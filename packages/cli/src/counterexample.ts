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
  atomicWriteJson,
  canonicalizeJson,
  readGitMetadata,
  type JsonObject,
  type JsonValue,
} from "../../shared/src/index.js";
import type { TransferIdempotencyVerification } from "../../verification-engine/src/index.js";

export const COUNTEREXAMPLE_PATH = "evidence/counterexample.json" as const;

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
  "READ_BALANCES",
  "READ_LEDGER",
]);

export function scenarioRunFromCounterexample(
  counterexample: Counterexample,
): ScenarioRun {
  if (counterexample.invariant.id !== "TRANSFER_IDEMPOTENCY") {
    throw new Error(
      `Unsupported recorded invariant: ${counterexample.invariant.id}`,
    );
  }
  if (counterexample.scenario.id !== "transfer-timeout-after-commit-retry") {
    throw new Error(
      `Unsupported recorded scenario: ${counterexample.scenario.id}`,
    );
  }
  if (
    counterexample.scenario.deterministicSeed !==
    "qedra-transfer-idempotency-seed-v1"
  ) {
    throw new Error(
      `Unsupported deterministic seed: ${counterexample.scenario.deterministicSeed}`,
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

  return {
    schemaVersion: "qedra.scenario-run.v1",
    invariantId: "TRANSFER_IDEMPOTENCY",
    invariantStatement: counterexample.invariant.statement,
    scenarioId: counterexample.scenario.id,
    deterministicSeed: counterexample.scenario.deterministicSeed,
    targetId: counterexample.scenario.targetId,
    attackRequestHash: counterexample.scenario.attackRequestHash,
    events,
  };
}
