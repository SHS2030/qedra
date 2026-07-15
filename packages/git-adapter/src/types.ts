export const DEFAULT_PROCESS_TIMEOUT_MS = 120_000;
export const MAX_PROCESS_TIMEOUT_MS = 900_000;
export const DEFAULT_MAX_OUTPUT_BYTES = 1_000_000;

export interface ProcessExecutionRequest {
  readonly command: string;
  readonly args?: readonly string[];
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly omitEnvironmentVariables?: readonly string[];
  readonly stdin?: string;
  readonly signal?: AbortSignal;
}

export interface ProcessExecutionResult {
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputTruncated: boolean;
}

export interface ProcessRunner {
  run(request: ProcessExecutionRequest): Promise<ProcessExecutionResult>;
}

export interface ValidationCommand {
  readonly id: string;
  readonly command: string;
  readonly args?: readonly string[];
  readonly timeoutMs?: number;
  readonly env?: Readonly<Record<string, string>>;
  readonly omitEnvironmentVariables?: readonly string[];
}

export interface ValidationResult {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly exitCode: number | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly durationMs: number;
  readonly passed: boolean;
  readonly timedOut: boolean;
  readonly cancelled: boolean;
  readonly outputTruncated: boolean;
}

export interface GitCommandOptions {
  readonly timeoutMs?: number;
  readonly stdin?: string;
  readonly signal?: AbortSignal | undefined;
}

export interface WorktreeMutationContext {
  readonly repositoryPath: string;
  readonly workingDirectory: string;
  readonly baseCommit: string;
  runGit(
    args: readonly string[],
    options?: GitCommandOptions,
  ): Promise<ProcessExecutionResult>;
}

export interface IsolatedWorktreeRequest {
  readonly repositoryPath: string;
  readonly worktreePath: string;
  readonly baseRef: string;
  readonly validationCommands: readonly ValidationCommand[];
  readonly stopValidationOnFailure?: boolean;
  readonly signal?: AbortSignal;
}

export type WorktreeRunStatus =
  | "PASSED"
  | "NO_CHANGES"
  | "VALIDATION_FAILED"
  | "MUTATION_FAILED"
  | "POLICY_VIOLATION"
  | "CANCELLED"
  | "TIMED_OUT"
  | "SETUP_FAILED";

export interface CleanupEvidence {
  readonly attempted: boolean;
  readonly succeeded: boolean;
  readonly pruned: boolean;
  readonly error?: string;
}

export interface IsolatedWorktreeResult<T = void> {
  readonly status: WorktreeRunStatus;
  readonly repositoryPath: string;
  readonly worktreePath: string;
  readonly baseCommit: string | null;
  readonly headCommit: string | null;
  readonly changedFiles: readonly string[];
  readonly patch: string;
  readonly patchSha256: string;
  readonly validationResults: readonly ValidationResult[];
  readonly mutationOutput?: T;
  readonly error?: string;
  readonly cleanup: CleanupEvidence;
  readonly humanApprovalRequired: true;
  readonly approvalStatus: "PENDING";
  readonly committed: boolean;
  readonly merged: false;
  readonly appliedToSourceRepository: false;
}
