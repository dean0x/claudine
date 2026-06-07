import { bootstrap } from '../../bootstrap.js';
import { AGENT_PROVIDERS, type AgentProvider, isAgentProvider } from '../../core/agents.js';
import type { Container } from '../../core/container.js';
import { createPipeline, type PipelineStepDefinition, type TaskId, type TaskRequest } from '../../core/domain.js';
import type { PipelineRepository, TaskManager } from '../../core/interfaces.js';
import {
  driveToCompletion,
  isWorkerInvocation,
  runDetached,
  stripWorkerFlag,
  waitForPipelineCompletion,
} from '../drive-helpers.js';
import { errorMessage } from '../services.js';
import * as ui from '../ui.js';

interface ParsedPipelineArgs {
  readonly steps: readonly string[];
  readonly agent?: AgentProvider;
}

/**
 * Parse `beat pipeline <prompt> <prompt> [...] [--agent AGENT]`.
 * Pure-ish: validates and exits on error (CLI convention).
 */
function parsePipelineArgs(pipelineArgs: readonly string[]): ParsedPipelineArgs {
  let agent: AgentProvider | undefined;
  const steps: string[] = [];

  for (let i = 0; i < pipelineArgs.length; i++) {
    const arg = pipelineArgs[i];
    const next = pipelineArgs[i + 1];

    if (arg === '--agent' || arg === '-a') {
      if (!next || next.startsWith('-')) {
        ui.error(`--agent requires an agent name (${AGENT_PROVIDERS.join(', ')})`);
        process.exit(1);
      }
      if (!isAgentProvider(next)) {
        ui.error(`Unknown agent: "${next}". Available agents: ${AGENT_PROVIDERS.join(', ')}`);
        process.exit(1);
      }
      agent = next;
      i++;
    } else if (arg.startsWith('-')) {
      ui.error(`Unknown flag: ${arg}`);
      process.exit(1);
    } else {
      steps.push(arg);
    }
  }

  if (steps.length < 2) {
    ui.error('Pipeline requires at least 2 steps');
    process.stderr.write('Usage: beat pipeline <prompt> <prompt> [<prompt>]... [--agent AGENT]\n');
    process.stderr.write('Example: beat pipeline "setup db" "run migrations" "seed data"\n');
    process.exit(1);
  }

  return { steps, agent };
}

/**
 * `beat pipeline <step> <step> [...]` — run steps sequentially.
 *
 * ARCHITECTURE (issue #205): self-contained, schedule-free. Previously this created N
 * linked one-time SCHEDULES that only fired if a daemon was running, so a CLI user saw
 * "schedules" appear and nothing executed. Now the default invocation detaches a
 * background worker (`mode: 'run'`) that delegates each step as a real task chained via
 * `dependsOn` (step N blocks on step N-1) and drives the pipeline to PipelineCompleted.
 * Scheduled pipelines (cron) still use the schedule executor — only immediate pipelines
 * changed.
 */
export async function handlePipelineCommand(pipelineArgs: string[]): Promise<void> {
  const isWorker = isWorkerInvocation(pipelineArgs);
  const cleanArgs = stripWorkerFlag(pipelineArgs);
  const { steps, agent } = parsePipelineArgs(cleanArgs);

  if (!isWorker) {
    await runDetached({
      command: 'pipeline',
      args: cleanArgs,
      logPrefix: 'pipeline',
      idPattern: /Pipeline ID:\s+(pipeline-\S+)/,
      foundMessage: (id) => `Pipeline started: ${id}`,
      infoLines: ['Check status: beat status', 'Pipelines:    beat dashboard'],
      entityLabel: 'Pipeline',
    });
    return;
  }

  await runPipelineWorker(steps, agent);
}

/**
 * Worker path: create the chained step tasks, persist the Pipeline entity (so the
 * PipelineHandler can aggregate status off task events), then drive to completion.
 */
async function runPipelineWorker(steps: readonly string[], agent?: AgentProvider): Promise<void> {
  let container: Container | undefined;
  const s = ui.createSpinner();
  try {
    s.start(`Creating pipeline with ${steps.length} steps...`);
    const containerResult = await bootstrap({ mode: 'run' });
    if (!containerResult.ok) {
      s.stop('Pipeline creation failed');
      ui.error(`Bootstrap failed: ${containerResult.error.message}`);
      process.exit(1);
    }
    container = containerResult.value;

    const taskManagerResult = await container.resolve<TaskManager>('taskManager');
    if (!taskManagerResult.ok) {
      s.stop('Pipeline creation failed');
      ui.error(`Failed to get task manager: ${taskManagerResult.error.message}`);
      await container.dispose();
      process.exit(1);
    }
    const taskManager = taskManagerResult.value;

    const pipelineRepoResult = container.get<PipelineRepository>('pipelineRepository');
    if (!pipelineRepoResult.ok) {
      s.stop('Pipeline creation failed');
      ui.error(`Failed to get pipeline repository: ${pipelineRepoResult.error.message}`);
      await container.dispose();
      process.exit(1);
    }
    const pipelineRepository = pipelineRepoResult.value;

    // Delegate each step as a task, chaining via dependsOn so step N blocks on step N-1.
    // Tasks start QUEUED; the worker pool spawns them in dependency order. The synchronous
    // creation completes well before any task finishes (tmux spawn takes seconds), so the
    // Pipeline entity is saved before any terminal task event can fire.
    const taskIds: TaskId[] = [];
    let previousTaskId: TaskId | undefined;
    for (const prompt of steps) {
      const request: TaskRequest = {
        prompt,
        agent,
        dependsOn: previousTaskId ? [previousTaskId] : undefined,
      };
      const delegateResult = await taskManager.delegate(request);
      if (!delegateResult.ok) {
        s.stop('Pipeline creation failed');
        ui.error(`Failed to delegate pipeline step: ${delegateResult.error.message}`);
        // Best-effort: cancel any steps already created so we don't orphan work.
        for (const id of taskIds) {
          await taskManager.cancel(id, 'Pipeline creation aborted');
        }
        await container.dispose();
        process.exit(1);
      }
      taskIds.push(delegateResult.value.id);
      previousTaskId = delegateResult.value.id;
    }

    const stepDefinitions: PipelineStepDefinition[] = steps.map((prompt, index) => ({ index, prompt, agent }));
    const pipeline = createPipeline({ steps: stepDefinitions, stepTaskIds: taskIds, agent });

    const saveResult = await pipelineRepository.save(pipeline);
    if (!saveResult.ok) {
      s.stop('Pipeline creation failed');
      ui.error(`Failed to persist pipeline: ${saveResult.error.message}`);
      for (const id of taskIds) {
        await taskManager.cancel(id, 'Pipeline creation aborted');
      }
      await container.dispose();
      process.exit(1);
    }

    s.stop('Pipeline created');
    // CRITICAL: "Pipeline ID:" pattern is used by detach-mode polling.
    ui.success(`Pipeline ID: ${pipeline.id}`);
    const lines: string[] = [];
    for (let i = 0; i < steps.length; i++) {
      lines.push(`${i + 1}. ${ui.dim(`[${taskIds[i]}]`)} "${steps[i]}"`);
      if (i < steps.length - 1) lines.push('   ↓');
    }
    ui.note(lines.join('\n'), agent ? `Pipeline Steps (agent: ${agent})` : 'Pipeline Steps');

    await driveToCompletion({
      container,
      wait: () => waitForPipelineCompletion(container as Container, pipeline.id),
      onSigint: () => {
        for (const id of taskIds) {
          taskManager.cancel(id, 'User interrupted (SIGINT)');
        }
      },
      sigintMessage: '\nCancelling pipeline...\n',
    });
  } catch (error) {
    s.stop('Pipeline creation failed');
    ui.error(errorMessage(error));
    if (container) await container.dispose();
    process.exit(1);
  }
}
