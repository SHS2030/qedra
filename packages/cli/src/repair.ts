import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createRecordedChangeSet,
  detectOpenAiApiKeyPresence,
  LiveCodexRepairAdapter,
  openAiEnvFiles,
  replayRecordedChangeSet,
  type RecordedChangeSet,
  type RepairBlocker,
  type RepairRequest,
  type RepairResult,
  type RepairStatus,
} from "../../codex-adapter/src/index.js";
import {
  GitWorktreeRunner,
  NodeProcessRunner,
  type IsolatedWorktreeResult,
  type ValidationCommand,
  type WorktreeMutationContext,
} from "../../git-adapter/src/index.js";
import {
  parseAndVerifyCounterexample,
  type Counterexample,
} from "../../proof-passport/src/index.js";
import {
  atomicWriteJson,
  atomicWriteText,
  readGitMetadata,
  sha256Hex,
} from "../../shared/src/index.js";
import {
  invariantEvidencePaths,
  isSupportedInvariantId,
  type SupportedInvariantId,
} from "./evidence-layout.js";

const TRANSFER_EVIDENCE_PATHS = invariantEvidencePaths("TRANSFER_IDEMPOTENCY");

export const REPAIR_REQUEST_PATH = TRANSFER_EVIDENCE_PATHS.repairRequest;
export const REPAIR_REPORT_PATH = TRANSFER_EVIDENCE_PATHS.repairReport;
export const REPAIR_DIFF_PATH = TRANSFER_EVIDENCE_PATHS.repairDiff;
export const LIVE_REPAIR_REQUEST_PATH =
  TRANSFER_EVIDENCE_PATHS.liveRepairRequest;
export const LIVE_REPAIR_REPORT_PATH = TRANSFER_EVIDENCE_PATHS.liveRepairReport;
export const LIVE_REPAIR_DIFF_PATH = TRANSFER_EVIDENCE_PATHS.liveRepairDiff;
export const RECORDED_CHANGE_SET_PATH =
  TRANSFER_EVIDENCE_PATHS.recordedChangeSet;

interface RepairProfile {
  readonly invariantId: SupportedInvariantId;
  readonly requestId: string;
  readonly recordedPatchPath: string;
  readonly repairedFiles: readonly string[];
  readonly validationCommands: readonly RepairRequest["validationCommands"][number][];
  readonly prompt: string;
}

const REPAIR_PROFILES: Readonly<Record<SupportedInvariantId, RepairProfile>> = {
  TRANSFER_IDEMPOTENCY: {
    invariantId: "TRANSFER_IDEMPOTENCY",
    requestId: "REPAIR-TRANSFER-IDEMPOTENCY-001",
    recordedPatchPath:
      "packages/codex-adapter/fixtures/TRANSFER_IDEMPOTENCY.patch",
    repairedFiles: [
      "examples/vulnerable-wallet-api/src/vulnerable-wallet-store.ts",
      "examples/vulnerable-wallet-api/tests/transfer-idempotency.regression.test.ts",
    ],
    validationCommands: [
      {
        id: "non-regression-test",
        command: process.execPath,
        args: [
          "--import",
          "tsx",
          "--test",
          "examples/vulnerable-wallet-api/tests/transfer-idempotency.regression.test.ts",
        ],
        timeoutMs: 60_000,
      },
      {
        id: "exact-attack-replay",
        command: process.execPath,
        args: [
          "--import",
          "tsx",
          "packages/cli/src/bin.ts",
          "verify",
          "TRANSFER_IDEMPOTENCY",
          "--target",
          "vulnerable",
          "--json",
        ],
        timeoutMs: 60_000,
      },
    ],
    prompt: [
      "Repair TRANSFER_IDEMPOTENCY in the deliberately vulnerable wallet fixture.",
      "Use persistent request/result storage, a unique request constraint, and one atomic transaction.",
      "Return the stored first result for every repeated request.",
      "Add and pass a non-regression test for the recorded timeout-after-commit retry.",
      "Modify only the allowed affected files. Do not commit, merge, push, or weaken validation.",
    ].join("\n"),
  },
  IDEMPOTENCY_KEY_PAYLOAD_BINDING: {
    invariantId: "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
    requestId: "REPAIR-IDEMPOTENCY-KEY-PAYLOAD-BINDING-001",
    recordedPatchPath:
      "packages/codex-adapter/fixtures/IDEMPOTENCY_KEY_PAYLOAD_BINDING.patch",
    repairedFiles: [
      "examples/vulnerable-wallet-api/src/payload-blind-wallet-store.ts",
      "examples/vulnerable-wallet-api/tests/idempotency-key-payload-binding.regression.test.ts",
    ],
    validationCommands: [
      {
        id: "non-regression-test",
        command: process.execPath,
        args: [
          "--import",
          "tsx",
          "--test",
          "--test-name-pattern",
          "non-regression",
          "examples/vulnerable-wallet-api/tests/idempotency-key-payload-binding.regression.test.ts",
        ],
        timeoutMs: 60_000,
      },
      {
        id: "exact-attack-replay",
        command: process.execPath,
        args: [
          "--import",
          "tsx",
          "--test",
          "--test-name-pattern",
          "exact replay",
          "examples/vulnerable-wallet-api/tests/idempotency-key-payload-binding.regression.test.ts",
        ],
        timeoutMs: 60_000,
      },
    ],
    prompt: [
      "Repair IDEMPOTENCY_KEY_PAYLOAD_BINDING in the deliberately payload-blind wallet fixture.",
      "Bind each idempotency key to canonical source, destination, and amount semantics.",
      "Return the stored first result for an exact retry and reject every conflicting payload with HTTP 409 and IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD.",
      "Preserve balances and ledger entries on every conflict and pass the exact recorded replay.",
      "Modify only the allowed affected files. Do not commit, merge, push, or weaken validation.",
    ].join("\n"),
  },
};
const SENSITIVE_VALIDATION_ENVIRONMENT_VARIABLES = [
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
] as const;

export interface RepairArtifactPaths {
  readonly request: string;
  readonly report: string;
  readonly diff: string;
}

export function repairArtifactPaths(
  mode: RepairRequest["mode"],
  invariantId: SupportedInvariantId = "TRANSFER_IDEMPOTENCY",
): RepairArtifactPaths {
  const paths = invariantEvidencePaths(invariantId);
  return mode === "live"
    ? {
        request: paths.liveRepairRequest,
        report: paths.liveRepairReport,
        diff: paths.liveRepairDiff,
      }
    : {
        request: paths.repairRequest,
        report: paths.repairReport,
        diff: paths.repairDiff,
      };
}

export async function buildRepairRequest(
  repositoryRoot: string,
  counterexample: Counterexample,
  mode: "live" | "record-replay",
  createdAt = new Date().toISOString(),
): Promise<RepairRequest> {
  if (!isSupportedInvariantId(counterexample.invariant.id)) {
    throw new Error(
      `Unsupported repair invariant: ${counterexample.invariant.id}`,
    );
  }
  const profile = REPAIR_PROFILES[counterexample.invariant.id];
  const paths = invariantEvidencePaths(profile.invariantId);
  const git = await readGitMetadata(repositoryRoot);
  if (git.commit === null) {
    throw new Error("A committed Git base is required for an isolated repair.");
  }
  if (counterexample.repository.commit !== git.commit) {
    throw new Error(
      "The counterexample commit must match the isolated repair base commit.",
    );
  }
  const counterexampleArtifactPath = paths.counterexample;
  const counterexampleBytes = await readFile(
    resolve(repositoryRoot, counterexampleArtifactPath),
  );
  const storedCounterexample = parseAndVerifyCounterexample(
    JSON.parse(counterexampleBytes.toString("utf8")) as unknown,
  );
  if (
    storedCounterexample.evidenceHash !== counterexample.evidenceHash ||
    storedCounterexample.invariant.id !== profile.invariantId
  ) {
    throw new Error(
      "The stored counterexample does not match the requested invariant evidence.",
    );
  }
  const counterexampleSha256 = sha256Hex(counterexampleBytes);
  return {
    schemaVersion: "qedra.repair-request.v1",
    requestId: profile.requestId,
    mode,
    invariant: counterexample.invariant,
    scenario: {
      id: counterexample.scenario.id,
      deterministicSeed: counterexample.scenario.deterministicSeed,
      counterexampleArtifactPath,
      counterexampleSha256,
      reproductionCommand: counterexample.reproductionCommand,
    },
    repository: {
      path: repositoryRoot,
      baseRef: git.commit,
      baseCommit: git.commit,
      isolatedWorktreePath: resolve(repositoryRoot, paths.worktree),
      affectedFiles: profile.repairedFiles,
    },
    prompt: profile.prompt,
    validationCommands: profile.validationCommands,
    limits: {
      maxAttempts: 3,
      attemptTimeoutMs: 120_000,
      noProgressLimit: 2,
    },
    createdAt,
    humanApprovalRequired: true,
  };
}

async function writeRepairArtifacts(
  repositoryRoot: string,
  request: RepairRequest,
  result: RepairResult,
  changeSet?: RecordedChangeSet,
): Promise<void> {
  if (!isSupportedInvariantId(request.invariant.id)) {
    throw new Error(`Unsupported repair invariant: ${request.invariant.id}`);
  }
  const paths = invariantEvidencePaths(request.invariant.id);
  const writeSet = async (paths: RepairArtifactPaths): Promise<void> => {
    await atomicWriteJson(resolve(repositoryRoot, paths.request), request);
    await atomicWriteJson(resolve(repositoryRoot, paths.report), result);
    await atomicWriteText(
      resolve(repositoryRoot, paths.diff),
      result.patch?.content ?? "",
    );
  };
  await writeSet({
    request: paths.repairRequest,
    report: paths.repairReport,
    diff: paths.repairDiff,
  });
  if (request.mode === "live") {
    await writeSet(repairArtifactPaths("live", request.invariant.id));
  }
  if (changeSet !== undefined) {
    await atomicWriteJson(
      resolve(repositoryRoot, paths.recordedChangeSet),
      changeSet,
    );
  }
}

export interface RepairExecution {
  readonly request: RepairRequest;
  readonly result: RepairResult;
  readonly changeSet?: RecordedChangeSet;
}

export async function executeRecordedRepair(
  repositoryRoot: string,
  counterexample: Counterexample,
  signal?: AbortSignal,
): Promise<RepairExecution> {
  const request = await buildRepairRequest(
    repositoryRoot,
    counterexample,
    "record-replay",
  );
  if (!isSupportedInvariantId(request.invariant.id)) {
    throw new Error(`Unsupported repair invariant: ${request.invariant.id}`);
  }
  const profile = REPAIR_PROFILES[request.invariant.id];
  const patch = await readFile(
    resolve(repositoryRoot, profile.recordedPatchPath),
    "utf8",
  );
  const changeSet = createRecordedChangeSet({
    requestId: request.requestId,
    invariantId: request.invariant.id,
    baseCommit: request.repository.baseCommit,
    patch,
    affectedFiles: profile.repairedFiles,
    recordedAt: request.createdAt,
  });
  const result = await replayRecordedChangeSet(
    request,
    changeSet,
    new GitWorktreeRunner(),
    signal,
  );
  await writeRepairArtifacts(repositoryRoot, request, result, changeSet);
  return { request, result, changeSet };
}

async function assessWorkspace(
  context: WorktreeMutationContext,
  commands: readonly ValidationCommand[],
  signal?: AbortSignal,
): Promise<{ readonly passed: boolean; readonly fingerprint: string }> {
  const runner = new NodeProcessRunner();
  let passed = true;
  for (const command of commands) {
    const result = await runner.run({
      command: command.command,
      args: command.args ?? [],
      cwd: context.workingDirectory,
      timeoutMs: command.timeoutMs ?? 120_000,
      omitEnvironmentVariables: SENSITIVE_VALIDATION_ENVIRONMENT_VARIABLES,
      ...(signal === undefined ? {} : { signal }),
    });
    passed &&= result.exitCode === 0 && !result.timedOut && !result.cancelled;
  }
  const diff = await context.runGit(["diff", "--binary", "HEAD", "--"], {
    ...(signal === undefined ? {} : { signal }),
  });
  return { passed, fingerprint: diff.stdout };
}

interface LiveWorktreeFailure {
  readonly status: RepairStatus;
  readonly blocker: RepairBlocker;
}

function liveWorktreeFailure(
  request: RepairRequest,
  worktree: IsolatedWorktreeResult<RepairResult>,
  liveStatus: RepairStatus,
): LiveWorktreeFailure | null {
  const failure = (
    status: RepairStatus,
    kind: RepairBlocker["kind"],
    message: string,
  ): LiveWorktreeFailure => ({
    status,
    blocker: { kind, code: status, message },
  });
  if (worktree.baseCommit !== request.repository.baseCommit) {
    return failure(
      "ISOLATION_REQUIRED",
      "policy",
      "The live repair worktree base commit did not match the repair request.",
    );
  }
  if (worktree.committed) {
    return failure(
      "CHANGE_SET_REJECTED",
      "policy",
      "The live repair created a commit; QEDRA repairs must remain uncommitted for human review.",
    );
  }
  const allowedFiles = new Set(request.repository.affectedFiles);
  const disallowedFiles = worktree.changedFiles.filter(
    (path) => !allowedFiles.has(path),
  );
  if (disallowedFiles.length > 0) {
    return failure(
      "CHANGE_SET_REJECTED",
      "policy",
      `The live repair changed files outside the allowlist: ${disallowedFiles.join(", ")}.`,
    );
  }
  if (!worktree.cleanup.succeeded) {
    return failure(
      "CHANGE_SET_REJECTED",
      "execution",
      "The live repair worktree could not be cleaned up safely.",
    );
  }
  if (liveStatus !== "SUCCEEDED") {
    return null;
  }
  switch (worktree.status) {
    case "PASSED":
      if (
        worktree.validationResults.length !==
          request.validationCommands.length ||
        !worktree.validationResults.every((validation) => validation.passed)
      ) {
        return failure(
          "VALIDATION_FAILED",
          "execution",
          "The live repair did not complete every deterministic validation command.",
        );
      }
      return null;
    case "VALIDATION_FAILED":
      return failure(
        "VALIDATION_FAILED",
        "execution",
        "The live repair failed deterministic worktree validation.",
      );
    case "NO_CHANGES":
      return failure(
        "NO_PROGRESS",
        "execution",
        "The live repair produced no reviewable change.",
      );
    case "CANCELLED":
      return failure(
        "CANCELLED",
        "execution",
        "The live repair was cancelled.",
      );
    case "TIMED_OUT":
      return failure("TIMED_OUT", "execution", "The live repair timed out.");
    case "POLICY_VIOLATION":
      return failure(
        "CHANGE_SET_REJECTED",
        "policy",
        worktree.error ?? "The live repair violated the worktree policy.",
      );
    case "MUTATION_FAILED":
      return failure(
        "LIVE_EXECUTION_FAILED",
        "execution",
        worktree.error ?? "The live repair mutation failed.",
      );
    case "SETUP_FAILED":
      return failure(
        "ISOLATION_REQUIRED",
        "execution",
        worktree.error ?? "The live repair worktree could not be created.",
      );
  }
}

export function finalizeLiveRepairResult(
  request: RepairRequest,
  live: RepairResult,
  worktree: IsolatedWorktreeResult<RepairResult>,
): RepairResult {
  const worktreeFailure = liveWorktreeFailure(request, worktree, live.status);
  return {
    ...live,
    ...(worktreeFailure === null
      ? {}
      : {
          status: worktreeFailure.status,
          blocker: worktreeFailure.blocker,
        }),
    ...(worktree.patch.length === 0
      ? {}
      : { patch: { content: worktree.patch, sha256: worktree.patchSha256 } }),
    changedFiles: worktree.changedFiles,
    validationResults: worktree.validationResults,
    committed: worktree.committed,
    merged: false,
    appliedToSourceRepository: false,
  };
}

export async function executeLiveRepair(
  repositoryRoot: string,
  counterexample: Counterexample,
  signal?: AbortSignal,
): Promise<RepairExecution> {
  const request = await buildRepairRequest(
    repositoryRoot,
    counterexample,
    "live",
  );
  const presence = await detectOpenAiApiKeyPresence({
    cwd: repositoryRoot,
    env: process.env,
    envFiles: openAiEnvFiles(process.env),
  });
  const adapter = new LiveCodexRepairAdapter();

  if (!presence.present) {
    const result = await adapter.execute(request, {
      workingDirectory: repositoryRoot,
      ...(signal === undefined ? {} : { signal }),
      assessWorkspace: () =>
        Promise.resolve({ passed: false, fingerprint: "not-run" }),
    });
    await writeRepairArtifacts(repositoryRoot, request, result);
    return { request, result };
  }

  const runner = new GitWorktreeRunner();
  let attemptedLiveResult: RepairResult | undefined;
  const worktree = await runner.run(
    {
      repositoryPath: repositoryRoot,
      worktreePath: request.repository.isolatedWorktreePath,
      baseRef: request.repository.baseRef,
      validationCommands: request.validationCommands,
      stopValidationOnFailure: true,
      ...(signal === undefined ? {} : { signal }),
    },
    async (context) => {
      const candidate = await adapter.execute(request, {
        workingDirectory: context.workingDirectory,
        ...(signal === undefined ? {} : { signal }),
        assessWorkspace: async (_workingDirectory, assessmentSignal) =>
          await assessWorkspace(
            context,
            request.validationCommands,
            assessmentSignal,
          ),
      });
      attemptedLiveResult = candidate;
      if (candidate.status !== "SUCCEEDED") {
        throw new Error(
          `The bounded live repair stopped with status ${candidate.status}.`,
        );
      }
      return candidate;
    },
  );
  const live = worktree.mutationOutput ?? attemptedLiveResult;
  if (live === undefined) {
    throw new Error(worktree.error ?? "Live repair did not produce a result.");
  }
  const result = finalizeLiveRepairResult(request, live, worktree);
  await writeRepairArtifacts(repositoryRoot, request, result);
  return { request, result };
}
