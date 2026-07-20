import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

import { afterEach, describe, expect, it } from "vitest";

import {
  createWalletApi,
  WalletStore,
  WalletStoreError,
} from "../../packages/core/src/index.js";

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

  it("binds an idempotency key to source, destination, and amount without mutating conflicts", async () => {
    const app = createWalletApi();
    try {
      await resetAndSeed(app);
      app.walletStore.seed({ C: 2_000 });
      const initial = {
        requestId: "TX-001",
        sourceWalletId: "A",
        destinationWalletId: "B",
        amount: 1_000,
      };
      const first = await app.inject({
        method: "POST",
        url: "/transfer",
        payload: initial,
      });
      const samePayload = await app.inject({
        method: "POST",
        url: "/transfer",
        payload: initial,
      });
      const differentAmount = await app.inject({
        method: "POST",
        url: "/transfer",
        payload: { ...initial, amount: 5_000 },
      });
      const differentDestination = await app.inject({
        method: "POST",
        url: "/transfer",
        payload: { ...initial, destinationWalletId: "C" },
      });
      const differentSource = await app.inject({
        method: "POST",
        url: "/transfer",
        payload: { ...initial, sourceWalletId: "C" },
      });

      expect(first.statusCode).toBe(200);
      expect(samePayload.statusCode).toBe(200);
      expect(samePayload.body).toBe(first.body);
      for (const conflict of [
        differentAmount,
        differentDestination,
        differentSource,
      ]) {
        expect(conflict.statusCode).toBe(409);
        expect(parseObject(conflict.body).error).toBe(
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
        );
      }
      expect(app.walletStore.getBalances()).toEqual({
        A: 9_000,
        B: 6_000,
        C: 2_000,
      });
      expect(app.walletStore.getLedger()).toEqual([
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
      ]);
    } finally {
      await app.close();
    }
  });

  it("preserves payload binding across database reopen", () => {
    const directory = mkdtempSync(join(tmpdir(), "qedra-payload-reopen-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "wallet.sqlite");
    const initial = {
      requestId: "TX-001",
      sourceWalletId: "A",
      destinationWalletId: "B",
      amount: 1_000,
    };
    const firstStore = new WalletStore(databasePath);
    firstStore.reset();
    firstStore.seed({ A: 10_000, B: 5_000, C: 2_000 });
    const firstResult = firstStore.transfer(initial);
    firstStore.close();

    const reopened = new WalletStore(databasePath);
    try {
      expect(reopened.transfer(initial)).toEqual(firstResult);
      for (const conflictingPayload of [
        { ...initial, amount: 5_000 },
        { ...initial, destinationWalletId: "C" },
        { ...initial, sourceWalletId: "C" },
      ]) {
        let conflict: unknown;
        try {
          reopened.transfer(conflictingPayload);
        } catch (error) {
          conflict = error;
        }
        expect(conflict).toBeInstanceOf(WalletStoreError);
        if (!(conflict instanceof WalletStoreError)) {
          throw new Error("Expected a WalletStoreError payload conflict.");
        }
        expect(conflict.code).toBe(
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
        );
        expect(conflict.statusCode).toBe(409);
      }
      expect(reopened.getBalances()).toEqual({
        A: 9_000,
        B: 6_000,
        C: 2_000,
      });
      expect(reopened.getLedger()).toEqual([
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
      ]);
    } finally {
      reopened.close();
    }
  });

  it("serializes conflicting payloads across database connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "qedra-payload-connections-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "wallet.sqlite");
    const firstApp = createWalletApi({ databasePath });
    const secondApp = createWalletApi({ databasePath });
    try {
      await resetAndSeed(firstApp);
      firstApp.walletStore.seed({ C: 2_000 });
      const initial = {
        requestId: "TX-001",
        sourceWalletId: "A",
        destinationWalletId: "B",
        amount: 1_000,
      };
      expect(
        (
          await firstApp.inject({
            method: "POST",
            url: "/transfer",
            payload: initial,
          })
        ).statusCode,
      ).toBe(200);
      const responses = await Promise.all([
        secondApp.inject({
          method: "POST",
          url: "/transfer",
          payload: initial,
        }),
        firstApp.inject({
          method: "POST",
          url: "/transfer",
          payload: { ...initial, amount: 5_000 },
        }),
        secondApp.inject({
          method: "POST",
          url: "/transfer",
          payload: { ...initial, destinationWalletId: "C" },
        }),
        firstApp.inject({
          method: "POST",
          url: "/transfer",
          payload: { ...initial, sourceWalletId: "C" },
        }),
      ]);
      expect(responses.map((response) => response.statusCode)).toEqual([
        200, 409, 409, 409,
      ]);
      for (const conflict of responses.slice(1)) {
        expect(parseObject(conflict.body).error).toBe(
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
        );
      }
      expect(secondApp.walletStore.getBalances()).toEqual({
        A: 9_000,
        B: 6_000,
        C: 2_000,
      });
      expect(secondApp.walletStore.getLedger("TX-001")).toHaveLength(2);
    } finally {
      await firstApp.close();
      await secondApp.close();
    }
  });

  it("serializes competing first payloads into one binding across database connections", async () => {
    const directory = mkdtempSync(join(tmpdir(), "qedra-payload-first-race-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "wallet.sqlite");
    const firstApp = createWalletApi({ databasePath });
    const secondApp = createWalletApi({ databasePath });
    try {
      await resetAndSeed(firstApp);
      firstApp.walletStore.seed({ C: 2_000 });
      const payloads = [
        {
          requestId: "TX-RACE",
          sourceWalletId: "A",
          destinationWalletId: "B",
          amount: 1_000,
        },
        {
          requestId: "TX-RACE",
          sourceWalletId: "A",
          destinationWalletId: "B",
          amount: 5_000,
        },
        {
          requestId: "TX-RACE",
          sourceWalletId: "C",
          destinationWalletId: "B",
          amount: 1_000,
        },
      ] as const;
      const responses = await Promise.all(
        payloads.map(
          async (payload, index) =>
            await (index % 2 === 0 ? firstApp : secondApp).inject({
              method: "POST",
              url: "/transfer",
              payload,
            }),
        ),
      );

      const winnerIndex = responses.findIndex(
        (response) => response.statusCode === 200,
      );
      expect(winnerIndex).toBeGreaterThanOrEqual(0);
      expect(
        responses.filter((response) => response.statusCode === 200),
      ).toHaveLength(1);
      const conflicts = responses.filter(
        (response) => response.statusCode !== 200,
      );
      expect(conflicts).toHaveLength(2);
      for (const conflict of conflicts) {
        expect(conflict.statusCode).toBe(409);
        expect(parseObject(conflict.body).error).toBe(
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
        );
      }

      const winner = payloads[winnerIndex];
      const winningResponse = responses[winnerIndex];
      if (winner === undefined || winningResponse === undefined) {
        throw new Error("Expected one competing payload to establish binding.");
      }
      const expectedBalances = { A: 10_000, B: 5_000, C: 2_000 };
      expectedBalances[winner.sourceWalletId] -= winner.amount;
      expectedBalances[winner.destinationWalletId] += winner.amount;
      expect(secondApp.walletStore.getBalances()).toEqual(expectedBalances);
      expect(secondApp.walletStore.getLedger()).toEqual([
        {
          id: 1,
          requestId: "TX-RACE",
          walletId: winner.sourceWalletId,
          direction: "DEBIT",
          amount: winner.amount,
          balanceAfter: expectedBalances[winner.sourceWalletId],
        },
        {
          id: 2,
          requestId: "TX-RACE",
          walletId: winner.destinationWalletId,
          direction: "CREDIT",
          amount: winner.amount,
          balanceAfter: expectedBalances[winner.destinationWalletId],
        },
      ]);
      const exactRetry = await secondApp.inject({
        method: "POST",
        url: "/transfer",
        payload: winner,
      });
      expect(exactRetry.statusCode).toBe(200);
      expect(exactRetry.body).toBe(winningResponse.body);
    } finally {
      await firstApp.close();
      await secondApp.close();
    }
  });

  it("backfills canonical payload fingerprints for a legacy persisted transfer", () => {
    const directory = mkdtempSync(join(tmpdir(), "qedra-payload-migration-"));
    temporaryDirectories.push(directory);
    const databasePath = join(directory, "wallet.sqlite");
    const initial = {
      requestId: "TX-LEGACY",
      sourceWalletId: "A",
      destinationWalletId: "B",
      amount: 1_000,
    } as const;
    const storedResult = {
      ...initial,
      status: "completed" as const,
      balances: { A: 9_000, B: 6_000 },
      ledgerEntryIds: [1, 2],
    };

    const legacy = new DatabaseSync(databasePath);
    legacy.exec(`
      CREATE TABLE wallets (
        wallet_id TEXT PRIMARY KEY,
        balance INTEGER NOT NULL CHECK (balance >= 0)
      ) STRICT;
      CREATE TABLE transfers (
        request_id TEXT PRIMARY KEY,
        source_wallet_id TEXT NOT NULL,
        destination_wallet_id TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount > 0),
        response_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        wallet_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
        FOREIGN KEY (wallet_id) REFERENCES wallets(wallet_id)
      ) STRICT;
      INSERT INTO wallets (wallet_id, balance)
      VALUES ('A', 9000), ('B', 6000), ('C', 2000);
      INSERT INTO ledger (
        request_id, wallet_id, direction, amount, balance_after
      ) VALUES
        ('TX-LEGACY', 'A', 'DEBIT', 1000, 9000),
        ('TX-LEGACY', 'B', 'CREDIT', 1000, 6000);
    `);
    legacy
      .prepare(
        `INSERT INTO transfers (
          request_id, source_wallet_id, destination_wallet_id, amount,
          response_json
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        initial.requestId,
        initial.sourceWalletId,
        initial.destinationWalletId,
        initial.amount,
        JSON.stringify(storedResult),
      );
    legacy.close();

    const migrated = new WalletStore(databasePath);
    try {
      expect(migrated.transfer(initial)).toEqual(storedResult);
      for (const conflictingPayload of [
        { ...initial, amount: 5_000 },
        { ...initial, destinationWalletId: "C" },
        { ...initial, sourceWalletId: "C" },
      ]) {
        let conflict: unknown;
        try {
          migrated.transfer(conflictingPayload);
        } catch (error) {
          conflict = error;
        }
        expect(conflict).toBeInstanceOf(WalletStoreError);
        if (!(conflict instanceof WalletStoreError)) {
          throw new Error("Expected a payload-binding conflict.");
        }
        expect(conflict.code).toBe(
          "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
        );
        expect(conflict.statusCode).toBe(409);
      }
      expect(migrated.getBalances()).toEqual({
        A: 9_000,
        B: 6_000,
        C: 2_000,
      });
      expect(migrated.getLedger()).toEqual([
        {
          id: 1,
          requestId: "TX-LEGACY",
          walletId: "A",
          direction: "DEBIT",
          amount: 1_000,
          balanceAfter: 9_000,
        },
        {
          id: 2,
          requestId: "TX-LEGACY",
          walletId: "B",
          direction: "CREDIT",
          amount: 1_000,
          balanceAfter: 6_000,
        },
      ]);
    } finally {
      migrated.close();
    }

    const inspection = new DatabaseSync(databasePath, { readOnly: true });
    try {
      const row = inspection
        .prepare(
          "SELECT payload_fingerprint FROM transfers WHERE request_id = ?",
        )
        .get(initial.requestId) as
        | { readonly payload_fingerprint: string }
        | undefined;
      expect(row?.payload_fingerprint).toMatch(/^[0-9a-f]{64}$/u);
    } finally {
      inspection.close();
    }
  });
});
