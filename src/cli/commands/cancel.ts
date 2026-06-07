import { TaskId } from '../../core/domain.js';
import type { WorkerRepository } from '../../core/interfaces.js';
import type { TmuxSessionManagerCorePort } from '../../core/tmux-types.js';
import { errorMessage, withServices } from '../services.js';
import * as ui from '../ui.js';

/**
 * `beat cancel <task-id> [reason]` — cancel a queued/running task.
 *
 * ARCHITECTURE (issue #205): self-contained. The event-driven cancel path
 * (WorkerHandler) kills the worker via the in-memory worker pool, which is empty in a
 * fresh CLI process — so previously the DB was marked cancelled but the detached tmux
 * session (an independent OS process) kept running. Here we look up the task's worker
 * registration (persisted across processes, migration v29) and destroy its tmux session
 * by name directly, then mark the task cancelled. Short-lived: no detach, no worker pool.
 */
export async function cancelTask(taskId: string, reason?: string) {
  const s = ui.createSpinner();
  try {
    s.start(`Cancelling ${taskId}...`);
    const { container, taskManager } = await withServices(s);
    const id = TaskId(taskId);

    // Resolve the tmux session name BEFORE cancelling — the registration may be cleaned
    // up as part of the cancellation flow. Best-effort: a task without a live tmux worker
    // (queued, or legacy process worker) simply has no session to destroy.
    let sessionName: string | undefined;
    const workerRepoResult = container.get<WorkerRepository>('workerRepository');
    if (workerRepoResult.ok) {
      const regResult = workerRepoResult.value.findByTaskId(id);
      if (regResult.ok && regResult.value) {
        sessionName = regResult.value.sessionName;
      }
    }

    const result = await taskManager.cancel(id, reason);
    if (!result.ok) {
      s.stop('Cancel failed');
      ui.error(`Failed to cancel task: ${result.error.message}`);
      await container.dispose();
      process.exit(1);
    }

    // Kill the tmux session directly (destroySession is idempotent). The session manager
    // is absent when a custom TmuxConnector is injected (tests) — skip the kill then.
    if (sessionName) {
      const sessionManagerResult = container.get<TmuxSessionManagerCorePort>('tmuxSessionManager');
      if (sessionManagerResult.ok) {
        const destroyResult = sessionManagerResult.value.destroySession(sessionName);
        if (!destroyResult.ok) {
          ui.info(`Warning: failed to destroy tmux session ${sessionName}: ${destroyResult.error.message}`);
        }
      }
    }

    s.stop(`Task ${taskId} cancelled`);
    if (reason) ui.info(`Reason: ${reason}`);
    if (sessionName) ui.info(`Killed session: ${sessionName}`);
    await container.dispose();
    process.exit(0);
  } catch (error) {
    s.stop('Cancel failed');
    ui.error(errorMessage(error));
    process.exit(1);
  }
}
