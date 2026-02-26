import { ChildProcess } from 'child_process';

export interface Task {
  id: string;
  prompt: string;
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';
  process?: ChildProcess;
  output: string[];
  errors: string[];
  startTime?: number;
  endTime?: number;
  exitCode?: number;
  cancelReason?: string;
  workingDirectory?: string;
}

export interface ToolResponse {
  success: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: generic payload for tool responses
  data?: any;
  error?: string;
}

export enum ErrorCode {
  TASK_NOT_FOUND = 'TASK_NOT_FOUND',
  TASK_ALREADY_RUNNING = 'TASK_ALREADY_RUNNING',
  CLAUDE_NOT_FOUND = 'CLAUDE_NOT_FOUND',
  SPAWN_FAILED = 'SPAWN_FAILED',
  INVALID_PROMPT = 'INVALID_PROMPT',
  TASK_TIMEOUT = 'TASK_TIMEOUT',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class DelegateError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public taskId?: string,
  ) {
    super(message);
    this.name = 'DelegateError';
  }
}
