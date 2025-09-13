/**
 * Process spawning implementation
 * Handles Claude Code process creation
 */

import { spawn, ChildProcess } from 'child_process';
import { ProcessSpawner } from '../core/interfaces.js';
import { Result, ok, err, tryCatch } from '../core/result.js';
import { processSpawnFailed, ClaudineError, ErrorCode } from '../core/errors.js';

export class ClaudeProcessSpawner implements ProcessSpawner {
  private readonly claudeCommand: string;
  private readonly baseArgs: readonly string[];

  constructor(
    claudeCommand = 'claude'
  ) {
    this.claudeCommand = claudeCommand;
    this.baseArgs = Object.freeze(['--print', '--dangerously-skip-permissions', '--output-format', 'json']);
  }

  spawn(prompt: string, workingDirectory: string, taskId?: string): Result<{ process: ChildProcess; pid: number }> {
    return tryCatch(
      () => {
        // With --print flag, prompt is passed as argument, not via stdin
        const args = [...this.baseArgs, prompt];
        
        // Log via proper logger instead of console.error to avoid interfering with output capture
        // console.error(`[ProcessSpawner] Executing: ${this.claudeCommand} ${args.map(arg => `"${arg}"`).join(' ')}`);
        // console.error(`[ProcessSpawner] Working directory: ${workingDirectory}`);
        // console.error(`[ProcessSpawner] Environment keys: ${Object.keys(process.env).length}`);
        
        // Add Claudine-specific environment variables for identification
        const env = {
          ...process.env,
          CLAUDINE_WORKER: 'true',
          ...(taskId && { CLAUDINE_TASK_ID: taskId })
        };
        
        const child = spawn(this.claudeCommand, args, {
          cwd: workingDirectory,
          env,
          stdio: ['ignore', 'pipe', 'pipe'],
        });

        if (!child.pid) {
          throw new Error('Failed to get process PID');
        }

        return { process: child, pid: child.pid };
      },
      (error) => processSpawnFailed(String(error))
    );
  }

  kill(pid: number): Result<void> {
    return tryCatch(
      () => {
        process.kill(pid, 'SIGTERM');
        
        // Give it 5 seconds to terminate gracefully
        setTimeout(() => {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Process might already be dead
          }
        }, 5000);
      },
      (error) => new ClaudineError(
        ErrorCode.PROCESS_KILL_FAILED,
        `Failed to kill process ${pid}: ${error}`
      )
    );
  }
}

