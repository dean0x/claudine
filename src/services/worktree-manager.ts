/**
 * Git Worktree Manager Service
 * Handles creation and cleanup of git worktrees with branch-based isolation
 * Using simple-git for security and better error handling
 */

import { simpleGit, SimpleGit } from 'simple-git';
import path from 'path';
import fs from 'fs/promises';
import { Task, TaskId } from '../core/domain.js';
import { Result, ok, err } from '../core/result.js';
import { Logger } from '../core/interfaces.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';
import { retryWithBackoff } from '../utils/retry.js';

export interface WorktreeInfo {
  path: string;
  branch: string;
  baseBranch: string;
}

export interface CompletionResult {
  action: 'pr_created' | 'merged' | 'branch_pushed' | 'patch_created';
  prUrl?: string;
  patchPath?: string;
  branch?: string;
}

/**
 * Manages git worktrees for isolated task execution
 */
export interface WorktreeManager {
  /**
   * Creates a new worktree with a named branch for task isolation
   * @param task The task requiring a worktree
   * @returns Worktree information including path and branch name
   */
  createWorktree(task: Task): Promise<Result<WorktreeInfo>>;
  
  /**
   * Completes a task by executing the configured merge strategy
   * @param task The task to complete
   * @param info Worktree information from createWorktree
   * @returns Result of the merge strategy execution
   */
  completeTask(task: Task, info: WorktreeInfo): Promise<Result<CompletionResult>>;
  
  /**
   * Removes a worktree and cleans up associated resources
   * @param taskId ID of the task whose worktree should be removed
   * @returns Success or error result
   */
  removeWorktree(taskId: TaskId): Promise<Result<void>>;
  
  /**
   * Cleans up all active worktrees
   * @returns Success or error result
   */
  cleanup(): Promise<Result<void>>;
}

/**
 * Git worktree manager implementation using simple-git for security
 * Provides branch-based isolation for parallel task execution
 */
export class GitWorktreeManager implements WorktreeManager {
  private readonly baseDir: string;
  private readonly activeWorktrees = new Map<TaskId, WorktreeInfo>();
  private readonly git: SimpleGit;

  /**
   * Creates a new GitWorktreeManager
   * @param logger Logger for operation tracking
   * @param githubIntegration Optional GitHub integration for PR creation
   * @param baseDir Base directory for worktrees (defaults to .claudine-worktrees)
   */
  constructor(
    private readonly logger: Logger,
    private readonly githubIntegration?: GitHubIntegration,
    baseDir?: string
  ) {
    this.baseDir = baseDir || path.join(process.cwd(), '.claudine-worktrees');
    this.git = simpleGit();
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

    const branchName = sanitizeBranchName(
      task.branchName || `claudine/task-${task.id.slice(0, 8)}`
    );
    const baseBranch = task.baseBranch || await this.getCurrentBranch();
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
      await this.git.raw([
        'worktree', 'add',
        '-b', branchName,
        worktreePath,
        baseBranch
      ]);
      
      const info: WorktreeInfo = { 
        path: worktreePath, 
        branch: branchName, 
        baseBranch 
      };
      
      this.activeWorktrees.set(task.id, info);
      
      this.logger.info('Created branch-based worktree', {
        taskId: task.id,
        branch: branchName,
        base: baseBranch,
        path: worktreePath
      });
      
      return ok(info);
    } catch (error) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to create worktree: ${error instanceof Error ? error.message : String(error)}`
      ));
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

    return err(new ClaudineError(
      ErrorCode.INVALID_INPUT,
      `Unknown merge strategy: ${task.mergeStrategy}`
    ));
  }

  private async hasUncommittedChanges(worktreePath: string): Promise<boolean> {
    const gitInWorktree = simpleGit(worktreePath);
    const status = await gitInWorktree.status();
    return !status.isClean();
  }

  private async commitChanges(info: WorktreeInfo, task: Task): Promise<void> {
    const gitInWorktree = simpleGit(info.path);
    
    // Build commit message safely
    const message = [
      `Task ${task.id}: ${task.prompt.slice(0, 50)}`,
      '',
      'Generated by Claudine task delegation',
      `Task ID: ${task.id}`,
      `Branch: ${info.branch}`
    ].join('\n');

    await gitInWorktree.add('.');
    await gitInWorktree.commit(message);
    
    this.logger.info('Committed changes in worktree', { 
      taskId: task.id, 
      branch: info.branch 
    });
  }

  private async createPullRequest(task: Task, info: WorktreeInfo): Promise<Result<CompletionResult>> {
    try {
      const gitInWorktree = simpleGit(info.path);
      
      // Push branch to remote with retry for network issues
      await retryWithBackoff(
        () => gitInWorktree.push(['origin', info.branch, '--set-upstream']),
        {
          maxRetries: 3,
          initialDelay: 2000,
          logger: this.logger,
          operation: `Push branch ${info.branch}`
        }
      );
      
      // Create PR using gh CLI (still needed as simple-git doesn't handle PRs)
      // But now we properly escape the inputs
      if (this.githubIntegration) {
        const prResult = await this.githubIntegration.createPR({
          title: task.prTitle || `Task ${task.id}: ${task.prompt.slice(0, 50)}`,
          body: task.prBody || `Automated changes from Claudine task ${task.id}

**Task**: ${task.prompt}
**Branch**: ${info.branch}
**Base**: ${info.baseBranch}`,
          baseBranch: info.baseBranch,
          cwd: info.path
        });

        if (prResult.ok) {
          this.logger.info('Created pull request', { 
            taskId: task.id, 
            prUrl: prResult.value,
            branch: info.branch 
          });
          
          return ok({ 
            action: 'pr_created', 
            prUrl: prResult.value, 
            branch: info.branch 
          });
        } else {
          return err(prResult.error);
        }
      }
      
      // Fallback if GitHub integration not available
      this.logger.info('Pushed branch without PR (GitHub CLI not available)', { 
        taskId: task.id,
        branch: info.branch 
      });
      
      return ok({ 
        action: 'branch_pushed', 
        branch: info.branch 
      });
    } catch (error) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to create PR: ${error instanceof Error ? error.message : String(error)}`
      ));
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
        into: info.baseBranch 
      });
      
      return ok({ 
        action: 'merged', 
        branch: info.branch 
      });
    } catch (error) {
      // Restore original branch on error
      try {
        await this.git.checkout(originalBranch);
      } catch (restoreError) {
        this.logger.error('Failed to restore original branch', restoreError as Error, {
          originalBranch,
          currentBranch: info.baseBranch
        });
      }
      
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Auto-merge failed: ${error instanceof Error ? error.message : String(error)}`
      ));
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
      await retryWithBackoff(
        () => gitInWorktree.push(['origin', info.branch, '--set-upstream']),
        {
          maxRetries: 3,
          initialDelay: 2000,
          logger: this.logger,
          operation: `Push branch ${info.branch} for manual review`
        }
      );
      
      this.logger.info('Pushed branch for manual review', { 
        branch: info.branch 
      });
      
      return ok({ 
        action: 'branch_pushed', 
        branch: info.branch 
      });
    } catch (error) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to push branch: ${error instanceof Error ? error.message : String(error)}`
      ));
    }
  }

  private async createPatch(task: Task, info: WorktreeInfo): Promise<Result<CompletionResult>> {
    try {
      const patchDir = path.join(process.cwd(), '.claudine-patches');
      await fs.mkdir(patchDir, { recursive: true });
      
      const patchFile = path.join(patchDir, `task-${task.id}.patch`);
      
      // Create patch from all commits on this branch using simple-git
      const gitInWorktree = simpleGit(info.path);
      const patchContent = await gitInWorktree.raw([
        'format-patch',
        `${info.baseBranch}..HEAD`,
        '--stdout'
      ]);
      
      await fs.writeFile(patchFile, patchContent);
      
      this.logger.info('Created patch file', { 
        taskId: task.id,
        patchPath: patchFile 
      });
      
      return ok({ 
        action: 'patch_created', 
        patchPath: patchFile 
      });
    } catch (error) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to create patch: ${error instanceof Error ? error.message : String(error)}`
      ));
    }
  }

  /**
   * Removes a worktree and cleans up associated resources
   * Handles both git worktree removal and filesystem cleanup
   * @param taskId ID of the task whose worktree should be removed
   * @returns Success or error result
   */
  async removeWorktree(taskId: TaskId): Promise<Result<void>> {
    const info = this.activeWorktrees.get(taskId);
    if (!info) {
      return ok(undefined); // Already removed
    }

    try {
      await this.git.raw(['worktree', 'remove', info.path, '--force']);
      this.activeWorktrees.delete(taskId);
      
      this.logger.info('Removed worktree', { 
        taskId,
        path: info.path 
      });
      
      return ok(undefined);
    } catch (error) {
      // Fallback to direct removal
      try {
        await fs.rm(info.path, { recursive: true, force: true });
        await this.git.raw(['worktree', 'prune']);
        this.activeWorktrees.delete(taskId);
        
        return ok(undefined);
      } catch (fallbackError) {
        return err(new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          `Failed to remove worktree: ${fallbackError instanceof Error ? fallbackError.message : String(fallbackError)}`
        ));
      }
    }
  }

  /**
   * Cleans up all active worktrees
   * Called during shutdown to ensure no orphaned worktrees
   * @returns Success or error result
   */
  async cleanup(): Promise<Result<void>> {
    for (const [taskId, _] of this.activeWorktrees) {
      await this.removeWorktree(taskId);
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