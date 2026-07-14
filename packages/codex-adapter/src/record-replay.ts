import type {
  GitCommandOptions,
  IsolatedWorktreeRequest,
  IsolatedWorktreeResult,
  ValidationCommand,
  WorktreeMutationContext,
} from "../../git-adapter/src/index.js";
import { posix } from "node:path";

import {
  REPAIR_RESULT_SCHEMA_VERSION,
  type RecordedChangeSet,
  type RepairAttemptEvidence,
  type RepairBlocker,
  type RepairRequest,
  type RepairResult,
  type RepairStatus,
  validateRecordedChangeSet,
} from "./contracts.js";

export interface GitWorktreeRunnerPort {
  run<T>(
    request: IsolatedWorktreeRequest,
    mutate: (context: WorktreeMutationContext) => Promise<T>,
  ): Promise<IsolatedWorktreeResult<T>>;
}

function normalizeRepositoryPath(path: string): string | null {
  if (
    path.length === 0 ||
    path.startsWith("/") ||
    path.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(path) ||
    /[\r\n\0]/u.test(path)
  ) {
    return null;
  }
  const slashPath = path.replaceAll("\\", "/");
  if (!/^[A-Za-z0-9._/-]+$/u.test(slashPath)) {
    return null;
  }
  const normalized = posix.normalize(slashPath);
  if (
    normalized !== slashPath ||
    normalized === "." ||
    normalized === ".." ||
    normalized.startsWith("../") ||
    normalized === ".git" ||
    normalized.startsWith(".git/")
  ) {
    return null;
  }
  return normalized;
}

function normalizePathList(
  paths: readonly string[],
  label: string,
  errors: string[],
): readonly string[] {
  const normalized: string[] = [];
  for (const path of paths) {
    const safe = normalizeRepositoryPath(path);
    if (safe === null) {
      errors.push(`${label} contains an unsafe repository-relative path`);
    } else {
      normalized.push(safe);
    }
  }
  return [...new Set(normalized)].sort((left, right) =>
    left.localeCompare(right),
  );
}

function extractCanonicalPatchPaths(
  patch: string,
  errors: string[],
): readonly string[] {
  const paths: string[] = [];
  const headers = patch
    .split(/\r?\n/u)
    .filter((line) => line.startsWith("diff --git "));
  if (headers.length === 0) {
    errors.push("The recorded patch contains no canonical Git diff headers");
    return [];
  }
  for (const header of headers) {
    const match =
      /^diff --git a\/([A-Za-z0-9._/-]+) b\/([A-Za-z0-9._/-]+)$/u.exec(header);
    const beforePath = match?.[1];
    const afterPath = match?.[2];
    if (
      beforePath === undefined ||
      afterPath === undefined ||
      beforePath !== afterPath
    ) {
      errors.push(
        "The recorded patch contains an unsupported or non-canonical file header",
      );
      continue;
    }
    const safe = normalizeRepositoryPath(beforePath);
    if (safe === null) {
      errors.push("The recorded patch contains an unsafe file path");
    } else {
      paths.push(safe);
    }
  }
  return [...new Set(paths)].sort((left, right) => left.localeCompare(right));
}

function samePaths(left: readonly string[], right: readonly string[]): boolean {
  return (
    left.length === right.length &&
    left.every((path, index) => path === right[index])
  );
}

function assertGitCommandPassed(
  result: Awaited<ReturnType<WorktreeMutationContext["runGit"]>>,
  operation: string,
): void {
  if (result.cancelled) {
    throw new Error(`${operation} was cancelled`);
  }
  if (result.timedOut) {
    throw new Error(`${operation} timed out`);
  }
  if (result.exitCode !== 0) {
    throw new Error(`${operation} rejected the recorded patch`);
  }
}

function replayBlocker(
  kind: RepairBlocker["kind"],
  code: RepairStatus,
  message: string,
): RepairBlocker {
  return { kind, code, message };
}

function invalidChangeSetResult(
  request: RepairRequest,
  message: string,
): RepairResult {
  return {
    schemaVersion: REPAIR_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    mode: "record-replay",
    status: "CHANGE_SET_REJECTED",
    attempts: [],
    blocker: replayBlocker("policy", "CHANGE_SET_REJECTED", message),
    humanApprovalRequired: true,
    approvalStatus: "PENDING",
    committed: false,
    merged: false,
    appliedToSourceRepository: false,
  };
}

function mapStatus(status: IsolatedWorktreeResult["status"]): RepairStatus {
  switch (status) {
    case "PASSED":
      return "SUCCEEDED";
    case "VALIDATION_FAILED":
      return "VALIDATION_FAILED";
    case "TIMED_OUT":
      return "TIMED_OUT";
    case "CANCELLED":
      return "CANCELLED";
    case "NO_CHANGES":
      return "REPLAY_MISMATCH";
    case "POLICY_VIOLATION":
    case "MUTATION_FAILED":
    case "SETUP_FAILED":
      return "CHANGE_SET_REJECTED";
  }
}

function replayMessage(status: RepairStatus): string | undefined {
  switch (status) {
    case "SUCCEEDED":
    case "CANCELLED":
    case "TIMED_OUT":
      return undefined;
    case "VALIDATION_FAILED":
      return "The recorded change set was applied in isolation but deterministic validation failed.";
    case "REPLAY_MISMATCH":
      return "The isolated replay did not reproduce the exact recorded patch.";
    case "CHANGE_SET_REJECTED":
      return "The recorded change set could not be applied under the isolated repair policy.";
    default:
      return "The deterministic replay did not complete successfully.";
  }
}

export async function replayRecordedChangeSet(
  request: RepairRequest,
  changeSet: RecordedChangeSet,
  runner: GitWorktreeRunnerPort,
  signal?: AbortSignal,
): Promise<RepairResult> {
  if (request.mode !== "record-replay") {
    throw new Error("Recorded change-set replay requires record-replay mode");
  }
  const validationErrors = [...validateRecordedChangeSet(changeSet)];
  if (changeSet.requestId !== request.requestId) {
    validationErrors.push(
      "The change set belongs to a different repair request",
    );
  }
  if (changeSet.invariantId !== request.invariant.id) {
    validationErrors.push("The change set belongs to a different invariant");
  }
  if (changeSet.baseCommit !== request.repository.baseCommit) {
    validationErrors.push(
      "The change set base commit differs from the repair request",
    );
  }
  const requestPaths = normalizePathList(
    request.repository.affectedFiles,
    "The repair request",
    validationErrors,
  );
  const changeSetPaths = normalizePathList(
    changeSet.affectedFiles,
    "The recorded change set",
    validationErrors,
  );
  const patchPaths = extractCanonicalPatchPaths(
    changeSet.patch.content,
    validationErrors,
  );
  const allowedPaths = changeSetPaths.filter((path) =>
    requestPaths.includes(path),
  );
  if (!samePaths(allowedPaths, changeSetPaths)) {
    validationErrors.push(
      "The recorded change set touches files outside the repair request allowlist",
    );
  }
  if (!samePaths(patchPaths, changeSetPaths)) {
    validationErrors.push(
      "The recorded patch file list does not match its declared affected files",
    );
  }
  if (validationErrors.length > 0) {
    return invalidChangeSetResult(request, validationErrors.join("; "));
  }

  const validationCommands: ValidationCommand[] =
    request.validationCommands.map((command) => ({
      id: command.id,
      command: command.command,
      args: command.args,
      timeoutMs: command.timeoutMs,
    }));
  const worktreeRequest: IsolatedWorktreeRequest = {
    repositoryPath: request.repository.path,
    worktreePath: request.repository.isolatedWorktreePath,
    baseRef: changeSet.baseCommit,
    validationCommands,
    stopValidationOnFailure: true,
    ...(signal === undefined ? {} : { signal }),
  };
  const startedAt = performance.now();
  const worktree = await runner.run(worktreeRequest, async (context) => {
    const options: GitCommandOptions = {
      stdin: changeSet.patch.content,
      timeoutMs: request.limits.attemptTimeoutMs,
      ...(signal === undefined ? {} : { signal }),
    };
    const check = await context.runGit(
      ["apply", "--check", "--whitespace=error-all"],
      options,
    );
    assertGitCommandPassed(check, "Git apply preflight");
    const apply = await context.runGit(
      ["apply", "--whitespace=error-all"],
      options,
    );
    assertGitCommandPassed(apply, "Git apply");
    return { applied: true as const };
  });

  let status = mapStatus(worktree.status);
  let policyMessage: string | undefined;
  const capturedPathErrors: string[] = [];
  const capturedPaths = normalizePathList(
    worktree.changedFiles,
    "The captured worktree diff",
    capturedPathErrors,
  );
  if (
    capturedPathErrors.length > 0 ||
    !samePaths(capturedPaths, changeSetPaths)
  ) {
    status = "CHANGE_SET_REJECTED";
    policyMessage =
      "The captured worktree file list does not exactly match the recorded change set.";
  }
  if (
    status === "SUCCEEDED" &&
    worktree.patchSha256 !== changeSet.patch.sha256
  ) {
    status = "REPLAY_MISMATCH";
  }
  if (status === "SUCCEEDED" && !worktree.cleanup.succeeded) {
    status = "CHANGE_SET_REJECTED";
  }

  const attempt: RepairAttemptEvidence = {
    attempt: 1,
    durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
    progressFingerprint: worktree.patchSha256,
    deterministicValidationPassed:
      status === "SUCCEEDED" &&
      worktree.validationResults.every((validation) => validation.passed),
  };
  const message = policyMessage ?? replayMessage(status);
  return {
    schemaVersion: REPAIR_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    mode: "record-replay",
    status,
    attempts: [attempt],
    ...(message === undefined
      ? {}
      : {
          blocker: replayBlocker(
            status === "VALIDATION_FAILED" ? "execution" : "policy",
            status,
            message,
          ),
        }),
    patch: {
      content: worktree.patch,
      sha256: worktree.patchSha256,
    },
    changedFiles: worktree.changedFiles,
    validationResults: worktree.validationResults,
    humanApprovalRequired: true,
    approvalStatus: "PENDING",
    committed: worktree.committed,
    merged: false,
    appliedToSourceRepository: false,
  };
}

export class DeterministicReplayAdapter {
  constructor(readonly runner: GitWorktreeRunnerPort) {}

  async execute(
    request: RepairRequest,
    changeSet: RecordedChangeSet,
    signal?: AbortSignal,
  ): Promise<RepairResult> {
    return await replayRecordedChangeSet(
      request,
      changeSet,
      this.runner,
      signal,
    );
  }
}
