import { describe, expect, it } from "vitest";

import type {
  IsolatedWorktreeRequest,
  IsolatedWorktreeResult,
  ProcessExecutionResult,
  WorktreeMutationContext,
} from "../../packages/git-adapter/src/index.js";
import {
  createRecordedChangeSet,
  REPAIR_REQUEST_SCHEMA_VERSION,
  replayRecordedChangeSet,
  type GitWorktreeRunnerPort,
  type RecordedChangeSet,
  type RepairRequest,
} from "../../packages/codex-adapter/src/index.js";

const BASE_COMMIT = "a".repeat(40);
const PATCH = [
  "diff --git a/src/idempotency.ts b/src/idempotency.ts",
  `index ${"1".repeat(40)}..${"2".repeat(40)} 100644`,
  "--- a/src/idempotency.ts",
  "+++ b/src/idempotency.ts",
  "@@ -1 +1 @@",
  "-export const protectedTransfer = false;",
  "+export const protectedTransfer = true;",
  "",
].join("\n");

function request(): RepairRequest {
  return {
    schemaVersion: REPAIR_REQUEST_SCHEMA_VERSION,
    requestId: "repair-TX-001",
    mode: "record-replay",
    invariant: {
      id: "TRANSFER_IDEMPOTENCY",
      statement: "The same transfer request must debit the source only once.",
    },
    scenario: {
      id: "timeout-after-commit-retry",
      deterministicSeed: "TX-001",
      counterexampleArtifactPath: "evidence/counterexample.json",
      counterexampleSha256: "c".repeat(64),
      reproductionCommand: "pnpm qedra attack TRANSFER_IDEMPOTENCY",
    },
    repository: {
      path: "C:\\fixture\\repository",
      baseRef: "HEAD",
      baseCommit: BASE_COMMIT,
      isolatedWorktreePath: "C:\\fixture\\worktree",
      affectedFiles: ["src/idempotency.ts"],
    },
    prompt: "Apply the recorded idempotency repair.",
    validationCommands: [
      {
        id: "idempotency-test",
        command: "pnpm",
        args: ["test", "--", "idempotency"],
        timeoutMs: 30_000,
      },
    ],
    limits: {
      maxAttempts: 1,
      attemptTimeoutMs: 30_000,
      noProgressLimit: 1,
    },
    createdAt: "2026-07-14T00:00:00.000Z",
    humanApprovalRequired: true,
  };
}

function changeSet(): RecordedChangeSet {
  return createRecordedChangeSet({
    requestId: "repair-TX-001",
    invariantId: "TRANSFER_IDEMPOTENCY",
    baseCommit: BASE_COMMIT,
    patch: PATCH,
    affectedFiles: ["src/idempotency.ts"],
    recordedAt: "2026-07-14T00:00:00.000Z",
  });
}

function commandResult(
  args: readonly string[],
  stdin?: string,
): ProcessExecutionResult {
  return {
    command: "git",
    args,
    exitCode: 0,
    stdout: stdin === undefined ? "" : "applied",
    stderr: "",
    durationMs: 1,
    timedOut: false,
    cancelled: false,
    outputTruncated: false,
  };
}

class SuccessfulReplayRunner implements GitWorktreeRunnerPort {
  request: IsolatedWorktreeRequest | undefined;
  readonly gitCalls: Array<{
    readonly args: readonly string[];
    readonly stdin?: string;
  }> = [];

  constructor(
    readonly changedFiles: readonly string[] = ["src/idempotency.ts"],
  ) {}

  async run<T>(
    worktreeRequest: IsolatedWorktreeRequest,
    mutate: (context: WorktreeMutationContext) => Promise<T>,
  ): Promise<IsolatedWorktreeResult<T>> {
    this.request = worktreeRequest;
    const mutationOutput = await mutate({
      repositoryPath: worktreeRequest.repositoryPath,
      workingDirectory: worktreeRequest.worktreePath,
      baseCommit: BASE_COMMIT,
      runGit: (args, options = {}) => {
        this.gitCalls.push({
          args,
          ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
        });
        return Promise.resolve(commandResult(args, options.stdin));
      },
    });
    const recorded = changeSet();
    return {
      status: "PASSED",
      repositoryPath: worktreeRequest.repositoryPath,
      worktreePath: worktreeRequest.worktreePath,
      baseCommit: BASE_COMMIT,
      headCommit: BASE_COMMIT,
      changedFiles: this.changedFiles,
      patch: PATCH,
      patchSha256: recorded.patch.sha256,
      validationResults: [
        {
          id: "idempotency-test",
          command: "pnpm",
          args: ["test", "--", "idempotency"],
          exitCode: 0,
          stdout: "passed",
          stderr: "",
          durationMs: 5,
          passed: true,
          timedOut: false,
          cancelled: false,
          outputTruncated: false,
        },
      ],
      mutationOutput,
      cleanup: { attempted: true, succeeded: true, pruned: true },
      humanApprovalRequired: true,
      approvalStatus: "PENDING",
      committed: false,
      merged: false,
      appliedToSourceRepository: false,
    };
  }
}

describe("record/replay repair", () => {
  it("replays the exact hashed patch in isolation and leaves approval pending", async () => {
    const runner = new SuccessfulReplayRunner();
    const recorded = changeSet();

    const result = await replayRecordedChangeSet(request(), recorded, runner);

    expect(result.status).toBe("SUCCEEDED");
    expect(result.patch?.sha256).toBe(recorded.patch.sha256);
    expect(result.validationResults).toHaveLength(1);
    expect(result.humanApprovalRequired).toBe(true);
    expect(result.approvalStatus).toBe("PENDING");
    expect(result.committed).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.appliedToSourceRepository).toBe(false);
    expect(runner.request?.baseRef).toBe(BASE_COMMIT);
    expect(runner.gitCalls.map((call) => call.args)).toEqual([
      ["apply", "--check", "--whitespace=error-all"],
      ["apply", "--whitespace=error-all"],
    ]);
    expect(runner.gitCalls.every((call) => call.stdin === PATCH)).toBe(true);
  });

  it("rejects a tampered patch before creating a worktree", async () => {
    let runnerCalled = false;
    const runner: GitWorktreeRunnerPort = {
      run: () => {
        runnerCalled = true;
        return Promise.reject(new Error("runner must not be called"));
      },
    };
    const recorded = changeSet();
    const tampered: RecordedChangeSet = {
      ...recorded,
      patch: {
        ...recorded.patch,
        content: `${recorded.patch.content}tampered`,
      },
    };

    const result = await replayRecordedChangeSet(request(), tampered, runner);

    expect(result.status).toBe("CHANGE_SET_REJECTED");
    expect(result.blocker?.message).toContain("SHA-256");
    expect(runnerCalled).toBe(false);
  });

  it("rejects a change set outside the request file intersection", async () => {
    let runnerCalled = false;
    const runner: GitWorktreeRunnerPort = {
      run: () => {
        runnerCalled = true;
        return Promise.reject(new Error("runner must not be called"));
      },
    };
    const repairRequest = request();

    const result = await replayRecordedChangeSet(
      {
        ...repairRequest,
        repository: {
          ...repairRequest.repository,
          affectedFiles: ["tests/allowed.test.ts"],
        },
      },
      changeSet(),
      runner,
    );

    expect(result.status).toBe("CHANGE_SET_REJECTED");
    expect(result.blocker?.message).toContain("allowlist");
    expect(runnerCalled).toBe(false);
  });

  it("rejects a captured worktree file list that differs from the record", async () => {
    const runner = new SuccessfulReplayRunner(["tests/unexpected.test.ts"]);

    const result = await replayRecordedChangeSet(
      request(),
      changeSet(),
      runner,
    );

    expect(result.status).toBe("CHANGE_SET_REJECTED");
    expect(result.blocker?.message).toContain("does not exactly match");
    expect(result.appliedToSourceRepository).toBe(false);
  });
});
