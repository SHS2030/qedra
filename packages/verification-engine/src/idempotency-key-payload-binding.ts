import {
  assertIdempotencyKeyPayloadBindingRunIntegrity,
  canonicalJson,
  IDEMPOTENCY_KEY_PAYLOAD_BINDING_STATEMENT,
  type JsonObject,
  type JsonValue,
  type ObservedLedgerEntry,
  type ScenarioEvent,
  type ScenarioRun,
} from "../../scenario-engine/src/index.js";

export const PAYLOAD_CONFLICT_ERROR =
  "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD" as const;

export interface PayloadBindingVerificationState {
  readonly balances: Readonly<Record<string, number | null>>;
  readonly ledgerEntries: number;
  readonly ledger: readonly ObservedLedgerEntry[];
  readonly amountConflictStatus: number;
  readonly amountConflictError: string | null;
  readonly amountConflictStateUnchanged: boolean;
  readonly destinationConflictStatus: number;
  readonly destinationConflictError: string | null;
  readonly destinationConflictStateUnchanged: boolean;
  readonly sourceConflictStatus: number;
  readonly sourceConflictError: string | null;
  readonly sourceConflictStateUnchanged: boolean;
  readonly identicalRetryStatus: number;
  readonly identicalRetryMatchesInitialResult: boolean;
  readonly originalTransferPreserved: boolean;
}

export interface PayloadBindingViolation {
  readonly code:
    | "AMOUNT_CONFLICT_NOT_REJECTED"
    | "AMOUNT_CONFLICT_ERROR_MISMATCH"
    | "AMOUNT_CONFLICT_MUTATED_STATE"
    | "DESTINATION_CONFLICT_NOT_REJECTED"
    | "DESTINATION_CONFLICT_ERROR_MISMATCH"
    | "DESTINATION_CONFLICT_MUTATED_STATE"
    | "SOURCE_CONFLICT_NOT_REJECTED"
    | "SOURCE_CONFLICT_ERROR_MISMATCH"
    | "SOURCE_CONFLICT_MUTATED_STATE"
    | "IDENTICAL_RETRY_NOT_ACCEPTED"
    | "IDENTICAL_RETRY_RESULT_MISMATCH"
    | "ORIGINAL_TRANSFER_NOT_PRESERVED";
  readonly message: string;
  readonly expected: string | number | boolean;
  readonly actual: string | number | boolean | null;
}

export interface IdempotencyKeyPayloadBindingVerification {
  readonly schemaVersion: "qedra.verification.v1";
  readonly invariantId: "IDEMPOTENCY_KEY_PAYLOAD_BINDING";
  readonly invariantStatement: string;
  readonly status: "PASSED" | "FAILED";
  readonly passed: boolean;
  readonly expected: PayloadBindingVerificationState;
  readonly actual: PayloadBindingVerificationState;
  readonly violations: readonly PayloadBindingViolation[];
}

function event(run: ScenarioRun, name: ScenarioEvent["name"]): ScenarioEvent {
  const matches = run.events.filter((candidate) => candidate.name === name);
  if (matches.length !== 1 || matches[0] === undefined) {
    throw new Error(
      `Payload-binding scenario must contain exactly one ${name} event.`,
    );
  }
  return matches[0];
}

function objectValue(value: JsonValue, context: string): JsonObject {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${context} response is not a JSON object.`);
  }
  return value;
}

function balancesFrom(
  eventValue: ScenarioEvent,
): Readonly<Record<string, number>> {
  const body = objectValue(eventValue.response.body, eventValue.name);
  const balances = body.balances;
  if (
    balances === null ||
    balances === undefined ||
    typeof balances !== "object" ||
    Array.isArray(balances)
  ) {
    throw new Error(`${eventValue.name} does not contain balances.`);
  }
  const result: Record<string, number> = {};
  for (const [walletId, balance] of Object.entries(balances)) {
    if (typeof balance !== "number" || !Number.isSafeInteger(balance)) {
      throw new Error(`${eventValue.name} balance ${walletId} is invalid.`);
    }
    result[walletId] = balance;
  }
  return result;
}

function ledgerFrom(eventValue: ScenarioEvent): readonly ObservedLedgerEntry[] {
  const body = objectValue(eventValue.response.body, eventValue.name);
  if (!Array.isArray(body.entries)) {
    throw new Error(`${eventValue.name} does not contain ledger entries.`);
  }
  return body.entries.map((entryValue, index) => {
    const entry = objectValue(
      entryValue,
      `${eventValue.name} ledger entry ${String(index)}`,
    );
    const { id, requestId, walletId, direction, amount, balanceAfter } = entry;
    if (
      typeof id !== "number" ||
      !Number.isSafeInteger(id) ||
      typeof requestId !== "string" ||
      typeof walletId !== "string" ||
      (direction !== "DEBIT" && direction !== "CREDIT") ||
      typeof amount !== "number" ||
      !Number.isSafeInteger(amount) ||
      typeof balanceAfter !== "number" ||
      !Number.isSafeInteger(balanceAfter)
    ) {
      throw new Error(
        `${eventValue.name} ledger entry ${String(index)} is invalid.`,
      );
    }
    return { id, requestId, walletId, direction, amount, balanceAfter };
  });
}

function errorCode(eventValue: ScenarioEvent): string | null {
  const body = objectValue(eventValue.response.body, eventValue.name);
  return typeof body.error === "string" ? body.error : null;
}

function sameJson(left: unknown, right: unknown): boolean {
  return canonicalJson(left as JsonValue) === canonicalJson(right as JsonValue);
}

const EXPECTED_BALANCES = Object.freeze({ A: 9_000, B: 6_000, C: 2_000 });
const EXPECTED_LEDGER = Object.freeze<readonly ObservedLedgerEntry[]>([
  Object.freeze({
    id: 1,
    requestId: "TX-001",
    walletId: "A",
    direction: "DEBIT",
    amount: 1_000,
    balanceAfter: 9_000,
  }),
  Object.freeze({
    id: 2,
    requestId: "TX-001",
    walletId: "B",
    direction: "CREDIT",
    amount: 1_000,
    balanceAfter: 6_000,
  }),
]);

function snapshotUnchanged(
  expectedBalances: Readonly<Record<string, number>>,
  expectedLedger: readonly ObservedLedgerEntry[],
  balanceEvent: ScenarioEvent,
  ledgerEvent: ScenarioEvent,
): boolean {
  return (
    sameJson(balancesFrom(balanceEvent), expectedBalances) &&
    sameJson(ledgerFrom(ledgerEvent), expectedLedger)
  );
}

function initialTransferIsCanonical(initial: ScenarioEvent): boolean {
  return sameJson(initial.response.body, {
    requestId: "TX-001",
    sourceWalletId: "A",
    destinationWalletId: "B",
    amount: 1_000,
    status: "completed",
    balances: { A: 9_000, B: 6_000 },
    ledgerEntryIds: [1, 2],
  });
}

export function verifyIdempotencyKeyPayloadBindingScenario(
  run: ScenarioRun,
): IdempotencyKeyPayloadBindingVerification {
  assertIdempotencyKeyPayloadBindingRunIntegrity(run);

  const initial = event(run, "TRANSFER_INITIAL");
  const baselineBalances = balancesFrom(
    event(run, "READ_BALANCES_AFTER_INITIAL_TRANSFER"),
  );
  const baselineLedger = ledgerFrom(
    event(run, "READ_LEDGER_AFTER_INITIAL_TRANSFER"),
  );
  const amountConflict = event(run, "TRANSFER_DIFFERENT_AMOUNT");
  const destinationConflict = event(run, "TRANSFER_DIFFERENT_DESTINATION");
  const sourceConflict = event(run, "TRANSFER_DIFFERENT_SOURCE");
  const identicalRetry = event(run, "TRANSFER_IDENTICAL_RETRY");
  const finalBalances = balancesFrom(event(run, "READ_BALANCES"));
  const finalLedger = ledgerFrom(event(run, "READ_LEDGER"));

  const actual: PayloadBindingVerificationState = {
    balances: finalBalances,
    ledgerEntries: finalLedger.length,
    ledger: finalLedger,
    amountConflictStatus: amountConflict.response.statusCode,
    amountConflictError: errorCode(amountConflict),
    amountConflictStateUnchanged: snapshotUnchanged(
      baselineBalances,
      baselineLedger,
      event(run, "READ_BALANCES_AFTER_AMOUNT_CONFLICT"),
      event(run, "READ_LEDGER_AFTER_AMOUNT_CONFLICT"),
    ),
    destinationConflictStatus: destinationConflict.response.statusCode,
    destinationConflictError: errorCode(destinationConflict),
    destinationConflictStateUnchanged: snapshotUnchanged(
      baselineBalances,
      baselineLedger,
      event(run, "READ_BALANCES_AFTER_DESTINATION_CONFLICT"),
      event(run, "READ_LEDGER_AFTER_DESTINATION_CONFLICT"),
    ),
    sourceConflictStatus: sourceConflict.response.statusCode,
    sourceConflictError: errorCode(sourceConflict),
    sourceConflictStateUnchanged: snapshotUnchanged(
      baselineBalances,
      baselineLedger,
      event(run, "READ_BALANCES_AFTER_SOURCE_CONFLICT"),
      event(run, "READ_LEDGER_AFTER_SOURCE_CONFLICT"),
    ),
    identicalRetryStatus: identicalRetry.response.statusCode,
    identicalRetryMatchesInitialResult:
      identicalRetry.response.bodyText === initial.response.bodyText,
    originalTransferPreserved:
      initialTransferIsCanonical(initial) &&
      sameJson(baselineBalances, EXPECTED_BALANCES) &&
      sameJson(baselineLedger, EXPECTED_LEDGER) &&
      sameJson(finalBalances, baselineBalances) &&
      sameJson(finalLedger, baselineLedger),
  };
  const expected: PayloadBindingVerificationState = {
    balances: EXPECTED_BALANCES,
    ledgerEntries: EXPECTED_LEDGER.length,
    ledger: EXPECTED_LEDGER,
    amountConflictStatus: 409,
    amountConflictError: PAYLOAD_CONFLICT_ERROR,
    amountConflictStateUnchanged: true,
    destinationConflictStatus: 409,
    destinationConflictError: PAYLOAD_CONFLICT_ERROR,
    destinationConflictStateUnchanged: true,
    sourceConflictStatus: 409,
    sourceConflictError: PAYLOAD_CONFLICT_ERROR,
    sourceConflictStateUnchanged: true,
    identicalRetryStatus: 200,
    identicalRetryMatchesInitialResult: true,
    originalTransferPreserved: true,
  };
  const violations: PayloadBindingViolation[] = [];
  const add = (
    condition: boolean,
    code: PayloadBindingViolation["code"],
    message: string,
    expectedValue: PayloadBindingViolation["expected"],
    actualValue: PayloadBindingViolation["actual"],
  ): void => {
    if (!condition) {
      violations.push({
        code,
        message,
        expected: expectedValue,
        actual: actualValue,
      });
    }
  };
  add(
    actual.amountConflictStatus === 409,
    "AMOUNT_CONFLICT_NOT_REJECTED",
    "Reusing TX-001 with a different amount must be rejected.",
    409,
    actual.amountConflictStatus,
  );
  add(
    actual.amountConflictError === PAYLOAD_CONFLICT_ERROR,
    "AMOUNT_CONFLICT_ERROR_MISMATCH",
    "Amount conflicts require the deterministic business error code.",
    PAYLOAD_CONFLICT_ERROR,
    actual.amountConflictError,
  );
  add(
    actual.amountConflictStateUnchanged,
    "AMOUNT_CONFLICT_MUTATED_STATE",
    "An amount conflict must not change any balance or ledger entry.",
    true,
    actual.amountConflictStateUnchanged,
  );
  add(
    actual.destinationConflictStatus === 409,
    "DESTINATION_CONFLICT_NOT_REJECTED",
    "Reusing TX-001 with a different destination must be rejected.",
    409,
    actual.destinationConflictStatus,
  );
  add(
    actual.destinationConflictError === PAYLOAD_CONFLICT_ERROR,
    "DESTINATION_CONFLICT_ERROR_MISMATCH",
    "Destination conflicts require the deterministic business error code.",
    PAYLOAD_CONFLICT_ERROR,
    actual.destinationConflictError,
  );
  add(
    actual.destinationConflictStateUnchanged,
    "DESTINATION_CONFLICT_MUTATED_STATE",
    "A destination conflict must not change any balance or ledger entry.",
    true,
    actual.destinationConflictStateUnchanged,
  );
  add(
    actual.sourceConflictStatus === 409,
    "SOURCE_CONFLICT_NOT_REJECTED",
    "Reusing TX-001 with a different source must be rejected.",
    409,
    actual.sourceConflictStatus,
  );
  add(
    actual.sourceConflictError === PAYLOAD_CONFLICT_ERROR,
    "SOURCE_CONFLICT_ERROR_MISMATCH",
    "Source conflicts require the deterministic business error code.",
    PAYLOAD_CONFLICT_ERROR,
    actual.sourceConflictError,
  );
  add(
    actual.sourceConflictStateUnchanged,
    "SOURCE_CONFLICT_MUTATED_STATE",
    "A source conflict must not change any balance or ledger entry.",
    true,
    actual.sourceConflictStateUnchanged,
  );
  add(
    actual.identicalRetryStatus === 200,
    "IDENTICAL_RETRY_NOT_ACCEPTED",
    "An exact retry must return the stored first result.",
    200,
    actual.identicalRetryStatus,
  );
  add(
    actual.identicalRetryMatchesInitialResult,
    "IDENTICAL_RETRY_RESULT_MISMATCH",
    "An exact retry must return byte-identical financial result data.",
    true,
    actual.identicalRetryMatchesInitialResult,
  );
  add(
    actual.originalTransferPreserved,
    "ORIGINAL_TRANSFER_NOT_PRESERVED",
    "Conflicts must preserve the original transfer, all balances, and the complete ledger.",
    true,
    actual.originalTransferPreserved,
  );
  const passed = violations.length === 0;
  return {
    schemaVersion: "qedra.verification.v1",
    invariantId: "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
    invariantStatement: IDEMPOTENCY_KEY_PAYLOAD_BINDING_STATEMENT,
    status: passed ? "PASSED" : "FAILED",
    passed,
    expected,
    actual,
    violations,
  };
}
