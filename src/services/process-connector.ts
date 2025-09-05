/**
 * Process Connector Service
 * Connects process stdout/stderr to OutputCapture
 */

import { ChildProcess } from 'child_process';
import { OutputCapture, Logger } from '../core/interfaces.js';
import { TaskId } from '../core/domain.js';

export class ProcessConnector {
  constructor(
    private readonly outputCapture: OutputCapture,
    private readonly logger: Logger
  ) {}

  /**
   * Connect a process to output capture
   */
  connect(
    process: ChildProcess,
    taskId: TaskId,
    onExit: (code: number | null) => void
  ): void {
    let exitHandled = false;
    
    const safeOnExit = (code?: number | null) => {
      if (exitHandled) {
        this.logger.debug('Multiple onExit calls prevented', { taskId, code });
        return;
      }
      exitHandled = true;
      onExit(code ?? null); // Use nullish coalescing to preserve 0
    };
    // Capture stdout
    if (process.stdout) {
      process.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        const result = this.outputCapture.capture(taskId, 'stdout', text);
        
        if (!result.ok) {
          this.logger.error('Failed to capture stdout', result.error, { taskId });
        }
      });
    }

    // Capture stderr
    if (process.stderr) {
      process.stderr.on('data', (data: Buffer) => {
        const text = data.toString();
        const result = this.outputCapture.capture(taskId, 'stderr', text);
        
        if (!result.ok) {
          this.logger.error('Failed to capture stderr', result.error, { taskId });
        }
      });
    }

    // Handle process exit
    process.on('exit', (code) => {
      this.logger.debug('Process exited', { taskId, code, codeType: typeof code });
      console.error(`[ProcessConnector] Process exit: taskId=${taskId}, code=${code}, type=${typeof code}`);
      safeOnExit(code);
    });

    // Handle process error
    process.on('error', (error) => {
      this.logger.error('Process error', error, { taskId });
      const result = this.outputCapture.capture(
        taskId,
        'stderr',
        `Process error: ${error.message}\n`
      );
      
      if (!result.ok) {
        this.logger.error('Failed to capture error', result.error, { taskId });
      }
      
      safeOnExit(1);
    });
  }
}