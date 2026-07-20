import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_WALLETS,
  financialPayloadFingerprint,
  WalletStoreError,
  type LedgerDirection,
  type LedgerEntry,
  type TransferInput,
  type TransferResult,
} from "../../../packages/core/src/index.js";

interface WalletRow {
  readonly wallet_id: string;
  readonly balance: number;
}

interface StoredTransferRow {
  readonly response_json: string;
}

interface LedgerRow {
  readonly id: number;
  readonly request_id: string;
  readonly wallet_id: string;
  readonly direction: LedgerDirection;
  readonly amount: number;
  readonly balance_after: number;
}

function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === ":memory:" || databasePath.startsWith("file:")) {
    return;
  }
  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new WalletStoreError(
      "INVALID_INPUT",
      `${field} must be a non-empty string.`,
      400,
    );
  }
  return value;
}

function requireInteger(
  value: unknown,
  field: string,
  minimum: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new WalletStoreError(
      "INVALID_INPUT",
      `${field} must be a safe integer greater than or equal to ${minimum}.`,
      400,
    );
  }
  return value;
}

function parseStoredResult(serialized: string): TransferResult {
  const parsed: unknown = JSON.parse(serialized);
  if (typeof parsed !== "object" || parsed === null) {
    throw new WalletStoreError(
      "CORRUPT_STORED_RESULT",
      "Stored transfer result is invalid.",
      500,
    );
  }
  return parsed as TransferResult;
}

/**
 * Deliberately vulnerable fixture for IDEMPOTENCY_KEY_PAYLOAD_BINDING.
 *
 * It persists the first result by request id, but accepts every later payload
 * carrying that id and blindly returns the first response. The fixture stores
 * a payload fingerprint to make the missing comparison explicit and
 * reproducible; the recorded repair activates deterministic binding.
 */
export class PayloadBlindWalletStore {
  private readonly database: DatabaseSync;
  private closed = false;

  public constructor(databasePath = ":memory:") {
    ensureDatabaseDirectory(databasePath);
    this.database = new DatabaseSync(databasePath);
    this.database.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
    if (databasePath !== ":memory:") {
      this.database.exec("PRAGMA journal_mode = WAL;");
    }
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS wallets (
        wallet_id TEXT PRIMARY KEY,
        balance INTEGER NOT NULL CHECK (balance >= 0)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS transfers (
        request_id TEXT PRIMARY KEY,
        source_wallet_id TEXT NOT NULL,
        destination_wallet_id TEXT NOT NULL,
        amount INTEGER NOT NULL CHECK (amount > 0),
        payload_fingerprint TEXT NOT NULL,
        response_json TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        wallet_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
        FOREIGN KEY (wallet_id) REFERENCES wallets(wallet_id)
      ) STRICT;

      CREATE INDEX IF NOT EXISTS payload_blind_ledger_request_idx
      ON ledger(request_id, id);
    `);
  }

  public reset(): void {
    this.assertOpen();
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      this.database.exec(`
        DELETE FROM ledger;
        DELETE FROM transfers;
        DELETE FROM wallets;
        DELETE FROM sqlite_sequence WHERE name = 'ledger';
      `);
      this.database.exec("COMMIT;");
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  public seed(
    wallets: Readonly<Record<string, number>> = DEFAULT_WALLETS,
  ): void {
    this.assertOpen();
    const entries = Object.entries(wallets).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length === 0) {
      throw new WalletStoreError(
        "INVALID_INPUT",
        "At least one wallet is required.",
        400,
      );
    }
    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const upsert = this.database.prepare(`
        INSERT INTO wallets (wallet_id, balance)
        VALUES (?, ?)
        ON CONFLICT(wallet_id) DO UPDATE SET balance = excluded.balance
      `);
      for (const [walletIdValue, balanceValue] of entries) {
        const walletId = requireString(walletIdValue, "walletId");
        const balance = requireInteger(
          balanceValue,
          `balance for ${walletId}`,
          0,
        );
        upsert.run(walletId, balance);
      }
      this.database.exec("COMMIT;");
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  public transfer(input: TransferInput): TransferResult {
    this.assertOpen();
    const requestId = requireString(input.requestId, "requestId");
    const sourceWalletId = requireString(
      input.sourceWalletId,
      "sourceWalletId",
    );
    const destinationWalletId = requireString(
      input.destinationWalletId,
      "destinationWalletId",
    );
    const amount = requireInteger(input.amount, "amount", 1);
    if (sourceWalletId === destinationWalletId) {
      throw new WalletStoreError(
        "INVALID_INPUT",
        "sourceWalletId and destinationWalletId must be different.",
        400,
      );
    }

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const stored = this.database
        .prepare("SELECT response_json FROM transfers WHERE request_id = ?")
        .get(requestId) as StoredTransferRow | undefined;

      if (stored !== undefined) {
        // Intentionally unsafe: the incoming financial payload is ignored.
        const result = parseStoredResult(stored.response_json);
        this.database.exec("COMMIT;");
        return result;
      }

      const source = this.wallet(sourceWalletId);
      const destination = this.wallet(destinationWalletId);
      if (source === undefined || destination === undefined) {
        throw new WalletStoreError(
          "WALLET_NOT_FOUND",
          "Source or destination wallet not found.",
          404,
        );
      }
      if (source.balance < amount) {
        throw new WalletStoreError(
          "INSUFFICIENT_FUNDS",
          "Source wallet has insufficient funds.",
          409,
        );
      }

      const sourceBalance = source.balance - amount;
      const destinationBalance = destination.balance + amount;
      this.database
        .prepare("UPDATE wallets SET balance = ? WHERE wallet_id = ?")
        .run(sourceBalance, sourceWalletId);
      this.database
        .prepare("UPDATE wallets SET balance = ? WHERE wallet_id = ?")
        .run(destinationBalance, destinationWalletId);

      const insertLedger = this.database.prepare(`
        INSERT INTO ledger (request_id, wallet_id, direction, amount, balance_after)
        VALUES (?, ?, ?, ?, ?)
      `);
      const debit = insertLedger.run(
        requestId,
        sourceWalletId,
        "DEBIT",
        amount,
        sourceBalance,
      );
      const credit = insertLedger.run(
        requestId,
        destinationWalletId,
        "CREDIT",
        amount,
        destinationBalance,
      );
      const result: TransferResult = {
        requestId,
        sourceWalletId,
        destinationWalletId,
        amount,
        status: "completed",
        balances: {
          [sourceWalletId]: sourceBalance,
          [destinationWalletId]: destinationBalance,
        },
        ledgerEntryIds: [
          Number(debit.lastInsertRowid),
          Number(credit.lastInsertRowid),
        ],
      };
      this.database
        .prepare(
          `
            INSERT INTO transfers (
              request_id, source_wallet_id, destination_wallet_id, amount,
              payload_fingerprint, response_json
            ) VALUES (?, ?, ?, ?, ?, ?)
          `,
        )
        .run(
          requestId,
          sourceWalletId,
          destinationWalletId,
          amount,
          financialPayloadFingerprint({
            sourceWalletId,
            destinationWalletId,
            amount,
          }),
          JSON.stringify(result),
        );
      this.database.exec("COMMIT;");
      return result;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  public getBalances(): Readonly<Record<string, number>> {
    this.assertOpen();
    const rows = this.database
      .prepare("SELECT wallet_id, balance FROM wallets ORDER BY wallet_id")
      .all() as unknown as readonly WalletRow[];
    return Object.fromEntries(rows.map((row) => [row.wallet_id, row.balance]));
  }

  public getLedger(requestId?: string): readonly LedgerEntry[] {
    this.assertOpen();
    const rows = (requestId === undefined
      ? this.database
          .prepare(
            `SELECT id, request_id, wallet_id, direction, amount, balance_after
             FROM ledger ORDER BY id`,
          )
          .all()
      : this.database
          .prepare(
            `SELECT id, request_id, wallet_id, direction, amount, balance_after
             FROM ledger WHERE request_id = ? ORDER BY id`,
          )
          .all(requestId)) as unknown as readonly LedgerRow[];
    return rows.map((row) => ({
      id: row.id,
      requestId: row.request_id,
      walletId: row.wallet_id,
      direction: row.direction,
      amount: row.amount,
      balanceAfter: row.balance_after,
    }));
  }

  public close(): void {
    if (!this.closed) {
      this.database.close();
      this.closed = true;
    }
  }

  private wallet(walletId: string): WalletRow | undefined {
    return this.database
      .prepare("SELECT wallet_id, balance FROM wallets WHERE wallet_id = ?")
      .get(walletId) as WalletRow | undefined;
  }

  private rollback(): void {
    try {
      this.database.exec("ROLLBACK;");
    } catch {
      // Preserve the original failure.
    }
  }

  private assertOpen(): void {
    if (this.closed) {
      throw new WalletStoreError(
        "STORE_CLOSED",
        "Wallet store is closed.",
        500,
      );
    }
  }
}
