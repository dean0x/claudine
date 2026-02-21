/**
 * Git Worktree Manager Service
 * Handles creation and cleanup of git worktrees with branch-based isolation
 * Using simple-git for security and better error handling
 */

import fs from 'fs/promises';
import path from 'path';
import { SimpleGit, simpleGit } from 'simple-git';
import { Task, TaskId } from '../core/domain.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';
import {
  CompletionResult,
  Logger,
  WorktreeInfo,
  WorktreeManager,
  WorktreeManagerConfig,
  WorktreeStatus,
} from '../core/interfaces.js';
import { err, ok, Result } from '../core/result.js';
import { retryWithBackoff } from '../utils/retry.js';

/**
 * Git worktree manager implementation using simple-git for security
 * Provides branch-based isolation for parallel task execution
 */
export class GitWorktreeManager implements WorktreeManager {
  private readonly baseDir: string;
  private readonly activeWorktrees = new Map<TaskId, WorktreeInfo>();
  private readonly git: SimpleGit;
  private readonly config: WorktreeManagerConfig;

  /**
   * Creates a new GitWorktreeManager
   * @param logger Logger for operation tracking
   * @param githubIntegration Optional GitHub integration for PR creation
   * @param baseDir Base directory for worktrees (defaults to .worktrees)
   * @param config Configuration for worktree safety and behavior
   */
  constructor(
    private readonly logger: Logger,
    private readonly githubIntegration?: GitHubIntegration,
    baseDir?: string,
    config?: Partial<WorktreeManagerConfig>,
  ) {
    this.baseDir = baseDir || path.join(process.cwd(), '.worktrees');
    this.git = simpleGit();
    this.config = {
      maxWorktreeAgeDays: 30, // Default: 30 days is safer for developers
      requireSafetyCheck: true,
      allowForceRemoval: false,
      ...config,
    };
    this.ensureBaseDirectory();
  }

  private async ensureBaseDirectory(): Promise<void> {
    try {
      await fs.mkdir(this.baseDir, { recursive: true });
    } catch (error) {
      this.logger.error('Failed to create base directory', error as Error, { baseDir: this.baseDir });
    }
  }

  /**
   * Gets the current branch name of the main repository
   * @returns Current branch name or 'main' as fallback
   */
  async getCurrentBranch(): Promise<string> {
    try {
      const status = await this.git.status();
      return status.current || 'main';
    } catch (error) {
      this.logger.warn('Failed to get current branch, defaulting to main', { error });
      return 'main';
    }
  }

  /**
   * Creates a new worktree with a named branch for task isolation
   * Sanitizes branch names to prevent command injection
   * @param task The task requiring a worktree
   * @returns Worktree information or error
   */
  async createWorktree(task: Task): Promise<Result<WorktreeInfo>> {
    // Sanitize branch name - remove any characters that aren't alphanumeric, dash, underscore, or slash
    const sanitizeBranchName = (name: string): string => {
      return name.replace(/[^a-zA-Z0-9\-_\/]/g, '-').replace(/^-+|-+$/g, '');
    };

    const branchName = sanitizeBranchName(task.branchName || `claudine/task-${task.id.slice(0, 8)}`);
    const baseBranch = task.baseBranch || (await this.getCurrentBranch());
    const worktreePath = path.join(this.baseDir, `task-${task.id}`);

    try {
      // Create worktree with new branch using simple-git
      // First check if worktree already exists
      const worktrees = await this.git.raw(['worktree', 'list', '--porcelain']);
      if (worktrees.includes(worktreePath)) {
        // Remove existing worktree
        await this.git.raw(['worktree', 'remove', worktreePath, '--force']);
      }

      // Create new worktree with branch
      await this.git.raw(['worktree', 'add', '-b', branchName, worktreePath, baseBranch]);

      const info: WorktreeInfo = {
        path: worktreePath,
        branch: branchName,
        baseBranch,
      };

      this.activeWorktrees.set(task.id, info);

      this.logger.info('Created branch-based worktree', {
        taskId: task.id,
        branch: branchName,
        base: baseBranch,
        path: worktreePath,
      });

      return ok(info);
    } catch (error) {
      return err(
        new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  /**
   * Completes a task by executing the configured merge strategy
   * Strategies: 'pr' (create PR), 'auto' (auto-merge), 'manual' (push only), 'patch' (create patch file)
   * @param task The task to complete
   * @param info Worktree information from createWorktree
   * @returns Result of the merge strategy execution
   */
  async completeTask(task: Task, info: WorktreeInfo): Promise<Result<CompletionResult>> {
    // Step 1: Check for changes
    const hasChanges = await this.hasUncommittedChanges(info.path);

    // Step 2: Commit if needed and requested
    if (hasChanges && task.autoCommit) {
      await this.commitChanges(info, task);
    }

    // Step 3: Execute merge strategy
    if (!task.mergeStrategy || task.mergeStrategy === 'pr') {
      return await this.createPullRequest(task, info);
    } else if (task.mergeStrategy === 'auto') {
      return await this.autoMerge(info);
    } else if (task.mergeStrategy === 'manual') {
      return await this.manualStrategy(info);
    } else if (task.mergeStrategy === 'patch') {
      return await this.createPatch(task, info);
    }

    return err(new ClaudineError(ErrorCode.INVALID_INPUT, `Unknown merge strategy: ${task.mergeStrategy}`));
  }

  private async hasUncommittedChanges(worktreePath: string): Promise<boolean> {
    const gitInWorktree = simpleGit(worktreePath);
    const status = await gitInWorktree.status();
    return !status.isClean();
  }

  private async commitChanges(info: WorktreeInfo, task: Task): Promise<void> {
    const gitInWorktree = simpleGit(info.path);

    // SECURITY: Sanitize commit message to prevent command injection
    // Remove shell metacharacters and limit length
    const sanitizeCommitMessage = (msg: string): string => {
      return msg
        .replace(/[`$();&|<>\\'"]/g, '') // Remove shell metacharacters
        .replace(/[\r\n]/g, ' ') // Convert newlines to spaces
        .trim()
        .slice(0, 200); // Limit length
    };

    // Build commit message with sanitized user input
    const message = [
      `Task ${task.id}: ${sanitizeCommitMessage(task.prompt)}`,
      '',
      'Generated by Claudine task delegation',
      `Task ID: ${task.id}`,
      `Branch: ${info.branch}`,
    ].join('\n');

    await gitInWorktree.add('.');
    await gitInWorktree.commit(message);

    this.logger.info('Committed changes in worktree', {
      taskId: task.id,
      branch: info.branch,
    });
  }

  private async createPullRequest(task: Task, info: WorktreeInfo): Promise<Result<CompletionResult>> {
    try {
      const gitInWorktree = simpleGit(info.path);

      // Push branch to remote with retry for network issues
      await retryWithBackoff(() => gitInWorktree.push(['origin', info.branch, '--set-upstream']), {
        maxRetries: 3,
        initialDelay: 2000,
        logger: this.logger,
        operation: `Push branch ${info.branch}`,
      });

      // SECURITY: Sanitize PR title and body to prevent command injection
      const sanitizeText = (text: string, maxLength: number): string => {
        return text
          .replace(/[`$();&|<>\\'"]/g, '') // Remove shell metacharacters
          .replace(/[\r\n]/g, ' ') // Convert newlines to spaces
          .trim()
          .slice(0, maxLength);
      };

      // Create PR using gh CLI with sanitized inputs
      if (this.githubIntegration) {
        const prResult = await this.githubIntegration.createPR({
          title: task.prTitle ? sanitizeText(task.prTitle, 200) : `Task ${task.id}: ${sanitizeText(task.prompt, 50)}`,
          body: task.prBody
            ? sanitizeText(task.prBody, 5000)
            : `Automated changes from Claudine task ${task.id}

**Task**: ${sanitizeText(task.prompt, 500)}
**Branch**: ${info.branch}
**Base**: ${info.baseBranch}`,
          baseBranch: info.baseBranch,
          cwd: info.path,
        });

        if (prResult.ok) {
          this.logger.info('Created pull request', {
            taskId: task.id,
            prUrl: prResult.value,
            branch: info.branch,
          });

          return ok({
            action: 'pr_created',
            prUrl: prResult.value,
            branch: info.branch,
          });
        } else {
          return err(prResult.error);
        }
      }

      // Fallback if GitHub integration not available
      this.logger.info('Pushed branch without PR (GitHub CLI not available)', {
        taskId: task.id,
        branch: info.branch,
      });

      return ok({
        action: 'branch_pushed',
        branch: info.branch,
      });
    } catch (error) {
      return err(
        new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          `Failed to create PR: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  private async autoMerge(info: WorktreeInfo): Promise<Result<CompletionResult>> {
    const originalBranch = await this.getCurrentBranch();

    try {
      // Switch to base branch
      await this.git.checkout(info.baseBranch);

      // Attempt merge
      await this.git.merge([info.branch, '--no-ff', '-m', `Auto-merge: ${info.branch}`]);

      this.logger.info('Auto-merged branch', {
        branch: info.branch,
        into: info.baseBranch,
      });

      return ok({
        action: 'merged',
        branch: info.branch,
      });
    } catch (error) {
      // Restore original branch on error
      try {
        await this.git.checkout(originalBranch);
      } catch (restoreError) {
        this.logger.error('Failed to restore original branch', restoreError as Error, {
          originalBranch,
          currentBranch: info.baseBranch,
        });
      }

      return err(
        new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          `Auto-merge failed: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  private async manualStrategy(info: WorktreeInfo): Promise<Result<CompletionResult>> {
    // For manual strategy: push branch and leave for human review
    return await this.pushBranch(info);
  }

  private async pushBranch(info: WorktreeInfo): Promise<Result<CompletionResult>> {
    try {
      const gitInWorktree = simpleGit(info.path);

      // Push with retry for network issues
      await retryWithBackoff(() => gitInWorktree.push(['origin', info.branch, '--set-upstream']), {
        maxRetries: 3,
        initialDelay: 2000,
        logger: this.logger,
        operation: `Push branch ${info.branch} for manual review`,
      });

      this.logger.info('Pushed branch for manual review', {
        branch: info.branch,
      });

      return ok({
        action: 'branch_pushed',
        branch: info.branch,
      });
    } catch (error) {
      return err(
        new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          `Failed to push branch: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  private async createPatch(task: Task, info: WorktreeInfo): Promise<Result<CompletionResult>> {
    try {
      const patchDir = path.join(process.cwd(), '.claudine-patches');
      await fs.mkdir(patchDir, { recursive: true });

      const patchFile = path.join(patchDir, `task-${task.id}.patch`);

      // Create patch from all commits on this branch using simple-git
      const gitInWorktree = simpleGit(info.path);
      const patchContent = await gitInWorktree.raw(['format-patch', `${info.baseBranch}..HEAD`, '--stdout']);

      await fs.writeFile(patchFile, patchContent);

      this.logger.info('Created patch file', {
        taskId: task.id,
        patchPath: patchFile,
      });

      return ok({
        action: 'patch_created',
        patchPath: patchFile,
      });
    } catch (error) {
      return err(
        new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          `Failed to create patch: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  /**
   * Removes a worktree and cleans up associated resources
   * Handles both git worktree removal and filesystem cleanup with safety checks
   * @param taskId ID of the task whose worktree should be removed
   * @param force Skip safety checks if true
   * @returns Success or error result
   */
  async removeWorktree(taskId: TaskId, force = false): Promise<Result<void>> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) {
      return ok(undefined); // Already removed
    }

    // Safety check: only auto-remove old worktrees unless forced
    if (!force && this.config.requireSafetyCheck) {
      const safetyCheck = await this.isWorktreeSafeToRemove(info.path);
      if (!safetyCheck.ok) {
        this.logger.warn('Worktree not removed - safety check failed', {
          taskId,
          path: info.path,
          reason: safetyCheck.error.message,
        });
        return safetyCheck;
      }
    }

    // Log the removal action
    this.logger.info('Removing worktree', {
      taskId,
      path: info.path,
      forced: force,
      safetyChecked: this.config.requireSafetyCheck && !force,
    });

    try {
      await this.git.raw(['worktree', 'remove', info.path, '--force']);
      this.activeWorktrees.delete(taskId);

      this.logger.info('Successfully removed worktree', {
        taskId,
        path: info.path,
      });

      return ok(undefined);
    } catch (error) {
      // Fallback to direct removal
      try {
        await fs.rm(info.path, { recursive: true, force: true });
        await this.git.raw(['worktree', 'prune']);
        this.activeWorktrees.delete(taskId);

        this.logger.info('Removed worktree via fallback method', {
          taskId,
          path: info.path,
        });

        return ok(undefined);
      } catch (fallbackError) {
        return err(
          new ClaudineError(
            ErrorCode.SYSTEM_ERROR,
            `Failed to remove worktree: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`,
          ),
        );
      }
    }
  }

  /**
   * Checks if a worktree is safe to remove based on age and other criteria
   * @param worktreePath Path to the worktree directory
   * @returns Success if safe to remove, error otherwise
   */
  private async isWorktreeSafeToRemove(worktreePath: string): Promise<Result<void>> {
    try {
      // Check if worktree directory exists
      const stats = await fs.stat(worktreePath);
      const ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);

      // Age-based safety check
      if (ageInDays < this.config.maxWorktreeAgeDays) {
        return err(
          new ClaudineError(
            ErrorCode.SYSTEM_ERROR,
            `Worktree too recent (${ageInDays.toFixed(1)} days old, minimum ${this.config.maxWorktreeAgeDays} days)`,
          ),
        );
      }

      // Check for unpushed changes
      const hasUnpushedChanges = await this.hasUnpushedChanges(worktreePath);
      if (hasUnpushedChanges) {
        return err(
          new ClaudineError(ErrorCode.SYSTEM_ERROR, 'Worktree has unpushed changes - would lose developer work'),
        );
      }

      return ok(undefined);
    } catch (error) {
      // If we can't stat the worktree, it probably doesn't exist, so it's safe to remove
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return ok(undefined);
      }
      return err(
        new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          `Cannot assess worktree safety: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  /**
   * Checks if a worktree has unpushed changes
   * @param worktreePath Path to the worktree
   * @returns True if there are unpushed changes
   */
  private async hasUnpushedChanges(worktreePath: string): Promise<boolean> {
    try {
      const gitInWorktree = simpleGit(worktreePath);
      const status = await gitInWorktree.status();

      // Check for uncommitted changes
      if (!status.isClean()) {
        return true;
      }

      // Check for unpushed commits against upstream
      try {
        const result = await gitInWorktree.raw(['rev-list', '--count', '@{u}..HEAD']);
        const unpushedCount = parseInt(result.trim(), 10);
        return unpushedCount > 0;
      } catch (upstreamError) {
        // ARCHITECTURE: Branch has no upstream configured (new local branch)
        // Check if branch has any commits that aren't in the main branch
        // If it does, consider it "unpushed" since the work isn't integrated
        try {
          const currentBranch = status.current || 'HEAD';

          // Try to find commits unique to this branch vs common base branches
          // This handles the case where a worktree branch has commits but no upstream
          for (const baseBranch of ['main', 'master', 'develop']) {
            try {
              const compareResult = await gitInWorktree.raw(['rev-list', '--count', `${baseBranch}..${currentBranch}`]);
              const uniqueCommits = parseInt(compareResult.trim(), 10);

              // If this branch has commits not in base branch, it has "unpushed" work
              if (uniqueCommits > 0) {
                this.logger.debug('Branch has commits not in base branch', {
                  worktreePath,
                  currentBranch,
                  baseBranch,
                  uniqueCommits,
                });
                return true;
              }

              // Successfully compared with this base branch and found no unique commits
              return false;
            } catch {
              // Base branch doesn't exist or compare failed, try next base
              continue;
            }
          }

          // Couldn't compare with any base branch - assume no unpushed changes
          // This handles edge cases like detached HEAD or orphan branches
          this.logger.debug('No upstream and no base branch comparison possible', {
            worktreePath,
            currentBranch,
          });
          return false;
        } catch (compareError) {
          // If we can't compare branches, log and assume no unpushed changes
          // This is safer than blocking cleanup forever
          this.logger.warn('Could not compare with base branches', {
            worktreePath,
            error: compareError instanceof Error ? compareError.message : String(compareError),
          });
          return false;
        }
      }
    } catch (error) {
      this.logger.warn('Could not check for unpushed changes', {
        worktreePath,
        error: error instanceof Error ? error.message : String(error),
      });
      // ARCHITECTURE: On error, default to false to prevent blocking cleanup
      // Safety checks (age, etc.) provide additional protection
      return false;
    }
  }

  /**
   * Get status information for all worktrees
   * @returns Array of worktree status information
   */
  async getWorktreeStatuses(): Promise<Result<WorktreeStatus[]>> {
    const statuses: WorktreeStatus[] = [];

    for (const [taskId, info] of this.activeWorktrees) {
      const statusResult = await this.getWorktreeStatus(taskId);
      if (statusResult.ok) {
        statuses.push(statusResult.value);
      }
    }

    return ok(statuses);
  }

  /**
   * Get status information for a specific worktree
   * @param taskId Task ID to get status for
   * @returns Worktree status information
   */
  async getWorktreeStatus(taskId: TaskId): Promise<Result<WorktreeStatus>> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) {
      return err(new ClaudineError(ErrorCode.TASK_NOT_FOUND, `Worktree not found for task ${taskId}`));
    }

    try {
      let ageInDays = 0;
      let exists = false;

      try {
        const stats = await fs.stat(info.path);
        ageInDays = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60 * 24);
        exists = true;
      } catch {
        // Worktree directory doesn't exist
        exists = false;
      }

      const hasUnpushedChanges = exists ? await this.hasUnpushedChanges(info.path) : false;
      const safetyCheck = exists ? await this.isWorktreeSafeToRemove(info.path) : ok(undefined);

      const status: WorktreeStatus = {
        taskId,
        path: info.path,
        branch: info.branch,
        baseBranch: info.baseBranch,
        ageInDays,
        hasUnpushedChanges,
        safeToRemove: safetyCheck.ok,
        exists,
      };

      return ok(status);
    } catch (error) {
      return err(
        new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          `Failed to get worktree status: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
    }
  }

  /**
   * Cleans up all active worktrees
   * Called during shutdown to ensure no orphaned worktrees
   * @param force Skip safety checks for all worktrees
   * @returns Success or error result
   */
  async cleanup(force = false): Promise<Result<void>> {
    const errors: string[] = [];

    // Create array of task IDs to avoid modifying map during iteration
    const taskIds = Array.from(this.activeWorktrees.keys());

    for (const taskId of taskIds) {
      const result = await this.removeWorktree(taskId, force);
      if (!result.ok) {
        errors.push(`${taskId}: ${result.error.message}`);
      }
    }

    if (errors.length > 0) {
      this.logger.warn('Some worktrees could not be cleaned up', { errors });
      return err(new ClaudineError(ErrorCode.SYSTEM_ERROR, `Failed to cleanup some worktrees: ${errors.join(', ')}`));
    }

    return ok(undefined);
  }
}

// Placeholder interface for GitHub integration
export interface GitHubIntegration {
  isAvailable(): Promise<boolean>;
  createPR(options: PROptions): Promise<Result<string>>;
}

export interface PROptions {
  title: string;
  body: string;
  baseBranch: string;
  cwd: string;
  draft?: boolean;
  labels?: string[];
}
