import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  EvidenceSummarySchema,
  generateEvidenceSummary,
  verifyEvidenceSummary,
} from "../../packages/cli/src/evidence-summary.js";
import {
  EVIDENCE_DASHBOARD_DATA_PATH,
  EVIDENCE_DASHBOARD_HTML_PATH,
  EVIDENCE_SUMMARY_PATH,
  SUPPORTED_INVARIANT_IDS,
  invariantEvidencePaths,
  type SupportedInvariantId,
} from "../../packages/cli/src/evidence-layout.js";
import {
  addEvidenceHash,
  createPassport,
  createRepairEvidence,
  type Passport,
} from "../../packages/proof-passport/src/index.js";
import { atomicWriteJson, sha256Hex } from "../../packages/shared/src/index.js";

const COMMIT = "a".repeat(40);
const GENERATED_AT = "2026-07-20T10:00:00.000Z";
const temporaryRoots: string[] = [];

function statement(invariantId: SupportedInvariantId): string {
  return invariantId === "TRANSFER_IDEMPOTENCY"
    ? "The same transfer request must never debit a wallet more than once."
    : "The same idempotency key must never be accepted for two semantically different transfer requests.";
}

function passport(
  invariantId: SupportedInvariantId,
  options: { readonly commit?: string; readonly generatedAt?: string } = {},
): Passport {
  const paths = invariantEvidencePaths(invariantId);
  const invariant = { id: invariantId, statement: statement(invariantId) };
  const generatedAt = options.generatedAt ?? GENERATED_AT;
  const repository = {
    commit: options.commit ?? COMMIT,
    branch: "hardening/hackathon-final",
    dirty: false,
    remoteUrl: "https://github.com/example/qedra.git",
  } as const;
  const repair = createRepairEvidence({
    schemaVersion: "1.0.0",
    kind: "qedra.repair",
    generatedAt,
    invariant,
    mode: "record-replay",
    status: "replayed",
    requestArtifact: {
      path: paths.repairRequest,
      sha256: sha256Hex(`${invariantId}-request`),
    },
    authentication: {
      provider: "official-codex-sdk",
      apiKeyDetected: false,
      liveInvocationAttempted: false,
      blocker: "Live repair was not invoked during deterministic replay.",
    },
    limits: { maxAttempts: 1, timeoutMs: 60_000, noProgressLimit: 1 },
    isolation: {
      strategy: "git-worktree",
      worktreePath: paths.worktree,
      baseCommit: repository.commit,
    },
    attempts: [],
    diffArtifact: {
      path: paths.repairDiff,
      sha256: sha256Hex(`${invariantId}-diff`),
    },
    validation: {
      commands: ["deterministic validation"],
      passed: true,
      completedAt: generatedAt,
    },
    humanApprovalRequired: true,
  });
  const reference = (path: string) => ({
    path,
    sha256: sha256Hex(path),
  });
  return createPassport({
    schemaVersion: "1.0.0",
    kind: "qedra.passport",
    generatedAt,
    invariant,
    repository,
    qualification: {
      status: "PASS",
      command: "qedra init --json",
      completedAt: generatedAt,
      artifact: reference("constitutions/qedra.yaml"),
    },
    attack: {
      status: "FAIL",
      command: `qedra attack ${invariantId} --target vulnerable --json`,
      completedAt: generatedAt,
      artifact: reference(paths.counterexample),
    },
    repair,
    replay: {
      status: "PASS",
      command: `qedra repair ${invariantId} --replay --json`,
      completedAt: generatedAt,
      artifact: reference(paths.replayResult),
    },
    verification: {
      status: "PASS",
      command: `qedra verify ${invariantId} --target fixed --json`,
      completedAt: generatedAt,
      artifact: reference(paths.verificationResult),
    },
    artifacts: [
      reference("constitutions/qedra.yaml"),
      reference(paths.counterexample),
      reference(paths.repairRequest),
      reference(paths.repairDiff),
      reference(paths.replayResult),
      reference(paths.verificationResult),
    ],
    reproductionCommands: [`qedra demo ${invariantId} --replay --json`],
    metrics: {
      durationMs: 1,
      scenariosExecuted: 3,
      verificationCommandsExecuted: 2,
      repairAttempts: 1,
      codexCalls: 0,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      budgetThresholdUsd: null,
      budgetExceeded: null,
    },
    limitations: ["Deterministic record/replay is not a live Codex call."],
    humanApprovalRequired: true,
  });
}

async function fixtureRoot(
  overrides: Partial<Record<SupportedInvariantId, Passport>> = {},
): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "qedra-evidence-summary-"));
  temporaryRoots.push(root);
  for (const invariantId of SUPPORTED_INVARIANT_IDS) {
    await atomicWriteJson(
      resolve(root, invariantEvidencePaths(invariantId).passportJson),
      overrides[invariantId] ?? passport(invariantId),
    );
  }
  return root;
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("two-law evidence summary", () => {
  it("generates deterministic canonical summary and autonomous dashboard artifacts", async () => {
    const root = await fixtureRoot();
    const first = await generateEvidenceSummary(root);
    const firstBytes = await Promise.all([
      readFile(resolve(root, EVIDENCE_SUMMARY_PATH), "utf8"),
      readFile(resolve(root, EVIDENCE_DASHBOARD_DATA_PATH), "utf8"),
      readFile(resolve(root, EVIDENCE_DASHBOARD_HTML_PATH), "utf8"),
    ]);
    const second = await generateEvidenceSummary(root);
    const secondBytes = await Promise.all([
      readFile(resolve(root, EVIDENCE_SUMMARY_PATH), "utf8"),
      readFile(resolve(root, EVIDENCE_DASHBOARD_DATA_PATH), "utf8"),
      readFile(resolve(root, EVIDENCE_DASHBOARD_HTML_PATH), "utf8"),
    ]);

    expect(secondBytes).toEqual(firstBytes);
    expect(second.summary.evidenceHash).toBe(first.summary.evidenceHash);
    expect(first.summary.invariants.map((item) => item.invariantId)).toEqual(
      SUPPORTED_INVARIANT_IDS,
    );
    expect(first.summary.repository.commit).toBe(COMMIT);
    expect(first.dashboard.summary.evidenceHash).toBe(
      first.summary.evidenceHash,
    );
    expect(firstBytes[2]).toContain("Human approval: PENDING (required)");
    expect(firstBytes[2]).toContain("Deterministic record/replay");
    expect(firstBytes[2]).not.toMatch(/<script|<link|https?:\/\//u);

    await expect(verifyEvidenceSummary(root)).resolves.toMatchObject({
      status: "VERIFIED",
      repositoryCommit: COMMIT,
      invariantIds: SUPPORTED_INVARIANT_IDS,
      humanApprovalRequired: true,
      approvalStatus: "PENDING",
      error: null,
    });
  });

  it("rejects duplicate laws and cross-invariant passport substitution", async () => {
    const root = await fixtureRoot();
    const generated = await generateEvidenceSummary(root);
    const duplicated = addEvidenceHash({
      ...generated.summary,
      invariants: [
        generated.summary.invariants[0],
        generated.summary.invariants[0],
      ],
      evidenceHash: undefined,
    });
    expect(() => EvidenceSummarySchema.parse(duplicated)).toThrow(
      /Duplicate invariant/u,
    );

    const transferPassport = await readFile(
      resolve(
        root,
        invariantEvidencePaths("TRANSFER_IDEMPOTENCY").passportJson,
      ),
    );
    await writeFile(
      resolve(
        root,
        invariantEvidencePaths("IDEMPOTENCY_KEY_PAYLOAD_BINDING").passportJson,
      ),
      transferPassport,
    );
    await expect(verifyEvidenceSummary(root)).resolves.toMatchObject({
      status: "INVALID",
      evidenceHash: null,
    });
  });

  it("rejects changed passport bytes, commit substitution, and stale dashboard data", async () => {
    const root = await fixtureRoot();
    await generateEvidenceSummary(root);
    const payloadPath = resolve(
      root,
      invariantEvidencePaths("IDEMPOTENCY_KEY_PAYLOAD_BINDING").passportJson,
    );
    const originalPayload = await readFile(payloadPath, "utf8");
    await writeFile(payloadPath, `${originalPayload} `, "utf8");
    await expect(verifyEvidenceSummary(root)).resolves.toMatchObject({
      status: "INVALID",
    });

    await atomicWriteJson(
      payloadPath,
      passport("IDEMPOTENCY_KEY_PAYLOAD_BINDING", {
        commit: "b".repeat(40),
      }),
    );
    await expect(verifyEvidenceSummary(root)).resolves.toMatchObject({
      status: "INVALID",
    });

    await atomicWriteJson(
      payloadPath,
      passport("IDEMPOTENCY_KEY_PAYLOAD_BINDING"),
    );
    await generateEvidenceSummary(root);
    const staleDashboard = await readFile(
      resolve(root, EVIDENCE_DASHBOARD_DATA_PATH),
      "utf8",
    );
    await atomicWriteJson(
      payloadPath,
      passport("IDEMPOTENCY_KEY_PAYLOAD_BINDING", {
        generatedAt: "2026-07-20T10:01:00.000Z",
      }),
    );
    await generateEvidenceSummary(root);
    await writeFile(
      resolve(root, EVIDENCE_DASHBOARD_DATA_PATH),
      staleDashboard,
      "utf8",
    );
    const staleResult = await verifyEvidenceSummary(root);
    expect(staleResult.status).toBe("INVALID");
    expect(staleResult.error).toMatch(/stale|substituted/u);
  });
});
