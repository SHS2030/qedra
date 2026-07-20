import { initConstitution } from "../../constitution/src/index.js";
import type { Counterexample } from "../../proof-passport/src/index.js";

import { buildCounterexample, writeCounterexample } from "./counterexample.js";
import {
  generatePassport,
  proofSummary,
  type PassportGenerationResult,
} from "./passport.js";
import { runProofLoop } from "./proof-loop.js";
import {
  buildPayloadBindingCounterexample,
  runPayloadBindingProofLoop,
  writePayloadBindingCounterexample,
} from "./payload-binding.js";
import {
  invariantEvidencePaths,
  SUPPORTED_INVARIANT_IDS,
  type SupportedInvariantId,
} from "./evidence-layout.js";
import {
  generateEvidenceSummary,
  verifyEvidenceSummary,
} from "./evidence-summary.js";
import {
  executeLiveRepair,
  executeRecordedRepair,
  type RepairExecution,
} from "./repair.js";

export interface DemoResult {
  readonly schemaVersion: "1.0.0";
  readonly status: "PASSED" | "BLOCKED";
  readonly mode: "record-replay" | "live";
  readonly invariantId: SupportedInvariantId;
  readonly attack: Readonly<Record<string, unknown>>;
  readonly repair: Readonly<Record<string, unknown>>;
  readonly replay: Readonly<Record<string, unknown>> | null;
  readonly verification: Readonly<Record<string, unknown>> | null;
  readonly artifacts: Readonly<Record<string, string>>;
  readonly humanApprovalRequired: true;
  readonly durationMs: number;
}

export interface AllDemoResult {
  readonly schemaVersion: "1.0.0";
  readonly status: "PASSED" | "BLOCKED";
  readonly mode: "record-replay" | "live";
  readonly laws: readonly DemoResult[];
  readonly summary: Readonly<Record<string, unknown>> | null;
  readonly artifacts: Readonly<Record<string, string>>;
  readonly humanApprovalRequired: true;
  readonly durationMs: number;
}

function assertExpectedVulnerableState(counterexample: Counterexample): void {
  const actual = counterexample.actualState;
  const balances = actual.balances;
  if (counterexample.invariant.id === "IDEMPOTENCY_KEY_PAYLOAD_BINDING") {
    if (
      balances === null ||
      typeof balances !== "object" ||
      Array.isArray(balances) ||
      balances.A !== 9_000 ||
      balances.B !== 6_000 ||
      balances.C !== 2_000 ||
      actual.ledgerEntries !== 2 ||
      actual.amountConflictStatus !== 200 ||
      actual.destinationConflictStatus !== 200 ||
      actual.sourceConflictStatus !== 200
    ) {
      throw new Error(
        "The payload-blind fixture did not reproduce the canonical counterexample.",
      );
    }
    return;
  }
  if (
    balances === null ||
    typeof balances !== "object" ||
    Array.isArray(balances) ||
    balances.A !== 8_000 ||
    balances.B !== 7_000 ||
    actual.debitEntries !== 2 ||
    actual.creditEntries !== 2
  ) {
    throw new Error(
      "The vulnerable fixture did not reproduce the canonical counterexample.",
    );
  }
}

function repairSummary(
  execution: RepairExecution,
): Readonly<Record<string, unknown>> {
  return {
    status: execution.result.status,
    attempts: execution.result.attempts.length,
    changedFiles: execution.result.changedFiles ?? [],
    validationsPassed:
      (execution.result.validationResults?.length ?? 0) > 0 &&
      (execution.result.validationResults ?? []).every(
        (validation) => validation.passed,
      ),
    blocker: execution.result.blocker?.message ?? null,
    committed: execution.result.committed,
    merged: execution.result.merged,
    humanApprovalRequired: execution.result.humanApprovalRequired,
  };
}

function passedDemo(
  durationMs: number,
  counterexample: Counterexample,
  execution: RepairExecution,
  bundle: PassportGenerationResult,
): DemoResult {
  if (
    counterexample.invariant.id !== "TRANSFER_IDEMPOTENCY" &&
    counterexample.invariant.id !== "IDEMPOTENCY_KEY_PAYLOAD_BINDING"
  ) {
    throw new Error("Unsupported demo invariant.");
  }
  const invariantId = counterexample.invariant.id;
  const paths = invariantEvidencePaths(invariantId);
  return {
    schemaVersion: "1.0.0",
    status: "PASSED",
    mode: execution.request.mode,
    invariantId,
    attack: {
      status: "FAILED_AS_EXPECTED",
      evidenceHash: counterexample.evidenceHash,
      ...counterexample.actualState,
    },
    repair: repairSummary(execution),
    replay: proofSummary(bundle.replay.verification),
    verification: proofSummary(bundle.verification.verification),
    artifacts: {
      counterexample: paths.counterexample,
      passportJson: paths.passportJson,
      passportHtml: paths.passportHtml,
      dashboard: bundle.paths.dashboard,
      ...(bundle.paths.liveRepairBlocker === null
        ? {}
        : { liveRepairBlocker: paths.liveRepairBlocker }),
    },
    humanApprovalRequired: true,
    durationMs,
  };
}

export async function runDemo(
  repositoryRoot: string,
  mode: "record-replay" | "live" = "record-replay",
  signal?: AbortSignal,
  invariantId: SupportedInvariantId = "TRANSFER_IDEMPOTENCY",
): Promise<DemoResult> {
  const started = performance.now();
  await initConstitution(repositoryRoot);
  let counterexample: Counterexample;
  if (invariantId === "TRANSFER_IDEMPOTENCY") {
    const attack = await runProofLoop(repositoryRoot, "vulnerable");
    if (attack.verification.passed) {
      throw new Error(
        "The deliberately vulnerable fixture unexpectedly passed.",
      );
    }
    counterexample = await buildCounterexample(
      repositoryRoot,
      attack.scenario,
      attack.verification,
    );
  } else {
    const attack = await runPayloadBindingProofLoop(
      repositoryRoot,
      "vulnerable",
    );
    if (attack.verification.passed) {
      throw new Error(
        "The deliberately payload-blind fixture unexpectedly passed.",
      );
    }
    counterexample = await buildPayloadBindingCounterexample(
      repositoryRoot,
      attack,
    );
  }
  assertExpectedVulnerableState(counterexample);
  if (invariantId === "TRANSFER_IDEMPOTENCY") {
    await writeCounterexample(repositoryRoot, counterexample);
  } else {
    await writePayloadBindingCounterexample(repositoryRoot, counterexample);
  }

  const execution =
    mode === "live"
      ? await executeLiveRepair(repositoryRoot, counterexample, signal)
      : await executeRecordedRepair(repositoryRoot, counterexample, signal);
  if (execution.result.status === "AUTHENTICATION_REQUIRED") {
    return {
      schemaVersion: "1.0.0",
      status: "BLOCKED",
      mode,
      invariantId,
      attack: {
        status: "FAILED_AS_EXPECTED",
        evidenceHash: counterexample.evidenceHash,
      },
      repair: repairSummary(execution),
      replay: null,
      verification: null,
      artifacts: {
        counterexample: invariantEvidencePaths(invariantId).counterexample,
        repairRequest: invariantEvidencePaths(invariantId).repairRequest,
        repairReport: invariantEvidencePaths(invariantId).repairReport,
      },
      humanApprovalRequired: true,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    };
  }
  if (execution.result.status !== "SUCCEEDED") {
    throw new Error(
      `The isolated repair workflow failed with ${execution.result.status}.`,
    );
  }

  const elapsedBeforePassport =
    Math.round((performance.now() - started) * 1000) / 1000;
  const bundle = await generatePassport(
    repositoryRoot,
    counterexample,
    execution,
    elapsedBeforePassport,
  );
  if (bundle.bundleVerification.status !== "VERIFIED") {
    throw new Error("The generated evidence bundle failed verification.");
  }
  const durationMs = Math.round((performance.now() - started) * 1000) / 1000;
  return passedDemo(durationMs, counterexample, execution, bundle);
}

export async function runAllDemos(
  repositoryRoot: string,
  mode: "record-replay" | "live" = "record-replay",
  signal?: AbortSignal,
): Promise<AllDemoResult> {
  const started = performance.now();
  const laws: DemoResult[] = [];
  for (const invariantId of SUPPORTED_INVARIANT_IDS) {
    laws.push(await runDemo(repositoryRoot, mode, signal, invariantId));
  }
  if (laws.some((law) => law.status !== "PASSED")) {
    return {
      schemaVersion: "1.0.0",
      status: "BLOCKED",
      mode,
      laws,
      summary: null,
      artifacts: {},
      humanApprovalRequired: true,
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    };
  }
  const generated = await generateEvidenceSummary(repositoryRoot);
  const verification = await verifyEvidenceSummary(repositoryRoot);
  if (verification.status !== "VERIFIED") {
    throw new Error(
      `The aggregate evidence summary is invalid: ${verification.error ?? "unknown error"}`,
    );
  }
  return {
    schemaVersion: "1.0.0",
    status: "PASSED",
    mode,
    laws,
    summary: {
      status: verification.status,
      evidenceHash: generated.summary.evidenceHash,
      repositoryCommit: verification.repositoryCommit,
      invariantIds: verification.invariantIds,
    },
    artifacts: generated.paths,
    humanApprovalRequired: true,
    durationMs: Math.round((performance.now() - started) * 1000) / 1000,
  };
}
