import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  createCounterexample,
  parseAndVerifyCounterexample,
  type Counterexample,
} from "../../proof-passport/src/index.js";
import type {
  ScenarioEvent,
  ScenarioHttpRequest,
  ScenarioHttpResponse,
  ScenarioRun,
} from "../../scenario-engine/src/index.js";
import {
  attackRequestHash,
  canonicalJson,
  IDEMPOTENCY_KEY_PAYLOAD_BINDING_ATTACK,
  TRANSFER_IDEMPOTENCY_ATTACK,
} from "../../scenario-engine/src/index.js";
import {
  atomicWriteJson,
  canonicalizeJson,
  readGitMetadata,
  type JsonObject,
  type JsonValue,
} from "../../shared/src/index.js";
import type { TransferIdempotencyVerification } from "../../verification-engine/src/index.js";

import { invariantEvidencePaths } from "./evidence-layout.js";

export const COUNTEREXAMPLE_PATH = invariantEvidencePaths(
  "TRANSFER_IDEMPOTENCY",
).counterexample;

function jsonObject(value: unknown): JsonObject {
  const normalized: JsonValue = canonicalizeJson(value);
  if (
    normalized === null ||
    typeof normalized !== "object" ||
    Array.isArray(normalized)
  ) {
    throw new TypeError("Expected evidence data to be a JSON object.");
  }
  return normalized;
}

function requestIdFromEvent(
  event: ScenarioRun["events"][number],
): string | null {
  const body = event.request.body;
  if (body === null || typeof body !== "object" || Array.isArray(body)) {
    return null;
  }
  const requestId = body.requestId;
  return typeof requestId === "string" ? requestId : null;
}

export async function buildCounterexample(
  repositoryRoot: string,
  scenarioRun: ScenarioRun,
  verification: TransferIdempotencyVerification,
  generatedAt = new Date().toISOString(),
): Promise<Counterexample> {
  if (verification.passed) {
    throw new Error(
      "A passing verification cannot be emitted as a counterexample.",
    );
  }

  const git = await readGitMetadata(repositoryRoot);
  return createCounterexample({
    schemaVersion: "1.0.0",
    kind: "qedra.counterexample",
    generatedAt,
    invariant: {
      id: verification.invariantId,
      statement: verification.invariantStatement,
    },
    scenario: {
      id: scenarioRun.scenarioId,
      deterministicSeed: scenarioRun.deterministicSeed,
      targetId: scenarioRun.targetId,
      attackRequestHash: scenarioRun.attackRequestHash,
    },
    events: scenarioRun.events.map((event, index) => ({
      sequence: index,
      type: event.name,
      requestId: requestIdFromEvent(event),
      occurredAt: null,
      data: jsonObject({
        expectedStatusCode: event.expectedStatusCode,
        request: event.request,
        response: event.response,
      }),
    })),
    expectedState: jsonObject(verification.expected),
    actualState: jsonObject(verification.actual),
    ledgerEntries: verification.actual.relevantLedgerEntries.map((entry) =>
      jsonObject(entry),
    ),
    affectedFiles: [
      "examples/vulnerable-wallet-api/src/vulnerable-wallet-store.ts",
      "packages/core/src/wallet-store.ts",
      "packages/scenario-engine/src/transfer-idempotency-scenario.ts",
      "packages/verification-engine/src/transfer-idempotency.ts",
    ],
    reproductionCommand:
      "node --import tsx packages/cli/src/bin.ts attack TRANSFER_IDEMPOTENCY --target vulnerable --json",
    repository: {
      commit: git.commit,
      branch: git.branch,
      dirty: git.dirty,
      remoteUrl: git.remoteUrl,
    },
  });
}

export async function writeCounterexample(
  repositoryRoot: string,
  counterexample: Counterexample,
): Promise<string> {
  const path = resolve(repositoryRoot, COUNTEREXAMPLE_PATH);
  await atomicWriteJson(path, counterexample);
  return path;
}

export async function readCounterexample(
  repositoryRoot: string,
): Promise<Counterexample> {
  const source = await readFile(
    resolve(repositoryRoot, COUNTEREXAMPLE_PATH),
    "utf8",
  );
  return parseAndVerifyCounterexample(JSON.parse(source) as unknown);
}

function stringRecord(
  value: JsonValue | undefined,
  field: string,
): Readonly<Record<string, string>> {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error(`${field} must be an object.`);
  }
  const output: Record<string, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") {
      throw new Error(`${field}.${key} must be a string.`);
    }
    output[key] = item;
  }
  return output;
}

function recordedRequest(value: JsonValue | undefined): ScenarioHttpRequest {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("Recorded request must be an object.");
  }
  const { method, path, headers, body, bodyText } = value;
  if ((method !== "GET" && method !== "POST") || typeof path !== "string") {
    throw new Error("Recorded request has an invalid method or path.");
  }
  if (bodyText !== undefined && typeof bodyText !== "string") {
    throw new Error("Recorded request bodyText must be a string.");
  }
  return {
    method,
    path,
    headers: stringRecord(headers, "request.headers"),
    ...(body === undefined ? {} : { body }),
    ...(bodyText === undefined ? {} : { bodyText }),
  };
}

function recordedResponse(value: JsonValue | undefined): ScenarioHttpResponse {
  if (
    value === null ||
    value === undefined ||
    typeof value !== "object" ||
    Array.isArray(value)
  ) {
    throw new Error("Recorded response must be an object.");
  }
  const { statusCode, headers, body, bodyText } = value;
  if (
    typeof statusCode !== "number" ||
    !Number.isInteger(statusCode) ||
    body === undefined ||
    typeof bodyText !== "string"
  ) {
    throw new Error("Recorded response has an invalid shape.");
  }
  return {
    statusCode,
    headers: stringRecord(headers, "response.headers"),
    body,
    bodyText,
  };
}

const SCENARIO_EVENT_NAMES = new Set<ScenarioEvent["name"]>([
  "RESET",
  "SEED",
  "TRANSFER_TIMEOUT_AFTER_COMMIT",
  "TRANSFER_RETRY",
  "TRANSFER_INITIAL",
  "READ_BALANCES_AFTER_INITIAL_TRANSFER",
  "READ_LEDGER_AFTER_INITIAL_TRANSFER",
  "TRANSFER_DIFFERENT_AMOUNT",
  "TRANSFER_DIFFERENT_DESTINATION",
  "TRANSFER_DIFFERENT_SOURCE",
  "TRANSFER_IDENTICAL_RETRY",
  "READ_BALANCES_AFTER_AMOUNT_CONFLICT",
  "READ_LEDGER_AFTER_AMOUNT_CONFLICT",
  "READ_BALANCES_AFTER_DESTINATION_CONFLICT",
  "READ_LEDGER_AFTER_DESTINATION_CONFLICT",
  "READ_BALANCES_AFTER_SOURCE_CONFLICT",
  "READ_LEDGER_AFTER_SOURCE_CONFLICT",
  "READ_BALANCES",
  "READ_LEDGER",
]);

export function scenarioRunFromCounterexample(
  counterexample: Counterexample,
): ScenarioRun {
  const isTransferIdempotency =
    counterexample.invariant.id === "TRANSFER_IDEMPOTENCY" &&
    counterexample.scenario.id === "transfer-timeout-after-commit-retry" &&
    counterexample.scenario.deterministicSeed ===
      "qedra-transfer-idempotency-seed-v1";
  const isPayloadBinding =
    counterexample.invariant.id === "IDEMPOTENCY_KEY_PAYLOAD_BINDING" &&
    counterexample.scenario.id === "idempotency-key-payload-conflict" &&
    counterexample.scenario.deterministicSeed ===
      "qedra-idempotency-key-payload-binding-seed-v1";
  if (!isTransferIdempotency && !isPayloadBinding) {
    throw new Error(
      `Unsupported recorded invariant: ${counterexample.invariant.id}`,
    );
  }

  const events: ScenarioEvent[] = counterexample.events.map((event, index) => {
    if (!SCENARIO_EVENT_NAMES.has(event.type as ScenarioEvent["name"])) {
      throw new Error(`Unsupported recorded event type: ${event.type}`);
    }
    const expectedStatusCode = event.data.expectedStatusCode;
    if (
      typeof expectedStatusCode !== "number" ||
      !Number.isInteger(expectedStatusCode)
    ) {
      throw new Error("Recorded expectedStatusCode must be an integer.");
    }
    return {
      sequence: index + 1,
      name: event.type as ScenarioEvent["name"],
      expectedStatusCode,
      request: recordedRequest(event.data.request),
      response: recordedResponse(event.data.response),
    };
  });

  const expectedSteps = isTransferIdempotency
    ? TRANSFER_IDEMPOTENCY_ATTACK.steps.map((step) => ({
        name: step.name,
        expectedStatusCode: step.expectedStatusCode,
        request: step.request,
      }))
    : IDEMPOTENCY_KEY_PAYLOAD_BINDING_ATTACK.steps.map((step) => ({
        name: step.name,
        expectedStatusCode: step.expectedStatusCodes.vulnerable,
        request: step.request,
      }));
  const expectedTargetId = isTransferIdempotency
    ? "vulnerable-wallet-api"
    : "vulnerable-payload-binding-wallet-api";
  if (
    counterexample.scenario.targetId !== expectedTargetId ||
    events.length !== expectedSteps.length
  ) {
    throw new Error(
      "Recorded scenario target or event count is not canonical.",
    );
  }
  for (const [index, event] of events.entries()) {
    const expected = expectedSteps[index];
    if (
      expected === undefined ||
      event.sequence !== index + 1 ||
      event.name !== expected.name ||
      event.expectedStatusCode !== expected.expectedStatusCode ||
      canonicalJson(canonicalizeJson(event.request)) !==
        canonicalJson(canonicalizeJson(expected.request))
    ) {
      throw new Error(
        `Recorded scenario event ${String(index + 1)} is not canonical.`,
      );
    }
    if (
      event.request.body !== undefined &&
      event.request.bodyText !== canonicalJson(event.request.body)
    ) {
      throw new Error(
        `Recorded request bodyText ${String(index + 1)} is not canonical.`,
      );
    }
  }
  const requests = events.map((event) => event.request);
  const computedAttackHash = attackRequestHash(requests);
  const canonicalAttackHash = attackRequestHash(
    expectedSteps.map((step) => step.request),
  );
  if (
    computedAttackHash !== counterexample.scenario.attackRequestHash ||
    computedAttackHash !== canonicalAttackHash
  ) {
    throw new Error("Recorded attack request hash is not canonical.");
  }

  return {
    schemaVersion: "qedra.scenario-run.v1",
    invariantId: counterexample.invariant.id as ScenarioRun["invariantId"],
    invariantStatement: counterexample.invariant.statement,
    scenarioId: counterexample.scenario.id,
    deterministicSeed: counterexample.scenario.deterministicSeed,
    targetId: counterexample.scenario.targetId,
    attackRequestHash: counterexample.scenario.attackRequestHash,
    events,
  };
}
