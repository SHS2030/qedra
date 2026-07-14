import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  buildDashboardData,
  exactRequestHash,
  generateEvidenceDashboard,
  renderEvidenceDashboard,
  serializeDashboardData,
  type DashboardArtifacts,
} from "../../apps/evidence-dashboard/src/index.js";
import {
  EVIDENCE_SCHEMA_VERSION,
  createCounterexample,
  createPassport,
  createRepairEvidence,
} from "../../packages/proof-passport/src/index.js";
import {
  TRANSFER_IDEMPOTENCY_ATTACK,
  attackRequestHash,
  type ScenarioHttpRequest,
} from "../../packages/scenario-engine/src/index.js";
import {
  canonicalizeJson,
  sha256Hex,
  type JsonObject,
  type JsonValue,
} from "../../packages/shared/src/index.js";

const GENERATED_AT = "2026-07-14T12:00:00.000Z";
const DEFAULT_STATEMENT =
  "The same transfer request must never debit a wallet more than once.";
const REPOSITORY = {
  commit: "a".repeat(40),
  branch: "codex/genesis",
  dirty: false,
  remoteUrl: "https://github.com/example/qedra.git",
} as const;
const temporaryRoots: string[] = [];

function requestId(request: ScenarioHttpRequest): string | null {
  const body = request.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  return typeof body.requestId === "string" ? body.requestId : null;
}

function responseData(statusCode: number): JsonObject {
  return {
    statusCode,
    headers: { "content-type": "application/json" },
    body: {},
    bodyText: "{}",
  };
}

function jsonObject(value: unknown): JsonObject {
  const normalized: JsonValue = canonicalizeJson(value);
  if (
    normalized === null ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    throw new TypeError("Expected fixture data to be a JSON object.");
  }
  return normalized;
}

function makeArtifacts(statement = DEFAULT_STATEMENT): DashboardArtifacts {
  const invariant = { id: "TRANSFER_IDEMPOTENCY", statement } as const;
  const scenarioRequests = TRANSFER_IDEMPOTENCY_ATTACK.steps.map(
    (step) => step.request,
  );
  const recordedAttackRequestHash = attackRequestHash(scenarioRequests);
  const counterexample = createCounterexample({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "qedra.counterexample",
    generatedAt: GENERATED_AT,
    invariant,
    scenario: {
      id: TRANSFER_IDEMPOTENCY_ATTACK.scenarioId,
      deterministicSeed: TRANSFER_IDEMPOTENCY_ATTACK.deterministicSeed,
      targetId: "vulnerable-wallet-api",
      attackRequestHash: recordedAttackRequestHash,
    },
    events: TRANSFER_IDEMPOTENCY_ATTACK.steps.map((step, index) => ({
      sequence: index,
      type: step.name,
      requestId: requestId(step.request),
      occurredAt: null,
      data: jsonObject({
        expectedStatusCode: step.expectedStatusCode,
        request: step.request,
        response: responseData(step.expectedStatusCode),
      }),
    })),
    expectedState: {
      balances: { A: 9_000, B: 6_000 },
      debitEntries: 1,
      creditEntries: 1,
      totalRelevantEntries: 2,
      relevantLedgerEntries: [],
    },
    actualState: {
      balances: { A: 8_000, B: 7_000 },
      debitEntries: 2,
      creditEntries: 2,
      totalRelevantEntries: 4,
      relevantLedgerEntries: [
        { requestId: "TX-001", walletId: "A", direction: "DEBIT" },
      ],
    },
    ledgerEntries: [{ requestId: "TX-001", walletId: "A", direction: "DEBIT" }],
    affectedFiles: [
      "examples/vulnerable-wallet-api/src/vulnerable-wallet-store.ts",
      "packages/core/src/wallet-store.ts",
    ],
    reproductionCommand:
      "pnpm --silent qedra attack TRANSFER_IDEMPOTENCY --target vulnerable --json",
    repository: REPOSITORY,
  });

  const repair = createRepairEvidence({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "qedra.repair",
    generatedAt: GENERATED_AT,
    invariant,
    mode: "record-replay",
    status: "replayed",
    requestArtifact: {
      path: "evidence/repair-request.json",
      sha256: sha256Hex("repair request"),
    },
    authentication: {
      provider: "official-codex-sdk",
      apiKeyDetected: false,
      liveInvocationAttempted: false,
      blocker:
        "OPENAI_API_KEY is not configured; live invocation was not attempted.",
    },
    limits: { maxAttempts: 2, timeoutMs: 120_000, noProgressLimit: 1 },
    isolation: {
      strategy: "git-worktree",
      worktreePath: null,
      baseCommit: REPOSITORY.commit,
    },
    attempts: [
      {
        attempt: 1,
        mode: "record-replay",
        startedAt: GENERATED_AT,
        completedAt: GENERATED_AT,
        durationMs: 12,
        outcome: "succeeded",
        codexCallId: null,
        model: null,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
        error: null,
      },
    ],
    diffArtifact: {
      path: "evidence/repair.diff",
      sha256: sha256Hex("repair diff"),
    },
    validation: {
      commands: ["pnpm test:adversarial"],
      passed: true,
      completedAt: GENERATED_AT,
    },
    humanApprovalRequired: true,
  });

  const counterexampleArtifact = {
    path: "evidence/counterexample.json",
    sha256: counterexample.evidenceHash,
  } as const;
  const replayArtifact = {
    path: "evidence/replay-result.json",
    sha256: sha256Hex("replay result"),
  } as const;
  const passport = createPassport({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "qedra.passport",
    generatedAt: GENERATED_AT,
    invariant,
    repository: REPOSITORY,
    qualification: {
      status: "PASS",
      command: "pnpm qedra init --json",
      completedAt: GENERATED_AT,
      artifact: null,
    },
    attack: {
      status: "FAIL",
      command: counterexample.reproductionCommand,
      completedAt: GENERATED_AT,
      artifact: counterexampleArtifact,
    },
    repair,
    replay: {
      status: "PASS",
      command: "pnpm qedra attack TRANSFER_IDEMPOTENCY --replay --json",
      completedAt: GENERATED_AT,
      artifact: replayArtifact,
    },
    verification: {
      status: "PASS",
      command: "pnpm qedra verify TRANSFER_IDEMPOTENCY --json",
      completedAt: GENERATED_AT,
      artifact: replayArtifact,
    },
    artifacts: [
      counterexampleArtifact,
      repair.requestArtifact,
      repair.diffArtifact!,
      replayArtifact,
    ],
    reproductionCommands: ["pnpm qedra demo --replay"],
    metrics: {
      durationMs: 450,
      scenariosExecuted: 2,
      verificationCommandsExecuted: 1,
      repairAttempts: 1,
      codexCalls: 0,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      budgetThresholdUsd: null,
      budgetExceeded: null,
    },
    limitations: [
      "Live Codex invocation was not executed because no API key was configured.",
    ],
    humanApprovalRequired: true,
  });

  return { counterexample, repair, passport };
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("evidence dashboard view model", () => {
  it("derives the initial state, ordered timeline, exact replay hash, and integrity", () => {
    const artifacts = makeArtifacts();
    const data = buildDashboardData(artifacts);
    const scenarioRequests = TRANSFER_IDEMPOTENCY_ATTACK.steps.map(
      (step) => step.request,
    );

    expect(data.initialState).toEqual({ A: 10_000, B: 5_000 });
    expect(data.timeline.map((event) => event.type)).toEqual(
      TRANSFER_IDEMPOTENCY_ATTACK.steps.map((step) => step.name),
    );
    expect(data.timeline[2]?.emphasis).toBe("timeout");
    expect(data.timeline[3]?.emphasis).toBe("retry");
    expect(data.replay.exactRequestHash).toBe(
      attackRequestHash(scenarioRequests),
    );
    expect(data.replay.recomputedRequestHash).toBe(
      data.replay.exactRequestHash,
    );
    expect(data.replay.requestHashMatches).toBe(true);
    expect(exactRequestHash(artifacts.counterexample)).toBe(
      data.replay.exactRequestHash,
    );
    expect(data.replay.result).toBe("PASS");
    expect(data.passport.integrity).toBe("VERIFIED");
    expect(data.passport.evidenceBundleIntegrity).toBe("VERIFIED");
    expect(data.humanApproval).toMatchObject({
      required: true,
      status: "PENDING",
    });
  });

  it("neutralizes HTML-significant evidence while preserving the JSON value", () => {
    const hostile = '</script><img src=x onerror="alert(1)"> & law';
    const artifacts = makeArtifacts(hostile);
    const viewModel = buildDashboardData(artifacts);
    const html = renderEvidenceDashboard(artifacts);
    const data = serializeDashboardData(viewModel);
    const parsed: unknown = JSON.parse(data);

    expect(html).not.toContain(hostile);
    expect(html).not.toContain('</script><img src=x onerror="alert(1)">');
    expect(html).toContain("\\u003c/script\\u003e\\u003cimg");
    expect(data).toContain("\\u0026 law");
    expect(parsed).toEqual(viewModel);
    expect(html).not.toContain("innerHTML");
  });
});

describe("evidence dashboard HTML and generation", () => {
  it("contains all judge-facing sections without external scripts or assets", () => {
    const html = renderEvidenceDashboard(makeArtifacts());

    expect(html).toContain("Protected law");
    expect(html).toContain("Initial state");
    expect(html).toContain("Ordered timeout / retry timeline");
    expect(html).toContain("Expected vs actual before repair");
    expect(html).toContain("Affected files");
    expect(html).toContain("Repair evidence");
    expect(html).toContain("Before / after comparison");
    expect(html).toContain("Exact replay hash / result");
    expect(html).toContain("Passport integrity");
    expect(html).toContain("Human approval pending");
    expect(html).toContain('aria-live="polite"');
    expect(html).not.toMatch(/<script[^>]+src\s*=/iu);
    expect(html).not.toMatch(/<link[^>]+href\s*=/iu);
    expect(html).not.toMatch(/<img[^>]+src\s*=/iu);
    expect(html).not.toMatch(
      /https?:\/\/(?!github\.com\/example\/qedra\.git)/iu,
    );
  });

  it("writes matching self-contained HTML and machine-readable JSON", async () => {
    const parent = resolve(process.cwd(), "reports/runtime/test-temp");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(join(parent, "dashboard-"));
    temporaryRoots.push(root);

    const artifacts = makeArtifacts();
    const result = await generateEvidenceDashboard(artifacts, {
      outputDirectory: root,
    });
    const [html, json] = await Promise.all([
      readFile(result.indexPath, "utf8"),
      readFile(result.dataPath, "utf8"),
    ]);
    const parsed: unknown = JSON.parse(json);

    expect(parsed).toEqual(result.data);
    expect(html).toContain(result.data.replay.exactRequestHash);
    expect(html).toContain(result.data.passport.evidenceHash);
    expect(html).toContain('id="qedra-dashboard-data"');
    expect(html).not.toContain("fetch(");
  });
});
