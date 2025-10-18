/**
 * Dependency graph management and cycle detection
 * ARCHITECTURE: Pure functional algorithms with Result pattern
 * Pattern: DAG (Directed Acyclic Graph) validation using DFS
 * Rationale: Ensures task dependencies form valid DAG, prevents deadlocks
 */

import { TaskId } from './domain.js';
import { Result, ok, err } from './result.js';
import { ClaudineError, ErrorCode } from './errors.js';
import { TaskDependency } from './interfaces.js';

/**
 * Represents a directed graph of task dependencies
 * Used for cycle detection and topological sorting
 */
export class DependencyGraph {
  // Adjacency list: taskId -> list of tasks it depends on
  private readonly graph: Map<string, Set<string>>;

  // Reverse adjacency list: taskId -> list of tasks that depend on it
  private readonly reverseGraph: Map<string, Set<string>>;

  constructor(dependencies: readonly TaskDependency[] = []) {
    this.graph = new Map();
    this.reverseGraph = new Map();

    // Build graph from dependency list
    for (const dep of dependencies) {
      this.addEdgeInternal(dep.taskId, dep.dependsOnTaskId);
    }
  }

  /**
   * Add a dependency edge to the graph (internal, no validation)
   */
  private addEdgeInternal(taskId: TaskId, dependsOnTaskId: TaskId): void {
    const taskIdStr = taskId as string;
    const dependsOnStr = dependsOnTaskId as string;

    // Add to forward graph
    if (!this.graph.has(taskIdStr)) {
      this.graph.set(taskIdStr, new Set());
    }
    this.graph.get(taskIdStr)!.add(dependsOnStr);

    // Add to reverse graph
    if (!this.reverseGraph.has(dependsOnStr)) {
      this.reverseGraph.set(dependsOnStr, new Set());
    }
    this.reverseGraph.get(dependsOnStr)!.add(taskIdStr);

    // Ensure nodes exist in both graphs
    if (!this.graph.has(dependsOnStr)) {
      this.graph.set(dependsOnStr, new Set());
    }
    if (!this.reverseGraph.has(taskIdStr)) {
      this.reverseGraph.set(taskIdStr, new Set());
    }
  }

  /**
   * Check if adding a dependency would create a cycle
   * Uses DFS to detect cycles in O(V + E) time
   *
   * Algorithm:
   * 1. Create temporary graph with proposed edge
   * 2. Run DFS from the new dependent task
   * 3. If we reach the dependency task, cycle exists
   *
   * @param taskId - The task that will depend on another task
   * @param dependsOnTaskId - The task that will be depended upon
   * @returns Ok(true) if cycle would be created, Ok(false) otherwise
   */
  wouldCreateCycle(taskId: TaskId, dependsOnTaskId: TaskId): Result<boolean> {
    const taskIdStr = taskId as string;
    const dependsOnStr = dependsOnTaskId as string;

    // Self-dependency check (simple cycle)
    if (taskIdStr === dependsOnStr) {
      return ok(true);
    }

    // Create temporary graph with the proposed edge
    const tempGraph = new Map(this.graph);

    // Add proposed edge to temp graph
    if (!tempGraph.has(taskIdStr)) {
      tempGraph.set(taskIdStr, new Set());
    }
    tempGraph.get(taskIdStr)!.add(dependsOnStr);

    // Ensure target node exists
    if (!tempGraph.has(dependsOnStr)) {
      tempGraph.set(dependsOnStr, new Set());
    }

    // Run DFS to detect cycle
    // A cycle exists if we can reach taskId from dependsOnTaskId
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    const hasCycle = this.detectCycleDFS(
      dependsOnStr,
      tempGraph,
      visited,
      recursionStack,
      taskIdStr
    );

    return ok(hasCycle);
  }

  /**
   * DFS-based cycle detection
   *
   * @param node Current node in DFS traversal
   * @param graph Graph to traverse
   * @param visited Set of all visited nodes
   * @param recursionStack Set of nodes in current DFS path
   * @param target Optional target node - if reached, cycle detected
   * @returns true if cycle detected, false otherwise
   */
  private detectCycleDFS(
    node: string,
    graph: Map<string, Set<string>>,
    visited: Set<string>,
    recursionStack: Set<string>,
    target?: string
  ): boolean {
    // If we've reached the target node, cycle exists
    if (target && node === target) {
      return true;
    }

    // If node is in recursion stack, we've found a cycle
    if (recursionStack.has(node)) {
      return true;
    }

    // If already visited (and not in recursion stack), no cycle from this path
    if (visited.has(node)) {
      return false;
    }

    // Mark node as visited and add to recursion stack
    visited.add(node);
    recursionStack.add(node);

    // Recursively visit all dependencies
    const dependencies = graph.get(node);
    if (dependencies) {
      for (const dep of dependencies) {
        if (this.detectCycleDFS(dep, graph, visited, recursionStack, target)) {
          return true;
        }
      }
    }

    // Remove from recursion stack (backtrack)
    recursionStack.delete(node);

    return false;
  }

  /**
   * Detect if the current graph contains any cycles
   * @returns Ok(true) if cycle exists, Ok(false) otherwise
   */
  hasCycle(): Result<boolean> {
    const visited = new Set<string>();
    const recursionStack = new Set<string>();

    // Check all nodes
    for (const node of this.graph.keys()) {
      if (!visited.has(node)) {
        if (this.detectCycleDFS(node, this.graph, visited, recursionStack)) {
          return ok(true);
        }
      }
    }

    return ok(false);
  }

  /**
   * Get all tasks that the given task depends on (transitive closure)
   * @param taskId - The task to get dependencies for
   * @returns Array of all task IDs in dependency chain
   */
  getAllDependencies(taskId: TaskId): Result<readonly TaskId[]> {
    const taskIdStr = taskId as string;
    const dependencies = new Set<string>();
    const visited = new Set<string>();

    const collectDependencies = (node: string): void => {
      if (visited.has(node)) {
        return;
      }
      visited.add(node);

      const deps = this.graph.get(node);
      if (deps) {
        for (const dep of deps) {
          dependencies.add(dep);
          collectDependencies(dep);
        }
      }
    };

    collectDependencies(taskIdStr);

    return ok(Array.from(dependencies) as TaskId[]);
  }

  /**
   * Get all tasks that depend on the given task (transitive closure)
   * @param taskId - The task to get dependents for
   * @returns Array of all task IDs that depend on this task
   */
  getAllDependents(taskId: TaskId): Result<readonly TaskId[]> {
    const taskIdStr = taskId as string;
    const dependents = new Set<string>();
    const visited = new Set<string>();

    const collectDependents = (node: string): void => {
      if (visited.has(node)) {
        return;
      }
      visited.add(node);

      const deps = this.reverseGraph.get(node);
      if (deps) {
        for (const dep of deps) {
          dependents.add(dep);
          collectDependents(dep);
        }
      }
    };

    collectDependents(taskIdStr);

    return ok(Array.from(dependents) as TaskId[]);
  }

  /**
   * Get direct dependencies for a task
   * @param taskId - The task to get direct dependencies for
   * @returns Array of task IDs this task directly depends on
   */
  getDirectDependencies(taskId: TaskId): Result<readonly TaskId[]> {
    const taskIdStr = taskId as string;
    const deps = this.graph.get(taskIdStr);

    if (!deps) {
      return ok([]);
    }

    return ok(Array.from(deps) as TaskId[]);
  }

  /**
   * Get direct dependents for a task
   * @param taskId - The task to get direct dependents for
   * @returns Array of task IDs that directly depend on this task
   */
  getDirectDependents(taskId: TaskId): Result<readonly TaskId[]> {
    const taskIdStr = taskId as string;
    const deps = this.reverseGraph.get(taskIdStr);

    if (!deps) {
      return ok([]);
    }

    return ok(Array.from(deps) as TaskId[]);
  }

  /**
   * Perform topological sort on the graph
   * Returns tasks in execution order (dependencies first)
   *
   * @returns Ordered array of task IDs, or error if graph has cycles
   */
  topologicalSort(): Result<readonly TaskId[]> {
    // First check for cycles
    const cycleCheck = this.hasCycle();
    if (!cycleCheck.ok) {
      return cycleCheck;
    }

    if (cycleCheck.value) {
      return err(new ClaudineError(
        ErrorCode.INVALID_OPERATION,
        'Cannot perform topological sort: graph contains cycles'
      ));
    }

    // Kahn's algorithm for topological sort
    // In-degree = number of dependencies (tasks this task depends on)
    const inDegree = new Map<string, number>();
    const result: TaskId[] = [];
    const queue: string[] = [];

    // Calculate in-degrees: count how many tasks each task depends on
    for (const [node, dependencies] of this.graph.entries()) {
      inDegree.set(node, dependencies.size);
    }

    // Find all nodes with in-degree 0
    for (const [node, degree] of inDegree.entries()) {
      if (degree === 0) {
        queue.push(node);
      }
    }

    // Process queue
    while (queue.length > 0) {
      const node = queue.shift()!;
      result.push(node as TaskId);

      // Reduce in-degree for dependent nodes
      const dependents = this.reverseGraph.get(node);
      if (dependents) {
        for (const dependent of dependents) {
          const newDegree = (inDegree.get(dependent) || 0) - 1;
          inDegree.set(dependent, newDegree);

          if (newDegree === 0) {
            queue.push(dependent);
          }
        }
      }
    }

    return ok(result);
  }

  /**
   * Get the number of nodes in the graph
   */
  size(): number {
    return this.graph.size;
  }

  /**
   * Check if a task exists in the graph
   * @param taskId - The task ID to check for existence
   * @returns true if the task exists in the graph, false otherwise
   */
  hasTask(taskId: TaskId): boolean {
    return this.graph.has(taskId as string);
  }
}
