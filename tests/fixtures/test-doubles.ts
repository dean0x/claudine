/**
 * Test Doubles
 * Provides test implementations of core interfaces for testing
 *
 * ARCHITECTURE: These test doubles implement the same interfaces as production
 * code but with controllable behavior for testing. Use these instead of mocks.
 */

import type {
  EventBus,
  Logger,
  TaskRepository,
  ProcessSpawner,
  ResourceMonitor,
  OutputCapture,
  TaskQueue,
  WorkerPool
} from '../../src/core/interfaces';
import type {
  Task,
  TaskId,
  Worker,
  WorkerId,
  SystemResources,
  TaskOutput
} from '../../src/core/domain';
import type { Result } from '../../src/core/result';
import { ok, err } from '../../src/core/result';
import { taskNotFound } from '../../src/core/errors';
import type { ChildProcess } from 'child_process';

/**
 * TestEventBus - EventBus with event tracking capabilities
 */
export class TestEventBus implements EventBus {
  private handlers = new Map<string, Set<(event: any) => Promise<void>>>();
  private requestHandlers = new Map<string, (event: any) => Promise<Result<any, Error>>>();
  private emittedEvents: Array<{ type: string; payload: any; timestamp: number }> = [];
  private subscriptionCount = 0;

  async emit<T>(eventType: string, payload: T): Promise<Result<void, Error>> {
    this.emittedEvents.push({
      type: eventType,
      payload,
      timestamp: Date.now()
    });

    const handlers = this.handlers.get(eventType) || new Set();
    const allHandlers = this.handlers.get('*') || new Set();

    const errors: Error[] = [];

    for (const handler of [...handlers, ...allHandlers]) {
      try {
        await handler({ type: eventType, ...payload });
      } catch (error) {
        errors.push(error as Error);
      }
    }

    if (errors.length > 0) {
      return err(new Error(`Event handler errors: ${errors.map(e => e.message).join(', ')}`));
    }

    return ok(undefined);
  }

  subscribe<T>(eventType: string, handler: (event: T) => Promise<void>): Result<string, Error> {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, new Set());
    }

    this.handlers.get(eventType)!.add(handler as any);
    this.subscriptionCount++;

    const subscriptionId = `sub-${this.subscriptionCount}`;
    return ok(subscriptionId);
  }

  subscribeAll(handler: (event: any) => Promise<void>): Result<string, Error> {
    return this.subscribe('*', handler);
  }

  unsubscribe(subscriptionId: string): Result<void, Error> {
    // Simplified unsubscribe for testing
    return ok(undefined);
  }

  unsubscribeAll(): void {
    this.handlers.clear();
    this.subscriptionCount = 0;
  }

  async request<TRequest, TResponse>(
    eventType: string,
    payload: TRequest
  ): Promise<Result<TResponse, Error>> {
    // Track request events for testing
    this.emittedEvents.push({
      type: `request:${eventType}`,
      payload,
      timestamp: Date.now()
    });

    const handler = this.requestHandlers.get(eventType);
    if (!handler) {
      return err(new Error(`No handler for request type: ${eventType}`));
    }

    return handler(payload) as Promise<Result<TResponse, Error>>;
  }

  onRequest<TRequest, TResponse>(
    eventType: string,
    handler: (event: TRequest) => Promise<Result<TResponse, Error>>
  ): Result<string, Error> {
    this.requestHandlers.set(eventType, handler as any);
    return ok(`req-handler-${eventType}`);
  }

  dispose(): void {
    this.unsubscribeAll();
    this.requestHandlers.clear();
    this.emittedEvents = [];
  }

  // Test-specific methods
  getAllEmittedEvents(): Array<{ type: string; payload: any; timestamp: number }> {
    return [...this.emittedEvents];
  }

  hasEmitted(eventType: string, payload?: any): boolean {
    return this.emittedEvents.some(e => {
      if (e.type !== eventType) return false;
      if (payload === undefined) return true;
      return JSON.stringify(e.payload) === JSON.stringify(payload);
    });
  }

  getEventCount(eventType: string): number {
    return this.emittedEvents.filter(e => e.type === eventType).length;
  }

  clearEmittedEvents(): void {
    this.emittedEvents = [];
  }

  on(eventType: string, handler: (data: any) => void): () => void {
    const asyncHandler = async (event: any) => {
      handler(event);
    };
    this.subscribe(eventType, asyncHandler);
    return () => this.unsubscribe(`mock-unsub`);
  }

  // Additional test helpers for worker-handler tests
  setRequestResponse<TRequest, TResponse>(
    eventType: string,
    response: Result<TResponse, Error>
  ): void {
    this.requestHandlers.set(eventType, async (payload: TRequest) => response);
  }

  hasSubscription(eventType: string): boolean {
    return this.handlers.has(eventType) && this.handlers.get(eventType)!.size > 0;
  }

  getEmittedEvents(eventType: string): any[] {
    return this.emittedEvents
      .filter(e => e.type === eventType)
      .map(e => e.payload);
  }

  getRequestedEvents(eventType: string): any[] {
    // Track requested events (simplified for testing)
    return this.emittedEvents
      .filter(e => e.type === `request:${eventType}`)
      .map(e => e.payload);
  }
}

/**
 * TestLogger - Logger that captures log entries for assertions
 */
export class TestLogger implements Logger {
  public logs: Array<{
    level: string;
    message: string;
    context?: Record<string, unknown>;
    timestamp: number;
  }> = [];

  info(message: string, context?: Record<string, unknown>): void {
    this.logs.push({ level: 'info', message, context, timestamp: Date.now() });
  }

  error(message: string, error?: Error, context?: Record<string, unknown>): void {
    this.logs.push({
      level: 'error',
      message,
      context: { ...context, error } as Record<string, unknown>,
      timestamp: Date.now()
    });
  }

  warn(message: string, context?: Record<string, unknown>): void {
    this.logs.push({ level: 'warn', message, context, timestamp: Date.now() });
  }

  debug(message: string, context?: Record<string, unknown>): void {
    this.logs.push({ level: 'debug', message, context, timestamp: Date.now() });
  }

  child(context: Record<string, unknown>): Logger {
    const childLogger = new TestLogger();
    childLogger.logs = this.logs; // Share logs with parent
    return childLogger;
  }

  hasLog(level: string, message: string): boolean {
    return this.logs.some(log => log.level === level && log.message === message);
  }

  hasLogContaining(substring: string): boolean {
    return this.logs.some(log => log.message.includes(substring));
  }

  getLogsByLevel(level: string): typeof this.logs {
    return this.logs.filter(log => log.level === level);
  }

  clear(): void {
    this.logs = [];
  }
}

/**
 * TestTaskRepository - In-memory task repository for testing
 */
export class TestTaskRepository implements TaskRepository {
  private tasks = new Map<TaskId, Task>();
  private saveError: Error | null = null;
  private findError: Error | null = null;

  async save(task: Task): Promise<Result<void, Error>> {
    if (this.saveError) {
      return err(this.saveError);
    }
    this.tasks.set(task.id, { ...task });
    return ok(undefined);
  }

  async update(id: TaskId, updates: Partial<Task>): Promise<Result<void, Error>> {
    const task = this.tasks.get(id);
    if (!task) {
      return err(taskNotFound(id));
    }
    this.tasks.set(id, { ...task, ...updates, updatedAt: Date.now() });
    return ok(undefined);
  }

  async findById(id: TaskId): Promise<Result<Task | null, Error>> {
    if (this.findError) {
      return err(this.findError);
    }
    const task = this.tasks.get(id);
    return ok(task || null);
  }

  async findAll(): Promise<Result<Task[], Error>> {
    if (this.findError) {
      return err(this.findError);
    }
    return ok(Array.from(this.tasks.values()));
  }

  async findByStatus(status: Task['status']): Promise<Result<Task[], Error>> {
    if (this.findError) {
      return err(this.findError);
    }
    const tasks = Array.from(this.tasks.values()).filter(t => t.status === status);
    return ok(tasks);
  }

  async delete(id: TaskId): Promise<Result<void, Error>> {
    if (!this.tasks.has(id)) {
      return err(taskNotFound(id));
    }
    this.tasks.delete(id);
    return ok(undefined);
  }

  async deleteAll(): Promise<Result<void, Error>> {
    this.tasks.clear();
    return ok(undefined);
  }

  // Test-specific methods
  setSaveError(error: Error | null): void {
    this.saveError = error;
  }

  setFindError(error: Error | null): void {
    this.findError = error;
  }

  getTaskCount(): number {
    return this.tasks.size;
  }

  hasTask(id: TaskId): boolean {
    return this.tasks.has(id);
  }

  clear(): void {
    this.tasks.clear();
    this.saveError = null;
    this.findError = null;
  }
}

/**
 * TestProcessSpawner - Controllable process spawner for testing
 */
export class TestProcessSpawner implements ProcessSpawner {
  private processes = new Map<string, { pid: number; killed: boolean }>();
  private spawnError: Error | null = null;
  private nextPid = 1000;
  private outputHandlers = new Map<string, (data: string) => void>();

  async spawn(
    command: string,
    args: string[],
    options?: any
  ): Promise<Result<{ process: ChildProcess; workerId: string }, Error>> {
    if (this.spawnError) {
      return err(this.spawnError);
    }

    const workerId = `worker-${this.nextPid}`;
    const pid = this.nextPid++;

    this.processes.set(workerId, { pid, killed: false });

    const mockProcess: any = {
      pid,
      kill: () => {
        const proc = this.processes.get(workerId);
        if (proc) {
          proc.killed = true;
        }
        return true;
      },
      on: (event: string, handler: Function) => {
        // Mock event handling
      },
      stdout: {
        on: (event: string, handler: Function) => {
          if (event === 'data') {
            this.outputHandlers.set(`${workerId}-stdout`, handler as any);
          }
        }
      },
      stderr: {
        on: (event: string, handler: Function) => {
          if (event === 'data') {
            this.outputHandlers.set(`${workerId}-stderr`, handler as any);
          }
        }
      }
    };

    return ok({ process: mockProcess, workerId });
  }

  async kill(pid: number): Promise<Result<void, Error>> {
    const entry = Array.from(this.processes.entries()).find(([_, p]) => p.pid === pid);
    if (!entry) {
      return err(new Error(`Process ${pid} not found`));
    }
    entry[1].killed = true;
    return ok(undefined);
  }

  // Test-specific methods
  setSpawnError(error: Error | null): void {
    this.spawnError = error;
  }

  simulateOutput(workerId: string, stream: 'stdout' | 'stderr', data: string): void {
    const handler = this.outputHandlers.get(`${workerId}-${stream}`);
    if (handler) {
      handler(Buffer.from(data));
    }
  }

  simulateExit(workerId: string, code: number): void {
    // Simulate process exit
    const proc = this.processes.get(workerId);
    if (proc) {
      proc.killed = true;
    }
  }

  isProcessKilled(workerId: string): boolean {
    return this.processes.get(workerId)?.killed || false;
  }

  clear(): void {
    this.processes.clear();
    this.outputHandlers.clear();
    this.spawnError = null;
    this.nextPid = 1000;
  }
}

/**
 * TestWorktreeManager - Mock worktree manager for testing
 */
export class TestWorktreeManager {
  private shouldFail = false;
  private worktrees = new Set<string>();

  async createWorktree(branchName: string, baseBranch?: string): Promise<Result<string, Error>> {
    if (this.shouldFail) {
      return err(new Error('Worktree creation failed'));
    }

    const worktreePath = `/tmp/worktree-${branchName}`;
    this.worktrees.add(worktreePath);
    return ok(worktreePath);
  }

  async cleanupWorktree(worktreePath: string): Promise<Result<void, Error>> {
    if (this.shouldFail) {
      return err(new Error('Worktree cleanup failed'));
    }

    this.worktrees.delete(worktreePath);
    return ok(undefined);
  }

  async removeWorktree(worktreePath: string): Promise<Result<void, Error>> {
    if (this.shouldFail) {
      return err(new Error('Worktree removal failed'));
    }

    this.worktrees.delete(worktreePath);
    return ok(undefined);
  }

  async completeTask(taskId: string, result: any): Promise<Result<any, Error>> {
    if (this.shouldFail) {
      return err(new Error('Task completion failed'));
    }

    return ok({ taskId, completed: true, result });
  }

  // Test-specific methods
  setShouldFail(shouldFail: boolean): void {
    this.shouldFail = shouldFail;
  }

  getActiveWorktrees(): string[] {
    return Array.from(this.worktrees);
  }

  clear(): void {
    this.worktrees.clear();
    this.shouldFail = false;
  }
}

/**
 * TestResourceMonitor - Controllable resource monitor for testing
 * Implements ResourceMonitor interface from src/core/interfaces.ts
 */
export class TestResourceMonitor implements ResourceMonitor {
  private cpuUsage = 50;
  private availableMemory = 4_000_000_000;
  private totalMemory = 8_000_000_000;
  private loadAvg: readonly [number, number, number] = [1.0, 1.0, 1.0];
  private workerCount = 0;
  private canSpawn = true;
  private cpuThreshold = 80;
  private memoryReserve = 1_000_000_000;

  async getResources(): Promise<Result<SystemResources>> {
    return ok({
      cpuUsage: this.cpuUsage,
      availableMemory: this.availableMemory,
      totalMemory: this.totalMemory,
      loadAverage: this.loadAvg,
      workerCount: this.workerCount,
    });
  }

  async canSpawnWorker(): Promise<Result<boolean>> {
    if (!this.canSpawn) {
      return ok(false);
    }
    return ok(
      this.cpuUsage < this.cpuThreshold &&
      this.availableMemory > this.memoryReserve
    );
  }

  getThresholds(): { readonly maxCpuPercent: number; readonly minMemoryBytes: number } {
    return {
      maxCpuPercent: this.cpuThreshold,
      minMemoryBytes: this.memoryReserve,
    };
  }

  incrementWorkerCount(): void {
    this.workerCount++;
  }

  decrementWorkerCount(): void {
    if (this.workerCount > 0) {
      this.workerCount--;
    }
  }

  recordSpawn(): void {
    // No-op for test double - settling workers tracking not needed in tests
  }

  // Test-specific methods
  setResources(resources: Partial<SystemResources>): void {
    if (resources.cpuUsage !== undefined) this.cpuUsage = resources.cpuUsage;
    if (resources.availableMemory !== undefined) this.availableMemory = resources.availableMemory;
    if (resources.totalMemory !== undefined) this.totalMemory = resources.totalMemory;
    if (resources.loadAverage !== undefined) this.loadAvg = resources.loadAverage;
    if (resources.workerCount !== undefined) this.workerCount = resources.workerCount;
  }

  setCpuUsage(percent: number): void {
    this.cpuUsage = percent;
  }

  setMemory(used: number, total: number): void {
    this.availableMemory = total - used;
    this.totalMemory = total;
  }

  setCanSpawnWorker(can: boolean): void {
    this.canSpawn = can;
  }

  getCurrentWorkerCount(): number {
    return this.workerCount;
  }

  simulateHighLoad(): void {
    this.setCpuUsage(95);
    this.setMemory(7500000000, 8000000000);
    this.setCanSpawnWorker(false);
  }

  simulateLowLoad(): void {
    this.setCpuUsage(20);
    this.setMemory(2000000000, 8000000000);
    this.setCanSpawnWorker(true);
  }
}

/**
 * TestOutputCapture - Controllable output capture for testing
 */
export class TestOutputCapture implements OutputCapture {
  private outputs = new Map<TaskId, { stdout: string[]; stderr: string[]; totalSize: number }>();
  private captureError: Error | null = null;

  capture(taskId: TaskId, stream: 'stdout' | 'stderr', data: string): Result<void, Error> {
    if (this.captureError) {
      return err(this.captureError);
    }

    if (!this.outputs.has(taskId)) {
      this.outputs.set(taskId, { stdout: [], stderr: [], totalSize: 0 });
    }

    const output = this.outputs.get(taskId)!;
    output[stream].push(data);
    output.totalSize += data.length;

    return ok(undefined);
  }

  getOutput(taskId: TaskId): Result<TaskOutput, Error> {
    const output = this.outputs.get(taskId);

    if (!output) {
      return ok({
        taskId,
        stdout: [],
        stderr: [],
        totalSize: 0
      });
    }

    return ok({
      taskId,
      stdout: output.stdout,
      stderr: output.stderr,
      totalSize: output.totalSize
    });
  }

  clear(taskId: TaskId): Result<void, Error> {
    this.outputs.delete(taskId);
    return ok(undefined);
  }

  cleanup(): void {
    this.outputs.clear();
  }

  // Test-specific methods
  setCaptureError(error: Error | null): void {
    this.captureError = error;
  }

  hasOutput(taskId: TaskId): boolean {
    return this.outputs.has(taskId);
  }

  getOutputCount(): number {
    return this.outputs.size;
  }
}