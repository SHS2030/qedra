import { describe, expect, it } from "vitest";

import { createPayloadBlindWalletApi } from "../../examples/vulnerable-wallet-api/src/index.js";
import { createWalletApi } from "../../packages/core/src/index.js";
import {
  attackRequestHash,
  createFastifyInjectTarget,
  replayIdempotencyKeyPayloadBindingScenario,
  runIdempotencyKeyPayloadBindingAttack,
  runIdempotencyKeyPayloadBindingVerification,
  type ScenarioRun,
} from "../../packages/scenario-engine/src/index.js";
import { verifyIdempotencyKeyPayloadBindingScenario } from "../../packages/verification-engine/src/index.js";

const EXPECTED_LEDGER = [
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
] as const;

describe("IDEMPOTENCY_KEY_PAYLOAD_BINDING adversarial proof", () => {
  it("reproduces acceptance of a reused key with different amount, destination, and source", async () => {
    const app = createPayloadBlindWalletApi();
    try {
      const run = await runIdempotencyKeyPayloadBindingAttack(
        createFastifyInjectTarget(app, "payload-blind-wallet"),
      );
      const result = verifyIdempotencyKeyPayloadBindingScenario(run);

      expect(result.status).toBe("FAILED");
      expect(result.actual.amountConflictStatus).toBe(200);
      expect(result.actual.destinationConflictStatus).toBe(200);
      expect(result.actual.sourceConflictStatus).toBe(200);
      expect(result.actual.amountConflictError).toBeNull();
      expect(result.actual.destinationConflictError).toBeNull();
      expect(result.actual.sourceConflictError).toBeNull();
      expect(result.actual.amountConflictStateUnchanged).toBe(true);
      expect(result.actual.destinationConflictStateUnchanged).toBe(true);
      expect(result.actual.sourceConflictStateUnchanged).toBe(true);
      expect(result.actual.balances).toEqual({
        A: 9_000,
        B: 6_000,
        C: 2_000,
      });
      expect(result.actual.ledgerEntries).toBe(2);
      expect(result.actual.ledger).toEqual(EXPECTED_LEDGER);
      expect(result.actual.originalTransferPreserved).toBe(true);
      expect(result.violations.map((violation) => violation.code)).toEqual([
        "AMOUNT_CONFLICT_NOT_REJECTED",
        "AMOUNT_CONFLICT_ERROR_MISMATCH",
        "DESTINATION_CONFLICT_NOT_REJECTED",
        "DESTINATION_CONFLICT_ERROR_MISMATCH",
        "SOURCE_CONFLICT_NOT_REJECTED",
        "SOURCE_CONFLICT_ERROR_MISMATCH",
      ]);
    } finally {
      await app.close();
    }
  });

  it("rejects every semantic conflict and returns the first result for an exact retry", async () => {
    const app = createWalletApi();
    try {
      const run = await runIdempotencyKeyPayloadBindingVerification(
        createFastifyInjectTarget(app, "payload-bound-wallet"),
      );
      const result = verifyIdempotencyKeyPayloadBindingScenario(run);

      expect(result.status).toBe("PASSED");
      expect(result.actual.amountConflictStatus).toBe(409);
      expect(result.actual.destinationConflictStatus).toBe(409);
      expect(result.actual.sourceConflictStatus).toBe(409);
      expect(result.actual.amountConflictError).toBe(
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
      );
      expect(result.actual.destinationConflictError).toBe(
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
      );
      expect(result.actual.sourceConflictError).toBe(
        "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
      );
      expect(result.actual.amountConflictStateUnchanged).toBe(true);
      expect(result.actual.destinationConflictStateUnchanged).toBe(true);
      expect(result.actual.sourceConflictStateUnchanged).toBe(true);
      expect(result.actual.identicalRetryMatchesInitialResult).toBe(true);
      expect(result.actual.ledger).toEqual(EXPECTED_LEDGER);
      expect(result.violations).toEqual([]);
    } finally {
      await app.close();
    }
  });

  it("replays the exact vulnerable requests against the corrected implementation", async () => {
    const vulnerable = createPayloadBlindWalletApi();
    const fixed = createWalletApi();
    try {
      const recorded = await runIdempotencyKeyPayloadBindingAttack(
        createFastifyInjectTarget(vulnerable, "payload-blind-wallet"),
      );
      const replay = await replayIdempotencyKeyPayloadBindingScenario(
        recorded,
        createFastifyInjectTarget(fixed, "payload-bound-wallet"),
      );
      expect(replay.attackRequestHash).toBe(recorded.attackRequestHash);
      expect(replay.events.map((event) => event.request.bodyText)).toEqual(
        recorded.events.map((event) => event.request.bodyText),
      );
      expect(verifyIdempotencyKeyPayloadBindingScenario(replay).status).toBe(
        "PASSED",
      );
    } finally {
      await vulnerable.close();
      await fixed.close();
    }
  });

  it("rejects changed request order, scenario, seed, and target before replay", async () => {
    const vulnerable = createPayloadBlindWalletApi();
    const fixed = createWalletApi();
    try {
      const recorded = await runIdempotencyKeyPayloadBindingAttack(
        createFastifyInjectTarget(vulnerable, "payload-blind-wallet"),
      );
      const replayTarget = createFastifyInjectTarget(
        fixed,
        "payload-bound-wallet",
      );
      const reordered: ScenarioRun = {
        ...recorded,
        events: [
          recorded.events[1]!,
          recorded.events[0]!,
          ...recorded.events.slice(2),
        ],
      };
      await expect(
        replayIdempotencyKeyPayloadBindingScenario(reordered, replayTarget),
      ).rejects.toThrow(/does not match the attack definition/u);
      await expect(
        replayIdempotencyKeyPayloadBindingScenario(
          { ...recorded, scenarioId: "changed-scenario" },
          replayTarget,
        ),
      ).rejects.toThrow(/not the supported/u);
      await expect(
        replayIdempotencyKeyPayloadBindingScenario(
          { ...recorded, deterministicSeed: "changed-seed" },
          replayTarget,
        ),
      ).rejects.toThrow(/not the supported/u);
      await expect(
        replayIdempotencyKeyPayloadBindingScenario(
          { ...recorded, targetId: "changed-target" },
          replayTarget,
        ),
      ).rejects.toThrow(/target identity/u);
    } finally {
      await vulnerable.close();
      await fixed.close();
    }
  });

  it("rejects changed HTTP body bytes even when their attack hash is recomputed", async () => {
    const vulnerable = createPayloadBlindWalletApi();
    const fixed = createWalletApi();
    try {
      const recorded = await runIdempotencyKeyPayloadBindingAttack(
        createFastifyInjectTarget(vulnerable, "payload-blind-wallet"),
      );
      const initialIndex = recorded.events.findIndex(
        (event) => event.name === "TRANSFER_INITIAL",
      );
      const changedEvents = recorded.events.map((event, index) =>
        index === initialIndex
          ? {
              ...event,
              request: {
                ...event.request,
                bodyText: `${event.request.bodyText ?? ""} `,
              },
            }
          : event,
      );
      const changedBytes: ScenarioRun = {
        ...recorded,
        events: changedEvents,
        attackRequestHash: attackRequestHash(
          changedEvents.map((event) => event.request),
        ),
      };

      await expect(
        replayIdempotencyKeyPayloadBindingScenario(
          changedBytes,
          createFastifyInjectTarget(fixed, "payload-bound-wallet"),
        ),
      ).rejects.toThrow(/body bytes are not canonical/u);
    } finally {
      await vulnerable.close();
      await fixed.close();
    }
  });
});
