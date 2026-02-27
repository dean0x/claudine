import { TaskId } from '../../core/domain.js';
import { errorMessage, withServices } from '../services.js';
import * as ui from '../ui.js';

export async function cancelTask(taskId: string, reason?: string) {
  const s = ui.createSpinner();
  try {
    s.start(`Cancelling ${taskId}...`);
    const { taskManager } = await withServices(s);

    const result = await taskManager.cancel(TaskId(taskId), reason);
    if (result.ok) {
      s.stop(`Task ${taskId} cancelled`);
      if (reason) ui.info(`Reason: ${reason}`);
      process.exit(0);
    } else {
      s.stop('Cancel failed');
      ui.error(`Failed to cancel task: ${result.error.message}`);
      process.exit(1);
    }
  } catch (error) {
    s.stop('Cancel failed');
    ui.error(errorMessage(error));
    process.exit(1);
  }
}
