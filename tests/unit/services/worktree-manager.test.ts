/**
 * Unit tests for GitWorktreeManager
 * ARCHITECTURE: Tests git worktree management with mocked simple-git and fs/promises
 * Pattern: Behavioral testing - focuses on worktree lifecycle, safety checks,
 *          merge strategies, and error handling
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { TaskId } from '../../../src/core/domain';
import { ClaudineError, ErrorCode } from '../../../src/core/errors';
import { err, ok } from '../../../src/core/result';
import { TaskFactory } from '../../fixtures/factories';
import { createMockLogger } from '../../fixtures/mocks';

// Mock simple-git BEFORE imports
const mockGitInstance = {
  status: vi.fn().mockResolvedValue({ current: 'main', isClean: () => true }),
  raw: vi.fn().mockResolvedValue(''),
  checkout: vi.fn().mockResolvedValue(undefined),
  merge: vi.fn().mockResolvedValue(undefined),
  add: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  push: vi.fn().mockResolvedValue(undefined),
};

vi.mock('simple-git', () => ({
  simpleGit: vi.fn(() => mockGitInstance),
}));

vi.mock('fs/promises', () => ({
  default: {
    mkdir: vi.fn().mockResolvedValue(undefined),
    stat: vi.fn().mockResolvedValue({ mtime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) }), // 60 days old
    rm: vi.fn().mockResolvedValue(undefined),
    writeFile: vi.fn().mockResolvedValue(undefined),
  },
}));

// Mock retryWithBackoff to avoid delays in tests - pass through immediately
vi.mock('../../../src/utils/retry', () => ({
  retryWithBackoff: vi.fn(async (fn: () => Promise<unknown>) => fn()),
  isRetryableError: vi.fn(() => false),
}));

import fs from 'fs/promises';
// Import AFTER mocks
import { type GitHubIntegration, GitWorktreeManager } from '../../../src/services/worktree-manager';

describe('GitWorktreeManager', () => {
  let manager: GitWorktreeManager;
  let mockLogger: ReturnType<typeof createMockLogger>;
  let mockGithubIntegration: GitHubIntegration;

  beforeEach(() => {
    vi.clearAllMocks();

    mockLogger = createMockLogger();
    mockGithubIntegration = {
      isAvailable: vi.fn().mockResolvedValue(true),
      createPR: vi.fn().mockResolvedValue(ok('https://github.com/test/repo/pull/1')),
    } as unknown as GitHubIntegration;

    // Reset default mock behaviors
    mockGitInstance.status.mockResolvedValue({ current: 'main', isClean: () => true });
    mockGitInstance.raw.mockResolvedValue('');
    mockGitInstance.checkout.mockResolvedValue(undefined);
    mockGitInstance.merge.mockResolvedValue(undefined);
    mockGitInstance.add.mockResolvedValue(undefined);
    mockGitInstance.commit.mockResolvedValue(undefined);
    mockGitInstance.push.mockResolvedValue(undefined);

    (fs.mkdir as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
      mtime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
    });
    (fs.rm as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    (fs.writeFile as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);

    manager = new GitWorktreeManager(mockLogger, mockGithubIntegration, '/tmp/worktrees');
  });

  describe('getCurrentBranch', () => {
    it('should return branch name from git status', async () => {
      mockGitInstance.status.mockResolvedValue({ current: 'feature/my-branch', isClean: () => true });

      const branch = await manager.getCurrentBranch();

      expect(branch).toBe('feature/my-branch');
    });

    it('should return "main" when git status fails', async () => {
      mockGitInstance.status.mockRejectedValue(new Error('git not found'));

      const branch = await manager.getCurrentBranch();

      expect(branch).toBe('main');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Failed to get current branch, defaulting to main',
        expect.any(Object),
      );
    });
  });

  describe('createWorktree', () => {
    it('should create worktree with generated branch name', async () => {
      const task = new TaskFactory().withId('test-task-1').withUseWorktree(true).build();

      const result = await manager.createWorktree(task);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.path).toContain('task-');
        expect(result.value.path).toContain(task.id);
        expect(result.value.branch).toMatch(/^claudine\/task-/);
        expect(result.value.baseBranch).toBe('main');
      }

      // Verify git commands were called
      expect(mockGitInstance.raw).toHaveBeenCalledWith(['worktree', 'list', '--porcelain']);
      expect(mockGitInstance.raw).toHaveBeenCalledWith(expect.arrayContaining(['worktree', 'add', '-b']));
    });

    it('should sanitize branch name by removing shell metacharacters', async () => {
      const task = new TaskFactory().withId('test-task-2').withUseWorktree(true).build();
      // Override branchName with shell metacharacters via spread
      const taskWithDirtyBranch = { ...task, branchName: 'feat/my`branch;rm -rf /' };

      const result = await manager.createWorktree(taskWithDirtyBranch);

      expect(result.ok).toBe(true);
      if (result.ok) {
        // Backtick, semicolons, spaces should be replaced with dashes
        expect(result.value.branch).not.toContain('`');
        expect(result.value.branch).not.toContain(';');
        expect(result.value.branch).not.toContain(' ');
        // But slashes and alphanumeric should be preserved
        expect(result.value.branch).toContain('feat/my');
      }
    });

    it('should use custom branchName from task', async () => {
      const task = new TaskFactory().withId('test-task-3').withUseWorktree(true).build();
      const taskWithBranch = { ...task, branchName: 'custom/branch-name' };

      const result = await manager.createWorktree(taskWithBranch);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.branch).toBe('custom/branch-name');
      }
    });

    it('should remove existing worktree before creating new one', async () => {
      const task = new TaskFactory().withId('test-task-4').withUseWorktree(true).build();

      // Mock worktree list to include existing worktree path
      const worktreePath = `/tmp/worktrees/task-${task.id}`;
      mockGitInstance.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'list') {
          return `worktree ${worktreePath}\nHEAD abc123\nbranch refs/heads/old-branch\n`;
        }
        return '';
      });

      const result = await manager.createWorktree(task);

      expect(result.ok).toBe(true);
      // Should have called remove on existing worktree
      expect(mockGitInstance.raw).toHaveBeenCalledWith(['worktree', 'remove', worktreePath, '--force']);
    });

    it('should return error on git failure', async () => {
      const task = new TaskFactory().withId('test-task-5').withUseWorktree(true).build();

      mockGitInstance.raw.mockRejectedValue(new Error('fatal: branch already exists'));

      const result = await manager.createWorktree(task);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ClaudineError);
        expect(result.error.message).toContain('Failed to create worktree');
        expect(result.error.message).toContain('branch already exists');
      }
    });

    it('should use task baseBranch when provided', async () => {
      const task = new TaskFactory().withId('test-task-6').withUseWorktree(true).build();
      const taskWithBase = { ...task, baseBranch: 'develop' };

      const result = await manager.createWorktree(taskWithBase);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.baseBranch).toBe('develop');
      }
      // Verify the base branch was passed to git worktree add
      expect(mockGitInstance.raw).toHaveBeenCalledWith(expect.arrayContaining(['develop']));
    });
  });

  describe('completeTask', () => {
    const createWorktreeInfo = (overrides: Partial<{ path: string; branch: string; baseBranch: string }> = {}) => ({
      path: '/tmp/worktrees/task-test-1',
      branch: 'claudine/task-test-1',
      baseBranch: 'main',
      ...overrides,
    });

    describe('PR strategy (default)', () => {
      it('should push branch and return branch_pushed when no github integration', async () => {
        // Create manager without github integration
        const managerNoGh = new GitWorktreeManager(mockLogger, undefined, '/tmp/worktrees');
        const task = new TaskFactory().withId('pr-task-1').withUseWorktree(true).build();
        const info = createWorktreeInfo();

        const result = await managerNoGh.completeTask(task, info);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe('branch_pushed');
          expect(result.value.branch).toBe('claudine/task-test-1');
        }
      });

      it('should create PR when github integration is available', async () => {
        const task = new TaskFactory().withId('pr-task-2').withUseWorktree(true).build();
        const info = createWorktreeInfo();

        const result = await manager.completeTask(task, info);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe('pr_created');
          expect(result.value.prUrl).toBe('https://github.com/test/repo/pull/1');
        }

        expect(mockGithubIntegration.createPR).toHaveBeenCalledWith(
          expect.objectContaining({
            baseBranch: 'main',
            cwd: info.path,
          }),
        );
      });

      it('should return error when github integration PR creation fails', async () => {
        (mockGithubIntegration.createPR as ReturnType<typeof vi.fn>).mockResolvedValue(
          err(new ClaudineError(ErrorCode.SYSTEM_ERROR, 'PR creation failed')),
        );
        const task = new TaskFactory().withId('pr-task-3').withUseWorktree(true).build();
        const info = createWorktreeInfo();

        const result = await manager.completeTask(task, info);

        expect(result.ok).toBe(false);
      });
    });

    describe('auto strategy', () => {
      it('should merge branch into base branch', async () => {
        const task = new TaskFactory().withId('auto-task-1').withUseWorktree(true).build();
        const taskWithStrategy = { ...task, mergeStrategy: 'auto' as const };
        const info = createWorktreeInfo();

        const result = await manager.completeTask(taskWithStrategy, info);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe('merged');
          expect(result.value.branch).toBe('claudine/task-test-1');
        }

        expect(mockGitInstance.checkout).toHaveBeenCalledWith('main');
        expect(mockGitInstance.merge).toHaveBeenCalledWith(expect.arrayContaining(['claudine/task-test-1', '--no-ff']));
      });

      it('should restore original branch on merge failure', async () => {
        mockGitInstance.merge.mockRejectedValue(new Error('merge conflict'));
        const task = new TaskFactory().withId('auto-task-2').withUseWorktree(true).build();
        const taskWithStrategy = { ...task, mergeStrategy: 'auto' as const };
        const info = createWorktreeInfo();

        const result = await manager.completeTask(taskWithStrategy, info);

        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.message).toContain('Auto-merge failed');
        }
        // Should have attempted to restore original branch
        expect(mockGitInstance.checkout).toHaveBeenCalledWith('main');
      });
    });

    describe('manual strategy', () => {
      it('should push branch only', async () => {
        const task = new TaskFactory().withId('manual-task-1').withUseWorktree(true).build();
        const taskWithStrategy = { ...task, mergeStrategy: 'manual' as const };
        const info = createWorktreeInfo();

        const result = await manager.completeTask(taskWithStrategy, info);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe('branch_pushed');
          expect(result.value.branch).toBe('claudine/task-test-1');
        }
      });
    });

    describe('patch strategy', () => {
      it('should create patch file', async () => {
        mockGitInstance.raw.mockResolvedValue('diff --git a/file.ts b/file.ts\n+new line\n');
        const task = new TaskFactory().withId('patch-task-1').withUseWorktree(true).build();
        const taskWithStrategy = { ...task, mergeStrategy: 'patch' as const };
        const info = createWorktreeInfo();

        const result = await manager.completeTask(taskWithStrategy, info);

        expect(result.ok).toBe(true);
        if (result.ok) {
          expect(result.value.action).toBe('patch_created');
          expect(result.value.patchPath).toContain('patch-task-1');
        }

        expect(fs.writeFile).toHaveBeenCalled();
      });
    });

    describe('auto-commit', () => {
      it('should commit changes when task.autoCommit is true and changes exist', async () => {
        // Mock: worktree has uncommitted changes
        mockGitInstance.status.mockResolvedValue({ current: 'main', isClean: () => false });

        const task = new TaskFactory().withId('commit-task-1').withUseWorktree(true).build();
        // autoCommit defaults to true in createTask
        const info = createWorktreeInfo();

        await manager.completeTask(task, info);

        expect(mockGitInstance.add).toHaveBeenCalledWith('.');
        expect(mockGitInstance.commit).toHaveBeenCalled();
      });

      it('should sanitize commit messages by removing shell metacharacters', async () => {
        mockGitInstance.status.mockResolvedValue({ current: 'main', isClean: () => false });

        const task = new TaskFactory()
          .withId('commit-task-2')
          .withPrompt('Fix bug `rm -rf /`; echo "pwned"')
          .withUseWorktree(true)
          .build();
        const info = createWorktreeInfo();

        await manager.completeTask(task, info);

        // Verify the commit message was sanitized
        const commitCall = mockGitInstance.commit.mock.calls[0];
        if (commitCall) {
          const commitMessage = commitCall[0] as string;
          expect(commitMessage).not.toContain('`');
          expect(commitMessage).not.toContain(';');
          expect(commitMessage).not.toContain('"');
        }
      });

      it('should not commit when autoCommit is false', async () => {
        mockGitInstance.status.mockResolvedValue({ current: 'main', isClean: () => false });

        const task = new TaskFactory().withId('commit-task-3').withUseWorktree(true).build();
        const taskNoAutoCommit = { ...task, autoCommit: false };
        const info = createWorktreeInfo();

        await manager.completeTask(taskNoAutoCommit, info);

        expect(mockGitInstance.add).not.toHaveBeenCalled();
        expect(mockGitInstance.commit).not.toHaveBeenCalled();
      });
    });
  });

  describe('removeWorktree', () => {
    // Helper: create a worktree in the manager's internal state
    async function setupWorktree(taskId: string): Promise<void> {
      const task = new TaskFactory().withId(taskId).withUseWorktree(true).build();
      mockGitInstance.raw.mockResolvedValue('');
      await manager.createWorktree(task);
      // Reset mocks after setup
      mockGitInstance.raw.mockReset();
      mockGitInstance.raw.mockResolvedValue('');
    }

    it('should return ok for unknown task (already removed)', async () => {
      const result = await manager.removeWorktree(TaskId('nonexistent'));

      expect(result.ok).toBe(true);
    });

    it('should block removal of recent worktrees when safety check is enabled', async () => {
      await setupWorktree('recent-task');

      // Mock fs.stat to return recent modification time (1 day old < 30 day threshold)
      (fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
        mtime: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day old
      });

      const result = await manager.removeWorktree(TaskId('recent-task'));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toContain('too recent');
      }
    });

    it('should force removal bypassing safety checks', async () => {
      await setupWorktree('force-task');

      // Mock fs.stat to return recent modification time
      (fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
        mtime: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day old
      });

      const result = await manager.removeWorktree(TaskId('force-task'), true);

      expect(result.ok).toBe(true);
      expect(mockGitInstance.raw).toHaveBeenCalledWith(expect.arrayContaining(['worktree', 'remove']));
    });

    it('should fall back to fs.rm when git worktree remove fails', async () => {
      await setupWorktree('fallback-task');

      // Make worktree old enough to pass safety check
      (fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
        mtime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days old
      });

      // Use mockImplementation to differentiate between git raw calls:
      // - 'worktree remove' should fail (triggers fallback)
      // - 'rev-list' for unpushed changes check should succeed (passes safety)
      // - 'worktree prune' should succeed (fallback cleanup)
      mockGitInstance.raw.mockImplementation(async (args: string[]) => {
        if (args[0] === 'worktree' && args[1] === 'remove') {
          throw new Error('worktree not locked');
        }
        if (args[0] === 'worktree' && args[1] === 'prune') {
          return '';
        }
        // rev-list: return '0' (no unpushed changes)
        if (args[0] === 'rev-list') {
          return '0';
        }
        return '';
      });

      const result = await manager.removeWorktree(TaskId('fallback-task'));

      expect(result.ok).toBe(true);
      expect(fs.rm).toHaveBeenCalledWith(expect.stringContaining('fallback-task'), { recursive: true, force: true });
    });

    it('should return error when both removal methods fail', async () => {
      await setupWorktree('double-fail-task');

      // Make worktree old enough to pass safety check
      (fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
        mtime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000),
      });

      // Both git worktree remove and fs.rm fail
      mockGitInstance.raw.mockRejectedValue(new Error('git worktree remove failed'));
      (fs.rm as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fs.rm failed'));

      const result = await manager.removeWorktree(TaskId('double-fail-task'));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ClaudineError);
        expect(result.error.message).toContain('Failed to remove worktree');
      }
    });

    it('should remove worktree that passes safety checks', async () => {
      await setupWorktree('old-task');

      // Make worktree old enough (> 30 days default)
      (fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
        mtime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000), // 60 days
      });

      const result = await manager.removeWorktree(TaskId('old-task'));

      expect(result.ok).toBe(true);
    });
  });

  describe('getWorktreeStatus', () => {
    it('should return error for unknown task', async () => {
      const result = await manager.getWorktreeStatus(TaskId('unknown'));

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ClaudineError);
        expect(result.error.code).toBe(ErrorCode.TASK_NOT_FOUND);
      }
    });

    it('should return status with correct fields for active worktree', async () => {
      const task = new TaskFactory().withId('status-task').withUseWorktree(true).build();
      await manager.createWorktree(task);

      // Mock fs.stat for age calculation
      const thirtyOneDaysAgo = new Date(Date.now() - 31 * 24 * 60 * 60 * 1000);
      (fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({ mtime: thirtyOneDaysAgo });

      const result = await manager.getWorktreeStatus(TaskId('status-task'));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.taskId).toBe(TaskId('status-task'));
        expect(result.value.path).toContain('status-task');
        expect(result.value.branch).toMatch(/claudine\/task-/);
        expect(result.value.baseBranch).toBe('main');
        expect(result.value.ageInDays).toBeGreaterThan(30);
        expect(typeof result.value.hasUnpushedChanges).toBe('boolean');
        expect(typeof result.value.safeToRemove).toBe('boolean');
        expect(result.value.exists).toBe(true);
      }
    });

    it('should handle non-existent worktree directory', async () => {
      const task = new TaskFactory().withId('gone-task').withUseWorktree(true).build();
      await manager.createWorktree(task);

      // Mock fs.stat to throw ENOENT
      const enoentError = new Error('ENOENT: no such file or directory') as NodeJS.ErrnoException;
      enoentError.code = 'ENOENT';
      (fs.stat as ReturnType<typeof vi.fn>).mockRejectedValue(enoentError);

      const result = await manager.getWorktreeStatus(TaskId('gone-task'));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.exists).toBe(false);
        expect(result.value.ageInDays).toBe(0);
        expect(result.value.hasUnpushedChanges).toBe(false);
      }
    });
  });

  describe('getWorktreeStatuses', () => {
    it('should return statuses for all active worktrees', async () => {
      // Create two worktrees
      const task1 = new TaskFactory().withId('multi-task-1').withUseWorktree(true).build();
      const task2 = new TaskFactory().withId('multi-task-2').withUseWorktree(true).build();

      await manager.createWorktree(task1);
      await manager.createWorktree(task2);

      const result = await manager.getWorktreeStatuses();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(2);
        const taskIds = result.value.map((s) => s.taskId);
        expect(taskIds).toContain(TaskId('multi-task-1'));
        expect(taskIds).toContain(TaskId('multi-task-2'));
      }
    });

    it('should return empty array when no worktrees exist', async () => {
      const result = await manager.getWorktreeStatuses();

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(0);
      }
    });
  });

  describe('cleanup', () => {
    async function setupWorktree(taskId: string): Promise<void> {
      const task = new TaskFactory().withId(taskId).withUseWorktree(true).build();
      mockGitInstance.raw.mockResolvedValue('');
      await manager.createWorktree(task);
    }

    it('should remove all active worktrees', async () => {
      await setupWorktree('cleanup-1');
      await setupWorktree('cleanup-2');

      // Force removal to bypass safety checks
      const result = await manager.cleanup(true);

      expect(result.ok).toBe(true);

      // Verify worktrees are gone - getWorktreeStatuses should return empty
      const statusResult = await manager.getWorktreeStatuses();
      expect(statusResult.ok).toBe(true);
      if (statusResult.ok) {
        expect(statusResult.value).toHaveLength(0);
      }
    });

    it('should collect errors from failed removals', async () => {
      await setupWorktree('fail-cleanup-1');
      await setupWorktree('fail-cleanup-2');

      // Make both git remove and fs.rm fail so removal completely fails
      mockGitInstance.raw.mockRejectedValue(new Error('git error'));
      (fs.rm as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('fs error'));

      // Force to bypass safety checks but still have git/fs failures
      const result = await manager.cleanup(true);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error).toBeInstanceOf(ClaudineError);
        expect(result.error.message).toContain('Failed to cleanup some worktrees');
      }
    });

    it('should return ok when no worktrees exist', async () => {
      const result = await manager.cleanup();

      expect(result.ok).toBe(true);
    });
  });

  describe('constructor defaults', () => {
    it('should create base directory on construction', () => {
      new GitWorktreeManager(mockLogger);

      // ensureBaseDirectory called in constructor
      expect(fs.mkdir).toHaveBeenCalledWith(expect.stringContaining('.worktrees'), { recursive: true });
    });

    it('should use provided config values', async () => {
      const customManager = new GitWorktreeManager(mockLogger, undefined, '/tmp/custom', {
        maxWorktreeAgeDays: 7,
        requireSafetyCheck: false,
      });

      // Create worktree to populate active map
      const task = new TaskFactory().withId('config-task').withUseWorktree(true).build();
      mockGitInstance.raw.mockResolvedValue('');
      await customManager.createWorktree(task);
      mockGitInstance.raw.mockResolvedValue('');

      // With requireSafetyCheck: false, even recent worktrees can be removed
      (fs.stat as ReturnType<typeof vi.fn>).mockResolvedValue({
        mtime: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000), // 1 day old
      });

      const result = await customManager.removeWorktree(TaskId('config-task'));

      expect(result.ok).toBe(true);
    });
  });
});
