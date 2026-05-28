/**
 * Real WorkerPool implementation using CommandExecutor for headless child processes.
 *
 * Provisions workers by:
 * 1. Creating a git worktree via GitPort
 * 2. Spawning a headless pi-bmad process via CommandExecutor
 * 3. Collecting stdout for HeadlessWorkflowOutput parsing
 * 4. Emitting events through OrchestratorEventBus
 */

import type { CommandExecutor, ChildHandle } from "../../shared/process.js";
import type { GitPort } from "../../shared/git.js";
import type { OrchestratorEventBus } from "../../events/bus.js";
import type { OrchestratorPaths } from "../../shared/paths.js";
import type { OrchestratorConfig } from "../../config.js";
import { parseHeadlessOutput } from "../../events/headless-output-parser.js";
import { join } from "node:path";

/** Configuration for provisioning a new worker. */
export interface WorkerProvisionConfig {
  /** Unique session identifier. */
  sessionId: string;
  /** BMAD agent ID. */
  agent: string;
  /** BMAD workflow ID. */
  workflow: string;
  /** Story ID for implementation-scoped dispatches, or null. */
  storyId: string | null;
  /** Dispatch prompt to send after session starts. */
  dispatchPrompt: string;
}

/** Handle to a provisioned worker. */
export interface WorkerHandle {
  /** Unique session identifier. */
  sessionId: string;
  /** Transport mechanism. */
  transport: "spawn";
  /** Absolute worktree path. */
  worktreePath: string;
  /** Git branch name. */
  branchName: string;
}

/** Internal state for a running worker. */
interface ActiveWorker {
  /** Worker handle returned to callers. */
  handle: WorkerHandle;
  /** Child process handle. */
  childProcess: ChildHandle;
  /** Accumulated stdout. */
  stdout: string;
  /** Start timestamp. */
  startedAt: string;
}

/** Dependencies for creating a SpawnWorkerPool. */
export interface SpawnWorkerPoolDeps {
  /** Command executor for spawning child processes. */
  exec: CommandExecutor;
  /** Git port for worktree operations. */
  git: GitPort;
  /** Event bus for audit events. */
  eventBus: OrchestratorEventBus;
  /** Resolved paths. */
  paths: OrchestratorPaths;
  /** Configuration. */
  config: OrchestratorConfig;
}

/** Callback for worker completion. */
type WorkerDoneCallback = (sessionId: string, exitCode: number, stdout: string) => void;

/**
 * Creates a real WorkerPool that spawns headless pi-bmad child processes.
 *
 * @param deps - Injected dependencies.
 *
 * @returns A WorkerPool implementation.
 */
export function createSpawnWorkerPool(deps: SpawnWorkerPoolDeps) {
  const { exec, git, eventBus, paths } = deps;
  const workers = new Map<string, ActiveWorker>();
  const doneCallbacks: WorkerDoneCallback[] = [];
  const staleCallbacks: ((sessionId: string) => void)[] = [];

  return {
    async provision(config: WorkerProvisionConfig): Promise<WorkerHandle> {
      const branchName = `worker/${config.sessionId}`;
      const worktreePath = join(paths.worktreeBase, config.sessionId);

      // Create git worktree
      await git.worktreeAdd(worktreePath, branchName, "HEAD");

      eventBus.emit("worker_state_changed", "orchestrator", {
        sessionId: config.sessionId,
        from: "creating",
        to: "active",
        reason: `Provisioned worktree at ${worktreePath}`,
      });

      // Build the pi command
      const piArgs = [
        "--no-extensions",
        "--no-skills",
        "-e", paths.piPiExtensionPath,
        "-e", paths.piBmadExtensionPath,
        "--model", "openai-codex/gpt-5.5",
        "--thinking", "xhigh",
        "-p",
        "--bmad-workflow", config.workflow,
        "--bmad-agent", config.agent,
        config.dispatchPrompt,
      ];

      // Spawn headless child process
      const childProcess = exec.spawn("pi", piArgs, {
        cwd: worktreePath,
        onStdout: (chunk: string) => {
          const worker = workers.get(config.sessionId);
          if (worker) {
            worker.stdout += chunk;
          }
        },
        onExit: (exitCode: number) => {
          const worker = workers.get(config.sessionId);
          if (worker) {
            const stdout = worker.stdout;
            workers.delete(config.sessionId);

            // Parse the HeadlessWorkflowOutput from stdout
            const parseResult = parseHeadlessOutput(stdout);

            eventBus.emit("dispatch_completed", "orchestrator", {
              dispatchId: config.sessionId,
              outcome: exitCode === 0 ? "success" : "failure",
            });

            if (parseResult.kind === "parsed") {
              eventBus.emit("worker_state_changed", "orchestrator", {
                sessionId: config.sessionId,
                from: "active",
                to: "completed",
                reason: `${parseResult.output.workflow}: ${parseResult.output.status} — returnType: ${parseResult.output.returnType} — payload: ${JSON.stringify(parseResult.output.payload)}`,
              });
            } else {
              eventBus.emit("worker_state_changed", "orchestrator", {
                sessionId: config.sessionId,
                from: "active",
                to: "completed",
                reason: `No HeadlessWorkflowOutput parsed: ${parseResult.kind}`,
              });
            }

            for (const callback of doneCallbacks) {
              callback(config.sessionId, exitCode, stdout);
            }
          }
        },
      });

      const handle: WorkerHandle = {
        sessionId: config.sessionId,
        transport: "spawn",
        worktreePath,
        branchName,
      };

      workers.set(config.sessionId, {
        handle,
        childProcess,
        stdout: "",
        startedAt: new Date().toISOString(),
      });

      eventBus.emit("dispatch_sent", "orchestrator", {
        dispatchId: config.sessionId,
        agent: config.agent,
        workflow: config.workflow,
        storyId: config.storyId,
      });

      return handle;
    },

    async steer(sessionId: string, message: string): Promise<void> {
      const worker = workers.get(sessionId);
      if (!worker) {
        throw new Error(`Worker ${sessionId} not found`);
      }
      eventBus.emit("steer_sent", "orchestrator", {
        messageRef: message,
        attempt: 1,
      });
    },

    async kill(sessionId: string): Promise<void> {
      const worker = workers.get(sessionId);
      if (worker) {
        worker.childProcess.kill();
        workers.delete(sessionId);
        eventBus.emit("worker_state_changed", "orchestrator", {
          sessionId,
          from: "active",
          to: "dead",
          reason: "Killed by orchestrator",
        });
      }
    },

    async killAll(): Promise<void> {
      for (const [sessionId, worker] of workers) {
        worker.childProcess.kill();
        eventBus.emit("worker_state_changed", "orchestrator", {
          sessionId,
          from: "active",
          to: "dead",
          reason: "killAll",
        });
      }
      workers.clear();
    },

    getActiveWorkers(): WorkerHandle[] {
      return Array.from(workers.values()).map((w) => w.handle);
    },

    getWorkerCount(): number {
      return workers.size;
    },

    onWorkerDone(callback: WorkerDoneCallback): () => void {
      doneCallbacks.push(callback);
      return () => {
        const index = doneCallbacks.indexOf(callback);
        if (index !== -1) doneCallbacks.splice(index, 1);
      };
    },

    onWorkerStale(callback: (sessionId: string) => void): () => void {
      staleCallbacks.push(callback);
      return () => {
        const index = staleCallbacks.indexOf(callback);
        if (index !== -1) staleCallbacks.splice(index, 1);
      };
    },

    dispose(): void {
      for (const [, worker] of workers) {
        worker.childProcess.kill();
      }
      workers.clear();
    },
  };
}
