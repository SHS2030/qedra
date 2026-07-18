import { createHash } from "node:crypto";

export const REPAIR_REQUEST_SCHEMA_VERSION = "qedra.repair-request.v1";
export const RECORDED_CHANGE_SET_SCHEMA_VERSION = "qedra.change-set.v1";
export const REPAIR_RESULT_SCHEMA_VERSION = "qedra.repair-result.v1";

export interface RepairValidationCommand {
  readonly id: string;
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
}

export interface RepairLimits {
  readonly maxAttempts: number;
  readonly attemptTimeoutMs: number;
  readonly noProgressLimit: number;
}

export interface RepairRequest {
  readonly schemaVersion: typeof REPAIR_REQUEST_SCHEMA_VERSION;
  readonly requestId: string;
  readonly mode: "live" | "record-replay";
  readonly invariant: {
    readonly id: string;
    readonly statement: string;
  };
  readonly scenario: {
    readonly id: string;
    readonly deterministicSeed: string;
    readonly counterexampleArtifactPath: string;
    readonly counterexampleSha256: string;
    readonly reproductionCommand: string;
  };
  readonly repository: {
    readonly path: string;
    readonly baseRef: string;
    readonly baseCommit: string;
    readonly isolatedWorktreePath: string;
    readonly affectedFiles: readonly string[];
  };
  readonly prompt: string;
  readonly validationCommands: readonly RepairValidationCommand[];
  readonly limits: RepairLimits;
  readonly createdAt: string;
  readonly humanApprovalRequired: true;
}

export interface RecordedChangeSet {
  readonly schemaVersion: typeof RECORDED_CHANGE_SET_SCHEMA_VERSION;
  readonly requestId: string;
  readonly invariantId: string;
  readonly baseCommit: string;
  readonly source: "deterministic-record";
  readonly patch: {
    readonly format: "git-diff";
    readonly content: string;
    readonly sha256: string;
  };
  readonly affectedFiles: readonly string[];
  readonly recordedAt: string;
  readonly humanApprovalRequired: true;
}

export type RepairStatus =
  | "SUCCEEDED"
  | "AUTHENTICATION_REQUIRED"
  | "ATTEMPT_LIMIT_REACHED"
  | "NO_PROGRESS"
  | "TIMED_OUT"
  | "CANCELLED"
  | "VALIDATION_FAILED"
  | "CHANGE_SET_REJECTED"
  | "REPLAY_MISMATCH"
  | "ISOLATION_REQUIRED"
  | "LIVE_EXECUTION_FAILED";

export interface ObservableTokenUsage {
  readonly inputTokens: number;
  readonly cachedInputTokens: number;
  readonly outputTokens: number;
  readonly reasoningOutputTokens: number;
}

export interface RepairAttemptEvidence {
  readonly attempt: number;
  readonly durationMs: number;
  readonly invocationStarted?: boolean;
  readonly threadId?: string;
  readonly progressFingerprint?: string;
  readonly deterministicValidationPassed?: boolean;
  readonly tokenUsage?: ObservableTokenUsage;
}

export interface RepairValidationEvidence {
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

export type RepairFailureDetailCode =
  | "OPENAI_AUTHENTICATION_REJECTED"
  | "OPENAI_INSUFFICIENT_QUOTA"
  | "OPENAI_RATE_LIMITED"
  | "OPENAI_ACCESS_DENIED"
  | "OPENAI_TRANSPORT_FAILED"
  | "CODEX_LOCAL_PROCESS_FAILED"
  | "CODEX_UNKNOWN_FAILURE";

export interface RepairBlocker {
  readonly kind: "external" | "policy" | "execution";
  readonly code: RepairStatus;
  readonly message: string;
  readonly detailCode?: RepairFailureDetailCode;
  readonly retryable?: boolean;
}

export interface RepairResult {
  readonly schemaVersion: typeof REPAIR_RESULT_SCHEMA_VERSION;
  readonly requestId: string;
  readonly mode: "live" | "record-replay";
  readonly status: RepairStatus;
  readonly attempts: readonly RepairAttemptEvidence[];
  readonly blocker?: RepairBlocker;
  readonly patch?: {
    readonly content: string;
    readonly sha256: string;
  };
  readonly changedFiles?: readonly string[];
  readonly validationResults?: readonly RepairValidationEvidence[];
  readonly humanApprovalRequired: true;
  readonly approvalStatus: "PENDING";
  readonly committed: boolean;
  readonly merged: false;
  readonly appliedToSourceRepository: false;
}

export function hashRepairPatch(patch: string): string {
  return createHash("sha256").update(patch, "utf8").digest("hex");
}

export interface CreateRecordedChangeSetInput {
  readonly requestId: string;
  readonly invariantId: string;
  readonly baseCommit: string;
  readonly patch: string;
  readonly affectedFiles: readonly string[];
  readonly recordedAt: string;
}

export function createRecordedChangeSet(
  input: CreateRecordedChangeSetInput,
): RecordedChangeSet {
  if (input.patch.length === 0) {
    throw new Error("A recorded change set cannot contain an empty patch");
  }
  if (!/^[0-9a-f]{40,64}$/u.test(input.baseCommit)) {
    throw new Error(
      "A recorded change set requires a full Git commit identifier",
    );
  }
  return {
    schemaVersion: RECORDED_CHANGE_SET_SCHEMA_VERSION,
    requestId: input.requestId,
    invariantId: input.invariantId,
    baseCommit: input.baseCommit,
    source: "deterministic-record",
    patch: {
      format: "git-diff",
      content: input.patch,
      sha256: hashRepairPatch(input.patch),
    },
    affectedFiles: [...new Set(input.affectedFiles)].sort((left, right) =>
      left.localeCompare(right),
    ),
    recordedAt: input.recordedAt,
    humanApprovalRequired: true,
  };
}

export function validateRecordedChangeSet(
  changeSet: RecordedChangeSet,
): readonly string[] {
  const errors: string[] = [];
  if (changeSet.schemaVersion !== RECORDED_CHANGE_SET_SCHEMA_VERSION) {
    errors.push("Unsupported change-set schema version");
  }
  if (changeSet.source !== "deterministic-record") {
    errors.push("Unsupported change-set source");
  }
  if (changeSet.patch.format !== "git-diff") {
    errors.push("Unsupported change-set patch format");
  }
  if (changeSet.patch.content.length === 0) {
    errors.push("The recorded patch is empty");
  }
  if (hashRepairPatch(changeSet.patch.content) !== changeSet.patch.sha256) {
    errors.push("The recorded patch SHA-256 does not match its content");
  }
  if (!/^[0-9a-f]{40,64}$/u.test(changeSet.baseCommit)) {
    errors.push("The recorded base commit is invalid");
  }
  if (changeSet.humanApprovalRequired !== true) {
    errors.push("Recorded repairs must require human approval");
  }
  return errors;
}

export function serializeRepairArtifact(
  value: RepairRequest | RecordedChangeSet,
): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}
