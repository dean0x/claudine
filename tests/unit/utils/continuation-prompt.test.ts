/**
 * Unit tests for buildContinuationPrompt
 *
 * ARCHITECTURE: Tests prompt enrichment for session continuation through dependency chains
 * Pattern: Pure function tests - no mocks needed
 */

import { describe, it, expect } from 'vitest';
import { buildContinuationPrompt } from '../../../src/utils/continuation-prompt.js';
import { createTask, TaskId, type TaskCheckpoint } from '../../../src/core/domain.js';

describe('buildContinuationPrompt', () => {
  const makeCheckpoint = (overrides?: Partial<TaskCheckpoint>): TaskCheckpoint => ({
    id: 1,
    taskId: TaskId('task-dep-123'),
    checkpointType: 'completed',
    outputSummary: 'Build succeeded. All tests passed.',
    errorSummary: undefined,
    gitBranch: 'feature/auth',
    gitCommitSha: 'abc123def',
    gitDirtyFiles: ['src/auth.ts', 'tests/auth.test.ts'],
    createdAt: Date.now(),
    ...overrides,
  });

  it('should include all fields when checkpoint is fully populated', () => {
    const task = createTask({ prompt: 'Continue implementing auth middleware' });
    const checkpoint = makeCheckpoint();
    const dependencyPrompt = 'Set up authentication module';

    const result = buildContinuationPrompt(task, checkpoint, dependencyPrompt);

    // Verify structure: dependency context comes first
    expect(result).toContain('DEPENDENCY CONTEXT:');
    expect(result).toContain('A prerequisite task has completed.');
    expect(result).toContain(`Prerequisite prompt: ${dependencyPrompt}`);
    expect(result).toContain('Status: completed');

    // Verify output included
    expect(result).toContain('Output:');
    expect(result).toContain('Build succeeded. All tests passed.');

    // Verify git state included
    expect(result).toContain('Git state: branch=feature/auth, commit=abc123def');
    expect(result).toContain('Modified files: src/auth.ts, tests/auth.test.ts');

    // Verify separator and task prompt at the end
    expect(result).toContain('---');
    expect(result).toContain('YOUR TASK:');
    expect(result).toContain('Continue implementing auth middleware');

    // Verify ordering: DEPENDENCY CONTEXT before YOUR TASK
    const contextIdx = result.indexOf('DEPENDENCY CONTEXT:');
    const taskIdx = result.indexOf('YOUR TASK:');
    expect(contextIdx).toBeLessThan(taskIdx);
  });

  it('should omit optional fields when checkpoint has minimal data', () => {
    const task = createTask({ prompt: 'Run integration tests' });
    const checkpoint = makeCheckpoint({
      outputSummary: undefined,
      errorSummary: undefined,
      gitBranch: undefined,
      gitCommitSha: undefined,
      gitDirtyFiles: undefined,
    });
    const dependencyPrompt = 'Set up test database';

    const result = buildContinuationPrompt(task, checkpoint, dependencyPrompt);

    // Should still have required structure
    expect(result).toContain('DEPENDENCY CONTEXT:');
    expect(result).toContain(`Prerequisite prompt: ${dependencyPrompt}`);
    expect(result).toContain('Status: completed');
    expect(result).toContain('YOUR TASK:');
    expect(result).toContain('Run integration tests');

    // Should NOT contain optional sections
    expect(result).not.toContain('Output:');
    expect(result).not.toContain('Errors encountered:');
    expect(result).not.toContain('Git state:');
    expect(result).not.toContain('Modified files:');
  });

  it('should include error summary for failed checkpoints', () => {
    const task = createTask({ prompt: 'Fix the failing tests' });
    const checkpoint = makeCheckpoint({
      checkpointType: 'failed',
      outputSummary: 'Running tests...',
      errorSummary: 'FAIL: auth.test.ts - Expected 200 got 401',
      gitBranch: 'feature/auth',
      gitCommitSha: undefined,
      gitDirtyFiles: [],
    });
    const dependencyPrompt = 'Implement authentication';

    const result = buildContinuationPrompt(task, checkpoint, dependencyPrompt);

    expect(result).toContain('Status: failed');
    expect(result).toContain('Errors encountered: FAIL: auth.test.ts - Expected 200 got 401');
    expect(result).toContain('Git state: branch=feature/auth, commit=unknown');
    // Empty dirty files should not appear
    expect(result).not.toContain('Modified files:');
  });

  it('should handle empty git dirty files array', () => {
    const task = createTask({ prompt: 'Continue work' });
    const checkpoint = makeCheckpoint({
      gitBranch: 'main',
      gitDirtyFiles: [],
    });
    const dependencyPrompt = 'Initial setup';

    const result = buildContinuationPrompt(task, checkpoint, dependencyPrompt);

    // Empty array should not produce "Modified files:" line
    expect(result).not.toContain('Modified files:');
  });

  it('should handle cancelled checkpoint type', () => {
    const task = createTask({ prompt: 'Retry the cancelled work' });
    const checkpoint = makeCheckpoint({
      checkpointType: 'cancelled',
      outputSummary: 'Partial output before cancellation',
    });
    const dependencyPrompt = 'Long running task';

    const result = buildContinuationPrompt(task, checkpoint, dependencyPrompt);

    expect(result).toContain('Status: cancelled');
    expect(result).toContain('Partial output before cancellation');
  });

  it('should preserve multi-line task prompts', () => {
    const multiLinePrompt = 'Step 1: Check database\nStep 2: Run migrations\nStep 3: Verify schema';
    const task = createTask({ prompt: multiLinePrompt });
    const checkpoint = makeCheckpoint({ outputSummary: undefined, gitBranch: undefined, gitDirtyFiles: undefined });
    const dependencyPrompt = 'Setup DB';

    const result = buildContinuationPrompt(task, checkpoint, dependencyPrompt);

    expect(result).toContain(multiLinePrompt);
  });
});
