import { initConstitution } from "../../constitution/src/index.js";
import type { Counterexample } from "../../proof-passport/src/index.js";

import {
  buildCounterexample,
  COUNTEREXAMPLE_PATH,
  writeCounterexample,
} from "./counterexample.js";
import {
  generatePassport,
  LIVE_REPAIR_BLOCKER_PATH,
  PASSPORT_HTML_PATH,
  PASSPORT_JSON_PATH,
  proofSummary,
  type PassportGenerationResult,
} from "./passport.js";
import { runProofLoop } from "./proof-loop.js";
import {
  executeLiveRepair,
  executeRecordedRepair,
  type RepairExecution,
} from "./repair.js";

export interface DemoResult {
  readonly schemaVersion: "1.0.0";
  readonly status: "PASSED" | "BLOCKED";
  readonly mode: "record-replay" | "live";
  readonly invariantId: "TRANSFER_IDEMPOTENCY";
  readonly attack: Readonly<Record<string, unknown>>;
  readonly repair: Readonly<Record<string, unknown>>;
  readonly replay: Readonly<Record<string, unknown>> | null;
  readonly verification: Readonly<Record<string, unknown>> | null;
  readonly artifacts: Readonly<Record<string, string>>;
  readonly humanApprovalRequired: true;
  readonly durationMs: number;
}

function assertExpectedVulnerableState(counterexample: Counterexample): void {
  const actual = counterexample.actualState;
  const balances = actual.balances;
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
  return {
    schemaVersion: "1.0.0",
    status: "PASSED",
    mode: execution.request.mode,
    invariantId: "TRANSFER_IDEMPOTENCY",
    attack: {
      status: "FAILED_AS_EXPECTED",
      evidenceHash: counterexample.evidenceHash,
      balances: counterexample.actualState.balances,
      debitEntries: counterexample.actualState.debitEntries,
      creditEntries: counterexample.actualState.creditEntries,
    },
    repair: repairSummary(execution),
    replay: proofSummary(bundle.replay.verification),
    verification: proofSummary(bundle.verification.verification),
    artifacts: {
      counterexample: COUNTEREXAMPLE_PATH,
      passportJson: PASSPORT_JSON_PATH,
      passportHtml: PASSPORT_HTML_PATH,
      dashboard: bundle.paths.dashboard,
      ...(bundle.paths.liveRepairBlocker === null
        ? {}
        : { liveRepairBlocker: LIVE_REPAIR_BLOCKER_PATH }),
    },
    humanApprovalRequired: true,
    durationMs,
  };
}

export async function runDemo(
  repositoryRoot: string,
  mode: "record-replay" | "live" = "record-replay",
  signal?: AbortSignal,
): Promise<DemoResult> {
  const started = performance.now();
  await initConstitution(repositoryRoot);
  const attack = await runProofLoop(repositoryRoot, "vulnerable");
  if (attack.verification.passed) {
    throw new Error("The deliberately vulnerable fixture unexpectedly passed.");
  }
  const counterexample = await buildCounterexample(
    repositoryRoot,
    attack.scenario,
    attack.verification,
  );
  assertExpectedVulnerableState(counterexample);
  await writeCounterexample(repositoryRoot, counterexample);

  const execution =
    mode === "live"
      ? await executeLiveRepair(repositoryRoot, counterexample, signal)
      : await executeRecordedRepair(repositoryRoot, counterexample, signal);
  if (execution.result.status === "AUTHENTICATION_REQUIRED") {
    return {
      schemaVersion: "1.0.0",
      status: "BLOCKED",
      mode,
      invariantId: "TRANSFER_IDEMPOTENCY",
      attack: {
        status: "FAILED_AS_EXPECTED",
        evidenceHash: counterexample.evidenceHash,
      },
      repair: repairSummary(execution),
      replay: null,
      verification: null,
      artifacts: {
        counterexample: COUNTEREXAMPLE_PATH,
        repairRequest: "evidence/repair-request.json",
        repairReport: "evidence/repair-report.json",
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
