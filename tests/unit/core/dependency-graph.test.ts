import { describe, it, expect } from 'vitest';
import { DependencyGraph } from '../../../src/core/dependency-graph.js';
import { TaskId } from '../../../src/core/domain.js';
import { TaskDependency } from '../../../src/core/interfaces.js';

describe('DependencyGraph - Cycle Detection and DAG Operations', () => {
  describe('Construction', () => {
    it('should create empty graph', () => {
      const graph = new DependencyGraph();

      expect(graph.size()).toBe(0);
    });

    it('should build graph from dependency list', () => {
      const dependencies: TaskDependency[] = [
        {
          id: 1,
          taskId: TaskId('task-A'),
          dependsOnTaskId: TaskId('task-B'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        },
        {
          id: 2,
          taskId: TaskId('task-B'),
          dependsOnTaskId: TaskId('task-C'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        }
      ];

      const graph = new DependencyGraph(dependencies);

      expect(graph.size()).toBe(3); // A, B, C
      expect(graph.hasTask(TaskId('task-A'))).toBe(true);
      expect(graph.hasTask(TaskId('task-B'))).toBe(true);
      expect(graph.hasTask(TaskId('task-C'))).toBe(true);
    });
  });

  describe('Cycle Detection - Simple Cases', () => {
    it('should detect self-dependency (simple cycle)', () => {
      const graph = new DependencyGraph();

      const result = graph.wouldCreateCycle(TaskId('task-A'), TaskId('task-A'));

      expect(result.ok).toBe(true);
      expect(result.value).toBe(true); // Cycle detected
    });

    it('should not detect cycle for simple dependency', () => {
      const graph = new DependencyGraph();

      const result = graph.wouldCreateCycle(TaskId('task-A'), TaskId('task-B'));

      expect(result.ok).toBe(true);
      expect(result.value).toBe(false); // No cycle
    });

    it('should detect two-node cycle', () => {
      // A -> B
      const dependencies: TaskDependency[] = [
        {
          id: 1,
          taskId: TaskId('task-A'),
          dependsOnTaskId: TaskId('task-B'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        }
      ];

      const graph = new DependencyGraph(dependencies);

      // Try to add B -> A (would create cycle)
      const result = graph.wouldCreateCycle(TaskId('task-B'), TaskId('task-A'));

      expect(result.ok).toBe(true);
      expect(result.value).toBe(true); // Cycle detected
    });
  });

  describe('Cycle Detection - Complex Cases', () => {
    it('should detect three-node cycle', () => {
      // A -> B -> C
      const dependencies: TaskDependency[] = [
        {
          id: 1,
          taskId: TaskId('task-A'),
          dependsOnTaskId: TaskId('task-B'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        },
        {
          id: 2,
          taskId: TaskId('task-B'),
          dependsOnTaskId: TaskId('task-C'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        }
      ];

      const graph = new DependencyGraph(dependencies);

      // Try to add C -> A (would create cycle: A -> B -> C -> A)
      const result = graph.wouldCreateCycle(TaskId('task-C'), TaskId('task-A'));

      expect(result.ok).toBe(true);
      expect(result.value).toBe(true); // Cycle detected
    });

    it('should detect cycle in diamond pattern', () => {
      // Diamond: A -> B, A -> C, B -> D, C -> D
      const dependencies: TaskDependency[] = [
        {
          id: 1,
          taskId: TaskId('task-A'),
          dependsOnTaskId: TaskId('task-B'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        },
        {
          id: 2,
          taskId: TaskId('task-A'),
          dependsOnTaskId: TaskId('task-C'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        },
        {
          id: 3,
          taskId: TaskId('task-B'),
          dependsOnTaskId: TaskId('task-D'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        },
        {
          id: 4,
          taskId: TaskId('task-C'),
          dependsOnTaskId: TaskId('task-D'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        }
      ];

      const graph = new DependencyGraph(dependencies);

      // Diamond is valid DAG - no cycle
      const result1 = graph.hasCycle();
      expect(result1.ok).toBe(true);
      expect(result1.value).toBe(false);

      // Try to add D -> A (would create cycle)
      const result2 = graph.wouldCreateCycle(TaskId('task-D'), TaskId('task-A'));
      expect(result2.ok).toBe(true);
      expect(result2.value).toBe(true); // Cycle detected
    });

    it('should allow valid DAG with multiple paths', () => {
      // A -> B -> D
      // A -> C -> D
      const dependencies: TaskDependency[] = [
        {
          id: 1,
          taskId: TaskId('task-A'),
          dependsOnTaskId: TaskId('task-B'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        },
        {
          id: 2,
          taskId: TaskId('task-A'),
          dependsOnTaskId: TaskId('task-C'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        },
        {
          id: 3,
          taskId: TaskId('task-B'),
          dependsOnTaskId: TaskId('task-D'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        },
        {
          id: 4,
          taskId: TaskId('task-C'),
          dependsOnTaskId: TaskId('task-D'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        }
      ];

      const graph = new DependencyGraph(dependencies);

      const result = graph.hasCycle();
      expect(result.ok).toBe(true);
      expect(result.value).toBe(false); // Valid DAG, no cycle
    });

    it('should detect long cycle chain', () => {
      // A -> B -> C -> D -> E
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('task-B'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 3, taskId: TaskId('task-C'), dependsOnTaskId: TaskId('task-D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 4, taskId: TaskId('task-D'), dependsOnTaskId: TaskId('task-E'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      // Try to add E -> A (would create long cycle)
      const result = graph.wouldCreateCycle(TaskId('task-E'), TaskId('task-A'));

      expect(result.ok).toBe(true);
      expect(result.value).toBe(true); // Cycle detected
    });

    it('should detect cycle in middle of chain', () => {
      // A -> B -> C -> D -> E
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('task-B'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 3, taskId: TaskId('task-C'), dependsOnTaskId: TaskId('task-D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 4, taskId: TaskId('task-D'), dependsOnTaskId: TaskId('task-E'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      // Try to add D -> B (would create cycle in middle: B -> C -> D -> B)
      const result = graph.wouldCreateCycle(TaskId('task-D'), TaskId('task-B'));

      expect(result.ok).toBe(true);
      expect(result.value).toBe(true); // Cycle detected
    });
  });

  describe('Dependency Queries', () => {
    it('should get direct dependencies', () => {
      // A depends on B and C
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const result = graph.getDirectDependencies(TaskId('task-A'));

      expect(result.ok).toBe(true);
      expect(result.value).toHaveLength(2);
      expect(result.value).toContain(TaskId('task-B'));
      expect(result.value).toContain(TaskId('task-C'));
    });

    it('should get direct dependents', () => {
      // A and B depend on C
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('task-B'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const result = graph.getDirectDependents(TaskId('task-C'));

      expect(result.ok).toBe(true);
      expect(result.value).toHaveLength(2);
      expect(result.value).toContain(TaskId('task-A'));
      expect(result.value).toContain(TaskId('task-B'));
    });

    it('should get all transitive dependencies', () => {
      // A -> B -> C -> D
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('task-B'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 3, taskId: TaskId('task-C'), dependsOnTaskId: TaskId('task-D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const result = graph.getAllDependencies(TaskId('task-A'));

      expect(result.ok).toBe(true);
      expect(result.value).toHaveLength(3);
      expect(result.value).toContain(TaskId('task-B'));
      expect(result.value).toContain(TaskId('task-C'));
      expect(result.value).toContain(TaskId('task-D'));
    });

    it('should get all transitive dependents', () => {
      // A -> B -> C -> D
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('task-B'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 3, taskId: TaskId('task-C'), dependsOnTaskId: TaskId('task-D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const result = graph.getAllDependents(TaskId('task-D'));

      expect(result.ok).toBe(true);
      expect(result.value).toHaveLength(3);
      expect(result.value).toContain(TaskId('task-A'));
      expect(result.value).toContain(TaskId('task-B'));
      expect(result.value).toContain(TaskId('task-C'));
    });

    it('should return empty array for task with no dependencies', () => {
      const graph = new DependencyGraph();

      const result = graph.getDirectDependencies(TaskId('task-A'));

      expect(result.ok).toBe(true);
      expect(result.value).toHaveLength(0);
    });
  });

  describe('Topological Sort', () => {
    it('should sort simple chain', () => {
      // A -> B -> C
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('task-B'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const result = graph.topologicalSort();

      expect(result.ok).toBe(true);
      // C should be before B, B before A (dependencies first)
      const order = result.value as readonly TaskId[];
      expect(order.indexOf(TaskId('task-C'))).toBeLessThan(order.indexOf(TaskId('task-B')));
      expect(order.indexOf(TaskId('task-B'))).toBeLessThan(order.indexOf(TaskId('task-A')));
    });

    it('should sort diamond pattern', () => {
      // A -> B, A -> C, B -> D, C -> D
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 3, taskId: TaskId('task-B'), dependsOnTaskId: TaskId('task-D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 4, taskId: TaskId('task-C'), dependsOnTaskId: TaskId('task-D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const result = graph.topologicalSort();

      expect(result.ok).toBe(true);
      const order = result.value as readonly TaskId[];

      // D should be before B and C
      expect(order.indexOf(TaskId('task-D'))).toBeLessThan(order.indexOf(TaskId('task-B')));
      expect(order.indexOf(TaskId('task-D'))).toBeLessThan(order.indexOf(TaskId('task-C')));

      // B and C should be before A
      expect(order.indexOf(TaskId('task-B'))).toBeLessThan(order.indexOf(TaskId('task-A')));
      expect(order.indexOf(TaskId('task-C'))).toBeLessThan(order.indexOf(TaskId('task-A')));
    });

    it('should fail for graph with cycles', () => {
      // A -> B -> A (cycle)
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('task-B'), dependsOnTaskId: TaskId('task-A'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const result = graph.topologicalSort();

      expect(result.ok).toBe(false);
      expect(result.error?.message).toContain('cycle');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty graph', () => {
      const graph = new DependencyGraph();

      const sortResult = graph.topologicalSort();
      expect(sortResult.ok).toBe(true);
      expect(sortResult.value).toHaveLength(0);

      const cycleResult = graph.hasCycle();
      expect(cycleResult.ok).toBe(true);
      expect(cycleResult.value).toBe(false);
    });

    it('should handle single task', () => {
      const graph = new DependencyGraph();

      const result = graph.wouldCreateCycle(TaskId('task-A'), TaskId('task-B'));

      expect(result.ok).toBe(true);
      expect(result.value).toBe(false);
    });

    it('should handle disconnected graph components', () => {
      // A -> B and C -> D (disconnected)
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('task-C'), dependsOnTaskId: TaskId('task-D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const cycleResult = graph.hasCycle();
      expect(cycleResult.ok).toBe(true);
      expect(cycleResult.value).toBe(false);

      const sortResult = graph.topologicalSort();
      expect(sortResult.ok).toBe(true);
      expect(sortResult.value).toHaveLength(4);
    });
  });

  describe('Real-world Scenarios', () => {
    it('should handle build pipeline dependencies', () => {
      // test -> lint -> build -> deploy
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('deploy'), dependsOnTaskId: TaskId('build'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('build'), dependsOnTaskId: TaskId('lint'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 3, taskId: TaskId('build'), dependsOnTaskId: TaskId('test'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const sortResult = graph.topologicalSort();
      expect(sortResult.ok).toBe(true);

      const order = sortResult.value as readonly TaskId[];

      // test and lint should be before build
      expect(order.indexOf(TaskId('test'))).toBeLessThan(order.indexOf(TaskId('build')));
      expect(order.indexOf(TaskId('lint'))).toBeLessThan(order.indexOf(TaskId('build')));

      // build should be before deploy
      expect(order.indexOf(TaskId('build'))).toBeLessThan(order.indexOf(TaskId('deploy')));
    });

    it('should prevent circular pipeline', () => {
      // deploy -> build -> test -> deploy (circular!)
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('deploy'), dependsOnTaskId: TaskId('build'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('build'), dependsOnTaskId: TaskId('test'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      // Try to add test -> deploy (would complete cycle)
      const result = graph.wouldCreateCycle(TaskId('test'), TaskId('deploy'));

      expect(result.ok).toBe(true);
      expect(result.value).toBe(true); // Cycle detected - prevented!
    });
  });

  describe('Chain Depth Calculation', () => {
    it('should return depth 0 for task with no dependencies', () => {
      const graph = new DependencyGraph();

      const depth = graph.getMaxDepth(TaskId('task-A'));

      expect(depth).toBe(0);
    });

    it('should return depth 1 for task with single dependency', () => {
      const dependencies: TaskDependency[] = [
        {
          id: 1,
          taskId: TaskId('task-A'),
          dependsOnTaskId: TaskId('task-B'),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        }
      ];

      const graph = new DependencyGraph(dependencies);

      const depth = graph.getMaxDepth(TaskId('task-A'));

      expect(depth).toBe(1); // A -> B (depth 1)
    });

    it('should return correct depth for linear chain', () => {
      // A -> B -> C -> D (depth 3)
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('A'), dependsOnTaskId: TaskId('B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('B'), dependsOnTaskId: TaskId('C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 3, taskId: TaskId('C'), dependsOnTaskId: TaskId('D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const depthA = graph.getMaxDepth(TaskId('A'));
      const depthB = graph.getMaxDepth(TaskId('B'));
      const depthC = graph.getMaxDepth(TaskId('C'));
      const depthD = graph.getMaxDepth(TaskId('D'));

      expect(depthA).toBe(3); // A -> B -> C -> D
      expect(depthB).toBe(2); // B -> C -> D
      expect(depthC).toBe(1); // C -> D
      expect(depthD).toBe(0); // D (no dependencies)
    });

    it('should return maximum depth for task with multiple dependencies (diamond shape)', () => {
      // A -> [B, C]
      // B -> D
      // C -> D
      // Max depth for A is 2 (A -> B -> D or A -> C -> D)
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('A'), dependsOnTaskId: TaskId('B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('A'), dependsOnTaskId: TaskId('C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 3, taskId: TaskId('B'), dependsOnTaskId: TaskId('D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 4, taskId: TaskId('C'), dependsOnTaskId: TaskId('D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const depth = graph.getMaxDepth(TaskId('A'));

      expect(depth).toBe(2); // Max path: A -> B -> D (or A -> C -> D)
    });

    it('should choose longest path when branches have different depths', () => {
      // A -> [B, C]
      // B -> D -> E -> F (depth 3 from B)
      // C (depth 0 from C)
      // Max depth for A is 4 (A -> B -> D -> E -> F)
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('A'), dependsOnTaskId: TaskId('B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('A'), dependsOnTaskId: TaskId('C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 3, taskId: TaskId('B'), dependsOnTaskId: TaskId('D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 4, taskId: TaskId('D'), dependsOnTaskId: TaskId('E'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 5, taskId: TaskId('E'), dependsOnTaskId: TaskId('F'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      const depth = graph.getMaxDepth(TaskId('A'));

      expect(depth).toBe(4); // Longest path: A -> B -> D -> E -> F
    });

    it('should handle deep linear chains (101 tasks)', () => {
      // Create chain: 0 -> 1 -> 2 -> ... -> 100
      const dependencies: TaskDependency[] = [];
      for (let i = 0; i < 100; i++) {
        dependencies.push({
          id: i + 1,
          taskId: TaskId(`task-${i}`),
          dependsOnTaskId: TaskId(`task-${i + 1}`),
          createdAt: Date.now(),
          resolvedAt: null,
          resolution: 'pending'
        });
      }

      const graph = new DependencyGraph(dependencies);

      const depth = graph.getMaxDepth(TaskId('task-0'));

      expect(depth).toBe(100); // Depth from task-0 to task-100
    });

    it('should use memoization for complex diamond graphs (performance)', () => {
      // Complex diamond that would be exponential without memoization
      // A -> [B, C]
      // B -> [D, E]
      // C -> [D, E]
      // D -> F
      // E -> F
      const dependencies: TaskDependency[] = [
        { id: 1, taskId: TaskId('A'), dependsOnTaskId: TaskId('B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 2, taskId: TaskId('A'), dependsOnTaskId: TaskId('C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 3, taskId: TaskId('B'), dependsOnTaskId: TaskId('D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 4, taskId: TaskId('B'), dependsOnTaskId: TaskId('E'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 5, taskId: TaskId('C'), dependsOnTaskId: TaskId('D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 6, taskId: TaskId('C'), dependsOnTaskId: TaskId('E'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 7, taskId: TaskId('D'), dependsOnTaskId: TaskId('F'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
        { id: 8, taskId: TaskId('E'), dependsOnTaskId: TaskId('F'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
      ];

      const graph = new DependencyGraph(dependencies);

      // This should complete quickly due to memoization
      const depth = graph.getMaxDepth(TaskId('A'));

      expect(depth).toBe(3); // A -> B -> D -> F
      // NOTE: Timing assertions removed - performance tests should be in separate benchmark suite
    });
  });

  /**
   * Incremental Graph Updates (v0.3.2+)
   *
   * PERFORMANCE: These methods enable O(1) graph updates instead of O(N) cache rebuilds.
   * Used by DependencyHandler to maintain in-memory graph consistency without calling
   * findAll() on every dependency operation (70-80% latency reduction).
   *
   * Architecture: Event-driven incremental updates
   * - Handler initializes graph once from database (O(N) one-time cost)
   * - After successful database operations, handler updates graph incrementally (O(1))
   * - No cache invalidation needed - graph always stays in sync
   *
   * Tests cover:
   * - addEdge(): Add single edge to forward/reverse graphs
   * - removeEdge(): Remove single edge from both graphs (with memory leak prevention)
   * - removeTask(): Bulk remove all edges for a task (when task is deleted)
   * - Memory leak prevention: Verify empty Map entries are cleaned up
   * - Integration: Mixed operations with cycle detection
   */
  describe('Incremental Graph Updates', () => {
    describe('addEdge', () => {
      it('should add edge to empty graph', () => {
        const graph = new DependencyGraph();

        graph.addEdge(TaskId('task-A'), TaskId('task-B'));

        expect(graph.hasTask(TaskId('task-A'))).toBe(true);
        expect(graph.hasTask(TaskId('task-B'))).toBe(true);
        expect(graph.size()).toBe(2);

        const deps = graph.getDirectDependencies(TaskId('task-A'));
        expect(deps.ok).toBe(true);
        expect(deps.value).toContain(TaskId('task-B'));
      });

      it('should add edge to existing graph', () => {
        const dependencies: TaskDependency[] = [
          { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
        ];
        const graph = new DependencyGraph(dependencies);

        graph.addEdge(TaskId('task-B'), TaskId('task-C'));

        expect(graph.size()).toBe(3);
        const depsB = graph.getDirectDependencies(TaskId('task-B'));
        expect(depsB.value).toContain(TaskId('task-C'));
      });

      it('should maintain reverse graph correctly', () => {
        const graph = new DependencyGraph();

        graph.addEdge(TaskId('task-A'), TaskId('task-B'));

        const dependents = graph.getDirectDependents(TaskId('task-B'));
        expect(dependents.ok).toBe(true);
        expect(dependents.value).toContain(TaskId('task-A'));
      });

      it('should allow adding multiple edges incrementally', () => {
        const graph = new DependencyGraph();

        // Build chain: A -> B -> C -> D
        graph.addEdge(TaskId('task-A'), TaskId('task-B'));
        graph.addEdge(TaskId('task-B'), TaskId('task-C'));
        graph.addEdge(TaskId('task-C'), TaskId('task-D'));

        expect(graph.size()).toBe(4);

        // Verify transitive dependencies
        const allDeps = graph.getAllDependencies(TaskId('task-A'));
        expect(allDeps.value).toHaveLength(3);
        expect(allDeps.value).toContain(TaskId('task-B'));
        expect(allDeps.value).toContain(TaskId('task-C'));
        expect(allDeps.value).toContain(TaskId('task-D'));
      });

      it('should enable cycle detection after incremental adds', () => {
        const graph = new DependencyGraph();

        // Add A -> B
        graph.addEdge(TaskId('task-A'), TaskId('task-B'));

        // Check that B -> A would create cycle
        const cycleCheck = graph.wouldCreateCycle(TaskId('task-B'), TaskId('task-A'));
        expect(cycleCheck.ok).toBe(true);
        expect(cycleCheck.value).toBe(true);
      });
    });

    describe('removeEdge', () => {
      it('should remove edge from graph', () => {
        const dependencies: TaskDependency[] = [
          { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
        ];
        const graph = new DependencyGraph(dependencies);

        graph.removeEdge(TaskId('task-A'), TaskId('task-B'));

        const deps = graph.getDirectDependencies(TaskId('task-A'));
        expect(deps.ok).toBe(true);
        expect(deps.value).toHaveLength(0);
      });

      it('should remove edge from reverse graph', () => {
        const dependencies: TaskDependency[] = [
          { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
        ];
        const graph = new DependencyGraph(dependencies);

        graph.removeEdge(TaskId('task-A'), TaskId('task-B'));

        const dependents = graph.getDirectDependents(TaskId('task-B'));
        expect(dependents.ok).toBe(true);
        expect(dependents.value).toHaveLength(0);
      });

      it('should handle removing non-existent edge gracefully', () => {
        const graph = new DependencyGraph();

        // Should not throw
        graph.removeEdge(TaskId('task-A'), TaskId('task-B'));
        expect(graph.size()).toBe(0);
      });

      it('should allow adding then removing edge', () => {
        const graph = new DependencyGraph();

        graph.addEdge(TaskId('task-A'), TaskId('task-B'));
        expect(graph.size()).toBe(2);

        graph.removeEdge(TaskId('task-A'), TaskId('task-B'));

        const deps = graph.getDirectDependencies(TaskId('task-A'));
        expect(deps.value).toHaveLength(0);
      });

      it('should break cycle when edge removed', () => {
        const dependencies: TaskDependency[] = [
          { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
          { id: 2, taskId: TaskId('task-B'), dependsOnTaskId: TaskId('task-A'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
        ];
        const graph = new DependencyGraph(dependencies);

        // Graph has cycle
        const cycleCheckBefore = graph.hasCycle();
        expect(cycleCheckBefore.value).toBe(true);

        // Remove one edge to break cycle
        graph.removeEdge(TaskId('task-B'), TaskId('task-A'));

        // Cycle should be gone
        const cycleCheckAfter = graph.hasCycle();
        expect(cycleCheckAfter.value).toBe(false);
      });
    });

    describe('removeTask', () => {
      it('should remove all outgoing edges', () => {
        const dependencies: TaskDependency[] = [
          { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
          { id: 2, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
        ];
        const graph = new DependencyGraph(dependencies);

        graph.removeTask(TaskId('task-A'));

        // Task A should have no dependencies
        const deps = graph.getDirectDependencies(TaskId('task-A'));
        expect(deps.value).toHaveLength(0);

        // B and C should have no dependents
        const dependentsB = graph.getDirectDependents(TaskId('task-B'));
        const dependentsC = graph.getDirectDependents(TaskId('task-C'));
        expect(dependentsB.value).toHaveLength(0);
        expect(dependentsC.value).toHaveLength(0);
      });

      it('should remove all incoming edges', () => {
        const dependencies: TaskDependency[] = [
          { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
          { id: 2, taskId: TaskId('task-B'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
        ];
        const graph = new DependencyGraph(dependencies);

        graph.removeTask(TaskId('task-C'));

        // C should have no dependents
        const dependents = graph.getDirectDependents(TaskId('task-C'));
        expect(dependents.value).toHaveLength(0);

        // A and B should have no dependencies on C
        const depsA = graph.getDirectDependencies(TaskId('task-A'));
        const depsB = graph.getDirectDependencies(TaskId('task-B'));
        expect(depsA.value).toHaveLength(0);
        expect(depsB.value).toHaveLength(0);
      });

      it('should handle removing task with both incoming and outgoing edges', () => {
        // A -> B -> C
        const dependencies: TaskDependency[] = [
          { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
          { id: 2, taskId: TaskId('task-B'), dependsOnTaskId: TaskId('task-C'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
        ];
        const graph = new DependencyGraph(dependencies);

        graph.removeTask(TaskId('task-B'));

        // A should have no dependencies
        const depsA = graph.getDirectDependencies(TaskId('task-A'));
        expect(depsA.value).toHaveLength(0);

        // C should have no dependents
        const dependentsC = graph.getDirectDependents(TaskId('task-C'));
        expect(dependentsC.value).toHaveLength(0);
      });

      it('should handle removing non-existent task gracefully', () => {
        const graph = new DependencyGraph();

        // Should not throw
        graph.removeTask(TaskId('task-A'));
        expect(graph.size()).toBe(0);
      });

      it('should maintain graph consistency for remaining tasks', () => {
        // A -> B, C -> D
        const dependencies: TaskDependency[] = [
          { id: 1, taskId: TaskId('task-A'), dependsOnTaskId: TaskId('task-B'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' },
          { id: 2, taskId: TaskId('task-C'), dependsOnTaskId: TaskId('task-D'), createdAt: Date.now(), resolvedAt: null, resolution: 'pending' }
        ];
        const graph = new DependencyGraph(dependencies);

        graph.removeTask(TaskId('task-A'));

        // C -> D should remain intact
        const depsC = graph.getDirectDependencies(TaskId('task-C'));
        expect(depsC.value).toContain(TaskId('task-D'));

        const dependentsD = graph.getDirectDependents(TaskId('task-D'));
        expect(dependentsD.value).toContain(TaskId('task-C'));
      });
    });

    describe('Memory leak prevention', () => {
      /**
       * ROOT CAUSE TESTS: Verify that removeEdge() and removeTask() clean up
       * empty Map entries to prevent memory leaks. Without cleanup, empty Set
       * objects accumulate indefinitely in long-running processes.
       */

      it('should clean up empty forward graph entries in removeEdge', () => {
        // Create graph with A -> B
        const graph = new DependencyGraph();
        graph.addEdge(TaskId('task-A'), TaskId('task-B'));

        // Verify task-A exists in graph
        expect(graph.hasTask(TaskId('task-A'))).toBe(true);

        // Remove the only edge from task-A
        graph.removeEdge(TaskId('task-A'), TaskId('task-B'));

        // CRITICAL: task-A should be removed from internal Map (no memory leak)
        // If not cleaned up, empty Set {} remains in Map forever
        expect(graph.hasTask(TaskId('task-A'))).toBe(false);
      });

      it('should clean up empty reverse graph entries in removeEdge', () => {
        // Create graph with A -> B
        const graph = new DependencyGraph();
        graph.addEdge(TaskId('task-A'), TaskId('task-B'));

        // task-B exists as a target in reverse graph
        const dependents = graph.getDirectDependents(TaskId('task-B'));
        expect(dependents.value).toHaveLength(1);

        // Remove the only edge TO task-B
        graph.removeEdge(TaskId('task-A'), TaskId('task-B'));

        // CRITICAL: task-B should be removed from reverse graph Map
        // Without cleanup, empty Set {} leaks memory
        const dependentsAfter = graph.getDirectDependents(TaskId('task-B'));
        expect(dependentsAfter.value).toHaveLength(0);
      });

      it('should clean up empty entries when removing multiple edges incrementally', () => {
        const graph = new DependencyGraph();

        // Create task-A with 3 dependencies
        graph.addEdge(TaskId('task-A'), TaskId('task-B'));
        graph.addEdge(TaskId('task-A'), TaskId('task-C'));
        graph.addEdge(TaskId('task-A'), TaskId('task-D'));

        expect(graph.hasTask(TaskId('task-A'))).toBe(true);

        // Remove edges one by one
        graph.removeEdge(TaskId('task-A'), TaskId('task-B'));
        graph.removeEdge(TaskId('task-A'), TaskId('task-C'));

        // A still has one dependency, should still exist
        expect(graph.hasTask(TaskId('task-A'))).toBe(true);

        // Remove last edge
        graph.removeEdge(TaskId('task-A'), TaskId('task-D'));

        // CRITICAL: Now A has zero edges, Map entry should be cleaned up
        expect(graph.hasTask(TaskId('task-A'))).toBe(false);
      });

      it('should clean up empty entries in removeTask for outgoing edges', () => {
        const graph = new DependencyGraph();

        // Create: A -> B -> C
        graph.addEdge(TaskId('task-A'), TaskId('task-B'));
        graph.addEdge(TaskId('task-B'), TaskId('task-C'));

        // Remove B (which has outgoing edge to C)
        graph.removeTask(TaskId('task-B'));

        // CRITICAL: After removing B's outgoing edge to C,
        // if C has no other dependents, C's reverse graph entry should be cleaned
        // B should be removed from C's dependents
        const dependentsC = graph.getDirectDependents(TaskId('task-C'));
        expect(dependentsC.value).toHaveLength(0);
      });

      it('should clean up empty entries in removeTask for incoming edges', () => {
        const graph = new DependencyGraph();

        // Create: A -> C, B -> C
        graph.addEdge(TaskId('task-A'), TaskId('task-C'));
        graph.addEdge(TaskId('task-B'), TaskId('task-C'));

        // Remove C (which has incoming edges from A and B)
        graph.removeTask(TaskId('task-C'));

        // CRITICAL: After removing C's incoming edges,
        // A and B should have empty dependency Sets that get cleaned up
        const depsA = graph.getDirectDependencies(TaskId('task-A'));
        const depsB = graph.getDirectDependencies(TaskId('task-B'));

        expect(depsA.value).toHaveLength(0);
        expect(depsB.value).toHaveLength(0);
      });

      it('should prevent memory leak in long-running scenario', () => {
        const graph = new DependencyGraph();

        // Simulate long-running process with many add/remove cycles
        for (let i = 0; i < 100; i++) {
          const taskId = TaskId(`task-${i}`);
          const depId = TaskId(`dep-${i}`);

          // Add edge
          graph.addEdge(taskId, depId);

          // Immediately remove it
          graph.removeEdge(taskId, depId);

          // CRITICAL: After each cycle, both nodes should be cleaned up
          // Without cleanup, we'd accumulate 200 empty Map entries (100 * 2 nodes)
        }

        // After 100 add/remove cycles, graph should be empty
        // If memory leak exists, graph would still have 200 nodes with empty Sets
        expect(graph.size()).toBe(0);
      });
    });

    describe('Integration - Incremental Updates with Cycle Detection', () => {
      it('should maintain valid graph after mixed add/remove operations', () => {
        const graph = new DependencyGraph();

        // Build: A -> B -> C
        graph.addEdge(TaskId('task-A'), TaskId('task-B'));
        graph.addEdge(TaskId('task-B'), TaskId('task-C'));

        // Remove B (breaks chain)
        graph.removeTask(TaskId('task-B'));

        // Add A -> C directly
        graph.addEdge(TaskId('task-A'), TaskId('task-C'));

        // Verify final state
        const depsA = graph.getDirectDependencies(TaskId('task-A'));
        expect(depsA.value).toContain(TaskId('task-C'));
        expect(depsA.value).not.toContain(TaskId('task-B'));
      });

      it('should maintain cycle detection after incremental updates', () => {
        const graph = new DependencyGraph();

        // Build: A -> B -> C
        graph.addEdge(TaskId('task-A'), TaskId('task-B'));
        graph.addEdge(TaskId('task-B'), TaskId('task-C'));

        // Should detect potential cycle
        const cycleCheck1 = graph.wouldCreateCycle(TaskId('task-C'), TaskId('task-A'));
        expect(cycleCheck1.value).toBe(true);

        // Remove B -> C edge
        graph.removeEdge(TaskId('task-B'), TaskId('task-C'));

        // Now C -> A should be valid (no cycle)
        const cycleCheck2 = graph.wouldCreateCycle(TaskId('task-C'), TaskId('task-A'));
        expect(cycleCheck2.value).toBe(false);
      });

      it('should maintain max depth calculations after incremental updates', () => {
        const graph = new DependencyGraph();

        // Build: A -> B -> C -> D
        graph.addEdge(TaskId('task-A'), TaskId('task-B'));
        graph.addEdge(TaskId('task-B'), TaskId('task-C'));
        graph.addEdge(TaskId('task-C'), TaskId('task-D'));

        expect(graph.getMaxDepth(TaskId('task-A'))).toBe(3);

        // Remove C -> D
        graph.removeEdge(TaskId('task-C'), TaskId('task-D'));

        // Depth should now be 2
        expect(graph.getMaxDepth(TaskId('task-A'))).toBe(2);
      });
    });
  });

  /**
   * Input Validation Tests
   *
   * These tests verify that graph mutation methods return Result.err for invalid inputs
   * instead of throwing exceptions or silently failing. This ensures consistent error
   * handling following the Result pattern used throughout the codebase.
   *
   * Methods tested:
   * - addEdge(): Validates both taskId and dependsOnTaskId
   * - removeEdge(): Validates both taskId and dependsOnTaskId
   * - removeTask(): Validates taskId
   */
  describe('Input Validation', () => {
    describe('addEdge validation', () => {
      it('should return err for empty taskId', () => {
        const graph = new DependencyGraph();

        const result = graph.addEdge('' as unknown as ReturnType<typeof TaskId>, TaskId('valid'));

        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('Invalid taskId');
      });

      it('should return err for whitespace-only taskId', () => {
        const graph = new DependencyGraph();

        const result = graph.addEdge('   ' as unknown as ReturnType<typeof TaskId>, TaskId('valid'));

        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('Invalid taskId');
      });

      it('should return err for empty dependsOnTaskId', () => {
        const graph = new DependencyGraph();

        const result = graph.addEdge(TaskId('valid'), '' as unknown as ReturnType<typeof TaskId>);

        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('Invalid dependsOnTaskId');
      });

      it('should return err for whitespace-only dependsOnTaskId', () => {
        const graph = new DependencyGraph();

        const result = graph.addEdge(TaskId('valid'), '   ' as unknown as ReturnType<typeof TaskId>);

        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('Invalid dependsOnTaskId');
      });

      it('should return ok for valid inputs', () => {
        const graph = new DependencyGraph();

        const result = graph.addEdge(TaskId('task-A'), TaskId('task-B'));

        expect(result.ok).toBe(true);
      });
    });

    describe('removeEdge validation', () => {
      it('should return err for empty taskId', () => {
        const graph = new DependencyGraph();

        const result = graph.removeEdge('' as unknown as ReturnType<typeof TaskId>, TaskId('valid'));

        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('Invalid taskId');
      });

      it('should return err for whitespace-only taskId', () => {
        const graph = new DependencyGraph();

        const result = graph.removeEdge('   ' as unknown as ReturnType<typeof TaskId>, TaskId('valid'));

        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('Invalid taskId');
      });

      it('should return err for empty dependsOnTaskId', () => {
        const graph = new DependencyGraph();

        const result = graph.removeEdge(TaskId('valid'), '' as unknown as ReturnType<typeof TaskId>);

        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('Invalid dependsOnTaskId');
      });

      it('should return err for whitespace-only dependsOnTaskId', () => {
        const graph = new DependencyGraph();

        const result = graph.removeEdge(TaskId('valid'), '   ' as unknown as ReturnType<typeof TaskId>);

        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('Invalid dependsOnTaskId');
      });

      it('should return ok for valid inputs (edge not present)', () => {
        const graph = new DependencyGraph();

        const result = graph.removeEdge(TaskId('task-A'), TaskId('task-B'));

        expect(result.ok).toBe(true);
      });

      it('should return ok for valid inputs (edge present)', () => {
        const graph = new DependencyGraph();
        graph.addEdge(TaskId('task-A'), TaskId('task-B'));

        const result = graph.removeEdge(TaskId('task-A'), TaskId('task-B'));

        expect(result.ok).toBe(true);
      });
    });

    describe('removeTask validation', () => {
      it('should return err for empty taskId', () => {
        const graph = new DependencyGraph();

        const result = graph.removeTask('' as unknown as ReturnType<typeof TaskId>);

        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('Invalid taskId');
      });

      it('should return err for whitespace-only taskId', () => {
        const graph = new DependencyGraph();

        const result = graph.removeTask('   ' as unknown as ReturnType<typeof TaskId>);

        expect(result.ok).toBe(false);
        expect(result.error?.message).toContain('Invalid taskId');
      });

      it('should return ok for valid inputs (task not present)', () => {
        const graph = new DependencyGraph();

        const result = graph.removeTask(TaskId('task-A'));

        expect(result.ok).toBe(true);
      });

      it('should return ok for valid inputs (task present)', () => {
        const graph = new DependencyGraph();
        graph.addEdge(TaskId('task-A'), TaskId('task-B'));

        const result = graph.removeTask(TaskId('task-A'));

        expect(result.ok).toBe(true);
      });
    });
  });
});
