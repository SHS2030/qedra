import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createRecordedChangeSet,
  detectOpenAiApiKeyPresence,
  LiveCodexRepairAdapter,
  replayRecordedChangeSet,
  type RecordedChangeSet,
  type RepairRequest,
  type RepairResult,
} from "../../codex-adapter/src/index.js";
import {
  GitWorktreeRunner,
  NodeProcessRunner,
  type ValidationCommand,
  type WorktreeMutationContext,
} from "../../git-adapter/src/index.js";
import type { Counterexample } from "../../proof-passport/src/index.js";
import {
  atomicWriteJson,
  atomicWriteText,
  readGitMetadata,
} from "../../shared/src/index.js";

export const REPAIR_REQUEST_PATH = "evidence/repair-request.json" as const;
export const REPAIR_REPORT_PATH = "evidence/repair-report.json" as const;
export const REPAIR_DIFF_PATH = "evidence/repair.diff" as const;
export const RECORDED_CHANGE_SET_PATH =
  "evidence/recorded-change-set.json" as const;

const RECORDED_PATCH_PATH =
  "packages/codex-adapter/fixtures/TRANSFER_IDEMPOTENCY.patch" as const;
const REPAIRED_FILES = [
  "examples/vulnerable-wallet-api/src/vulnerable-wallet-store.ts",
  "examples/vulnerable-wallet-api/tests/transfer-idempotency.regression.test.ts",
] as const;

function validationCommands(): readonly RepairRequest["validationCommands"][number][] {
  return [
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
  ];
}

export async function buildRepairRequest(
  repositoryRoot: string,
  counterexample: Counterexample,
  mode: "live" | "record-replay",
  createdAt = new Date().toISOString(),
): Promise<RepairRequest> {
  const git = await readGitMetadata(repositoryRoot);
  if (git.commit === null) {
    throw new Error("A committed Git base is required for an isolated repair.");
  }
  return {
    schemaVersion: "qedra.repair-request.v1",
    requestId: "REPAIR-TRANSFER_IDEMPOTENCY-001",
    mode,
    invariant: counterexample.invariant,
    scenario: {
      id: counterexample.scenario.id,
      deterministicSeed: counterexample.scenario.deterministicSeed,
      counterexampleArtifactPath: "evidence/counterexample.json",
      counterexampleSha256: counterexample.evidenceHash,
      reproductionCommand: counterexample.reproductionCommand,
    },
    repository: {
      path: repositoryRoot,
      baseRef: git.commit,
      baseCommit: git.commit,
      isolatedWorktreePath: resolve(
        repositoryRoot,
        ".qedra",
        "worktrees",
        "transfer-idempotency",
      ),
      affectedFiles: REPAIRED_FILES,
    },
    prompt: [
      "Repair TRANSFER_IDEMPOTENCY in the deliberately vulnerable wallet fixture.",
      "Use persistent request/result storage, a unique request constraint, and one atomic transaction.",
      "Return the stored first result for every repeated request.",
      "Add and pass a non-regression test for the recorded timeout-after-commit retry.",
      "Modify only the allowed affected files. Do not commit, merge, push, or weaken validation.",
    ].join("\n"),
    validationCommands: validationCommands(),
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
  await atomicWriteJson(resolve(repositoryRoot, REPAIR_REQUEST_PATH), request);
  await atomicWriteJson(resolve(repositoryRoot, REPAIR_REPORT_PATH), result);
  await atomicWriteText(
    resolve(repositoryRoot, REPAIR_DIFF_PATH),
    result.patch?.content ?? "",
  );
  if (changeSet !== undefined) {
    await atomicWriteJson(
      resolve(repositoryRoot, RECORDED_CHANGE_SET_PATH),
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
): Promise<RepairExecution> {
  const request = await buildRepairRequest(
    repositoryRoot,
    counterexample,
    "record-replay",
  );
  const patch = await readFile(
    resolve(repositoryRoot, RECORDED_PATCH_PATH),
    "utf8",
  );
  const changeSet = createRecordedChangeSet({
    requestId: request.requestId,
    invariantId: request.invariant.id,
    baseCommit: request.repository.baseCommit,
    patch,
    affectedFiles: REPAIRED_FILES,
    recordedAt: request.createdAt,
  });
  const result = await replayRecordedChangeSet(
    request,
    changeSet,
    new GitWorktreeRunner(),
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
      ...(signal === undefined ? {} : { signal }),
    });
    passed &&= result.exitCode === 0 && !result.timedOut && !result.cancelled;
  }
  const diff = await context.runGit(["diff", "--binary", "HEAD", "--"], {
    ...(signal === undefined ? {} : { signal }),
  });
  return { passed, fingerprint: diff.stdout };
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
    envFiles: [".env.local", ".env"],
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
  const worktree = await runner.run(
    {
      repositoryPath: repositoryRoot,
      worktreePath: request.repository.isolatedWorktreePath,
      baseRef: request.repository.baseRef,
      validationCommands: [],
      ...(signal === undefined ? {} : { signal }),
    },
    async (context) =>
      await adapter.execute(request, {
        workingDirectory: context.workingDirectory,
        ...(signal === undefined ? {} : { signal }),
        assessWorkspace: async (_workingDirectory, assessmentSignal) =>
          await assessWorkspace(
            context,
            request.validationCommands,
            assessmentSignal,
          ),
      }),
  );
  const live = worktree.mutationOutput;
  if (live === undefined) {
    throw new Error(worktree.error ?? "Live repair did not produce a result.");
  }
  const result: RepairResult = {
    ...live,
    ...(worktree.patch.length === 0
      ? {}
      : { patch: { content: worktree.patch, sha256: worktree.patchSha256 } }),
    changedFiles: worktree.changedFiles,
    validationResults: worktree.validationResults,
  };
  await writeRepairArtifacts(repositoryRoot, request, result);
  return { request, result };
}
