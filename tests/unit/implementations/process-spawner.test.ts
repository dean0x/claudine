import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { ClaudeProcessSpawner } from '../../../src/implementations/process-spawner';
import { spawn } from 'child_process';
import type { ChildProcess } from 'child_process';
import { EventEmitter } from 'events';

// Mock child_process module
vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

// Mock process.kill
const originalKill = process.kill;

describe('ClaudeProcessSpawner - REAL Process Spawning Behavior', () => {
  let spawner: ClaudeProcessSpawner;
  let mockProcess: ChildProcess & EventEmitter;
  let mockSpawn: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    spawner = new ClaudeProcessSpawner();

    // Create a mock child process
    mockProcess = new EventEmitter() as ChildProcess & EventEmitter;
    mockProcess.pid = 12345;
    mockProcess.stdin = null;
    mockProcess.stdout = new EventEmitter() as any;
    mockProcess.stderr = new EventEmitter() as any;
    mockProcess.kill = vi.fn().mockReturnValue(true);

    // Setup spawn mock
    mockSpawn = spawn as ReturnType<typeof vi.fn>;
    mockSpawn.mockReturnValue(mockProcess);

    // Mock process.kill
    process.kill = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
    process.kill = originalKill;
  });

  describe('Process spawning', () => {
    it('should spawn claude process with correct arguments', () => {
      const result = spawner.spawn('test prompt', '/work/dir');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.process).toBe(mockProcess);
        expect(result.value.pid).toBe(12345);
      }

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        ['--print', '--dangerously-skip-permissions', '--output-format', 'json', 'test prompt'],
        expect.objectContaining({
          cwd: '/work/dir',
          stdio: ['ignore', 'pipe', 'pipe'],
          env: expect.objectContaining({
            CLAUDINE_WORKER: 'true'
          })
        })
      );
    });

    it('should include task ID in environment when provided', () => {
      spawner.spawn('prompt', '/dir', 'task-123');

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            CLAUDINE_WORKER: 'true',
            CLAUDINE_TASK_ID: 'task-123'
          })
        })
      );
    });

    it('should wrap simple commands with execution instruction', () => {
      spawner.spawn('ls -la', '/dir');

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.arrayContaining(['Execute the following bash command: ls -la']),
        expect.any(Object)
      );
    });

    it('should not wrap complex prompts', () => {
      const complexPrompts = [
        'Run the test suite and fix any errors',
        'Execute npm install',
        'Please perform a code review',
        'Use bash to list files',
        'Run this command: echo hello'
      ];

      complexPrompts.forEach(prompt => {
        mockSpawn.mockClear();
        spawner.spawn(prompt, '/dir');

        const args = mockSpawn.mock.calls[0][1];
        expect(args[args.length - 1]).toBe(prompt);
      });
    });

    it('should handle spawn failures gracefully', () => {
      mockSpawn.mockImplementation(() => {
        throw new Error('Command not found: claude');
      });

      const result = spawner.spawn('test', '/dir');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROCESS_SPAWN_FAILED');
        expect(result.error.message).toContain('Command not found');
      }
    });

    it('should handle missing PID', () => {
      mockProcess.pid = undefined;

      const result = spawner.spawn('test', '/dir');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Failed to get process PID');
      }
    });

    it('should preserve existing environment variables', () => {
      const originalEnv = { ...process.env };
      process.env.CUSTOM_VAR = 'test-value';

      spawner.spawn('prompt', '/dir');

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          env: expect.objectContaining({
            CUSTOM_VAR: 'test-value',
            CLAUDINE_WORKER: 'true'
          })
        })
      );

      process.env = originalEnv;
    });
  });

  describe('Custom claude command', () => {
    it('should use custom claude command if provided', () => {
      const customSpawner = new ClaudeProcessSpawner('/usr/local/bin/claude');

      customSpawner.spawn('test', '/dir');

      expect(mockSpawn).toHaveBeenCalledWith(
        '/usr/local/bin/claude',
        expect.any(Array),
        expect.any(Object)
      );
    });

    it('should use default claude command if not provided', () => {
      spawner.spawn('test', '/dir');

      expect(mockSpawn).toHaveBeenCalledWith(
        'claude',
        expect.any(Array),
        expect.any(Object)
      );
    });
  });

  describe('Process killing', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should send SIGTERM signal first', () => {
      const result = spawner.kill(54321);

      expect(result.ok).toBe(true);
      expect(process.kill).toHaveBeenCalledWith(54321, 'SIGTERM');
    });

    it('should send SIGKILL after 5 seconds', () => {
      spawner.kill(54321);

      expect(process.kill).toHaveBeenCalledTimes(1);
      expect(process.kill).toHaveBeenCalledWith(54321, 'SIGTERM');

      // Advance time by 5 seconds
      vi.advanceTimersByTime(5000);

      expect(process.kill).toHaveBeenCalledTimes(2);
      expect(process.kill).toHaveBeenCalledWith(54321, 'SIGKILL');
    });

    it('should handle SIGTERM failure gracefully', () => {
      (process.kill as any).mockImplementation(() => {
        throw new Error('No such process');
      });

      const result = spawner.kill(99999);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('PROCESS_KILL_FAILED');
        expect(result.error.message).toContain('99999');
      }
    });

    it('should ignore SIGKILL failure if process already dead', () => {
      let callCount = 0;
      (process.kill as any).mockImplementation(() => {
        callCount++;
        if (callCount === 2) {
          throw new Error('No such process');
        }
      });

      const result = spawner.kill(11111);

      expect(result.ok).toBe(true);

      vi.advanceTimersByTime(5000);

      // Should not throw even though SIGKILL failed
      expect(process.kill).toHaveBeenCalledTimes(2);
    });
  });

  describe('Working directory handling', () => {
    it('should set correct working directory', () => {
      const directories = [
        '/home/user/project',
        '/var/tmp',
        '.',
        '../parent',
        '/workspace/claudine'
      ];

      directories.forEach(dir => {
        mockSpawn.mockClear();
        spawner.spawn('test', dir);

        expect(mockSpawn).toHaveBeenCalledWith(
          expect.any(String),
          expect.any(Array),
          expect.objectContaining({ cwd: dir })
        );
      });
    });
  });

  describe('Stdio configuration', () => {
    it('should always use correct stdio configuration', () => {
      spawner.spawn('test', '/dir');

      expect(mockSpawn).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(Array),
        expect.objectContaining({
          stdio: ['ignore', 'pipe', 'pipe']
        })
      );
    });

    it('should provide piped stdout and stderr', () => {
      const result = spawner.spawn('test', '/dir');

      if (result.ok) {
        expect(result.value.process.stdout).toBeDefined();
        expect(result.value.process.stderr).toBeDefined();
        expect(result.value.process.stdin).toBeNull();
      }
    });
  });

  describe('Argument construction', () => {
    it('should maintain argument order', () => {
      spawner.spawn('my prompt', '/dir');

      const args = mockSpawn.mock.calls[0][1];
      expect(args).toEqual([
        '--print',
        '--dangerously-skip-permissions',
        '--output-format',
        'json',
        'my prompt'
      ]);
    });

    it('should handle prompts with special characters', () => {
      const specialPrompts = [
        'echo "hello world"',
        "grep 'pattern' file.txt",
        'find . -name "*.ts"',
        'cat file | grep error',
        'npm run test && echo done'
      ];

      specialPrompts.forEach(prompt => {
        mockSpawn.mockClear();
        const result = spawner.spawn(prompt, '/dir');

        expect(result.ok).toBe(true);
        const args = mockSpawn.mock.calls[0][1];
        expect(args[args.length - 1]).toContain(prompt);
      });
    });

    it('should handle multi-line prompts', () => {
      const multilinePrompt = `Please analyze this code
and find any bugs
then create a fix`;

      spawner.spawn(multilinePrompt, '/dir');

      const args = mockSpawn.mock.calls[0][1];
      expect(args[args.length - 1]).toBe(multilinePrompt);
    });
  });

  describe('Error handling patterns', () => {
    it('should wrap all errors in Result type', () => {
      const errors = [
        new Error('ENOENT'),
        new Error('EACCES'),
        new Error('spawn claude ENOENT'),
        'string error',
        null,
        undefined
      ];

      errors.forEach(error => {
        mockSpawn.mockImplementation(() => {
          throw error;
        });

        const result = spawner.spawn('test', '/dir');
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error).toBeDefined();
          expect(result.error.code).toBe('PROCESS_SPAWN_FAILED');
        }
      });
    });

    it('should handle async process errors', () => {
      const result = spawner.spawn('test', '/dir');

      expect(result.ok).toBe(true);

      // Simulate process error after spawning
      setImmediate(() => {
        mockProcess.emit('error', new Error('Process crashed'));
      });

      // The spawn itself succeeds, error handling is consumer's responsibility
      if (result.ok) {
        let errorCaught = false;
        result.value.process.on('error', () => {
          errorCaught = true;
        });

        return new Promise(resolve => {
          setTimeout(() => {
            expect(errorCaught).toBe(true);
            resolve(undefined);
          }, 10);
        });
      }
    });
  });

  describe('Real-world usage patterns', () => {
    it('should spawn multiple processes independently', () => {
      const pids = [10001, 10002, 10003];
      let pidIndex = 0;

      mockSpawn.mockImplementation(() => {
        const proc = new EventEmitter() as ChildProcess & EventEmitter;
        proc.pid = pids[pidIndex++];
        proc.stdout = new EventEmitter() as any;
        proc.stderr = new EventEmitter() as any;
        proc.stdin = null;
        return proc;
      });

      const results = [
        spawner.spawn('task 1', '/dir1'),
        spawner.spawn('task 2', '/dir2'),
        spawner.spawn('task 3', '/dir3')
      ];

      results.forEach((result, i) => {
        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.pid).toBe(pids[i]);
        }
      });
    });

    it('should handle rapid spawn and kill', () => {
      const result = spawner.spawn('quick task', '/dir');

      if (result.ok) {
        const killResult = spawner.kill(result.value.pid);
        expect(killResult.ok).toBe(true);
      }
    });

    it('should work with dependency injection', () => {
      class TaskRunner {
        constructor(private spawner: ClaudeProcessSpawner) {}

        runTask(prompt: string): boolean {
          const result = this.spawner.spawn(prompt, process.cwd());
          return result.ok;
        }
      }

      const runner = new TaskRunner(spawner);
      const success = runner.runTask('echo test');

      expect(success).toBe(true);
      expect(mockSpawn).toHaveBeenCalled();
    });
  });

  describe('Base arguments immutability', () => {
    it('should not allow modification of base arguments', () => {
      const spawner1 = new ClaudeProcessSpawner();
      spawner1.spawn('test 1', '/dir');

      const args1 = mockSpawn.mock.calls[0][1];

      mockSpawn.mockClear();

      const spawner2 = new ClaudeProcessSpawner();
      spawner2.spawn('test 2', '/dir');

      const args2 = mockSpawn.mock.calls[0][1];

      // Base args should be identical
      expect(args1.slice(0, 4)).toEqual(args2.slice(0, 4));
    });
  });
});