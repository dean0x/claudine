import { bootstrap } from '../../bootstrap.js';
import type { Container } from '../../core/container.js';
import { TaskId } from '../../core/domain.js';
import type { TaskManager } from '../../core/interfaces.js';
import { driveToCompletion, runDetached, waitForTaskCompletion } from '../drive-helpers.js';
import { errorMessage } from '../services.js';
import * as ui from '../ui.js';

/**
 * `beat resume <task-id> [--context "..."]` — resume a task from its checkpoint.
 *
 * ARCHITECTURE (issue #205): self-contained. Default invocation detaches a background
 * worker that creates the resumed task AND drives it to completion via the tmux worker
 * subsystem (`mode: 'run'`). Previously this bootstrapped `mode: 'cli'` and exited, so the
 * resumed task was created but never executed.
 */
export async function handleResumeCommand(
  taskId: string,
  additionalContext: string | undefined,
  isWorker: boolean,
): Promise<void> {
  if (!isWorker) {
    const args = [taskId, ...(additionalContext ? ['--context', additionalContext] : [])];
    await runDetached({
      command: 'resume',
      args,
      logPrefix: 'resume',
      // Matches the load-bearing "New Task ID:" line printed by the worker path.
      idPattern: /New Task ID:\s+(task-\S+)/,
      foundMessage: (id) => `Resumed task started: ${id}`,
      infoLines: ['Check status: beat status {id}', 'View logs:    beat logs {id}'],
      entityLabel: 'Task',
    });
    return;
  }

  let container: Container | undefined;
  const s = ui.createSpinner();
  try {
    s.start(`Resuming ${taskId}...`);
    const containerResult = await bootstrap({ mode: 'run' });
    if (!containerResult.ok) {
      s.stop('Resume failed');
      ui.error(`Bootstrap failed: ${containerResult.error.message}`);
      process.exit(1);
    }
    container = containerResult.value;

    const taskManagerResult = await container.resolve<TaskManager>('taskManager');
    if (!taskManagerResult.ok) {
      s.stop('Resume failed');
      ui.error(`Failed to get task manager: ${taskManagerResult.error.message}`);
      await container.dispose();
      process.exit(1);
    }
    const taskManager = taskManagerResult.value;

    const result = await taskManager.resume({ taskId: TaskId(taskId), additionalContext });
    if (!result.ok) {
      s.stop('Resume failed');
      ui.error(`Failed to resume task: ${result.error.message}`);
      await container.dispose();
      process.exit(1);
    }

    const newTask = result.value;
    s.stop('Task resumed');
    // CRITICAL: "New Task ID:" pattern is used by detach-mode polling.
    ui.success(`New Task ID: ${newTask.id}`);
    ui.info(
      `Status: ${ui.colorStatus(newTask.status)}${newTask.retryCount ? ` | Retry #${newTask.retryCount}` : ''}${newTask.parentTaskId ? ` | Parent: ${newTask.parentTaskId}` : ''}`,
    );
    if (additionalContext) ui.info(`Context: ${additionalContext}`);

    await driveToCompletion({
      container,
      wait: () => waitForTaskCompletion(container as Container, newTask.id),
      onSigint: () => taskManager.cancel(newTask.id, 'User interrupted (SIGINT)'),
      sigintMessage: '\nCancelling task...\n',
    });
  } catch (error) {
    s.stop('Resume failed');
    ui.error(errorMessage(error));
    if (container) await container.dispose();
    process.exit(1);
  }
}
