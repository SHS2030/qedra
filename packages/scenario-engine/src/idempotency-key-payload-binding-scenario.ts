import { attackRequestHash, canonicalJson } from "./canonical-json.js";
import { assertExactRequestReplay } from "./transfer-idempotency-scenario.js";
import type {
  JsonValue,
  ScenarioEvent,
  ScenarioHttpRequest,
  ScenarioRun,
  ScenarioStep,
  ScenarioTarget,
} from "./types.js";

const JSON_HEADERS = Object.freeze({ "content-type": "application/json" });

export const IDEMPOTENCY_KEY_PAYLOAD_BINDING_STATEMENT =
  "The same idempotency key must never be accepted for two semantically different transfer requests." as const;
export const IDEMPOTENCY_KEY_PAYLOAD_BINDING_SCENARIO_ID =
  "idempotency-key-payload-conflict" as const;
export const IDEMPOTENCY_KEY_PAYLOAD_BINDING_SEED =
  "qedra-idempotency-key-payload-binding-seed-v1" as const;

type PayloadBindingStepName = ScenarioStep["name"];
type PayloadBindingTargetProfile = "vulnerable" | "fixed";

interface PayloadBindingStep {
  readonly name: PayloadBindingStepName;
  readonly expectedStatusCodes: Readonly<
    Record<PayloadBindingTargetProfile, number>
  >;
  readonly request: ScenarioHttpRequest;
}

const FIXED_TO_VULNERABLE_TARGET = Object.freeze({
  "fixed-payload-binding-wallet-api": "vulnerable-payload-binding-wallet-api",
  "payload-bound-wallet": "payload-blind-wallet",
} as const);

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

function statuses(vulnerable: number, fixed = vulnerable) {
  return Object.freeze({ vulnerable, fixed });
}

export const IDEMPOTENCY_KEY_PAYLOAD_BINDING_ATTACK = Object.freeze({
  schemaVersion: "qedra.scenario-definition.v1" as const,
  invariantId: "IDEMPOTENCY_KEY_PAYLOAD_BINDING" as const,
  invariantStatement: IDEMPOTENCY_KEY_PAYLOAD_BINDING_STATEMENT,
  scenarioId: IDEMPOTENCY_KEY_PAYLOAD_BINDING_SCENARIO_ID,
  deterministicSeed: IDEMPOTENCY_KEY_PAYLOAD_BINDING_SEED,
  steps: Object.freeze<readonly PayloadBindingStep[]>([
    {
      name: "RESET",
      expectedStatusCodes: statuses(200),
      request: post("/reset", {}),
    },
    {
      name: "SEED",
      expectedStatusCodes: statuses(200),
      request: post("/seed", { wallets: { A: 10_000, B: 5_000, C: 2_000 } }),
    },
    {
      name: "TRANSFER_INITIAL",
      expectedStatusCodes: statuses(200),
      request: post("/transfer", {
        requestId: "TX-001",
        sourceWalletId: "A",
        destinationWalletId: "B",
        amount: 1_000,
      }),
    },
    {
      name: "READ_BALANCES_AFTER_INITIAL_TRANSFER",
      expectedStatusCodes: statuses(200),
      request: get("/balances"),
    },
    {
      name: "READ_LEDGER_AFTER_INITIAL_TRANSFER",
      expectedStatusCodes: statuses(200),
      request: get("/ledger"),
    },
    {
      name: "TRANSFER_DIFFERENT_AMOUNT",
      expectedStatusCodes: statuses(200, 409),
      request: post("/transfer", {
        requestId: "TX-001",
        sourceWalletId: "A",
        destinationWalletId: "B",
        amount: 5_000,
      }),
    },
    {
      name: "READ_BALANCES_AFTER_AMOUNT_CONFLICT",
      expectedStatusCodes: statuses(200),
      request: get("/balances"),
    },
    {
      name: "READ_LEDGER_AFTER_AMOUNT_CONFLICT",
      expectedStatusCodes: statuses(200),
      request: get("/ledger"),
    },
    {
      name: "TRANSFER_DIFFERENT_DESTINATION",
      expectedStatusCodes: statuses(200, 409),
      request: post("/transfer", {
        requestId: "TX-001",
        sourceWalletId: "A",
        destinationWalletId: "C",
        amount: 1_000,
      }),
    },
    {
      name: "READ_BALANCES_AFTER_DESTINATION_CONFLICT",
      expectedStatusCodes: statuses(200),
      request: get("/balances"),
    },
    {
      name: "READ_LEDGER_AFTER_DESTINATION_CONFLICT",
      expectedStatusCodes: statuses(200),
      request: get("/ledger"),
    },
    {
      name: "TRANSFER_DIFFERENT_SOURCE",
      expectedStatusCodes: statuses(200, 409),
      request: post("/transfer", {
        requestId: "TX-001",
        sourceWalletId: "C",
        destinationWalletId: "B",
        amount: 1_000,
      }),
    },
    {
      name: "READ_BALANCES_AFTER_SOURCE_CONFLICT",
      expectedStatusCodes: statuses(200),
      request: get("/balances"),
    },
    {
      name: "READ_LEDGER_AFTER_SOURCE_CONFLICT",
      expectedStatusCodes: statuses(200),
      request: get("/ledger"),
    },
    {
      name: "TRANSFER_IDENTICAL_RETRY",
      expectedStatusCodes: statuses(200),
      request: post("/transfer", {
        requestId: "TX-001",
        sourceWalletId: "A",
        destinationWalletId: "B",
        amount: 1_000,
      }),
    },
    {
      name: "READ_BALANCES",
      expectedStatusCodes: statuses(200),
      request: get("/balances"),
    },
    {
      name: "READ_LEDGER",
      expectedStatusCodes: statuses(200),
      request: get("/ledger"),
    },
  ]),
});

function cloneRequest(request: ScenarioHttpRequest): ScenarioHttpRequest {
  return structuredClone(request);
}

function targetProfile(targetId: string): PayloadBindingTargetProfile | null {
  if (Object.hasOwn(FIXED_TO_VULNERABLE_TARGET, targetId)) {
    return "fixed";
  }
  if (
    Object.values(FIXED_TO_VULNERABLE_TARGET).some(
      (candidate) => candidate === targetId,
    )
  ) {
    return "vulnerable";
  }
  return null;
}

function canonicalRequest(request: ScenarioHttpRequest): string {
  return canonicalJson(request as unknown as JsonValue);
}

function assertCanonicalBodyBytes(
  request: ScenarioHttpRequest,
  sequence: number,
): void {
  if (request.body === undefined) {
    if (request.bodyText !== undefined) {
      throw new Error(
        `Payload-binding request ${String(sequence)} has body bytes without a JSON body.`,
      );
    }
    return;
  }
  if (request.bodyText !== canonicalJson(request.body)) {
    throw new Error(
      `Payload-binding request ${String(sequence)} body bytes are not canonical.`,
    );
  }
}

export function assertIdempotencyKeyPayloadBindingRunIntegrity(
  run: ScenarioRun,
): void {
  const definition = IDEMPOTENCY_KEY_PAYLOAD_BINDING_ATTACK;
  if (
    run.schemaVersion !== "qedra.scenario-run.v1" ||
    run.invariantId !== definition.invariantId ||
    run.invariantStatement !== definition.invariantStatement ||
    run.scenarioId !== definition.scenarioId ||
    run.deterministicSeed !== definition.deterministicSeed
  ) {
    throw new Error(
      "Recorded artifact is not the supported idempotency-key payload-binding scenario.",
    );
  }

  const profile = targetProfile(run.targetId);
  if (profile === null) {
    throw new Error(
      `Payload-binding target identity is not authorized: ${run.targetId}.`,
    );
  }
  if (run.events.length !== definition.steps.length) {
    throw new Error(
      "Payload-binding event count does not match the canonical attack definition.",
    );
  }

  const canonicalRequests = definition.steps.map((step) =>
    cloneRequest(step.request),
  );
  const expectedAttackHash = attackRequestHash(canonicalRequests);
  const recordedRequests: ScenarioHttpRequest[] = [];

  for (const [index, step] of definition.steps.entries()) {
    const recordedEvent = run.events[index];
    if (
      recordedEvent === undefined ||
      recordedEvent.sequence !== index + 1 ||
      recordedEvent.name !== step.name ||
      recordedEvent.expectedStatusCode !== step.expectedStatusCodes[profile]
    ) {
      throw new Error(
        `Recorded payload-binding event ${String(index + 1)} does not match the attack definition.`,
      );
    }
    if (
      recordedEvent.response.statusCode !== step.expectedStatusCodes[profile]
    ) {
      throw new Error(
        `Recorded payload-binding response ${String(index + 1)} does not match the target profile.`,
      );
    }
    assertCanonicalBodyBytes(recordedEvent.request, index + 1);
    if (
      canonicalRequest(recordedEvent.request) !== canonicalRequest(step.request)
    ) {
      throw new Error(
        `Recorded payload-binding request ${String(index + 1)} does not match the canonical attack definition.`,
      );
    }
    recordedRequests.push(cloneRequest(recordedEvent.request));
  }

  if (
    run.attackRequestHash !== expectedAttackHash ||
    attackRequestHash(recordedRequests) !== expectedAttackHash
  ) {
    throw new Error(
      "Recorded payload-binding request hash does not match the canonical HTTP event sequence.",
    );
  }
}

async function executePayloadBindingRequests(
  requests: readonly ScenarioHttpRequest[],
  target: ScenarioTarget,
  profile: PayloadBindingTargetProfile,
): Promise<ScenarioRun> {
  const definition = IDEMPOTENCY_KEY_PAYLOAD_BINDING_ATTACK;
  if (targetProfile(target.id) !== profile) {
    throw new Error(
      `Payload-binding target ${target.id} does not match profile ${profile}.`,
    );
  }
  if (requests.length !== definition.steps.length) {
    throw new Error(
      "Payload-binding request count does not match its definition.",
    );
  }
  const events: ScenarioEvent[] = [];
  for (const [index, step] of definition.steps.entries()) {
    const request = requests[index];
    if (request === undefined) {
      throw new Error(`Missing payload-binding request at index ${index}.`);
    }
    const expectedStatusCode = step.expectedStatusCodes[profile];
    const response = await target.execute(request);
    if (response.statusCode !== expectedStatusCode) {
      throw new Error(
        `Scenario step ${step.name} expected HTTP ${String(expectedStatusCode)} but received ${String(response.statusCode)}.`,
      );
    }
    events.push({
      sequence: index + 1,
      name: step.name,
      expectedStatusCode,
      request: cloneRequest(request),
      response,
    });
  }
  const run: ScenarioRun = {
    schemaVersion: "qedra.scenario-run.v1",
    invariantId: definition.invariantId,
    invariantStatement: definition.invariantStatement,
    scenarioId: definition.scenarioId,
    deterministicSeed: definition.deterministicSeed,
    targetId: target.id,
    attackRequestHash: attackRequestHash(requests),
    events,
  };
  assertIdempotencyKeyPayloadBindingRunIntegrity(run);
  return run;
}

export async function runIdempotencyKeyPayloadBindingAttack(
  target: ScenarioTarget,
): Promise<ScenarioRun> {
  return await executePayloadBindingRequests(
    IDEMPOTENCY_KEY_PAYLOAD_BINDING_ATTACK.steps.map((step) =>
      cloneRequest(step.request),
    ),
    target,
    "vulnerable",
  );
}

export async function runIdempotencyKeyPayloadBindingVerification(
  target: ScenarioTarget,
): Promise<ScenarioRun> {
  return await executePayloadBindingRequests(
    IDEMPOTENCY_KEY_PAYLOAD_BINDING_ATTACK.steps.map((step) =>
      cloneRequest(step.request),
    ),
    target,
    "fixed",
  );
}

export async function replayIdempotencyKeyPayloadBindingScenario(
  recorded: ScenarioRun,
  fixedTarget: ScenarioTarget,
): Promise<ScenarioRun> {
  assertIdempotencyKeyPayloadBindingRunIntegrity(recorded);
  const expectedRecordedTarget =
    FIXED_TO_VULNERABLE_TARGET[
      fixedTarget.id as keyof typeof FIXED_TO_VULNERABLE_TARGET
    ];
  if (
    expectedRecordedTarget === undefined ||
    recorded.targetId !== expectedRecordedTarget
  ) {
    throw new Error(
      "Recorded payload-binding target identity does not match the fixed replay target.",
    );
  }
  const requests = recorded.events.map((event) => cloneRequest(event.request));
  const replay = await executePayloadBindingRequests(
    requests,
    fixedTarget,
    "fixed",
  );
  assertExactRequestReplay(recorded, replay);
  return replay;
}
