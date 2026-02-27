import { TaskId } from '../../core/domain.js';
import { errorMessage, withServices } from '../services.js';
import * as ui from '../ui.js';

export async function retryTask(taskId: string) {
  const s = ui.createSpinner();
  try {
    s.start(`Retrying ${taskId}...`);
    const { taskManager } = await withServices(s);

    const result = await taskManager.retry(TaskId(taskId));
    if (result.ok) {
      const newTask = result.value;
      s.stop('Retry task created');
      ui.success(`New Task ID: ${newTask.id}`);
      ui.info(
        `Status: ${ui.colorStatus(newTask.status)} | Retry #${newTask.retryCount || 1}${newTask.parentTaskId ? ` | Parent: ${newTask.parentTaskId}` : ''}`,
      );
      process.exit(0);
    } else {
      s.stop('Retry failed');
      ui.error(`Failed to retry task: ${result.error.message}`);
      process.exit(1);
    }
  } catch (error) {
    s.stop('Retry failed');
    ui.error(errorMessage(error));
    process.exit(1);
  }
}
