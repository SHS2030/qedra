import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  CounterexampleSchema,
  EVIDENCE_SCHEMA_VERSION,
  EvidenceIntegrityError,
  createCounterexample,
  createPassport,
  createRepairEvidence,
  parseAndVerifyCounterexample,
  parseAndVerifyPassport,
  renderPassportHtml,
  verifyEvidenceHash,
  writePassportArtifacts,
  type Passport,
  type RepairEvidence,
} from "../../packages/proof-passport/src/index.js";
import { sha256Hex } from "../../packages/shared/src/index.js";

const generatedAt = "2026-07-14T12:00:00.000Z";
const statement =
  "The same transfer request must never debit a wallet more than once, including after a network timeout, client retry, duplicate callback, or concurrent duplicate request.";
const invariant = { id: "TRANSFER_IDEMPOTENCY", statement } as const;
const repository = {
  commit: "a".repeat(40),
  branch: "codex/genesis",
  dirty: false,
  remoteUrl: "https://github.com/example/qedra.git",
} as const;
const temporaryRoots: string[] = [];

function makeRepair(): RepairEvidence {
  return createRepairEvidence({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "qedra.repair",
    generatedAt,
    invariant,
    mode: "record-replay",
    status: "replayed",
    requestArtifact: {
      path: "evidence/repair-request.json",
      sha256: sha256Hex("repair request fixture"),
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
      baseCommit: repository.commit,
    },
    attempts: [],
    diffArtifact: {
      path: "evidence/repair.patch",
      sha256: sha256Hex("deterministic patch fixture"),
    },
    validation: {
      commands: ["pnpm test:adversarial"],
      passed: true,
      completedAt: generatedAt,
    },
    humanApprovalRequired: true,
  });
}

function makePassport(): Passport {
  const repair = makeRepair();
  const counterexampleReference = {
    path: "evidence/counterexample.json",
    sha256: sha256Hex("counterexample fixture"),
  } as const;

  return createPassport({
    schemaVersion: EVIDENCE_SCHEMA_VERSION,
    kind: "qedra.passport",
    generatedAt,
    invariant,
    repository,
    qualification: {
      status: "PASS",
      command: "node --import tsx packages/cli/src/bin.ts init --json",
      completedAt: generatedAt,
      artifact: null,
    },
    attack: {
      status: "FAIL",
      command:
        "node --import tsx packages/cli/src/bin.ts attack TRANSFER_IDEMPOTENCY --json",
      completedAt: generatedAt,
      artifact: counterexampleReference,
    },
    repair,
    replay: {
      status: "PASS",
      command:
        "node --import tsx packages/cli/src/bin.ts repair TRANSFER_IDEMPOTENCY --replay --json",
      completedAt: generatedAt,
      artifact: null,
    },
    verification: {
      status: "PASS",
      command:
        "node --import tsx packages/cli/src/bin.ts verify TRANSFER_IDEMPOTENCY --json",
      completedAt: generatedAt,
      artifact: null,
    },
    artifacts: [
      counterexampleReference,
      repair.requestArtifact,
      repair.diffArtifact!,
    ],
    reproductionCommands: [
      "node --import tsx packages/cli/src/bin.ts demo --replay",
    ],
    metrics: {
      durationMs: 450,
      scenariosExecuted: 2,
      verificationCommandsExecuted: 1,
      repairAttempts: 0,
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
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("counterexample evidence", () => {
  it("hashes canonical evidence and detects state tampering", () => {
    const counterexample = createCounterexample({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      kind: "qedra.counterexample",
      generatedAt,
      invariant,
      scenario: {
        id: "timeout-after-commit-retry",
        deterministicSeed: "seed-1",
        targetId: "vulnerable-wallet-api",
        attackRequestHash: "a".repeat(64),
      },
      events: [
        {
          sequence: 0,
          type: "transfer.committed",
          requestId: "TX-001",
          occurredAt: null,
          data: { amount: 1_000 },
        },
        {
          sequence: 1,
          type: "client.retry",
          requestId: "TX-001",
          occurredAt: null,
          data: { reason: "timeout" },
        },
      ],
      expectedState: {
        sourceBalance: 9_000,
        destinationBalance: 6_000,
        debitEntries: 1,
        creditEntries: 1,
      },
      actualState: {
        sourceBalance: 8_000,
        destinationBalance: 7_000,
        debitEntries: 2,
        creditEntries: 2,
      },
      ledgerEntries: [
        { requestId: "TX-001", direction: "debit", amount: 1_000 },
      ],
      affectedFiles: ["examples/vulnerable-wallet-api/src/wallet.ts"],
      reproductionCommand:
        "node --import tsx packages/cli/src/bin.ts attack TRANSFER_IDEMPOTENCY --json",
      repository,
    });

    expect(verifyEvidenceHash(counterexample)).toBe(true);
    expect(parseAndVerifyCounterexample(counterexample)).toEqual(
      counterexample,
    );

    const tampered = structuredClone(counterexample);
    tampered.actualState.sourceBalance = 9_000;
    expect(verifyEvidenceHash(tampered)).toBe(false);
    expect(() => parseAndVerifyCounterexample(tampered)).toThrow(
      EvidenceIntegrityError,
    );
  });

  it("rejects unordered event sequences", () => {
    const valid = createCounterexample({
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      kind: "qedra.counterexample",
      generatedAt,
      invariant,
      scenario: {
        id: "scenario",
        deterministicSeed: "seed",
        targetId: "fixture",
        attackRequestHash: "b".repeat(64),
      },
      events: [
        {
          sequence: 0,
          type: "first",
          requestId: null,
          occurredAt: null,
          data: {},
        },
      ],
      expectedState: {},
      actualState: {},
      ledgerEntries: [],
      affectedFiles: ["example.ts"],
      reproductionCommand: "pnpm reproduce",
      repository,
    });
    const invalid = {
      ...valid,
      events: [{ ...valid.events[0]!, sequence: 2 }],
    };

    expect(() => CounterexampleSchema.parse(invalid)).toThrow(/sequence/u);
  });
});

describe("proof passport integrity and rendering", () => {
  it("requires human approval and preserves null for unobserved metrics", () => {
    const passport = makePassport();

    expect(passport.humanApprovalRequired).toBe(true);
    expect(passport.metrics.inputTokens).toBeNull();
    expect(passport.metrics.costUsd).toBeNull();
    expect(verifyEvidenceHash(passport.repair)).toBe(true);
    expect(verifyEvidenceHash(passport)).toBe(true);
    expect(parseAndVerifyPassport(passport)).toEqual(passport);
  });

  it("renders a standalone HTML report without external scripts", () => {
    const html = renderPassportHtml(makePassport());

    expect(html).toContain("<!doctype html>");
    expect(html).toContain("Human approval is required");
    expect(html).toContain("Integrity VERIFIED");
    expect(html).toContain("Not observable");
    expect(html).not.toMatch(/<script|<link[^>]+href=|<img[^>]+src=/iu);
  });

  it("writes JSON and HTML atomically and reports their real file hashes", async () => {
    const parent = resolve(process.cwd(), "reports/runtime/test-temp");
    await mkdir(parent, { recursive: true });
    const root = await mkdtemp(join(parent, "passport-"));
    temporaryRoots.push(root);
    const jsonPath = join(root, "passport.json");
    const htmlPath = join(root, "passport.html");

    const result = await writePassportArtifacts(makePassport(), {
      jsonPath,
      htmlPath,
    });
    const json = await readFile(jsonPath);
    const html = await readFile(htmlPath);

    expect(result.jsonSha256).toBe(sha256Hex(json));
    expect(result.htmlSha256).toBe(sha256Hex(html));
    expect(parseAndVerifyPassport(JSON.parse(json.toString("utf8")))).toEqual(
      makePassport(),
    );
    expect(html.toString("utf8")).toContain("Integrity VERIFIED");
  });
});
