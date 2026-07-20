import { describe, expect, it } from "vitest";

import {
  canonicalFinancialPayload,
  financialPayloadFingerprint,
  sameFinancialPayload,
} from "../../packages/core/src/index.js";

describe("financial payload identity", () => {
  const payload = {
    sourceWalletId: "A",
    destinationWalletId: "B",
    amount: 1_000,
  } as const;

  it("canonicalizes the semantic fields in a stable order", () => {
    const reordered = {
      amount: 1_000,
      destinationWalletId: "B",
      sourceWalletId: "A",
    } as const;
    expect(canonicalFinancialPayload(payload)).toBe(
      '{"amount":1000,"destinationWalletId":"B","sourceWalletId":"A"}',
    );
    expect(canonicalFinancialPayload(reordered)).toBe(
      canonicalFinancialPayload(payload),
    );
    expect(financialPayloadFingerprint(payload)).toMatch(/^[0-9a-f]{64}$/u);
    expect(financialPayloadFingerprint(payload)).toBe(
      financialPayloadFingerprint(reordered),
    );
  });

  it("distinguishes amount, destination, and source changes", () => {
    const stored = {
      ...payload,
      payloadFingerprint: financialPayloadFingerprint(payload),
    };
    expect(sameFinancialPayload(stored, payload)).toBe(true);
    expect(sameFinancialPayload(stored, { ...payload, amount: 5_000 })).toBe(
      false,
    );
    expect(
      sameFinancialPayload(stored, {
        ...payload,
        destinationWalletId: "C",
      }),
    ).toBe(false);
    expect(
      sameFinancialPayload(stored, { ...payload, sourceWalletId: "OTHER" }),
    ).toBe(false);
  });
});
