import { describe, expect, it } from "vitest";

import type { ObservedWalletState } from "../../packages/scenario-engine/src/index.js";
import { evaluateTransferIdempotency } from "../../packages/verification-engine/src/index.js";

const duplicatedState: ObservedWalletState = {
  balances: { A: 8_000, B: 7_000 },
  ledger: [
    {
      id: 1,
      requestId: "TX-001",
      walletId: "A",
      direction: "DEBIT",
      amount: 1_000,
      balanceAfter: 9_000,
    },
    {
      id: 2,
      requestId: "TX-001",
      walletId: "B",
      direction: "CREDIT",
      amount: 1_000,
      balanceAfter: 6_000,
    },
    {
      id: 3,
      requestId: "TX-001",
      walletId: "A",
      direction: "DEBIT",
      amount: 1_000,
      balanceAfter: 8_000,
    },
    {
      id: 4,
      requestId: "TX-001",
      walletId: "B",
      direction: "CREDIT",
      amount: 1_000,
      balanceAfter: 7_000,
    },
  ],
};

describe("TRANSFER_IDEMPOTENCY verification", () => {
  it("reports the deterministic duplicated debit as FAILED", () => {
    const result = evaluateTransferIdempotency(duplicatedState);

    expect(result.status).toBe("FAILED");
    expect(result.passed).toBe(false);
    expect(result.expected.balances).toEqual({ A: 9_000, B: 6_000 });
    expect(result.actual.balances).toEqual({ A: 8_000, B: 7_000 });
    expect(result.actual.debitEntries).toBe(2);
    expect(result.actual.creditEntries).toBe(2);
    expect(result.actual.totalRelevantEntries).toBe(4);
    expect(result.violations.map((violation) => violation.code)).toEqual([
      "SOURCE_BALANCE_MISMATCH",
      "DESTINATION_BALANCE_MISMATCH",
      "DEBIT_COUNT_MISMATCH",
      "CREDIT_COUNT_MISMATCH",
      "LEDGER_ENTRY_COUNT_MISMATCH",
    ]);
  });

  it("reports exactly one debit and credit as PASSED", () => {
    const state: ObservedWalletState = {
      balances: { A: 9_000, B: 6_000 },
      ledger: duplicatedState.ledger.slice(0, 2),
    };

    const result = evaluateTransferIdempotency(state);

    expect(result.status).toBe("PASSED");
    expect(result.passed).toBe(true);
    expect(result.violations).toEqual([]);
  });

  it("serializes deterministically and ignores unrelated requests", () => {
    const state: ObservedWalletState = {
      balances: { B: 6_000, A: 9_000 },
      ledger: [
        ...duplicatedState.ledger.slice(0, 2).toReversed(),
        {
          id: 3,
          requestId: "TX-OTHER",
          walletId: "A",
          direction: "DEBIT",
          amount: 1,
          balanceAfter: 8_999,
        },
      ],
    };

    const first = evaluateTransferIdempotency(state);
    const second = evaluateTransferIdempotency(state);

    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first.status).toBe("PASSED");
    expect(first.actual.relevantLedgerEntries.map((entry) => entry.id)).toEqual(
      [1, 2],
    );
  });
});
