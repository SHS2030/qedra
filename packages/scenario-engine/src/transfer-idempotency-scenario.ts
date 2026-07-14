import { attackRequestHash, canonicalJson } from "./canonical-json.js";
import type {
  JsonObject,
  JsonValue,
  ObservedLedgerEntry,
  ObservedWalletState,
  ScenarioDefinition,
  ScenarioEvent,
  ScenarioHttpRequest,
  ScenarioRun,
  ScenarioTarget,
} from "./types.js";

const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });

function post(path: string, body: JsonValue): ScenarioHttpRequest {
  return {
    method: "POST",
    path,
    headers: JSON_HEADERS,
    body,
    bodyText: canonicalJson(body),
  };
}

function get(path: string): ScenarioHttpRequest {
  return { method: "GET", path, headers: Object.freeze({}) };
}

export const TRANSFER_IDEMPOTENCY_ATTACK: ScenarioDefinition = Object.freeze({
  schemaVersion: "qedra.scenario-definition.v1",
  invariantId: "TRANSFER_IDEMPOTENCY",
  invariantStatement:
    "The same transfer request must never debit a wallet more than once, including after a network timeout, client retry, duplicate callback, or concurrent duplicate request.",
  scenarioId: "transfer-timeout-after-commit-retry",
  deterministicSeed: "qedra-transfer-idempotency-seed-v1",
  steps: Object.freeze([
    Object.freeze({
      name: "RESET",
      expectedStatusCode: 200,
      request: post("/reset", {}),
    }),
    Object.freeze({
      name: "SEED",
      expectedStatusCode: 200,
      request: post("/seed", { wallets: { A: 10_000, B: 5_000 } }),
    }),
    Object.freeze({
      name: "TRANSFER_TIMEOUT_AFTER_COMMIT",
      expectedStatusCode: 504,
      request: post("/transfer", {
        requestId: "TX-001",
        sourceWalletId: "A",
        destinationWalletId: "B",
        amount: 1_000,
        failureMode: "timeout-after-commit",
      }),
    }),
    Object.freeze({
      name: "TRANSFER_RETRY",
      expectedStatusCode: 200,
      request: post("/transfer", {
        requestId: "TX-001",
        sourceWalletId: "A",
        destinationWalletId: "B",
        amount: 1_000,
      }),
    }),
    Object.freeze({
      name: "READ_BALANCES",
      expectedStatusCode: 200,
      request: get("/balances"),
    }),
    Object.freeze({
      name: "READ_LEDGER",
      expectedStatusCode: 200,
      request: get("/ledger?requestId=TX-001"),
    }),
  ]),
});

function cloneRequest(request: ScenarioHttpRequest): ScenarioHttpRequest {
  return structuredClone(request);
}

async function executeRequests(
  definition: ScenarioDefinition,
  requests: readonly ScenarioHttpRequest[],
  target: ScenarioTarget,
): Promise<ScenarioRun> {
  if (requests.length !== definition.steps.length) {
    throw new Error("Scenario request count does not match its definition.");
  }
  const events: ScenarioEvent[] = [];
  for (const [index, step] of definition.steps.entries()) {
    const request = requests[index];
    if (request === undefined) {
      throw new Error(`Missing scenario request at index ${index}.`);
    }
    const response = await target.execute(request);
    events.push({
      sequence: index + 1,
      name: step.name,
      expectedStatusCode: step.expectedStatusCode,
      request: cloneRequest(request),
      response,
    });
  }

  return {
    schemaVersion: "qedra.scenario-run.v1",
    invariantId: definition.invariantId,
    invariantStatement: definition.invariantStatement,
    scenarioId: definition.scenarioId,
    deterministicSeed: definition.deterministicSeed,
    targetId: target.id,
    attackRequestHash: attackRequestHash(requests),
    events,
  };
}

export async function runTransferIdempotencyAttack(
  target: ScenarioTarget,
): Promise<ScenarioRun> {
  const requests = TRANSFER_IDEMPOTENCY_ATTACK.steps.map((step) =>
    cloneRequest(step.request),
  );
  return executeRequests(TRANSFER_IDEMPOTENCY_ATTACK, requests, target);
}

export async function replayScenario(
  recorded: ScenarioRun,
  fixedTarget: ScenarioTarget,
): Promise<ScenarioRun> {
  if (
    recorded.invariantId !== TRANSFER_IDEMPOTENCY_ATTACK.invariantId ||
    recorded.scenarioId !== TRANSFER_IDEMPOTENCY_ATTACK.scenarioId ||
    recorded.deterministicSeed !== TRANSFER_IDEMPOTENCY_ATTACK.deterministicSeed
  ) {
    throw new Error(
      "Recorded artifact is not the supported transfer idempotency scenario.",
    );
  }
  const requests = recorded.events.map((event, index) => {
    if (event.sequence !== index + 1) {
      throw new Error(
        "Recorded scenario events are not in exact contiguous order.",
      );
    }
    const definitionStep = TRANSFER_IDEMPOTENCY_ATTACK.steps[index];
    if (
      definitionStep === undefined ||
      event.name !== definitionStep.name ||
      event.expectedStatusCode !== definitionStep.expectedStatusCode
    ) {
      throw new Error(
        `Recorded scenario event ${index + 1} does not match the attack definition.`,
      );
    }
    return cloneRequest(event.request);
  });
  const recordedHash = attackRequestHash(requests);
  if (recordedHash !== recorded.attackRequestHash) {
    throw new Error(
      "Recorded scenario request hash does not match its HTTP event sequence.",
    );
  }

  const replay = await executeRequests(
    TRANSFER_IDEMPOTENCY_ATTACK,
    requests,
    fixedTarget,
  );
  assertExactRequestReplay(recorded, replay);
  return replay;
}

export function assertExactRequestReplay(
  recorded: ScenarioRun,
  replay: ScenarioRun,
): void {
  if (recorded.attackRequestHash !== replay.attackRequestHash) {
    throw new Error(
      "Replay did not execute the exact recorded HTTP attack sequence.",
    );
  }
  const recordedRequests = recorded.events.map((event) => event.request);
  const replayRequests = replay.events.map((event) => event.request);
  if (
    canonicalJson(recordedRequests as unknown as JsonValue) !==
    canonicalJson(replayRequests as unknown as JsonValue)
  ) {
    throw new Error("Replay HTTP requests differ from the recorded artifact.");
  }
}

function objectValue(value: JsonValue, context: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} response is not a JSON object.`);
  }
  return value;
}

function numberRecord(
  value: JsonValue | undefined,
  context: string,
): Readonly<Record<string, number>> {
  if (value === undefined) {
    throw new Error(`${context} is missing.`);
  }
  const candidate = objectValue(value, context);
  const result: Record<string, number> = {};
  for (const [key, item] of Object.entries(candidate)) {
    if (typeof item !== "number" || !Number.isSafeInteger(item)) {
      throw new Error(`${context}.${key} is not an integer.`);
    }
    result[key] = item;
  }
  return result;
}

function ledgerEntries(
  value: JsonValue | undefined,
): readonly ObservedLedgerEntry[] {
  if (!Array.isArray(value)) {
    throw new Error("Ledger entries response is not an array.");
  }
  return value.map((item, index) => {
    const entry = objectValue(item, `ledger entry ${index}`);
    const { id, requestId, walletId, direction, amount, balanceAfter } = entry;
    if (
      typeof id !== "number" ||
      typeof requestId !== "string" ||
      typeof walletId !== "string" ||
      (direction !== "DEBIT" && direction !== "CREDIT") ||
      typeof amount !== "number" ||
      typeof balanceAfter !== "number"
    ) {
      throw new Error(`Ledger entry ${index} has an invalid shape.`);
    }
    return { id, requestId, walletId, direction, amount, balanceAfter };
  });
}

export function extractWalletState(run: ScenarioRun): ObservedWalletState {
  const balancesEvent = run.events.find(
    (event) => event.name === "READ_BALANCES",
  );
  const ledgerEvent = run.events.find((event) => event.name === "READ_LEDGER");
  if (balancesEvent === undefined || ledgerEvent === undefined) {
    throw new Error(
      "Scenario run does not contain balance and ledger observations.",
    );
  }
  if (
    balancesEvent.response.statusCode !== 200 ||
    ledgerEvent.response.statusCode !== 200
  ) {
    throw new Error("Scenario observation endpoints did not return HTTP 200.");
  }
  const balancesBody = objectValue(balancesEvent.response.body, "balances");
  const ledgerBody = objectValue(ledgerEvent.response.body, "ledger");
  return {
    balances: numberRecord(balancesBody.balances, "balances"),
    ledger: ledgerEntries(ledgerBody.entries),
  };
}
