/**
 * GitHub Integration Service
 * Handles GitHub CLI operations for PR creation and management
 * Uses proper input escaping to prevent command injection
 */

import { spawn } from 'child_process';
import { Result, ok, err } from '../core/result.js';
import { Logger } from '../core/interfaces.js';
import { writeFile, unlink } from 'fs/promises';
import { tmpdir } from 'os';
import path from 'path';
import { retryWithBackoff } from '../utils/retry.js';
import { ClaudineError, ErrorCode } from '../core/errors.js';

export interface PROptions {
  title: string;
  body: string;
  baseBranch: string;
  cwd: string;
  draft?: boolean;
  labels?: string[];
}

export interface PRStatus {
  state: 'open' | 'closed' | 'merged';
  mergeable: boolean;
  url: string;
}

/**
 * GitHub integration using the GitHub CLI (gh) for PR operations
 * Uses spawn with array arguments to prevent command injection
 */
export class GitHubIntegration {
  constructor(private readonly logger: Logger) {}

  /**
   * Checks if GitHub CLI is available and authenticated
   * @returns true if gh CLI is available and authenticated
   */
  async isAvailable(): Promise<boolean> {
    try {
      await this.executeGhCommand(['--version']);
      return true;
    } catch {
      this.logger.warn('GitHub CLI not available - PR strategy will not work');
      return false;
    }
  }

  /**
   * Execute gh command safely without shell injection
   * Uses spawn with array arguments to prevent command injection
   * @param args Command arguments as array (safe from injection)
   * @param options Optional execution options
   * @returns Command stdout or throws on error
   * @private
   */
  private executeGhCommand(args: string[], options?: { cwd?: string }): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn('gh', args, {
        cwd: options?.cwd || process.cwd(),
        env: process.env,
        stdio: 'pipe'
      });

      let stdout = '';
      let stderr = '';

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('error', (error) => {
        reject(error);
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(stdout.trim());
        } else {
          reject(new Error(`gh command failed with code ${code}: ${stderr}`));
        }
      });
    });
  }

  /**
   * Creates a GitHub pull request using the gh CLI
   * Uses temporary files for complex body content to prevent injection
   * @param options PR options including title, body, and base branch
   * @returns URL of the created PR or error
   */
  async createPR(options: PROptions): Promise<Result<string>> {
    const available = await this.isAvailable();
    if (!available) {
      return err(new Error('GitHub CLI not available'));
    }

    try {
      // Create temporary file for PR body to avoid shell injection
      const tmpFile = path.join(tmpdir(), `pr-body-${Date.now()}.txt`);
      await writeFile(tmpFile, options.body, 'utf-8');

      try {
        const args = [
          'pr', 'create',
          '--title', options.title,
          '--body-file', tmpFile,
          '--base', options.baseBranch
        ];

        if (options.draft) {
          args.push('--draft');
        }

        if (options.labels?.length) {
          // Add each label separately to avoid injection
          for (const label of options.labels) {
            args.push('--label', label);
          }
        }

        // Execute with retry for API rate limiting and network issues
        const prUrl = await retryWithBackoff(
          () => this.executeGhCommand(args, { cwd: options.cwd }),
          {
            maxRetries: 3,
            initialDelay: 2000,
            maxDelay: 10000,
            logger: this.logger,
            operation: 'Create GitHub PR'
          }
        );
        
        this.logger.info('Created PR successfully', { prUrl });
        return ok(prUrl);
      } finally {
        // Clean up temp file
        try {
          await unlink(tmpFile);
        } catch {
          // Ignore cleanup errors
        }
      }
    } catch (error) {
      return err(error as Error);
    }
  }

  async getPRStatus(prNumber: string): Promise<Result<PRStatus>> {
    const available = await this.isAvailable();
    if (!available) {
      return err(new Error('GitHub CLI not available'));
    }

    try {
      // Validate PR number to prevent injection
      if (!/^\d+$/.test(prNumber)) {
        return err(new Error('Invalid PR number format'));
      }

      // Execute with retry for API rate limiting  
      const stdout = await retryWithBackoff(
        () => this.executeGhCommand([
          'pr', 'view', prNumber,
          '--json', 'state,mergeable,url'
        ]),
        {
          maxRetries: 3,
          initialDelay: 1000,
          logger: this.logger,
          operation: `Get PR ${prNumber} status`
        }
      );
      
      const data = JSON.parse(stdout);
      
      return ok({
        state: data.state.toLowerCase() as PRStatus['state'],
        mergeable: data.mergeable === 'MERGEABLE',
        url: data.url
      });
    } catch (error) {
      return err(error as Error);
    }
  }

  async mergePR(prNumber: string, method: 'merge' | 'squash' | 'rebase' = 'merge'): Promise<Result<void>> {
    const available = await this.isAvailable();
    if (!available) {
      return err(new Error('GitHub CLI not available'));
    }

    try {
      // Validate PR number to prevent injection
      if (!/^\d+$/.test(prNumber)) {
        return err(new Error('Invalid PR number format'));
      }

      await this.executeGhCommand([
        'pr', 'merge', prNumber,
        `--${method}`,
        '--delete-branch'
      ]);
      
      this.logger.info('Merged PR successfully', { prNumber, method });
      return ok(undefined);
    } catch (error) {
      return err(error as Error);
    }
  }
}