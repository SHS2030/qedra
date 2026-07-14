import { describe, expect, it } from "vitest";

import { createVulnerableWalletApi } from "../../examples/vulnerable-wallet-api/src/index.js";
import { createWalletApi } from "../../packages/core/src/index.js";
import {
  assertExactRequestReplay,
  createFastifyInjectTarget,
  extractWalletState,
  replayScenario,
  runTransferIdempotencyAttack,
  type ScenarioRun,
} from "../../packages/scenario-engine/src/index.js";
import { verifyTransferIdempotencyScenario } from "../../packages/verification-engine/src/index.js";

describe("TRANSFER_IDEMPOTENCY adversarial proof", () => {
  it("reproduces the vulnerable timeout/retry counterexample deterministically", async () => {
    const app = createVulnerableWalletApi();
    try {
      const run = await runTransferIdempotencyAttack(
        createFastifyInjectTarget(app, "vulnerable-wallet"),
      );
      const state = extractWalletState(run);
      const verification = verifyTransferIdempotencyScenario(run);

      expect(run.events.map((event) => event.name)).toEqual([
        "RESET",
        "SEED",
        "TRANSFER_TIMEOUT_AFTER_COMMIT",
        "TRANSFER_RETRY",
        "READ_BALANCES",
        "READ_LEDGER",
      ]);
      expect(run.events.map((event) => event.response.statusCode)).toEqual([
        200, 200, 504, 200, 200, 200,
      ]);
      expect(state.balances).toEqual({ A: 8_000, B: 7_000 });
      expect(state.ledger).toHaveLength(4);
      expect(
        state.ledger.filter((entry) => entry.direction === "DEBIT"),
      ).toHaveLength(2);
      expect(
        state.ledger.filter((entry) => entry.direction === "CREDIT"),
      ).toHaveLength(2);
      expect(verification.status).toBe("FAILED");
    } finally {
      await app.close();
    }
  });

  it("replays the exact recorded attack against the corrected target and passes", async () => {
    const vulnerable = createVulnerableWalletApi();
    const corrected = createWalletApi();
    try {
      const counterexample = await runTransferIdempotencyAttack(
        createFastifyInjectTarget(vulnerable, "vulnerable-wallet"),
      );
      const replay = await replayScenario(
        counterexample,
        createFastifyInjectTarget(corrected, "corrected-wallet"),
      );
      assertExactRequestReplay(counterexample, replay);

      expect(replay.attackRequestHash).toBe(counterexample.attackRequestHash);
      expect(replay.events.map((event) => event.request.bodyText)).toEqual(
        counterexample.events.map((event) => event.request.bodyText),
      );
      expect(extractWalletState(replay).balances).toEqual({
        A: 9_000,
        B: 6_000,
      });
      expect(extractWalletState(replay).ledger).toHaveLength(2);
      expect(verifyTransferIdempotencyScenario(replay).status).toBe("PASSED");
    } finally {
      await vulnerable.close();
      await corrected.close();
    }
  });

  it("rejects an artifact whose ordered event definition was altered", async () => {
    const app = createVulnerableWalletApi();
    try {
      const counterexample = await runTransferIdempotencyAttack(
        createFastifyInjectTarget(app, "vulnerable-wallet"),
      );
      const firstEvent = counterexample.events[0];
      if (firstEvent === undefined) {
        throw new Error("Expected the RESET event.");
      }
      const tampered: ScenarioRun = {
        ...counterexample,
        events: [
          { ...firstEvent, name: "SEED" },
          ...counterexample.events.slice(1),
        ],
      };

      await expect(
        replayScenario(
          tampered,
          createFastifyInjectTarget(app, "fixed-target"),
        ),
      ).rejects.toThrow("does not match the attack definition");
    } finally {
      await app.close();
    }
  });
});
