/**
 * Simple dependency injection container
 * Manages service lifecycle and dependencies
 */

import { Result, ok, err } from './result.js';
import { ClaudineError, ErrorCode } from './errors.js';

type Factory<T> = () => T | Promise<T>;
type Service = { factory: Factory<any>; singleton: boolean; instance?: any };

export class Container {
  private readonly services = new Map<string, Service>();
  private readonly resolving = new Set<string>();

  /**
   * Register a singleton service (created once, shared)
   */
  registerSingleton<T>(name: string, factory: Factory<T>): Result<void> {
    if (this.services.has(name)) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        `Service ${name} already registered`
      ));
    }
    
    this.services.set(name, { factory, singleton: true });
    return ok(undefined);
  }

  /**
   * Register a transient service (new instance each time)
   */
  registerTransient<T>(name: string, factory: Factory<T>): Result<void> {
    if (this.services.has(name)) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        `Service ${name} already registered`
      ));
    }
    
    this.services.set(name, { factory, singleton: false });
    return ok(undefined);
  }

  /**
   * Register a value directly (already instantiated)
   */
  registerValue<T>(name: string, value: T): Result<void> {
    if (this.services.has(name)) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        `Service ${name} already registered`
      ));
    }
    
    this.services.set(name, { 
      factory: () => value, 
      singleton: true, 
      instance: value 
    });
    return ok(undefined);
  }

  /**
   * Resolve a service by name
   */
  async resolve<T>(name: string): Promise<Result<T>> {
    const service = this.services.get(name);
    
    if (!service) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        `Service ${name} not registered`
      ));
    }

    // Check for circular dependencies
    if (this.resolving.has(name)) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        `Circular dependency detected for ${name}`
      ));
    }

    try {
      // If singleton and already created, return it
      if (service.singleton && service.instance !== undefined) {
        return ok(service.instance);
      }

      // Mark as resolving to detect circular deps
      this.resolving.add(name);

      // Create new instance
      const instance = await service.factory();

      // Cache if singleton
      if (service.singleton) {
        service.instance = instance;
      }

      this.resolving.delete(name);
      return ok(instance);
    } catch (error) {
      this.resolving.delete(name);
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to resolve service ${name}: ${error}`
      ));
    }
  }

  /**
   * Resolve a service synchronously (must be already instantiated or sync factory)
   */
  get<T>(name: string): Result<T> {
    const service = this.services.get(name);
    
    if (!service) {
      return err(new ClaudineError(
        ErrorCode.CONFIGURATION_ERROR,
        `Service ${name} not registered`
      ));
    }

    // If singleton and already created, return it
    if (service.singleton && service.instance !== undefined) {
      return ok(service.instance);
    }

    // For sync get, factory must be synchronous
    try {
      const instance = service.factory();
      if (instance instanceof Promise) {
        return err(new ClaudineError(
          ErrorCode.CONFIGURATION_ERROR,
          `Service ${name} has async factory, use resolve() instead`
        ));
      }
      
      if (service.singleton) {
        service.instance = instance;
      }
      
      return ok(instance as T);
    } catch (error) {
      return err(new ClaudineError(
        ErrorCode.SYSTEM_ERROR,
        `Failed to get service ${name}: ${error}`
      ));
    }
  }

  /**
   * Check if a service is registered
   */
  has(name: string): boolean {
    return this.services.has(name);
  }

  /**
   * Clear all services
   */
  clear(): void {
    this.services.clear();
    this.resolving.clear();
  }

  /**
   * Dispose container and trigger graceful shutdown
   */
  async dispose(): Promise<void> {
    // Get EventBus if available to emit shutdown events
    const eventBusResult = this.get('eventBus');
    if (eventBusResult.ok) {
      const eventBus = eventBusResult.value as any;
      if (eventBus.emit) {
        await eventBus.emit('ShutdownInitiated', {});
      }
    }

    // Kill all workers if worker pool exists
    const workerPoolResult = this.get('workerPool');
    if (workerPoolResult.ok) {
      const workerPool = workerPoolResult.value as any;
      if (workerPool.killAll) {
        if (eventBusResult.ok) {
          const eventBus = eventBusResult.value as any;
          await eventBus.emit('WorkersTerminating', {});
        }
        await workerPool.killAll();
      }
    }

    // Close database if exists
    const dbResult = this.get('database');
    if (dbResult.ok) {
      const db = dbResult.value as any;
      if (db.close) {
        if (eventBusResult.ok) {
          const eventBus = eventBusResult.value as any;
          await eventBus.emit('DatabaseClosing', {});
        }
        db.close();
      }
    }

    // Final cleanup event
    if (eventBusResult.ok) {
      const eventBus = eventBusResult.value as any;
      if (eventBus.emit) {
        await eventBus.emit('ShutdownComplete', {});
      }

      // CRITICAL: Dispose EventBus to clear setInterval cleanup timer
      if (eventBus.dispose) {
        eventBus.dispose();
      }
    }

    // Clear all services
    this.clear();
  }

  /**
   * Create a child container (inherits registrations)
   */
  createChild(): Container {
    const child = new Container();
    
    // Copy service definitions (not instances)
    for (const [name, service] of this.services) {
      child.services.set(name, {
        factory: service.factory,
        singleton: service.singleton,
        // Don't copy instances - child gets fresh ones
      });
    }
    
    return child;
  }
}

/**
 * Global container instance (optional - can create your own)
 */
export const globalContainer = new Container();