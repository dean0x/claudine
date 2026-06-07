import { bootstrap } from '../../bootstrap.js';
import type { Container } from '../../core/container.js';
import { TaskId } from '../../core/domain.js';
import type { TaskManager } from '../../core/interfaces.js';
import { driveToCompletion, runDetached, waitForTaskCompletion } from '../drive-helpers.js';
import { errorMessage } from '../services.js';
import * as ui from '../ui.js';

/**
 * `beat retry <task-id>` — re-run a failed/cancelled task.
 *
 * ARCHITECTURE (issue #205): self-contained. Default invocation detaches a background
 * worker that creates the retry task AND drives it to completion via the tmux worker
 * subsystem (`mode: 'run'`). Previously this bootstrapped `mode: 'cli'` and exited, so the
 * retry task was created but never executed.
 */
export async function retryTask(taskId: string, isWorker: boolean): Promise<void> {
  if (!isWorker) {
    await runDetached({
      command: 'retry',
      args: [taskId],
      logPrefix: 'retry',
      // Matches the load-bearing "New Task ID:" line printed by the worker path.
      idPattern: /New Task ID:\s+(task-\S+)/,
      foundMessage: (id) => `Retry task started: ${id}`,
      infoLines: ['Check status: beat status {id}', 'View logs:    beat logs {id}'],
      entityLabel: 'Task',
    });
    return;
  }

  let container: Container | undefined;
  const s = ui.createSpinner();
  try {
    s.start(`Retrying ${taskId}...`);
    const containerResult = await bootstrap({ mode: 'run' });
    if (!containerResult.ok) {
      s.stop('Retry failed');
      ui.error(`Bootstrap failed: ${containerResult.error.message}`);
      process.exit(1);
    }
    container = containerResult.value;

    const taskManagerResult = await container.resolve<TaskManager>('taskManager');
    if (!taskManagerResult.ok) {
      s.stop('Retry failed');
      ui.error(`Failed to get task manager: ${taskManagerResult.error.message}`);
      await container.dispose();
      process.exit(1);
    }
    const taskManager = taskManagerResult.value;

    const result = await taskManager.retry(TaskId(taskId));
    if (!result.ok) {
      s.stop('Retry failed');
      ui.error(`Failed to retry task: ${result.error.message}`);
      await container.dispose();
      process.exit(1);
    }

    const newTask = result.value;
    s.stop('Retry task created');
    // CRITICAL: "New Task ID:" pattern is used by detach-mode polling.
    ui.success(`New Task ID: ${newTask.id}`);
    ui.info(
      `Status: ${ui.colorStatus(newTask.status)} | Retry #${newTask.retryCount || 1}${newTask.parentTaskId ? ` | Parent: ${newTask.parentTaskId}` : ''}`,
    );

    await driveToCompletion({
      container,
      wait: () => waitForTaskCompletion(container as Container, newTask.id),
      onSigint: () => {
        taskManager.cancel(newTask.id, 'User interrupted (SIGINT)');
      },
      sigintMessage: '\nCancelling task...\n',
    });
  } catch (error) {
    s.stop('Retry failed');
    ui.error(errorMessage(error));
    if (container) await container.dispose();
    process.exit(1);
  }
}
