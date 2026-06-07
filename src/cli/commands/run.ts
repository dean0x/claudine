import { bootstrap } from '../../bootstrap.js';
import type { AgentProvider } from '../../core/agents.js';
import type { Container } from '../../core/container.js';
import type { TaskRequest } from '../../core/domain.js';
import { OrchestratorId, Priority, TaskId } from '../../core/domain.js';
import type { OrchestrationRepository, TaskManager } from '../../core/interfaces.js';
import { driveToCompletion, runDetached, waitForTaskCompletion } from '../drive-helpers.js';
import { errorMessage } from '../services.js';
import * as ui from '../ui.js';

/**
 * Detach `beat run` to a background worker that drives the task to completion.
 *
 * ARCHITECTURE (issue #205): thin wrapper over the shared {@link runDetached} — the
 * background worker re-runs `beat run` with the internal worker flag, which routes it
 * into {@link runTask}. The foreground polls the worker's log for the task id and exits.
 */
export async function handleRunDetach(runArgs: readonly string[]): Promise<void> {
  // Validate that at least one non-flag word exists (the prompt)
  const hasPrompt = runArgs.some((arg) => !arg.startsWith('-'));
  if (!hasPrompt) {
    ui.error('Usage: beat run "<prompt>" [options]');
    process.stderr.write('  A prompt is required to delegate a task\n');
    process.exit(1);
  }

  await runDetached({
    command: 'run',
    args: runArgs,
    logPrefix: 'run',
    // CRITICAL: matches the load-bearing "Task ID:" line printed by runTask.
    idPattern: /Task ID:\s+(task-\S+)/,
    foundMessage: (id) => `Task delegated: ${id}`,
    infoLines: ['Check status: beat status {id}', 'View logs:    beat logs {id}'],
    entityLabel: 'Task',
  });
}

export async function runTask(
  prompt: string,
  options?: {
    priority?: 'P0' | 'P1' | 'P2';
    workingDirectory?: string;
    dependsOn?: readonly string[];
    continueFrom?: string;
    timeout?: number;
    maxOutputBuffer?: number;
    agent?: string;
    model?: string;
    systemPrompt?: string;
  },
): Promise<void> {
  let container: Container | undefined;
  const s = ui.createSpinner();
  try {
    s.start('Initializing...');
    const containerResult = await bootstrap({ mode: 'run' });
    if (!containerResult.ok) {
      s.stop('Initialization failed');
      ui.error(`Bootstrap failed: ${containerResult.error.message}`);
      process.exit(1);
    }
    container = containerResult.value;

    const taskManagerResult = await container.resolve<TaskManager>('taskManager');
    if (!taskManagerResult.ok) {
      s.stop('Initialization failed');
      ui.error(`Failed to get task manager: ${taskManagerResult.error.message}`);
      await container.dispose();
      process.exit(1);
    }

    const taskManager = taskManagerResult.value;
    s.stop('Ready');

    // Show task info
    const truncatedPrompt = prompt.substring(0, 100) + (prompt.length > 100 ? '...' : '');
    ui.step(truncatedPrompt);

    if (options) {
      const params: string[] = [];
      if (options.priority) params.push(`Priority: ${options.priority}`);
      if (options.workingDirectory) params.push(`Dir: ${options.workingDirectory}`);
      if (options.agent) params.push(`Agent: ${options.agent}`);
      if (options.model) params.push(`Model: ${options.model}`);
      if (options.systemPrompt) {
        const preview =
          options.systemPrompt.length > 40 ? `${options.systemPrompt.substring(0, 40)}...` : options.systemPrompt;
        params.push(`SystemPrompt: ${preview}`);
      }
      if (options.dependsOn && options.dependsOn.length > 0) params.push(`Deps: ${options.dependsOn.join(', ')}`);
      if (options.continueFrom) params.push(`Continue from: ${options.continueFrom}`);
      if (options.timeout) params.push(`Timeout: ${ui.formatMs(options.timeout)}`);
      if (options.maxOutputBuffer) params.push(`Buffer: ${ui.formatBytes(options.maxOutputBuffer)}`);
      if (params.length > 0) ui.info(params.join(' | '));
    }

    // v1.3.0: Read orchestrator attribution env var (set by BaseAgentAdapter when running inside
    // an orchestration). Validated against DB — dropped silently if orchestration not found.
    // SECURITY: DB lookup is the authoritative check. Stale env leaks from a prior shell or
    // manual misuse cannot attribute tasks to orchestrations that don't exist in the local DB,
    // and since the DB is per-user the blast radius is limited to the caller's own orchestrations.
    let orchestratorId: OrchestratorId | undefined;
    const envOrchId = process.env.AUTOBEAT_ORCHESTRATOR_ID;
    if (envOrchId) {
      const orchRepoResult = container.get<OrchestrationRepository>('orchestrationRepository');
      if (orchRepoResult.ok) {
        const orchResult = await orchRepoResult.value.findById(OrchestratorId(envOrchId));
        if (orchResult.ok && orchResult.value) {
          orchestratorId = OrchestratorId(envOrchId);
        } else {
          // Stale env var from a prior shell / process — drop silently.
          // SECURITY: Strip control chars (prevents log injection / ANSI escapes) and cap
          // display length before writing to stderr. The actual env var is not modified.
          const sanitized = envOrchId.replace(/[\x00-\x1f\x7f]/g, '?').slice(0, 200);
          const lengthNote = envOrchId.length > 200 ? ` (truncated from ${envOrchId.length} chars)` : '';
          process.stderr.write(
            `[autobeat] AUTOBEAT_ORCHESTRATOR_ID '${sanitized}'${lengthNote} not found in DB, ignoring\n`,
          );
        }
      }
    }

    const request: TaskRequest = {
      prompt,
      ...options,
      priority: options?.priority ? Priority[options.priority as keyof typeof Priority] : undefined,
      dependsOn: options?.dependsOn?.map((id: string) => TaskId(id)),
      continueFrom: options?.continueFrom ? TaskId(options.continueFrom) : undefined,
      agent: options?.agent as AgentProvider | undefined,
      model: options?.model,
      systemPrompt: options?.systemPrompt,
      orchestratorId,
    };

    const result = await taskManager.delegate(request);
    if (!result.ok) {
      ui.error(`Failed to delegate task: ${result.error.message}`);
      await container.dispose();
      process.exit(1);
    }

    const task = result.value;
    // CRITICAL: "Task ID:" pattern is used by detach-mode polling
    ui.success(`Task ID: ${task.id}`);

    // Drive the task to completion (SIGINT cancels), then dispose + exit.
    await driveToCompletion({
      container,
      wait: () => waitForTaskCompletion(container as Container, task.id),
      onSigint: () => {
        taskManager.cancel(task.id, 'User interrupted (SIGINT)');
      },
      sigintMessage: '\nCancelling task...\n',
    });
  } catch (error) {
    s.stop('Failed');
    ui.error(errorMessage(error));
    if (container) await container.dispose();
    process.exit(1);
  }
}
