import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { createWalletApi, WalletStore } from "../../packages/core/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

async function resetAndSeed(
  app: ReturnType<typeof createWalletApi>,
): Promise<void> {
  expect(
    (await app.inject({ method: "POST", url: "/reset", payload: {} }))
      .statusCode,
  ).toBe(200);
  expect(
    (
      await app.inject({
        method: "POST",
        url: "/seed",
        payload: { wallets: { A: 10_000, B: 5_000 } },
      })
    ).statusCode,
  ).toBe(200);
}

function parseObject(body: string): Record<string, unknown> {
  const parsed: unknown = JSON.parse(body);
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new TypeError("Expected a JSON object response.");
  }
  return parsed as Record<string, unknown>;
}

describe("corrected wallet API", () => {
  it("commits before an injected timeout and returns the stored result on retry", async () => {
    const app = createWalletApi();
    try {
      await resetAndSeed(app);
      const request = {
        requestId: "TX-001",
        sourceWalletId: "A",
        destinationWalletId: "B",
        amount: 1_000,
      };
      const timedOut = await app.inject({
        method: "POST",
        url: "/transfer",
        payload: { ...request, failureMode: "timeout-after-commit" },
      });
      expect(timedOut.statusCode).toBe(504);
      expect(parseObject(timedOut.body).error).toBe("TIMEOUT_AFTER_COMMIT");

      const retry = await app.inject({
        method: "POST",
        url: "/transfer",
        payload: request,
      });
      const duplicate = await app.inject({
        method: "POST",
        url: "/transfer",
        payload: request,
      });
      expect(retry.statusCode).toBe(200);
      expect(duplicate.statusCode).toBe(200);
      expect(duplicate.body).toBe(retry.body);

      const balances = parseObject(
        (await app.inject({ method: "GET", url: "/balances" })).body,
      );
      expect(balances.balances).toEqual({ A: 9_000, B: 6_000 });
      const ledger = parseObject(
        (await app.inject({ method: "GET", url: "/ledger?requestId=TX-001" }))
          .body,
      );
      expect(ledger.entries).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("serializes concurrent duplicate requests into one atomic transfer", async () => {
    const app = createWalletApi();
    try {
      await resetAndSeed(app);
      const request = {
        requestId: "TX-001",
        sourceWalletId: "A",
        destinationWalletId: "B",
        amount: 1_000,
      };
      const responses = await Promise.all(
        Array.from({ length: 20 }, async () =>
          app.inject({ method: "POST", url: "/transfer", payload: request }),
        ),
      );

      expect(responses.every((response) => response.statusCode === 200)).toBe(
        true,
      );
      expect(new Set(responses.map((response) => response.body)).size).toBe(1);
      expect(app.walletStore.getBalances()).toEqual({ A: 9_000, B: 6_000 });
      expect(app.walletStore.getLedger("TX-001")).toHaveLength(2);
    } finally {
      await app.close();
    }
  });

  it("enforces idempotency across two database connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "qedra-wallet-connections-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "wallet.sqlite");
    const firstApp = createWalletApi({ databasePath });
    const secondApp = createWalletApi({ databasePath });
    try {
      await resetAndSeed(firstApp);
      const request = {
        requestId: "TX-001",
        sourceWalletId: "A",
        destinationWalletId: "B",
        amount: 1_000,
      };
      const responses = await Promise.all(
        Array.from({ length: 20 }, async (_, index) =>
          (index % 2 === 0 ? firstApp : secondApp).inject({
            method: "POST",
            url: "/transfer",
            payload: request,
          }),
        ),
      );

      expect(responses.every((response) => response.statusCode === 200)).toBe(
        true,
      );
      expect(new Set(responses.map((response) => response.body)).size).toBe(1);
      expect(secondApp.walletStore.getBalances()).toEqual({
        A: 9_000,
        B: 6_000,
      });
      expect(secondApp.walletStore.getLedger("TX-001")).toHaveLength(2);
    } finally {
      await firstApp.close();
      await secondApp.close();
    }
  });

  it("persists the unique request and exact first response across reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "qedra-wallet-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "wallet.sqlite");
    const request = {
      requestId: "TX-001",
      sourceWalletId: "A",
      destinationWalletId: "B",
      amount: 1_000,
    };

    const firstStore = new WalletStore(databasePath);
    firstStore.reset();
    firstStore.seed();
    const firstResponse = firstStore.transfer(request);
    firstStore.close();

    const reopenedStore = new WalletStore(databasePath);
    try {
      const replayedResponse = reopenedStore.transfer(request);
      expect(replayedResponse).toEqual(firstResponse);
      expect(JSON.stringify(replayedResponse)).toBe(
        JSON.stringify(firstResponse),
      );
      expect(reopenedStore.getBalances()).toEqual({ A: 9_000, B: 6_000 });
      expect(reopenedStore.getLedger("TX-001")).toHaveLength(2);
    } finally {
      reopenedStore.close();
    }
  });
});
