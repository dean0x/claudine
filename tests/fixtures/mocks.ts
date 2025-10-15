import { vi } from 'vitest';
import type { EventEmitter } from 'events';
import type {
  Logger,
  EventBus,
  TaskRepository,
  ProcessSpawner,
  OutputCapture,
  ResourceMonitor,
  TaskQueue
} from '../../src/core/interfaces';
import type { Result } from '../../src/core/result';
import type { Task, Worker, WorkerOptions } from '../../src/core/domain';
import { createMockTask, createMockWorker } from './index.js';

export const createMockLogger = (): Logger => ({
  info: vi.fn(),
  error: vi.fn(),
  warn: vi.fn(),
  debug: vi.fn(),
});

export const createMockEventBus = (): EventBus => {
  const listeners = new Map<string, Set<Function>>();
  return {
    emit: vi.fn((event: string, data?: any) => {
      const handlers = listeners.get(event);
      if (handlers) {
        handlers.forEach(handler => handler(data));
      }
    }),
    on: vi.fn((event: string, handler: Function) => {
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(handler);
    }),
    off: vi.fn((event: string, handler: Function) => {
      listeners.get(event)?.delete(handler);
    }),
    once: vi.fn((event: string, handler: Function) => {
      const wrapper = (data: any) => {
        handler(data);
        listeners.get(event)?.delete(wrapper);
      };
      if (!listeners.has(event)) {
        listeners.set(event, new Set());
      }
      listeners.get(event)!.add(wrapper);
    }),
  };
};

export const createMockTaskRepository = (): TaskRepository => ({
  save: vi.fn(async (task: Task): Promise<Result<Task>> =>
    ({ ok: true, value: task })),
  findById: vi.fn(async (id: string): Promise<Result<Task | null>> =>
    ({ ok: true, value: createMockTask({ id }) })),
  findAll: vi.fn(async (): Promise<Result<Task[]>> =>
    ({ ok: true, value: [] })),
  update: vi.fn(async (id: string, updates: Partial<Task>): Promise<Result<Task>> =>
    ({ ok: true, value: { ...createMockTask({ id }), ...updates } })),
  delete: vi.fn(async (id: string): Promise<Result<void>> =>
    ({ ok: true, value: undefined })),
  findByStatus: vi.fn(async (status: Task['status']): Promise<Result<Task[]>> =>
    ({ ok: true, value: [] })),
});

export const createMockProcessSpawner = (): ProcessSpawner => ({
  spawn: vi.fn(async (options: WorkerOptions): Promise<Result<Worker>> =>
    ({ ok: true, value: createMockWorker({ taskId: options.taskId }) })),
  kill: vi.fn(async (pid: number): Promise<Result<void>> =>
    ({ ok: true, value: undefined })),
  isRunning: vi.fn(async (pid: number): Promise<boolean> => true),
});

export const createMockOutputCapture = (): OutputCapture => ({
  capture: vi.fn(async (workerId: string, data: string): Promise<Result<void>> =>
    ({ ok: true, value: undefined })),
  getOutput: vi.fn(async (workerId: string): Promise<Result<string>> =>
    ({ ok: true, value: '' })),
  clear: vi.fn(async (workerId: string): Promise<Result<void>> =>
    ({ ok: true, value: undefined })),
});

export const createMockResourceMonitor = (): ResourceMonitor => ({
  getAvailableResources: vi.fn(async () =>
    ({ ok: true as const, value: { cpuAvailable: 4, memoryAvailable: 8 * 1024 * 1024 * 1024 } })),
  getSystemLoad: vi.fn(async () =>
    ({ ok: true as const, value: { cpuUsage: 0.5, memoryUsage: 0.6 } })),
  canSpawnWorker: vi.fn(async () =>
    ({ ok: true as const, value: true })),
  trackWorker: vi.fn(async (worker: Worker) =>
    ({ ok: true as const, value: undefined })),
  releaseWorker: vi.fn(async (workerId: string) =>
    ({ ok: true as const, value: undefined })),
});

export const createMockTaskQueue = (): TaskQueue => ({
  enqueue: vi.fn(async (task: Task): Promise<Result<void>> =>
    ({ ok: true, value: undefined })),
  dequeue: vi.fn(async (): Promise<Result<Task | null>> =>
    ({ ok: true, value: null })),
  peek: vi.fn(async (): Promise<Result<Task | null>> =>
    ({ ok: true, value: null })),
  size: vi.fn(async (): Promise<Result<number>> =>
    ({ ok: true, value: 0 })),
  isEmpty: vi.fn(async (): Promise<Result<boolean>> =>
    ({ ok: true, value: true })),
  clear: vi.fn(async (): Promise<Result<void>> =>
    ({ ok: true, value: undefined })),
});