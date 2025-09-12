/**
 * Git Worktree Manager Service
 * Handles creation and cleanup of git worktrees for isolated task execution
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import path from 'path';
import os from 'os';
import fs from 'fs';
import { TaskId } from '../core/domain.js';
import { Result, ok, err, tryCatchAsync } from '../core/result.js';
import { Logger } from '../core/interfaces.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';

const execAsync = promisify(exec);

/**
 * Find the git repository root for a given directory
 */
async function findGitRoot(startDir: string): Promise<Result<string>> {
  return tryCatchAsync(async () => {
    const { stdout } = await execAsync('git rev-parse --show-toplevel', { 
      cwd: startDir,
      timeout: 5000 
    });
    return stdout.trim();
  }, (error) => new ClaudineError(
    ErrorCode.SYSTEM_ERROR,
    `Failed to find git root: ${error instanceof Error ? error.message : String(error)}`,
    { startDir }
  ));
}

export interface WorktreeManager {
  createWorktree(taskId: TaskId, targetProjectDir?: string): Promise<Result<string>>;
  removeWorktree(taskId: TaskId): Promise<Result<void>>;
  getWorktreePath(taskId: TaskId, targetProjectDir?: string): string;
  cleanup(): Promise<Result<void>>;
}

export class GitWorktreeManager implements WorktreeManager {
  private readonly baseDir: string;
  private readonly activeWorktrees = new Map<TaskId, string>();

  constructor(
    private readonly logger: Logger,
    baseDir?: string
  ) {
    this.baseDir = baseDir || path.join(process.cwd(), '.claudine-worktrees');
    this.ensureBaseDirectory();
  }

  private ensureBaseDirectory(): void {
    try {
      if (!fs.existsSync(this.baseDir)) {
        fs.mkdirSync(this.baseDir, { recursive: true });
        this.logger.debug('Created worktree base directory', { baseDir: this.baseDir });
      }
    } catch (error) {
      this.logger.error('Failed to create worktree base directory', error as Error, { baseDir: this.baseDir });
    }
  }

  getWorktreePath(taskId: TaskId, targetProjectDir?: string): string {
    if (targetProjectDir) {
      // Use target project directory for project-scoped worktrees
      return path.join(targetProjectDir, '.claudine-worktrees', `task-${taskId}`);
    }
    // Fallback to base directory (current behavior)
    return path.join(this.baseDir, `task-${taskId}`);
  }

  async createWorktree(taskId: TaskId, targetProjectDir?: string): Promise<Result<string>> {
    let effectiveProjectDir: string;
    let worktreePath: string;
    const originalTargetDir = targetProjectDir; // Store for logging
    
    // Determine the target project directory and worktree location
    if (targetProjectDir) {
      // Find git root for the target project
      const gitRootResult = await findGitRoot(targetProjectDir);
      if (!gitRootResult.ok) {
        this.logger.error('Target directory is not in a git repository', undefined, { targetProjectDir });
        return err(gitRootResult.error);
      }
      effectiveProjectDir = gitRootResult.value;
      worktreePath = this.getWorktreePath(taskId, effectiveProjectDir);
    } else {
      effectiveProjectDir = process.cwd();
      worktreePath = this.getWorktreePath(taskId);
    }

    this.logger.debug('Creating git worktree', { 
      taskId, 
      worktreePath, 
      effectiveProjectDir,
      originalTargetDir 
    });

    return tryCatchAsync(async () => {
      // Ensure the worktree directory exists
      const worktreeDir = path.dirname(worktreePath);
      if (!fs.existsSync(worktreeDir)) {
        fs.mkdirSync(worktreeDir, { recursive: true });
        this.logger.debug('Created worktree directory', { worktreeDir });
      }

      // Check if we're in a git repository (use effective project directory)
      try {
        await execAsync('git rev-parse --git-dir', { cwd: effectiveProjectDir });
      } catch (gitError) {
        throw new ClaudineError(
          ErrorCode.SYSTEM_ERROR,
          'Not in a git repository - cannot create worktree',
          { cwd: effectiveProjectDir }
        );
      }

      // Get current branch/commit from the effective project directory
      const { stdout: currentRef } = await execAsync('git rev-parse HEAD', { cwd: effectiveProjectDir });
      const commitSha = currentRef.trim();

      // Clean up any existing worktree at this path
      if (fs.existsSync(worktreePath)) {
        this.logger.debug('Removing existing worktree', { worktreePath });
        await this.removeWorktreeByPath(worktreePath);
      }

      // Create the worktree from the effective project directory
      const worktreeName = `claudine-${taskId.slice(0, 8)}`;
      await execAsync(`git worktree add "${worktreePath}" ${commitSha}`, { 
        cwd: effectiveProjectDir,
        timeout: 30000 // 30 second timeout
      });

      // Track the active worktree
      this.activeWorktrees.set(taskId, worktreePath);

      this.logger.info('Git worktree created successfully', { 
        taskId, 
        worktreePath,
        commitSha: commitSha.slice(0, 8),
        effectiveProjectDir
      });

      return worktreePath;
    }, (error) => {
      this.logger.error('Failed to create git worktree', error as Error, { 
        taskId, 
        worktreePath, 
        effectiveProjectDir, 
        originalTargetDir 
      });
      
      if (error instanceof ClaudineError) {
        return error;
      }
      
      return new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to create git worktree: ${error instanceof Error ? error.message : String(error)}`,
        { taskId, worktreePath }
      );
    });
  }

  async removeWorktree(taskId: TaskId): Promise<Result<void>> {
    const worktreePath = this.activeWorktrees.get(taskId) || this.getWorktreePath(taskId);

    this.logger.debug('Removing git worktree', { taskId, worktreePath });

    const result = await this.removeWorktreeByPath(worktreePath);
    
    if (result.ok) {
      this.activeWorktrees.delete(taskId);
      this.logger.debug('Git worktree removed successfully', { taskId, worktreePath });
    }

    return result;
  }

  private async removeWorktreeByPath(worktreePath: string): Promise<Result<void>> {
    return tryCatchAsync(async () => {
      // Check if worktree path exists
      if (!fs.existsSync(worktreePath)) {
        return; // Already cleaned up
      }

      // Check for uncommitted changes before cleanup
      try {
        const { stdout: status } = await execAsync(`git status --porcelain`, { 
          cwd: worktreePath,
          timeout: 5000
        });
        
        if (status.trim()) {
          this.logger.warn('Worktree has uncommitted changes that will be lost', { 
            worktreePath,
            uncommittedFiles: status.trim().split('\n').length 
          });
          // TODO: Consider auto-commit or making cleanup optional
        }
      } catch (statusError) {
        this.logger.debug('Could not check git status before cleanup', { statusError });
      }

      try {
        // Try to remove via git worktree command first
        await execAsync(`git worktree remove "${worktreePath}" --force`, { 
          cwd: process.cwd(),
          timeout: 15000 // 15 second timeout
        });
      } catch (gitError) {
        this.logger.debug('Git worktree remove failed, falling back to filesystem cleanup', { gitError });
        
        // Fallback: remove directory directly
        await execAsync(`rm -rf "${worktreePath}"`, { timeout: 10000 });
      }

      // Prune any dangling worktree references
      try {
        await execAsync('git worktree prune', { cwd: process.cwd(), timeout: 10000 });
      } catch (pruneError) {
        // Non-critical - just log it
        this.logger.debug('Failed to prune worktree references', { pruneError });
      }
    }, (error) => {
      return new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to remove git worktree: ${error instanceof Error ? error.message : String(error)}`,
        { worktreePath }
      );
    });
  }

  /**
   * Cleanup all active worktrees (for shutdown/recovery)
   */
  async cleanup(): Promise<Result<void>> {
    this.logger.info('Cleaning up all active worktrees', { count: this.activeWorktrees.size });

    const cleanupPromises = Array.from(this.activeWorktrees.keys()).map(taskId => 
      this.removeWorktree(taskId)
    );

    try {
      const results = await Promise.allSettled(cleanupPromises);
      
      let failures = 0;
      for (const result of results) {
        if (result.status === 'rejected' || (result.status === 'fulfilled' && !result.value.ok)) {
          failures++;
        }
      }

      if (failures > 0) {
        this.logger.warn('Some worktrees failed to cleanup', { failures, total: results.length });
      }

      // Clear the tracking map
      this.activeWorktrees.clear();

      return ok(undefined);
    } catch (error) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to cleanup worktrees: ${error instanceof Error ? error.message : String(error)}`
      ));
    }
  }

  /**
   * Get statistics about active worktrees
   */
  getStats(): { active: number; baseDir: string } {
    return {
      active: this.activeWorktrees.size,
      baseDir: this.baseDir
    };
  }
}