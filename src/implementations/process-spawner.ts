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
    claudeCommand = 'claude',
    private readonly mockMode = false
  ) {
    this.claudeCommand = claudeCommand;
    this.baseArgs = Object.freeze(['--no-interaction', '--dangerously-skip-permissions']);
  }

  spawn(prompt: string, workingDirectory: string): Result<{ process: ChildProcess; pid: number }> {
    if (this.mockMode) {
      return this.spawnMock(prompt, workingDirectory);
    }

    return tryCatch(
      () => {
        const args = [...this.baseArgs];
        const child = spawn(this.claudeCommand, args, {
          cwd: workingDirectory,
          env: { ...process.env },
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        if (!child.pid) {
          throw new Error('Failed to get process PID');
        }

        // Send the prompt to stdin
        child.stdin?.write(prompt);
        child.stdin?.end();

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

  private spawnMock(prompt: string, workingDirectory: string): Result<{ process: ChildProcess; pid: number }> {
    return tryCatch(
      () => {
        // In mock mode, spawn a simple echo process
        const child = spawn('sh', ['-c', `
          echo "Starting mock task: ${prompt.substring(0, 50)}..."
          sleep 2
          echo "Mock task completed successfully"
        `], {
          cwd: workingDirectory,
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        if (!child.pid) {
          throw new Error('Failed to get mock process PID');
        }

        return { process: child, pid: child.pid };
      },
      (error) => processSpawnFailed(String(error))
    );
  }
}

/**
 * Test implementation that doesn't spawn real processes
 */
export class TestProcessSpawner implements ProcessSpawner {
  private nextPid = 1000;
  private readonly processes = new Map<number, MockProcess>();

  spawn(prompt: string, workingDirectory: string): Result<{ process: ChildProcess; pid: number }> {
    const pid = this.nextPid++;
    const mockProcess = new MockProcess(pid, prompt, workingDirectory);
    this.processes.set(pid, mockProcess);
    
    // Simulate async completion
    setTimeout(() => {
      mockProcess.complete();
    }, 100);
    
    return ok({ process: mockProcess as any, pid });
  }

  kill(pid: number): Result<void> {
    const process = this.processes.get(pid);
    if (!process) {
      return err(new ClaudineError(
        ErrorCode.PROCESS_NOT_FOUND,
        `Process ${pid} not found`
      ));
    }
    
    process.kill();
    this.processes.delete(pid);
    return ok(undefined);
  }

  // Test helpers
  getProcess(pid: number): MockProcess | undefined {
    return this.processes.get(pid);
  }

  clear(): void {
    this.processes.clear();
    this.nextPid = 1000;
  }
}

class MockProcess {
  public stdout = new MockStream();
  public stderr = new MockStream();
  public stdin = new MockStream();
  private exitCode: number | null = null;
  private killed = false;
  private readonly listeners = new Map<string, Function[]>();

  constructor(
    public readonly pid: number,
    public readonly prompt: string,
    public readonly cwd: string
  ) {}

  on(event: string, listener: Function): this {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  complete(code = 0): void {
    if (this.killed) return;
    
    this.exitCode = code;
    this.stdout.push(`Task completed: ${this.prompt.substring(0, 50)}`);
    this.emit('exit', code);
  }

  kill(): void {
    this.killed = true;
    this.emit('exit', -1);
  }

  private emit(event: string, ...args: any[]): void {
    const listeners = this.listeners.get(event) || [];
    listeners.forEach(listener => listener(...args));
  }
}

class MockStream {
  private readonly chunks: string[] = [];
  private readonly listeners = new Map<string, Function[]>();

  on(event: string, listener: Function): this {
    const listeners = this.listeners.get(event) || [];
    listeners.push(listener);
    this.listeners.set(event, listeners);
    return this;
  }

  push(data: string): void {
    this.chunks.push(data);
    this.emit('data', Buffer.from(data));
  }

  write(data: string): void {
    this.chunks.push(data);
  }

  end(): void {
    this.emit('end');
  }

  private emit(event: string, ...args: any[]): void {
    const listeners = this.listeners.get(event) || [];
    listeners.forEach(listener => listener(...args));
  }
}