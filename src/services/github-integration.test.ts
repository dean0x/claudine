import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { GitHubIntegration, PROptions } from './github-integration.js';
import { ConsoleLogger } from '../implementations/logger.js';
import { spawn } from 'child_process';
import { writeFile, unlink } from 'fs/promises';
import EventEmitter from 'events';

// Mock spawn
const createMockProcess = (stdout: string, stderr: string = '', exitCode: number = 0) => {
  const process = new EventEmitter() as any;
  process.stdout = new EventEmitter();
  process.stderr = new EventEmitter();
  
  // Simulate async output
  setTimeout(() => {
    if (stdout) process.stdout.emit('data', Buffer.from(stdout));
    if (stderr) process.stderr.emit('data', Buffer.from(stderr));
    process.emit('close', exitCode);
  }, 0);
  
  return process;
};

vi.mock('child_process', () => ({
  spawn: vi.fn()
}));

vi.mock('fs/promises', () => ({
  writeFile: vi.fn(),
  unlink: vi.fn()
}));

describe('GitHubIntegration', () => {
  let github: GitHubIntegration;
  let logger: ConsoleLogger;
  const mockSpawn = vi.mocked(spawn);
  const mockWriteFile = vi.mocked(writeFile);
  const mockUnlink = vi.mocked(unlink);

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new ConsoleLogger('test');
    vi.spyOn(logger, 'info').mockImplementation(() => {});
    vi.spyOn(logger, 'warn').mockImplementation(() => {});
    vi.spyOn(logger, 'error').mockImplementation(() => {});
    vi.spyOn(logger, 'debug').mockImplementation(() => {});
    
    github = new GitHubIntegration(logger);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isAvailable', () => {
    it('should return true when gh CLI is installed', async () => {
      mockSpawn.mockReturnValueOnce(
        createMockProcess('gh version 2.40.0 (2024-01-10)\n')
      );
      
      const available = await github.isAvailable();
      expect(available).toBe(true);
      
      expect(mockSpawn).toHaveBeenCalledWith('gh', ['--version'], expect.any(Object));
    });

    it('should return false when gh CLI is not installed', async () => {
      const process = new EventEmitter() as any;
      process.stdout = new EventEmitter();
      process.stderr = new EventEmitter();
      
      mockSpawn.mockReturnValueOnce(process);
      
      // Simulate command not found error
      setTimeout(() => {
        process.emit('error', new Error('Command not found'));
      }, 0);
      
      const available = await github.isAvailable();
      expect(available).toBe(false);
    });
  });

  describe('createPR', () => {
    beforeEach(() => {
      // Mock isAvailable to return true
      mockSpawn.mockImplementationOnce(() => 
        createMockProcess('gh version 2.40.0')
      );
    });

    it('should create PR with basic options', async () => {
      const prUrl = 'https://github.com/user/repo/pull/42';
      
      // For the actual PR creation
      mockSpawn.mockImplementationOnce(() => 
        createMockProcess(prUrl + '\n')
      );
      
      const options: PROptions = {
        title: 'Test PR',
        body: 'This is a test PR body',
        baseBranch: 'main',
        cwd: '/test/repo'
      };
      
      const result = await github.createPR(options);
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toBe(prUrl);
      }
      
      // Verify temp file was created
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('pr-body-'),
        'This is a test PR body',
        'utf-8'
      );
      
      // Verify gh command was called with correct args
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining([
          'pr', 'create',
          '--title', 'Test PR',
          '--body-file', expect.stringContaining('pr-body-'),
          '--base', 'main'
        ]),
        expect.objectContaining({ cwd: '/test/repo' })
      );
      
      // Verify temp file cleanup
      expect(mockUnlink).toHaveBeenCalledWith(expect.stringContaining('pr-body-'));
    });

    it('should create draft PR when draft option is true', async () => {
      const prUrl = 'https://github.com/user/repo/pull/43';
      
      mockSpawn.mockImplementationOnce(() => 
        createMockProcess(prUrl + '\n')
      );
      
      const options: PROptions = {
        title: 'Draft PR',
        body: 'Draft body',
        baseBranch: 'develop',
        cwd: '/test/repo',
        draft: true
      };
      
      const result = await github.createPR(options);
      
      expect(result.ok).toBe(true);
      
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        expect.arrayContaining(['--draft']),
        expect.any(Object)
      );
    });

    it('should add labels when provided', async () => {
      const prUrl = 'https://github.com/user/repo/pull/44';
      
      mockSpawn.mockImplementationOnce(() => 
        createMockProcess(prUrl + '\n')
      );
      
      const options: PROptions = {
        title: 'PR with labels',
        body: 'Body',
        baseBranch: 'main',
        cwd: '/test/repo',
        labels: ['bug', 'enhancement']
      };
      
      const result = await github.createPR(options);
      
      expect(result.ok).toBe(true);
      
      const spawnCall = mockSpawn.mock.calls.find(call => 
        call[1].includes('pr') && call[1].includes('create')
      );
      
      expect(spawnCall?.[1]).toContain('--label');
      expect(spawnCall?.[1]).toContain('bug');
      expect(spawnCall?.[1]).toContain('enhancement');
    });

    it('should handle PR creation failure', async () => {
      const errorMessage = 'Failed to create PR: repository not found';
      
      mockSpawn.mockImplementationOnce(() => 
        createMockProcess('', errorMessage, 1)
      );
      
      const options: PROptions = {
        title: 'Failed PR',
        body: 'Body',
        baseBranch: 'main',
        cwd: '/test/repo'
      };
      
      const result = await github.createPR(options);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain(errorMessage);
      }
      
      // Verify temp file cleanup even on failure
      expect(mockUnlink).toHaveBeenCalled();
    });

    it('should handle when gh CLI is not available', async () => {
      // Override the isAvailable check to return false
      const process = new EventEmitter() as any;
      process.stdout = new EventEmitter();
      process.stderr = new EventEmitter();
      
      // First call for isAvailable check
      mockSpawn.mockReset();
      mockSpawn.mockImplementationOnce(() => {
        setTimeout(() => {
          process.emit('error', new Error('Command not found'));
        }, 0);
        return process;
      });
      
      const options: PROptions = {
        title: 'Test PR',
        body: 'Body',
        baseBranch: 'main',
        cwd: '/test/repo'
      };
      
      const result = await github.createPR(options);
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('GitHub CLI not available');
      }
    });
  });

  describe('getPRStatus', () => {
    beforeEach(() => {
      // Mock isAvailable to return true
      mockSpawn.mockImplementationOnce(() => 
        createMockProcess('gh version 2.40.0')
      );
    });

    it('should get PR status successfully', async () => {
      const prData = {
        state: 'OPEN',
        mergeable: 'MERGEABLE',
        url: 'https://github.com/user/repo/pull/42'
      };
      
      mockSpawn.mockImplementationOnce(() => 
        createMockProcess(JSON.stringify(prData))
      );
      
      const result = await github.getPRStatus('42');
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.state).toBe('open');
        expect(result.value.mergeable).toBe(true);
        expect(result.value.url).toBe(prData.url);
      }
      
      expect(mockSpawn).toHaveBeenCalledWith(
        'gh',
        ['pr', 'view', '42', '--json', 'state,mergeable,url'],
        expect.any(Object)
      );
    });

    it('should reject invalid PR number format', async () => {
      const result = await github.getPRStatus('not-a-number');
      
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('Invalid PR number format');
      }
      
      // Should not call gh command for invalid input
      expect(mockSpawn).toHaveBeenCalledTimes(1); // Only for isAvailable
    });

    it('should handle unmergeable PR', async () => {
      const prData = {
        state: 'OPEN',
        mergeable: 'CONFLICTING',
        url: 'https://github.com/user/repo/pull/43'
      };
      
      mockSpawn.mockImplementationOnce(() => 
        createMockProcess(JSON.stringify(prData))
      );
      
      const result = await github.getPRStatus('43');
      
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.mergeable).toBe(false);
      }
    });
  });
});