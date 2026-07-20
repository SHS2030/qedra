import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../packages/shared/src/index.js", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../packages/shared/src/index.js")>();
  return {
    ...actual,
    readGitMetadata: async (repositoryRoot: string) => ({
      repositoryRoot: resolve(repositoryRoot),
      commit: "a".repeat(40),
      branch: "hardening/hackathon-final",
      dirty: false,
      remoteUrl: "https://github.com/example/qedra.git",
    }),
  };
});

import {
  SUPPORTED_INVARIANT_IDS,
  invariantEvidencePaths,
  type InvariantEvidencePaths,
  type SupportedInvariantId,
} from "../../packages/cli/src/evidence-layout.js";
import {
  LIVE_REPAIR_DIFF_PATH,
  LIVE_REPAIR_REPORT_PATH,
  LIVE_REPAIR_REQUEST_PATH,
  RECORDED_CHANGE_SET_PATH,
  REPAIR_DIFF_PATH,
  REPAIR_REPORT_PATH,
  REPAIR_REQUEST_PATH,
  buildRepairRequest,
  repairArtifactPaths,
} from "../../packages/cli/src/repair.js";
import {
  createCounterexample,
  type Counterexample,
} from "../../packages/proof-passport/src/index.js";
import {
  isSafeRepositoryRelativePath,
  sha256Hex,
} from "../../packages/shared/src/index.js";

const COMMIT = "a".repeat(40);
const CREATED_AT = "2026-07-20T10:00:00.000Z";
const temporaryRoots: string[] = [];

const PROFILE_EXPECTATIONS = {
  TRANSFER_IDEMPOTENCY: {
    requestId: "REPAIR-TRANSFER-IDEMPOTENCY-001",
    scenarioId: "transfer-timeout-after-commit-retry",
    deterministicSeed: "qedra-transfer-idempotency-seed-v1",
    targetId: "vulnerable-wallet-api",
    validationNeedle:
      "examples/vulnerable-wallet-api/tests/transfer-idempotency.regression.test.ts",
    otherValidationNeedle:
      "examples/vulnerable-wallet-api/tests/idempotency-key-payload-binding.regression.test.ts",
    affectedFiles: [
      "examples/vulnerable-wallet-api/src/vulnerable-wallet-store.ts",
      "examples/vulnerable-wallet-api/tests/transfer-idempotency.regression.test.ts",
    ],
  },
  IDEMPOTENCY_KEY_PAYLOAD_BINDING: {
    requestId: "REPAIR-IDEMPOTENCY-KEY-PAYLOAD-BINDING-001",
    scenarioId: "idempotency-key-payload-conflict",
    deterministicSeed: "qedra-idempotency-key-payload-binding-seed-v1",
    targetId: "vulnerable-payload-binding-wallet-api",
    validationNeedle:
      "examples/vulnerable-wallet-api/tests/idempotency-key-payload-binding.regression.test.ts",
    otherValidationNeedle:
      "examples/vulnerable-wallet-api/tests/transfer-idempotency.regression.test.ts",
    affectedFiles: [
      "examples/vulnerable-wallet-api/src/payload-blind-wallet-store.ts",
      "examples/vulnerable-wallet-api/tests/idempotency-key-payload-binding.regression.test.ts",
    ],
  },
} as const;

type Fixture = {
  readonly root: string;
  readonly counterexamples: Readonly<
    Record<SupportedInvariantId, Counterexample>
  >;
};

function statement(invariantId: SupportedInvariantId): string {
  return invariantId === "TRANSFER_IDEMPOTENCY"
    ? "The same transfer request must never debit a wallet more than once."
    : "The same idempotency key must never be accepted for two semantically different transfer requests.";
}

function counterexample(invariantId: SupportedInvariantId): Counterexample {
  const profile = PROFILE_EXPECTATIONS[invariantId];
  return createCounterexample({
    schemaVersion: "1.0.0",
    kind: "qedra.counterexample",
    generatedAt: CREATED_AT,
    invariant: { id: invariantId, statement: statement(invariantId) },
    scenario: {
      id: profile.scenarioId,
      deterministicSeed: profile.deterministicSeed,
      targetId: profile.targetId,
      attackRequestHash: sha256Hex(`${invariantId}-attack`),
    },
    events: [
      {
        sequence: 0,
        type: "TRANSFER_RETRY",
        requestId: "TX-001",
        occurredAt: null,
        data: { fixture: invariantId },
      },
    ],
    expectedState: { acceptedTransfers: 1 },
    actualState: { acceptedTransfers: 2 },
    ledgerEntries: [],
    affectedFiles: [...profile.affectedFiles],
    reproductionCommand: `qedra attack ${invariantId} --target vulnerable --json`,
    repository: {
      commit: COMMIT,
      branch: "hardening/hackathon-final",
      dirty: true,
      remoteUrl: "https://github.com/example/qedra.git",
    },
  });
}

async function writeCounterexampleArtifact(
  root: string,
  invariantId: SupportedInvariantId,
  value: Counterexample,
): Promise<void> {
  const path = resolve(
    root,
    invariantEvidencePaths(invariantId).counterexample,
  );
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), "qedra-multi-invariant-repair-"));
  temporaryRoots.push(root);
  const counterexamples = {
    TRANSFER_IDEMPOTENCY: counterexample("TRANSFER_IDEMPOTENCY"),
    IDEMPOTENCY_KEY_PAYLOAD_BINDING: counterexample(
      "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
    ),
  };
  await Promise.all(
    SUPPORTED_INVARIANT_IDS.map(async (invariantId) => {
      await writeCounterexampleArtifact(
        root,
        invariantId,
        counterexamples[invariantId],
      );
    }),
  );
  return { root, counterexamples };
}

function everyLayoutPath(paths: InvariantEvidencePaths): readonly string[] {
  return Object.values(paths);
}

function expectSafePath(path: string): void {
  expect(isSafeRepositoryRelativePath(path), path).toBe(true);
  expect(path.replaceAll("\\", "/").split("/"), path).not.toContain("..");
  expect(path, path).not.toMatch(/(?:^|\/)\.git(?:\/|$)/u);
}

afterEach(async () => {
  vi.clearAllMocks();
  await Promise.all(
    temporaryRoots.splice(0).map(async (root) => {
      await rm(root, { recursive: true, force: true });
    }),
  );
});

describe("multi-invariant repair profiles", () => {
  it("assigns disjoint safe artifact and worktree paths to each financial law", () => {
    const transfer = invariantEvidencePaths("TRANSFER_IDEMPOTENCY");
    const payload = invariantEvidencePaths("IDEMPOTENCY_KEY_PAYLOAD_BINDING");
    const transferPaths = everyLayoutPath(transfer);
    const payloadPaths = everyLayoutPath(payload);

    expect(new Set(transferPaths).size).toBe(transferPaths.length);
    expect(new Set(payloadPaths).size).toBe(payloadPaths.length);
    expect(transferPaths.filter((path) => payloadPaths.includes(path))).toEqual(
      [],
    );
    for (const path of [...transferPaths, ...payloadPaths]) {
      expectSafePath(path);
    }

    expect(
      repairArtifactPaths("record-replay", "TRANSFER_IDEMPOTENCY"),
    ).toEqual({
      request: transfer.repairRequest,
      report: transfer.repairReport,
      diff: transfer.repairDiff,
    });
    expect(
      repairArtifactPaths("record-replay", "IDEMPOTENCY_KEY_PAYLOAD_BINDING"),
    ).toEqual({
      request: payload.repairRequest,
      report: payload.repairReport,
      diff: payload.repairDiff,
    });
    expect(repairArtifactPaths("live", "TRANSFER_IDEMPOTENCY")).toEqual({
      request: transfer.liveRepairRequest,
      report: transfer.liveRepairReport,
      diff: transfer.liveRepairDiff,
    });
    expect(
      repairArtifactPaths("live", "IDEMPOTENCY_KEY_PAYLOAD_BINDING"),
    ).toEqual({
      request: payload.liveRepairRequest,
      report: payload.liveRepairReport,
      diff: payload.liveRepairDiff,
    });
  });

  it("keeps the legacy first-law constants scoped away from second-law artifacts", () => {
    const transfer = invariantEvidencePaths("TRANSFER_IDEMPOTENCY");
    const payload = invariantEvidencePaths("IDEMPOTENCY_KEY_PAYLOAD_BINDING");
    const legacyPaths = [
      REPAIR_REQUEST_PATH,
      REPAIR_REPORT_PATH,
      REPAIR_DIFF_PATH,
      LIVE_REPAIR_REQUEST_PATH,
      LIVE_REPAIR_REPORT_PATH,
      LIVE_REPAIR_DIFF_PATH,
      RECORDED_CHANGE_SET_PATH,
    ];

    expect(legacyPaths).toEqual([
      transfer.repairRequest,
      transfer.repairReport,
      transfer.repairDiff,
      transfer.liveRepairRequest,
      transfer.liveRepairReport,
      transfer.liveRepairDiff,
      transfer.recordedChangeSet,
    ]);
    expect(
      legacyPaths.some((path) => everyLayoutPath(payload).includes(path)),
    ).toBe(false);
  });

  it.each(SUPPORTED_INVARIANT_IDS)(
    "binds the %s repair request to its own counterexample and validation profile",
    async (invariantId) => {
      const { root, counterexamples } = await fixture();
      const profile = PROFILE_EXPECTATIONS[invariantId];
      const paths = invariantEvidencePaths(invariantId);
      const artifactBytes = await readFile(resolve(root, paths.counterexample));
      const request = await buildRepairRequest(
        root,
        counterexamples[invariantId],
        "record-replay",
        CREATED_AT,
      );

      expect(request).toMatchObject({
        requestId: profile.requestId,
        mode: "record-replay",
        invariant: counterexamples[invariantId].invariant,
        scenario: {
          id: profile.scenarioId,
          deterministicSeed: profile.deterministicSeed,
          counterexampleArtifactPath: paths.counterexample,
          counterexampleSha256: sha256Hex(artifactBytes),
          reproductionCommand: counterexamples[invariantId].reproductionCommand,
        },
        repository: {
          path: root,
          baseRef: COMMIT,
          baseCommit: COMMIT,
          isolatedWorktreePath: resolve(root, paths.worktree),
          affectedFiles: profile.affectedFiles,
        },
        createdAt: CREATED_AT,
        humanApprovalRequired: true,
      });
      expect(request.validationCommands.map(({ id }) => id)).toEqual([
        "non-regression-test",
        "exact-attack-replay",
      ]);
      const validationText = request.validationCommands
        .flatMap(({ args }) => args)
        .join(" ");
      expect(validationText).toContain(profile.validationNeedle);
      expect(validationText).not.toContain(profile.otherValidationNeedle);
      request.repository.affectedFiles.forEach(expectSafePath);
      expectSafePath(paths.worktree);
    },
  );

  it("rejects an unsupported invariant before selecting any repair profile", async () => {
    const { root, counterexamples } = await fixture();
    const unsupported = structuredClone(
      counterexamples.TRANSFER_IDEMPOTENCY,
    ) as Counterexample;
    Object.assign(unsupported.invariant, { id: "TRANSFER_ATOMICITY" });

    await expect(
      buildRepairRequest(root, unsupported, "record-replay", CREATED_AT),
    ).rejects.toThrow("Unsupported repair invariant: TRANSFER_ATOMICITY");
  });

  it("rejects a cross-invariant counterexample substitution", async () => {
    const { root, counterexamples } = await fixture();
    await writeCounterexampleArtifact(
      root,
      "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
      counterexamples.TRANSFER_IDEMPOTENCY,
    );

    await expect(
      buildRepairRequest(
        root,
        counterexamples.IDEMPOTENCY_KEY_PAYLOAD_BINDING,
        "record-replay",
        CREATED_AT,
      ),
    ).rejects.toThrow(/counterexample|invariant|substitut|match/iu);
  });
});
