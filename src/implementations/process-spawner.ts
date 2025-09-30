/**
 * Process spawning implementation
 * Handles Claude Code process creation
 */

import { spawn, ChildProcess } from 'child_process';
import { ProcessSpawner } from '../core/interfaces.js';
import { Result, ok, err, tryCatch } from '../core/result.js';
import { processSpawnFailed, ClaudineError, ErrorCode } from '../core/errors.js';
import { Configuration } from '../core/configuration.js';

export class ClaudeProcessSpawner implements ProcessSpawner {
  private readonly claudeCommand: string;
  private readonly baseArgs: readonly string[];
  private readonly killTimeouts = new Map<number, NodeJS.Timeout>();
  private readonly config: Configuration;

  constructor(
    config: Configuration,
    claudeCommand = 'claude'
  ) {
    this.config = config;
    this.claudeCommand = claudeCommand;
    this.baseArgs = Object.freeze(['--print', '--dangerously-skip-permissions', '--output-format', 'json']);
  }

  spawn(prompt: string, workingDirectory: string, taskId?: string): Result<{ process: ChildProcess; pid: number }> {
    return tryCatch(
      () => {
        // Make prompt more explicit if it looks like a simple command
        let finalPrompt = prompt;

        // If the prompt looks like a simple command without explicit instructions,
        // wrap it to make Claude understand it should execute it
        if (!prompt.toLowerCase().includes('run') &&
            !prompt.toLowerCase().includes('execute') &&
            !prompt.toLowerCase().includes('perform') &&
            !prompt.toLowerCase().includes('bash') &&
            !prompt.toLowerCase().includes('command') &&
            prompt.split(' ').length <= 3) {
          finalPrompt = `Execute the following bash command: ${prompt}`;
        }

        // With --print flag, prompt is passed as argument, not via stdin
        const args = [...this.baseArgs, finalPrompt];
        
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
        // Clear any existing timeout for this PID
        this.clearKillTimeout(pid);

        process.kill(pid, 'SIGTERM');

        // Give it time to terminate gracefully before forcing
        const timeoutId = setTimeout(() => {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Process might already be dead
          } finally {
            // Clean up timeout reference
            this.killTimeouts.delete(pid);
          }
        }, this.config.killGracePeriodMs!);

        // Track timeout for cleanup
        this.killTimeouts.set(pid, timeoutId);
      },
      (error) => new ClaudineError(
        ErrorCode.PROCESS_KILL_FAILED,
        `Failed to kill process ${pid}: ${error}`
      )
    );
  }

  /**
   * Clear kill timeout for a specific PID
   * @param pid - Process ID to clear timeout for
   * @remarks Prevents timeout leaks during cleanup
   * @internal
   */
  private clearKillTimeout(pid: number): void {
    const timeoutId = this.killTimeouts.get(pid);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.killTimeouts.delete(pid);
    }
  }

  /**
   * Clean up all pending kill timeouts and resources
   * @remarks Must be called during shutdown to prevent timeout leaks
   * @example
   * ```typescript
   * const spawner = new ClaudeProcessSpawner();
   * try {
   *   const result = spawner.spawn('test prompt', '/tmp', 'task-123');
   *   // use the spawned process
   * } finally {
   *   spawner.dispose(); // Ensure cleanup
   * }
   * ```
   */
  public dispose(): void {
    for (const [pid, timeoutId] of this.killTimeouts) {
      clearTimeout(timeoutId);
    }
    this.killTimeouts.clear();
  }
}

