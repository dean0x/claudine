import { TaskId } from '../../core/domain.js';
import { errorMessage, withServices } from '../services.js';
import * as ui from '../ui.js';

export async function handleResumeCommand(taskId: string, additionalContext?: string) {
  const s = ui.createSpinner();
  try {
    s.start(`Resuming ${taskId}...`);
    const { taskManager } = await withServices(s);

    s.message('Resuming task...');
    const result = await taskManager.resume({
      taskId: TaskId(taskId),
      additionalContext,
    });

    if (result.ok) {
      const newTask = result.value;
      s.stop('Task resumed');
      ui.success(`New Task ID: ${newTask.id}`);
      ui.info(
        `Status: ${ui.colorStatus(newTask.status)}${newTask.retryCount ? ` | Retry #${newTask.retryCount}` : ''}${newTask.parentTaskId ? ` | Parent: ${newTask.parentTaskId}` : ''}`,
      );
      if (additionalContext) ui.info(`Context: ${additionalContext}`);
      process.exit(0);
    } else {
      s.stop('Resume failed');
      ui.error(`Failed to resume task: ${result.error.message}`);
      process.exit(1);
    }
  } catch (error) {
    s.stop('Resume failed');
    ui.error(errorMessage(error));
    process.exit(1);
  }
}
