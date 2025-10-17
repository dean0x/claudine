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
});
