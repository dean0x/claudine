/**
 * Autoscaling manager
 * Continuously monitors resources and spawns workers as needed
 */

import {
  TaskQueue,
  WorkerPool,
  ResourceMonitor,
  Logger,
} from '../core/interfaces.js';

export class AutoscalingManager {
  private running = false;
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly checkIntervalMs: number;
  private onScaleUpCallback?: () => void;

  constructor(
    private readonly queue: TaskQueue,
    private readonly workers: WorkerPool,
    private readonly monitor: ResourceMonitor,
    private readonly logger: Logger,
    checkIntervalMs = 1000 // Check every second by default
  ) {
    this.checkIntervalMs = checkIntervalMs;
  }

  /**
   * Start the autoscaling loop
   */
  start(): void {
    if (this.running) {
      this.logger.warn('Autoscaling already running');
      return;
    }

    this.running = true;
    this.logger.info('Autoscaling started', {
      checkInterval: this.checkIntervalMs,
      thresholds: this.monitor.getThresholds(),
    });

    // Start the check loop
    this.scheduleCheck();
  }

  /**
   * Stop the autoscaling loop
   */
  stop(): void {
    if (!this.running) {
      return;
    }

    this.running = false;
    
    if (this.checkInterval) {
      clearTimeout(this.checkInterval);
      this.checkInterval = null;
    }

    this.logger.info('Autoscaling stopped');
  }

  /**
   * Perform one autoscaling check
   */
  private async check(): Promise<void> {
    if (!this.running) {
      return;
    }

    try {
      // Get current state
      const queueSize = this.queue.size();
      const workerCount = this.workers.getWorkerCount();

      // Log current state
      this.logger.debug('Autoscaling check', {
        queueSize,
        workerCount,
      });

      // If queue is empty, nothing to do
      if (queueSize === 0) {
        return;
      }

      // Check if we can spawn more workers
      const canSpawnResult = await this.monitor.canSpawnWorker();
      
      if (!canSpawnResult.ok) {
        this.logger.error('Failed to check resources', canSpawnResult.error);
        return;
      }

      if (!canSpawnResult.value) {
        // Can't spawn, log why
        const resourcesResult = await this.monitor.getResources();
        
        if (resourcesResult.ok) {
          const resources = resourcesResult.value;
          this.logger.debug('Cannot spawn worker - insufficient resources', {
            cpuUsage: resources.cpuUsage,
            availableMemory: resources.availableMemory,
            workerCount: resources.workerCount,
          });
        }
        
        return;
      }

      // We can spawn! Get next task
      const peekResult = this.queue.peek();
      
      if (!peekResult.ok || !peekResult.value) {
        return;
      }

      // Log that we're scaling up
      this.logger.info('Scaling up', {
        queueSize,
        currentWorkers: workerCount,
        newWorkers: workerCount + 1,
      });

      // Emit event (for TaskManager to handle actual spawning)
      this.onScaleUp();

    } catch (error) {
      this.logger.error('Autoscaling check failed', error as Error);
    } finally {
      // Schedule next check
      this.scheduleCheck();
    }
  }

  /**
   * Schedule the next check
   */
  private scheduleCheck(): void {
    if (!this.running) {
      return;
    }

    this.checkInterval = setTimeout(
      () => this.check(),
      this.checkIntervalMs
    );
  }

  /**
   * Called when we need to scale up
   * This would typically emit an event that TaskManager listens to
   */
  private onScaleUp(): void {
    this.logger.debug('Scale up event emitted');
    // Call the callback if set
    if (this.onScaleUpCallback) {
      this.onScaleUpCallback();
    }
  }
  
  /**
   * Set callback for scale up events
   */
  setOnScaleUp(callback: () => void): void {
    this.onScaleUpCallback = callback;
  }

  /**
   * Get current autoscaling status
   */
  async getStatus(): Promise<{
    running: boolean;
    queueSize: number;
    workerCount: number;
    canSpawn: boolean;
    resources?: {
      cpuUsage: number;
      availableMemory: number;
    };
  }> {
    const queueSize = this.queue.size();
    const workerCount = this.workers.getWorkerCount();
    
    const canSpawnResult = await this.monitor.canSpawnWorker();
    const canSpawn = canSpawnResult.ok && canSpawnResult.value;

    const resourcesResult = await this.monitor.getResources();
    const resources = resourcesResult.ok ? {
      cpuUsage: resourcesResult.value.cpuUsage,
      availableMemory: resourcesResult.value.availableMemory,
    } : undefined;

    return {
      running: this.running,
      queueSize,
      workerCount,
      canSpawn,
      resources,
    };
  }
}

/**
 * Autoscaling policy for more sophisticated scaling decisions
 */
export interface AutoscalingPolicy {
  shouldScaleUp(
    queueSize: number,
    workerCount: number,
    cpuUsage: number,
    memoryAvailable: number
  ): boolean;

  shouldScaleDown(
    queueSize: number,
    workerCount: number,
    cpuUsage: number,
    memoryAvailable: number
  ): boolean;

  getTargetWorkerCount(
    queueSize: number,
    currentWorkers: number
  ): number;
}

/**
 * Default autoscaling policy
 */
export class DefaultAutoscalingPolicy implements AutoscalingPolicy {
  constructor(
    private readonly maxCpuPercent = 80,
    private readonly minMemoryBytes = 1_000_000_000,
    private readonly maxWorkersPerTask = 1
  ) {}

  shouldScaleUp(
    queueSize: number,
    workerCount: number,
    cpuUsage: number,
    memoryAvailable: number
  ): boolean {
    // Don't scale if no tasks in queue
    if (queueSize === 0) {
      return false;
    }

    // Don't scale if resources are constrained
    if (cpuUsage >= this.maxCpuPercent) {
      return false;
    }

    if (memoryAvailable <= this.minMemoryBytes) {
      return false;
    }

    // Scale if we have fewer workers than tasks
    return workerCount < queueSize;
  }

  shouldScaleDown(
    queueSize: number,
    workerCount: number,
    cpuUsage: number,
    memoryAvailable: number
  ): boolean {
    // For now, we don't scale down - workers terminate when done
    // Could implement idle worker termination in the future
    return false;
  }

  getTargetWorkerCount(
    queueSize: number,
    currentWorkers: number
  ): number {
    // Simple policy: one worker per task
    return Math.min(queueSize, currentWorkers + 1);
  }
}

/**
 * Aggressive autoscaling policy for maximum throughput
 */
export class AggressiveAutoscalingPolicy implements AutoscalingPolicy {
  shouldScaleUp(
    queueSize: number,
    workerCount: number,
    cpuUsage: number,
    memoryAvailable: number
  ): boolean {
    // Scale up as long as we have any tasks and any resources
    return queueSize > 0 && cpuUsage < 95 && memoryAvailable > 500_000_000;
  }

  shouldScaleDown(
    queueSize: number,
    workerCount: number,
    cpuUsage: number,
    memoryAvailable: number
  ): boolean {
    return false;
  }

  getTargetWorkerCount(
    queueSize: number,
    currentWorkers: number
  ): number {
    // Try to spawn multiple workers at once
    return currentWorkers + Math.min(queueSize, 5);
  }
}