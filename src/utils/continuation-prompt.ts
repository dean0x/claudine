/**
 * Continuation prompt builder for session continuation through dependency chains
 * ARCHITECTURE: Semantically different from buildEnrichedPrompt (retry framing in TaskManager)
 * - No "retry" framing — this is a continuation, not a retry
 * - Original prompt stays primary (listed last, after context)
 * - Dependency's prompt is included for context
 */

import type { Task, TaskCheckpoint } from '../core/domain.js';

/**
 * Build a continuation prompt that injects dependency context into a task's prompt
 *
 * @param task - The task being enriched (its prompt appears at the end)
 * @param checkpoint - The checkpoint from the dependency task
 * @param dependencyPrompt - The original prompt of the dependency task (for context)
 * @returns Enriched prompt string with dependency context prepended
 */
export function buildContinuationPrompt(task: Task, checkpoint: TaskCheckpoint, dependencyPrompt: string): string {
  const parts: string[] = [];

  parts.push('DEPENDENCY CONTEXT:');
  parts.push('A prerequisite task has completed. Here is what it produced:');
  parts.push('');
  parts.push(`Prerequisite prompt: ${dependencyPrompt}`);
  parts.push(`Status: ${checkpoint.checkpointType}`);

  if (checkpoint.outputSummary) {
    parts.push('');
    parts.push('Output:');
    parts.push(checkpoint.outputSummary);
  }

  if (checkpoint.errorSummary) {
    parts.push('');
    parts.push(`Errors encountered: ${checkpoint.errorSummary}`);
  }

  if (checkpoint.gitBranch) {
    parts.push('');
    parts.push(`Git state: branch=${checkpoint.gitBranch}, commit=${checkpoint.gitCommitSha ?? 'unknown'}`);
  }

  if (checkpoint.gitDirtyFiles && checkpoint.gitDirtyFiles.length > 0) {
    parts.push(`Modified files: ${checkpoint.gitDirtyFiles.join(', ')}`);
  }

  parts.push('');
  parts.push('---');
  parts.push('');
  parts.push('YOUR TASK:');
  parts.push(task.prompt);

  return parts.join('\n');
}
