import { describe, expect, it } from "vitest";

import {
  REPAIR_REQUEST_SCHEMA_VERSION,
  REPAIR_RESULT_SCHEMA_VERSION,
  type RepairRequest,
  type RepairResult,
} from "../../packages/codex-adapter/src/index.js";
import type {
  IsolatedWorktreeResult,
  ValidationResult,
} from "../../packages/git-adapter/src/index.js";
import { finalizeLiveRepairResult } from "../../packages/cli/src/repair.js";

const BASE_COMMIT = "a".repeat(40);
const ALLOWED_FILE =
  "examples/vulnerable-wallet-api/src/vulnerable-wallet-store.ts";
const PATCH = [
  `diff --git a/${ALLOWED_FILE} b/${ALLOWED_FILE}`,
  "--- a/source.ts",
  "+++ b/source.ts",
  "@@ -1 +1 @@",
  "-export const repaired = false;",
  "+export const repaired = true;",
  "",
].join("\n");

function request(): RepairRequest {
  return {
    schemaVersion: REPAIR_REQUEST_SCHEMA_VERSION,
    requestId: "repair-live-policy-001",
    mode: "live",
    invariant: {
      id: "TRANSFER_IDEMPOTENCY",
      statement: "The same transfer request must debit the source only once.",
    },
    scenario: {
      id: "transfer-timeout-after-commit-retry",
      deterministicSeed: "qedra-transfer-idempotency-seed-v1",
      counterexampleArtifactPath: "evidence/counterexample.json",
      counterexampleSha256: "c".repeat(64),
      reproductionCommand: "qedra attack TRANSFER_IDEMPOTENCY",
    },
    repository: {
      path: "C:\\fixture\\repository",
      baseRef: BASE_COMMIT,
      baseCommit: BASE_COMMIT,
      isolatedWorktreePath: "C:\\fixture\\worktree",
      affectedFiles: [ALLOWED_FILE],
    },
    prompt: "Repair the confirmed idempotency violation.",
    validationCommands: [
      {
        id: "idempotency-test",
        command: "pnpm",
        args: ["test", "--", "idempotency"],
        timeoutMs: 30_000,
      },
    ],
    limits: {
      maxAttempts: 2,
      attemptTimeoutMs: 30_000,
      noProgressLimit: 1,
    },
    createdAt: "2026-07-15T00:00:00.000Z",
    humanApprovalRequired: true,
  };
}

function validation(
  overrides: Partial<ValidationResult> = {},
): ValidationResult {
  return {
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
    ...overrides,
  };
}

function liveResult(overrides: Partial<RepairResult> = {}): RepairResult {
  return {
    schemaVersion: REPAIR_RESULT_SCHEMA_VERSION,
    requestId: "repair-live-policy-001",
    mode: "live",
    status: "SUCCEEDED",
    attempts: [
      {
        attempt: 1,
        durationMs: 10,
        deterministicValidationPassed: true,
      },
    ],
    humanApprovalRequired: true,
    approvalStatus: "PENDING",
    committed: false,
    merged: false,
    appliedToSourceRepository: false,
    ...overrides,
  };
}

function worktree(
  overrides: Partial<IsolatedWorktreeResult<RepairResult>> = {},
): IsolatedWorktreeResult<RepairResult> {
  return {
    status: "PASSED",
    repositoryPath: "C:\\fixture\\repository",
    worktreePath: "C:\\fixture\\worktree",
    baseCommit: BASE_COMMIT,
    headCommit: BASE_COMMIT,
    changedFiles: [ALLOWED_FILE],
    patch: PATCH,
    patchSha256: "d".repeat(64),
    validationResults: [validation()],
    mutationOutput: liveResult(),
    cleanup: { attempted: true, succeeded: true, pruned: true },
    humanApprovalRequired: true,
    approvalStatus: "PENDING",
    committed: false,
    merged: false,
    appliedToSourceRepository: false,
    ...overrides,
  };
}

describe("live repair worktree policy", () => {
  it("accepts a validated uncommitted repair limited to the allowlist", () => {
    const result = finalizeLiveRepairResult(
      request(),
      liveResult(),
      worktree(),
    );

    expect(result.status).toBe("SUCCEEDED");
    expect(result.blocker).toBeUndefined();
    expect(result.changedFiles).toEqual([ALLOWED_FILE]);
    expect(result.patch).toEqual({
      content: PATCH,
      sha256: "d".repeat(64),
    });
    expect(result.validationResults).toEqual([validation()]);
    expect(result.committed).toBe(false);
    expect(result.merged).toBe(false);
    expect(result.appliedToSourceRepository).toBe(false);
  });

  it("rejects a repair that creates a commit", () => {
    const result = finalizeLiveRepairResult(
      request(),
      liveResult(),
      worktree({ committed: true }),
    );

    expect(result.status).toBe("CHANGE_SET_REJECTED");
    expect(result.blocker).toMatchObject({
      kind: "policy",
      code: "CHANGE_SET_REJECTED",
    });
    expect(result.committed).toBe(true);
  });

  it("rejects a repair that changes a file outside the allowlist", () => {
    const result = finalizeLiveRepairResult(
      request(),
      liveResult(),
      worktree({ changedFiles: [ALLOWED_FILE, "README.md"] }),
    );

    expect(result.status).toBe("CHANGE_SET_REJECTED");
    expect(result.blocker).toMatchObject({
      kind: "policy",
      code: "CHANGE_SET_REJECTED",
    });
    expect(result.blocker?.message).toContain("README.md");
  });

  it("fails when a required validation result is absent", () => {
    const result = finalizeLiveRepairResult(
      request(),
      liveResult(),
      worktree({ validationResults: [] }),
    );

    expect(result.status).toBe("VALIDATION_FAILED");
    expect(result.blocker).toMatchObject({
      kind: "execution",
      code: "VALIDATION_FAILED",
    });
  });

  it("fails when a deterministic validation fails", () => {
    const failedValidation = validation({
      exitCode: 1,
      stdout: "",
      stderr: "assertion failed",
      passed: false,
    });
    const result = finalizeLiveRepairResult(
      request(),
      liveResult(),
      worktree({
        status: "VALIDATION_FAILED",
        validationResults: [failedValidation],
      }),
    );

    expect(result.status).toBe("VALIDATION_FAILED");
    expect(result.blocker).toMatchObject({
      kind: "execution",
      code: "VALIDATION_FAILED",
    });
    expect(result.validationResults).toEqual([failedValidation]);
  });

  it.each([
    ["AUTHENTICATION_REQUIRED", "external"],
    ["TIMED_OUT", "execution"],
  ] as const)(
    "preserves the live %s status when the worktree reports MUTATION_FAILED",
    (status, kind) => {
      const live = liveResult({
        status,
        attempts: [],
        blocker: {
          kind,
          code: status,
          message: `Live adapter reported ${status}.`,
        },
      });

      const result = finalizeLiveRepairResult(
        request(),
        live,
        worktree({
          status: "MUTATION_FAILED",
          mutationOutput: live,
          validationResults: [],
          error: `Live adapter reported ${status}.`,
        }),
      );

      expect(result.status).toBe(status);
      expect(result.blocker).toEqual(live.blocker);
    },
  );
});
