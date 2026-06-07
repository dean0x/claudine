/**
 * Unit tests for waitForLoopCompletion (shared drive-helpers waiter).
 * ARCHITECTURE: foreground orchestration now reuses the shared bounded-execution
 * waiter (issue #205) instead of a bespoke local copy; these tests pin its lifecycle
 * behavior. On LoopCompleted the waiter re-reads the loop's terminal status (the event
 * carries no status) and maps FAILED→1, otherwise →0; the mock container provides a
 * loopRepository so these tests exercise that authoritative path.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { waitForLoopCompletion } from '../../../src/cli/drive-helpers.js';
import { loadConfiguration } from '../../../src/core/configuration.js';
import type { Container } from '../../../src/core/container.js';
import { LoopId, LoopStatus } from '../../../src/core/domain.js';
import { InMemoryEventBus } from '../../../src/core/events/event-bus.js';
import { err, ok } from '../../../src/core/result.js';
import { createMockLogger } from '../../fixtures/mocks.js';

function createMockContainer(eventBus: InMemoryEventBus, loopStatus: LoopStatus = LoopStatus.COMPLETED): Container {
  return {
    get: (key: string) => {
      if (key === 'eventBus') return ok(eventBus);
      if (key === 'loopRepository') return ok({ findById: async () => ok({ status: loopStatus }) });
      return err(new Error(`Unknown key: ${key}`));
    },
  } as unknown as Container;
}

describe('waitForLoopCompletion', () => {
  let eventBus: InMemoryEventBus;
  let container: Container;
  const loopId = LoopId('loop-test-1');

  beforeEach(() => {
    eventBus = new InMemoryEventBus(loadConfiguration(), createMockLogger());
    container = createMockContainer(eventBus);
  });

  afterEach(() => {
    eventBus.dispose();
  });

  it('should resolve with 0 on LoopCompleted', async () => {
    const promise = waitForLoopCompletion(container, loopId);

    // Emit after subscription
    await eventBus.emit('LoopCompleted', { loopId, reason: 'done' });

    const exitCode = await promise;
    expect(exitCode).toBe(0);
  });

  it('should resolve with 1 on LoopCancelled', async () => {
    const promise = waitForLoopCompletion(container, loopId);

    await eventBus.emit('LoopCancelled', { loopId, reason: 'user cancelled' });

    const exitCode = await promise;
    expect(exitCode).toBe(1);
  });

  it('should ignore events for other loopIds', async () => {
    const promise = waitForLoopCompletion(container, loopId);

    // Emit for a different loop — should not resolve
    await eventBus.emit('LoopCompleted', { loopId: LoopId('loop-other'), reason: 'done' });

    // Verify not resolved yet by racing with a timeout
    const result = await Promise.race([
      promise.then((code) => ({ resolved: true, code })),
      new Promise<{ resolved: false }>((resolve) => setTimeout(() => resolve({ resolved: false }), 50)),
    ]);
    expect(result.resolved).toBe(false);

    // Now emit for the correct loop
    await eventBus.emit('LoopCompleted', { loopId, reason: 'done' });
    const exitCode = await promise;
    expect(exitCode).toBe(0);
  });

  it('should only resolve once when both events fire rapidly', async () => {
    const promise = waitForLoopCompletion(container, loopId);

    // Fire both events rapidly
    await eventBus.emit('LoopCompleted', { loopId, reason: 'done' });
    await eventBus.emit('LoopCancelled', { loopId, reason: 'cancelled' });

    const exitCode = await promise;
    // First event wins (LoopCompleted → 0)
    expect(exitCode).toBe(0);
  });

  it('should resolve with 1 when eventBus is unavailable', async () => {
    const uiErrorSpy = vi.spyOn(await import('../../../src/cli/ui.js'), 'error').mockImplementation(() => {});

    const badContainer = {
      get: () => err(new Error('No event bus')),
    } as unknown as Container;

    const exitCode = await waitForLoopCompletion(badContainer, loopId);

    expect(exitCode).toBe(1);
    uiErrorSpy.mockRestore();
  });
});
