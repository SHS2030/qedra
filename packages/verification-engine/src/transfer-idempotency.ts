import {
  extractWalletState,
  type ObservedLedgerEntry,
  type ObservedWalletState,
  type ScenarioRun,
} from "../../scenario-engine/src/index.js";

export const TRANSFER_IDEMPOTENCY_STATEMENT =
  "The same transfer request must never debit a wallet more than once, including after a network timeout, client retry, duplicate callback, or concurrent duplicate request.";

export interface TransferIdempotencyParameters {
  readonly requestId?: string;
  readonly sourceWalletId?: string;
  readonly destinationWalletId?: string;
  readonly initialSourceBalance?: number;
  readonly initialDestinationBalance?: number;
  readonly amount?: number;
}

export interface VerificationState {
  readonly balances: Readonly<Record<string, number | null>>;
  readonly debitEntries: number;
  readonly creditEntries: number;
  readonly totalRelevantEntries: number;
  readonly relevantLedgerEntries: readonly ObservedLedgerEntry[];
}

export interface VerificationViolation {
  readonly code:
    | "SOURCE_BALANCE_MISMATCH"
    | "DESTINATION_BALANCE_MISMATCH"
    | "DEBIT_COUNT_MISMATCH"
    | "CREDIT_COUNT_MISMATCH"
    | "LEDGER_ENTRY_COUNT_MISMATCH";
  readonly message: string;
  readonly expected: number;
  readonly actual: number | null;
}

export interface TransferIdempotencyVerification {
  readonly schemaVersion: "qedra.verification.v1";
  readonly invariantId: "TRANSFER_IDEMPOTENCY";
  readonly invariantStatement: string;
  readonly status: "PASSED" | "FAILED";
  readonly passed: boolean;
  readonly expected: VerificationState;
  readonly actual: VerificationState;
  readonly violations: readonly VerificationViolation[];
}

function safeInteger(value: number, field: string, minimum: number): number {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new TypeError(
      `${field} must be a safe integer greater than or equal to ${minimum}.`,
    );
  }
  return value;
}

function requiredIdentifier(value: string, field: string): string {
  if (value.trim().length === 0) {
    throw new TypeError(`${field} must not be empty.`);
  }
  return value;
}

function relevantEntries(
  state: ObservedWalletState,
  requestId: string,
): readonly ObservedLedgerEntry[] {
  return state.ledger
    .filter((entry) => entry.requestId === requestId)
    .toSorted((left, right) => left.id - right.id);
}

export function evaluateTransferIdempotency(
  observed: ObservedWalletState,
  parameters: TransferIdempotencyParameters = {},
): TransferIdempotencyVerification {
  const requestId = requiredIdentifier(
    parameters.requestId ?? "TX-001",
    "requestId",
  );
  const sourceWalletId = requiredIdentifier(
    parameters.sourceWalletId ?? "A",
    "sourceWalletId",
  );
  const destinationWalletId = requiredIdentifier(
    parameters.destinationWalletId ?? "B",
    "destinationWalletId",
  );
  const initialSourceBalance = safeInteger(
    parameters.initialSourceBalance ?? 10_000,
    "initialSourceBalance",
    0,
  );
  const initialDestinationBalance = safeInteger(
    parameters.initialDestinationBalance ?? 5_000,
    "initialDestinationBalance",
    0,
  );
  const amount = safeInteger(parameters.amount ?? 1_000, "amount", 1);
  const expectedSourceBalance = initialSourceBalance - amount;
  const expectedDestinationBalance = initialDestinationBalance + amount;
  if (expectedSourceBalance < 0) {
    throw new TypeError("Transfer amount exceeds the initial source balance.");
  }

  const relevant = relevantEntries(observed, requestId);
  const debitEntries = relevant.filter(
    (entry) => entry.direction === "DEBIT" && entry.walletId === sourceWalletId,
  ).length;
  const creditEntries = relevant.filter(
    (entry) =>
      entry.direction === "CREDIT" && entry.walletId === destinationWalletId,
  ).length;
  const sourceBalance = observed.balances[sourceWalletId] ?? null;
  const destinationBalance = observed.balances[destinationWalletId] ?? null;

  const expected: VerificationState = {
    balances: {
      [sourceWalletId]: expectedSourceBalance,
      [destinationWalletId]: expectedDestinationBalance,
    },
    debitEntries: 1,
    creditEntries: 1,
    totalRelevantEntries: 2,
    relevantLedgerEntries: [],
  };
  const actual: VerificationState = {
    balances: {
      [sourceWalletId]: sourceBalance,
      [destinationWalletId]: destinationBalance,
    },
    debitEntries,
    creditEntries,
    totalRelevantEntries: relevant.length,
    relevantLedgerEntries: relevant,
  };

  const violations: VerificationViolation[] = [];
  if (sourceBalance !== expectedSourceBalance) {
    violations.push({
      code: "SOURCE_BALANCE_MISMATCH",
      message: `Wallet ${sourceWalletId} balance must reflect exactly one debit.`,
      expected: expectedSourceBalance,
      actual: sourceBalance,
    });
  }
  if (destinationBalance !== expectedDestinationBalance) {
    violations.push({
      code: "DESTINATION_BALANCE_MISMATCH",
      message: `Wallet ${destinationWalletId} balance must reflect exactly one credit.`,
      expected: expectedDestinationBalance,
      actual: destinationBalance,
    });
  }
  if (debitEntries !== 1) {
    violations.push({
      code: "DEBIT_COUNT_MISMATCH",
      message: `Request ${requestId} must have exactly one source debit entry.`,
      expected: 1,
      actual: debitEntries,
    });
  }
  if (creditEntries !== 1) {
    violations.push({
      code: "CREDIT_COUNT_MISMATCH",
      message: `Request ${requestId} must have exactly one destination credit entry.`,
      expected: 1,
      actual: creditEntries,
    });
  }
  if (relevant.length !== 2) {
    violations.push({
      code: "LEDGER_ENTRY_COUNT_MISMATCH",
      message: `Request ${requestId} must have exactly two relevant ledger entries.`,
      expected: 2,
      actual: relevant.length,
    });
  }

  const passed = violations.length === 0;
  return {
    schemaVersion: "qedra.verification.v1",
    invariantId: "TRANSFER_IDEMPOTENCY",
    invariantStatement: TRANSFER_IDEMPOTENCY_STATEMENT,
    status: passed ? "PASSED" : "FAILED",
    passed,
    expected,
    actual,
    violations,
  };
}

export function verifyTransferIdempotencyScenario(
  run: ScenarioRun,
  parameters: TransferIdempotencyParameters = {},
): TransferIdempotencyVerification {
  return evaluateTransferIdempotency(extractWalletState(run), parameters);
}
