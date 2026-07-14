import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

import { createVulnerableWalletApi } from "../../../examples/vulnerable-wallet-api/src/index.js";
import { createWalletApi } from "../../core/src/index.js";
import {
  createFastifyInjectTarget,
  replayScenario,
  runTransferIdempotencyAttack,
  type ScenarioRun,
} from "../../scenario-engine/src/index.js";
import {
  verifyTransferIdempotencyScenario,
  type TransferIdempotencyVerification,
} from "../../verification-engine/src/index.js";

export type ProofTarget = "vulnerable" | "fixed";

export interface ProofLoopRun {
  readonly target: ProofTarget;
  readonly scenario: ScenarioRun;
  readonly verification: TransferIdempotencyVerification;
  readonly durationMs: number;
}

async function databasePath(
  repositoryRoot: string,
  target: ProofTarget,
): Promise<string> {
  const runtimeDirectory = resolve(repositoryRoot, "reports", "runtime");
  await mkdir(runtimeDirectory, { recursive: true });
  return resolve(runtimeDirectory, `${target}-wallet.sqlite`);
}

export async function runProofLoop(
  repositoryRoot: string,
  target: ProofTarget,
  recordedScenario?: ScenarioRun,
): Promise<ProofLoopRun> {
  const started = performance.now();
  const path = await databasePath(repositoryRoot, target);
  const app =
    target === "vulnerable"
      ? createVulnerableWalletApi({ databasePath: path })
      : createWalletApi({ databasePath: path });

  try {
    const scenarioTarget = createFastifyInjectTarget(
      app,
      `${target}-wallet-api`,
    );
    const scenario =
      recordedScenario === undefined
        ? await runTransferIdempotencyAttack(scenarioTarget)
        : await replayScenario(recordedScenario, scenarioTarget);
    return {
      target,
      scenario,
      verification: verifyTransferIdempotencyScenario(scenario),
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    };
  } finally {
    await app.close();
  }
}
