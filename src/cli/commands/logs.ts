import { TaskId } from '../../core/domain.js';
import { errorMessage, withServices } from '../services.js';
import * as ui from '../ui.js';

export async function getTaskLogs(taskId: string, tail?: number) {
  const s = ui.createSpinner();
  try {
    s.start(`Fetching logs for ${taskId}...`);
    const { taskManager } = await withServices(s);

    const result = await taskManager.getLogs(TaskId(taskId));
    if (result.ok) {
      const logs = result.value;

      // Apply tail limit if specified
      let stdoutLines = logs.stdout || [];
      let stderrLines = logs.stderr || [];

      if (tail && tail > 0) {
        stdoutLines = stdoutLines.slice(-tail);
        stderrLines = stderrLines.slice(-tail);
      }

      const hasOutput = stdoutLines.length > 0 || stderrLines.length > 0;

      if (!hasOutput) {
        s.stop('No output captured');
        process.exit(0);
      }

      s.stop(`Logs for ${taskId}`);

      if (stdoutLines.length > 0) {
        ui.step(`stdout${tail ? ` (last ${tail} lines)` : ''}`);
        for (const line of stdoutLines) {
          process.stderr.write(`${line}\n`);
        }
      }
      if (stderrLines.length > 0) {
        ui.step(`stderr${tail ? ` (last ${tail} lines)` : ''}`);
        for (const line of stderrLines) {
          process.stderr.write(`${line}\n`);
        }
      }
      process.exit(0);
    } else {
      s.stop('Failed');
      ui.error(`Failed to get task logs: ${result.error.message}`);
      process.exit(1);
    }
  } catch (error) {
    s.stop('Failed');
    ui.error(errorMessage(error));
    process.exit(1);
  }
}
