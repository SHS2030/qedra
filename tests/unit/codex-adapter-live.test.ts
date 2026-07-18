import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  LiveCodexRepairAdapter,
  REPAIR_REQUEST_SCHEMA_VERSION,
  type CodexClientPort,
  type CodexRunResultPort,
  type CodexThreadPort,
  type RepairBlocker,
  type RepairFailureDetailCode,
  type RepairRequest,
  type RepairStatus,
  type WorkspaceAssessment,
} from "../../packages/codex-adapter/src/index.js";

const temporaryDirectories: string[] = [];
const CONFIGURED_API_KEY = "unit-test-key-never-logged";
const RAW_PROVIDER_DETAIL = "raw-provider-diagnostic-never-persisted";
const SENSITIVE_ERROR_MARKER = "sk-proj-unit-test-secret-never-persisted";

interface SdkFailureFixture {
  readonly name: string;
  readonly error: Error;
  readonly status: RepairStatus;
  readonly kind: RepairBlocker["kind"];
  readonly detailCode: RepairFailureDetailCode;
  readonly retryable: boolean;
  readonly safeMessage: string;
}

const sdkFailureFixtures = [
  {
    name: "authentication rejection",
    error: new Error(
      `401 Unauthorized: invalid_api_key ${RAW_PROVIDER_DETAIL} ${SENSITIVE_ERROR_MARKER}`,
    ),
    status: "AUTHENTICATION_REQUIRED",
    kind: "external",
    detailCode: "OPENAI_AUTHENTICATION_REJECTED",
    retryable: false,
    safeMessage:
      "The live Codex SDK rejected the configured API authentication.",
  },
  {
    name: "exhausted API quota",
    error: new Error(
      `429 rate_limit_exceeded insufficient_quota: current quota exhausted ${RAW_PROVIDER_DETAIL} ${SENSITIVE_ERROR_MARKER}`,
    ),
    status: "LIVE_EXECUTION_FAILED",
    kind: "external",
    detailCode: "OPENAI_INSUFFICIENT_QUOTA",
    retryable: false,
    safeMessage:
      "The OpenAI API reported exhausted credits or quota for the configured project.",
  },
  {
    name: "ordinary rate limit",
    error: new Error(
      `429 rate_limit_exceeded: requests per minute exceeded ${RAW_PROVIDER_DETAIL} ${SENSITIVE_ERROR_MARKER}`,
    ),
    status: "LIVE_EXECUTION_FAILED",
    kind: "external",
    detailCode: "OPENAI_RATE_LIMITED",
    retryable: true,
    safeMessage: "The OpenAI API rate-limited the bounded live repair request.",
  },
  {
    name: "project or model access denial",
    error: new Error(
      `403 model_not_found: project does not have access ${RAW_PROVIDER_DETAIL} ${SENSITIVE_ERROR_MARKER}`,
    ),
    status: "LIVE_EXECUTION_FAILED",
    kind: "external",
    detailCode: "OPENAI_ACCESS_DENIED",
    retryable: false,
    safeMessage:
      "The configured OpenAI project, organization, or model is not authorized for this live repair.",
  },
  {
    name: "transport failure",
    error: new Error(
      `ETIMEDOUT while connecting to provider ${RAW_PROVIDER_DETAIL} ${SENSITIVE_ERROR_MARKER}`,
    ),
    status: "LIVE_EXECUTION_FAILED",
    kind: "external",
    detailCode: "OPENAI_TRANSPORT_FAILED",
    retryable: true,
    safeMessage: "The Codex SDK could not reach the OpenAI API.",
  },
  {
    name: "local Codex process failure",
    error: new Error(
      `Codex Exec exited with code 1: ${RAW_PROVIDER_DETAIL} ${SENSITIVE_ERROR_MARKER}`,
    ),
    status: "LIVE_EXECUTION_FAILED",
    kind: "execution",
    detailCode: "CODEX_LOCAL_PROCESS_FAILED",
    retryable: false,
    safeMessage: "The local Codex SDK process could not be executed.",
  },
  {
    name: "unknown SDK failure",
    error: new Error(
      `Unexpected provider rejection ${RAW_PROVIDER_DETAIL} ${SENSITIVE_ERROR_MARKER}`,
    ),
    status: "LIVE_EXECUTION_FAILED",
    kind: "execution",
    detailCode: "CODEX_UNKNOWN_FAILURE",
    retryable: false,
    safeMessage:
      "The bounded Codex SDK attempt failed before deterministic validation.",
  },
  {
    name: "ambiguous HTTP 429",
    error: new Error(
      `429 provider rejection ${RAW_PROVIDER_DETAIL} ${SENSITIVE_ERROR_MARKER}`,
    ),
    status: "LIVE_EXECUTION_FAILED",
    kind: "execution",
    detailCode: "CODEX_UNKNOWN_FAILURE",
    retryable: false,
    safeMessage:
      "The bounded Codex SDK attempt failed before deterministic validation.",
  },
  {
    name: "unrelated local 401 identifier",
    error: new Error(
      `Local worker 401 terminated unexpectedly ${RAW_PROVIDER_DETAIL} ${SENSITIVE_ERROR_MARKER}`,
    ),
    status: "LIVE_EXECUTION_FAILED",
    kind: "execution",
    detailCode: "CODEX_UNKNOWN_FAILURE",
    retryable: false,
    safeMessage:
      "The bounded Codex SDK attempt failed before deterministic validation.",
  },
  {
    name: "unrelated local 403 identifier",
    error: new Error(
      `Local path segment 403 failed a check ${RAW_PROVIDER_DETAIL} ${SENSITIVE_ERROR_MARKER}`,
    ),
    status: "LIVE_EXECUTION_FAILED",
    kind: "execution",
    detailCode: "CODEX_UNKNOWN_FAILURE",
    retryable: false,
    safeMessage:
      "The bounded Codex SDK attempt failed before deterministic validation.",
  },
] as const satisfies readonly SdkFailureFixture[];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

async function isolatedPaths(): Promise<{
  readonly root: string;
  readonly repository: string;
  readonly worktree: string;
}> {
  const root = await mkdtemp(join(tmpdir(), "qedra-live-test-"));
  temporaryDirectories.push(root);
  const repository = join(root, "repository");
  const worktree = join(root, "worktree");
  await mkdir(repository);
  await mkdir(worktree);
  await writeFile(join(worktree, ".git"), "gitdir: fixture\n", "utf8");
  return { root, repository, worktree };
}

function request(repository: string, worktree: string): RepairRequest {
  return {
    schemaVersion: REPAIR_REQUEST_SCHEMA_VERSION,
    requestId: "repair-TX-001",
    mode: "live",
    invariant: {
      id: "TRANSFER_IDEMPOTENCY",
      statement: "The same transfer request must debit the source only once.",
    },
    scenario: {
      id: "timeout-after-commit-retry",
      deterministicSeed: "TX-001",
      counterexampleArtifactPath: "evidence/counterexample.json",
      counterexampleSha256: "c".repeat(64),
      reproductionCommand:
        "node --import tsx packages/cli/src/bin.ts attack TRANSFER_IDEMPOTENCY",
    },
    repository: {
      path: repository,
      baseRef: "HEAD",
      baseCommit: "a".repeat(40),
      isolatedWorktreePath: worktree,
      affectedFiles: ["examples/vulnerable-wallet-api/src/store.ts"],
    },
    prompt:
      "Repair the confirmed idempotency violation and add a regression test.",
    validationCommands: [
      {
        id: "targeted-test",
        command: "pnpm",
        args: ["test", "--", "idempotency"],
        timeoutMs: 30_000,
      },
    ],
    limits: {
      maxAttempts: 2,
      attemptTimeoutMs: 100,
      noProgressLimit: 1,
    },
    createdAt: "2026-07-14T00:00:00.000Z",
    humanApprovalRequired: true,
  };
}

class FakeThread implements CodexThreadPort {
  readonly id = "thread-fixture";

  constructor(
    readonly implementation: (
      prompt: string,
      signal: AbortSignal,
    ) => Promise<CodexRunResultPort>,
  ) {}

  async run(
    prompt: string,
    options: { readonly signal: AbortSignal },
  ): Promise<CodexRunResultPort> {
    return await this.implementation(prompt, options.signal);
  }
}

class FakeClient implements CodexClientPort {
  readonly threadOptions: unknown[] = [];
  readonly prompts: string[] = [];

  constructor(
    readonly implementation: (
      prompt: string,
      signal: AbortSignal,
    ) => Promise<CodexRunResultPort>,
  ) {}

  startThread(
    options: Parameters<CodexClientPort["startThread"]>[0],
  ): CodexThreadPort {
    this.threadOptions.push(options);
    return new FakeThread(async (prompt, signal) => {
      this.prompts.push(prompt);
      return await this.implementation(prompt, signal);
    });
  }
}

const completedTurn: CodexRunResultPort = {
  finalResponse: "A proposed repair was written to the isolated worktree.",
  items: [],
  usage: {
    input_tokens: 10,
    cached_input_tokens: 2,
    output_tokens: 3,
    reasoning_output_tokens: 1,
  },
};

function assessmentSequence(
  values: readonly WorkspaceAssessment[],
): (workingDirectory: string) => Promise<WorkspaceAssessment> {
  let index = 0;
  return () => {
    const value = values[index] ?? values.at(-1);
    index += 1;
    if (value === undefined) {
      return Promise.reject(new Error("Missing assessment fixture"));
    }
    return Promise.resolve(value);
  };
}

describe("LiveCodexRepairAdapter", () => {
  it("returns an external authentication blocker without creating an SDK client", async () => {
    const paths = await isolatedPaths();
    let factoryCalls = 0;
    const adapter = new LiveCodexRepairAdapter({
      environment: {},
      envFiles: ["missing.env"],
      clientFactory: () => {
        factoryCalls += 1;
        return new FakeClient(() => Promise.resolve(completedTurn));
      },
    });

    const result = await adapter.execute(
      request(paths.repository, paths.worktree),
      {
        workingDirectory: paths.worktree,
        assessWorkspace: assessmentSequence([
          { passed: false, fingerprint: "before" },
        ]),
      },
    );

    expect(result.status).toBe("AUTHENTICATION_REQUIRED");
    expect(result.blocker).toMatchObject({
      kind: "external",
      code: "AUTHENTICATION_REQUIRED",
    });
    expect(result.attempts).toEqual([]);
    expect(factoryCalls).toBe(0);
  });

  it("uses startThread in the isolated worktree and trusts deterministic validation", async () => {
    const paths = await isolatedPaths();
    const client = new FakeClient(() => Promise.resolve(completedTurn));
    const adapter = new LiveCodexRepairAdapter({
      environment: { OPENAI_API_KEY: "unit-test-key-never-logged" },
      clientFactory: () => client,
    });

    const result = await adapter.execute(
      request(paths.repository, paths.worktree),
      {
        workingDirectory: paths.worktree,
        assessWorkspace: assessmentSequence([
          { passed: false, fingerprint: "before" },
          { passed: true, fingerprint: "after" },
        ]),
      },
    );

    expect(result.status).toBe("SUCCEEDED");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]).toMatchObject({
      invocationStarted: true,
      threadId: "thread-fixture",
      progressFingerprint: "after",
      deterministicValidationPassed: true,
      tokenUsage: {
        inputTokens: 10,
        cachedInputTokens: 2,
        outputTokens: 3,
        reasoningOutputTokens: 1,
      },
    });
    expect(client.threadOptions).toEqual([
      {
        workingDirectory: paths.worktree,
        skipGitRepoCheck: false,
        sandboxMode: "workspace-write",
        approvalPolicy: "never",
        networkAccessEnabled: false,
      },
    ]);
    expect(client.prompts[0]).toContain("Do not commit, merge, push");
    expect(result.humanApprovalRequired).toBe(true);
    expect(result.approvalStatus).toBe("PENDING");
  });

  it("aborts a non-responsive attempt at its configured timeout", async () => {
    const paths = await isolatedPaths();
    const client = new FakeClient(
      async (_prompt, signal) =>
        await new Promise<CodexRunResultPort>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("The test repair attempt was aborted"),
              );
            },
            { once: true },
          );
        }),
    );
    const timedRequest = request(paths.repository, paths.worktree);
    const adapter = new LiveCodexRepairAdapter({
      environment: { OPENAI_API_KEY: "unit-test-key-never-logged" },
      clientFactory: () => client,
    });

    const result = await adapter.execute(
      {
        ...timedRequest,
        limits: { ...timedRequest.limits, attemptTimeoutMs: 5 },
      },
      {
        workingDirectory: paths.worktree,
        assessWorkspace: assessmentSequence([
          { passed: false, fingerprint: "before" },
        ]),
      },
    );

    expect(result.status).toBe("TIMED_OUT");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.invocationStarted).toBe(true);
  });

  it("cancels a running SDK attempt through the external signal", async () => {
    const paths = await isolatedPaths();
    const controller = new AbortController();
    const client = new FakeClient(
      async (_prompt, signal) =>
        await new Promise<CodexRunResultPort>((_resolve, reject) => {
          signal.addEventListener(
            "abort",
            () => {
              reject(
                signal.reason instanceof Error
                  ? signal.reason
                  : new Error("The test repair attempt was cancelled"),
              );
            },
            { once: true },
          );
          queueMicrotask(() => controller.abort());
        }),
    );
    const adapter = new LiveCodexRepairAdapter({
      environment: { OPENAI_API_KEY: "unit-test-key-never-logged" },
      clientFactory: () => client,
    });

    const result = await adapter.execute(
      request(paths.repository, paths.worktree),
      {
        workingDirectory: paths.worktree,
        signal: controller.signal,
        assessWorkspace: assessmentSequence([
          { passed: false, fingerprint: "before" },
        ]),
      },
    );

    expect(result.status).toBe("CANCELLED");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.invocationStarted).toBe(true);
  });

  it.each(sdkFailureFixtures)(
    "classifies $name without persisting raw provider details",
    async (fixture) => {
      const paths = await isolatedPaths();
      const client = new FakeClient(() => Promise.reject(fixture.error));
      const adapter = new LiveCodexRepairAdapter({
        environment: { OPENAI_API_KEY: CONFIGURED_API_KEY },
        clientFactory: () => client,
      });

      const result = await adapter.execute(
        request(paths.repository, paths.worktree),
        {
          workingDirectory: paths.worktree,
          assessWorkspace: assessmentSequence([
            { passed: false, fingerprint: "before" },
          ]),
        },
      );

      expect(result.status).toBe(fixture.status);
      expect(result.blocker).toMatchObject({
        kind: fixture.kind,
        code: fixture.status,
        message: fixture.safeMessage,
        detailCode: fixture.detailCode,
        retryable: fixture.retryable,
      });
      expect(result.attempts).toHaveLength(1);
      expect(result.attempts[0]).toMatchObject({
        invocationStarted: true,
        threadId: "thread-fixture",
      });

      const serializedResult = JSON.stringify(result);
      expect(serializedResult).not.toContain(fixture.error.message);
      expect(serializedResult).not.toContain(RAW_PROVIDER_DETAIL);
      expect(serializedResult).not.toContain(SENSITIVE_ERROR_MARKER);
      expect(serializedResult).not.toContain(CONFIGURED_API_KEY);
    },
  );

  it("does not count a thread-construction failure as an SDK invocation", async () => {
    const paths = await isolatedPaths();
    const adapter = new LiveCodexRepairAdapter({
      environment: { OPENAI_API_KEY: "unit-test-key-never-logged" },
      clientFactory: () => ({
        startThread: () => {
          throw new Error("SDK thread setup failed");
        },
      }),
    });

    const result = await adapter.execute(
      request(paths.repository, paths.worktree),
      {
        workingDirectory: paths.worktree,
        assessWorkspace: assessmentSequence([
          { passed: false, fingerprint: "before" },
        ]),
      },
    );

    expect(result.status).toBe("LIVE_EXECUTION_FAILED");
    expect(result.attempts).toHaveLength(1);
    expect(result.attempts[0]?.invocationStarted).toBeUndefined();
  });

  it("stops after the bounded no-progress threshold", async () => {
    const paths = await isolatedPaths();
    const client = new FakeClient(() => Promise.resolve(completedTurn));
    const adapter = new LiveCodexRepairAdapter({
      environment: { OPENAI_API_KEY: "unit-test-key-never-logged" },
      clientFactory: () => client,
    });

    const result = await adapter.execute(
      request(paths.repository, paths.worktree),
      {
        workingDirectory: paths.worktree,
        assessWorkspace: assessmentSequence([
          { passed: false, fingerprint: "unchanged" },
          { passed: false, fingerprint: "unchanged" },
        ]),
      },
    );

    expect(result.status).toBe("NO_PROGRESS");
    expect(result.attempts).toHaveLength(1);
    expect(client.prompts).toHaveLength(1);
  });
});
