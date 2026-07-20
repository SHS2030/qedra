import { mkdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { createPayloadBlindWalletApi } from "../../../examples/vulnerable-wallet-api/src/index.js";
import { createWalletApi } from "../../core/src/index.js";
import {
  createCounterexample,
  parseAndVerifyCounterexample,
  type Counterexample,
} from "../../proof-passport/src/index.js";
import {
  createFastifyInjectTarget,
  replayIdempotencyKeyPayloadBindingScenario,
  runIdempotencyKeyPayloadBindingAttack,
  runIdempotencyKeyPayloadBindingVerification,
  type ScenarioRun,
} from "../../scenario-engine/src/index.js";
import {
  atomicWriteJson,
  canonicalizeJson,
  readGitMetadata,
  type JsonObject,
  type JsonValue,
} from "../../shared/src/index.js";
import {
  verifyIdempotencyKeyPayloadBindingScenario,
  type IdempotencyKeyPayloadBindingVerification,
} from "../../verification-engine/src/index.js";

import { scenarioRunFromCounterexample } from "./counterexample.js";
import { invariantEvidencePaths } from "./evidence-layout.js";
import type { ProofTarget } from "./proof-loop.js";

const PAYLOAD_BINDING_PATHS = invariantEvidencePaths(
  "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
);
export const PAYLOAD_BINDING_EVIDENCE_DIRECTORY =
  PAYLOAD_BINDING_PATHS.directory;
export const PAYLOAD_BINDING_COUNTEREXAMPLE_PATH =
  PAYLOAD_BINDING_PATHS.counterexample;

export interface PayloadBindingProofLoopRun {
  readonly target: ProofTarget;
  readonly scenario: ScenarioRun;
  readonly verification: IdempotencyKeyPayloadBindingVerification;
  readonly durationMs: number;
}

async function databasePath(
  repositoryRoot: string,
  target: ProofTarget,
): Promise<string> {
  const directory = resolve(repositoryRoot, "reports", "runtime");
  await mkdir(directory, { recursive: true });
  return resolve(directory, `${target}-payload-binding-wallet.sqlite`);
}

export async function runPayloadBindingProofLoop(
  repositoryRoot: string,
  target: ProofTarget,
  recordedScenario?: ScenarioRun,
): Promise<PayloadBindingProofLoopRun> {
  const started = performance.now();
  const path = await databasePath(repositoryRoot, target);
  const app =
    target === "vulnerable"
      ? createPayloadBlindWalletApi({ databasePath: path })
      : createWalletApi({ databasePath: path });
  try {
    const scenarioTarget = createFastifyInjectTarget(
      app,
      `${target}-payload-binding-wallet-api`,
    );
    const scenario =
      recordedScenario === undefined
        ? target === "vulnerable"
          ? await runIdempotencyKeyPayloadBindingAttack(scenarioTarget)
          : await runIdempotencyKeyPayloadBindingVerification(scenarioTarget)
        : await replayIdempotencyKeyPayloadBindingScenario(
            recordedScenario,
            scenarioTarget,
          );
    return {
      target,
      scenario,
      verification: verifyIdempotencyKeyPayloadBindingScenario(scenario),
      durationMs: Math.round((performance.now() - started) * 1000) / 1000,
    };
  } finally {
    await app.close();
  }
}

function jsonObject(value: unknown): JsonObject {
  const normalized: JsonValue = canonicalizeJson(value);
  if (
    normalized === null ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    throw new TypeError("Expected payload-binding evidence to be an object.");
  }
  return normalized;
}

function requestIdFromEvent(run: ScenarioRun, index: number): string | null {
  const body = run.events[index]?.request.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  return typeof body.requestId === "string" ? body.requestId : null;
}

export async function buildPayloadBindingCounterexample(
  repositoryRoot: string,
  run: PayloadBindingProofLoopRun,
  generatedAt = new Date().toISOString(),
): Promise<Counterexample> {
  if (run.verification.passed) {
    throw new Error("A passing payload-binding run is not a counterexample.");
  }
  const git = await readGitMetadata(repositoryRoot);
  return createCounterexample({
    schemaVersion: "1.0.0",
    kind: "qedra.counterexample",
    generatedAt,
    invariant: {
      id: run.verification.invariantId,
      statement: run.verification.invariantStatement,
    },
    scenario: {
      id: run.scenario.scenarioId,
      deterministicSeed: run.scenario.deterministicSeed,
      targetId: run.scenario.targetId,
      attackRequestHash: run.scenario.attackRequestHash,
    },
    events: run.scenario.events.map((event, index) => ({
      sequence: index,
      type: event.name,
      requestId: requestIdFromEvent(run.scenario, index),
      occurredAt: null,
      data: jsonObject({
        expectedStatusCode: event.expectedStatusCode,
        request: event.request,
        response: event.response,
      }),
    })),
    expectedState: jsonObject(run.verification.expected),
    actualState: jsonObject(run.verification.actual),
    ledgerEntries: [],
    affectedFiles: [
      "examples/vulnerable-wallet-api/src/payload-blind-wallet-store.ts",
      "packages/core/src/financial-payload.ts",
      "packages/core/src/wallet-store.ts",
      "packages/scenario-engine/src/idempotency-key-payload-binding-scenario.ts",
      "packages/verification-engine/src/idempotency-key-payload-binding.ts",
    ],
    reproductionCommand:
      "node --import tsx packages/cli/src/bin.ts attack IDEMPOTENCY_KEY_PAYLOAD_BINDING --target vulnerable --json",
    repository: {
      commit: git.commit,
      branch: git.branch,
      dirty: git.dirty,
      remoteUrl: git.remoteUrl,
    },
  });
}

export async function writePayloadBindingCounterexample(
  repositoryRoot: string,
  counterexample: Counterexample,
): Promise<void> {
  await atomicWriteJson(
    resolve(repositoryRoot, PAYLOAD_BINDING_COUNTEREXAMPLE_PATH),
    counterexample,
  );
}

export async function readPayloadBindingCounterexample(
  repositoryRoot: string,
): Promise<Counterexample> {
  const source = await readFile(
    resolve(repositoryRoot, PAYLOAD_BINDING_COUNTEREXAMPLE_PATH),
    "utf8",
  );
  const counterexample = parseAndVerifyCounterexample(
    JSON.parse(source) as unknown,
  );
  const scenario = scenarioRunFromCounterexample(counterexample);
  if (scenario.invariantId !== "IDEMPOTENCY_KEY_PAYLOAD_BINDING") {
    throw new Error("Stored counterexample belongs to a different law.");
  }
  return counterexample;
}
