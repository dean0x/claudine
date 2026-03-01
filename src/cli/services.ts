import { bootstrap } from '../bootstrap.js';
import type { Container } from '../core/container.js';
import type { ScheduleService, TaskManager } from '../core/interfaces.js';
import type { Spinner } from './ui.js';
import * as ui from './ui.js';

/** Extract a safe error message from an unknown catch value. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Bootstrap and resolve services, eliminating repeated boilerplate.
 * Accepts an optional spinner for progress feedback during async init.
 * Returns typed services or exits on failure.
 */
export async function withServices(s?: Spinner): Promise<{
  container: Container;
  taskManager: TaskManager;
  scheduleService: ScheduleService;
}> {
  s?.message('Initializing...');
  const containerResult = await bootstrap({ skipScheduleExecutor: true });
  if (!containerResult.ok) {
    s?.stop('Initialization failed');
    ui.error(`Bootstrap failed: ${containerResult.error.message}`);
    process.exit(1);
  }
  const container = containerResult.value;

  const taskManagerResult = await container.resolve<TaskManager>('taskManager');
  if (!taskManagerResult.ok) {
    s?.stop('Initialization failed');
    ui.error(`Failed to get task manager: ${taskManagerResult.error.message}`);
    process.exit(1);
  }

  const scheduleServiceResult = container.get<ScheduleService>('scheduleService');
  if (!scheduleServiceResult.ok) {
    s?.stop('Initialization failed');
    ui.error(`Failed to get schedule service: ${scheduleServiceResult.error.message}`);
    process.exit(1);
  }

  return {
    container,
    taskManager: taskManagerResult.value,
    scheduleService: scheduleServiceResult.value,
  };
}
