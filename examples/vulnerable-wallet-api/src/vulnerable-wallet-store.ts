import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

export interface VulnerableTransferInput {
  readonly requestId: string;
  readonly sourceWalletId: string;
  readonly destinationWalletId: string;
  readonly amount: number;
}

export interface VulnerableTransferResult extends VulnerableTransferInput {
  readonly status: "completed";
  readonly balances: Readonly<Record<string, number>>;
  readonly ledgerEntryIds: readonly number[];
}

export interface VulnerableLedgerEntry {
  readonly id: number;
  readonly requestId: string;
  readonly walletId: string;
  readonly direction: "DEBIT" | "CREDIT";
  readonly amount: number;
  readonly balanceAfter: number;
}

interface WalletRow {
  readonly wallet_id: string;
  readonly balance: number;
}

interface LedgerRow {
  readonly id: number;
  readonly request_id: string;
  readonly wallet_id: string;
  readonly direction: "DEBIT" | "CREDIT";
  readonly amount: number;
  readonly balance_after: number;
}

export class VulnerableWalletError extends Error {
  public constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
  ) {
    super(message);
    this.name = "VulnerableWalletError";
  }
}

function ensureDatabaseDirectory(databasePath: string): void {
  if (databasePath === ":memory:" || databasePath.startsWith("file:")) {
    return;
  }
  mkdirSync(dirname(resolve(databasePath)), { recursive: true });
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new VulnerableWalletError(
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
    throw new VulnerableWalletError(
      "INVALID_INPUT",
      `${field} must be a safe integer greater than or equal to ${minimum}.`,
      400,
    );
  }
  return value;
}

/**
 * Deliberately unsafe fixture. It has no persistent idempotency record or unique
 * request constraint, so retrying a committed request applies it a second time.
 */
export class VulnerableWalletStore {
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

      CREATE TABLE IF NOT EXISTS ledger (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        request_id TEXT NOT NULL,
        wallet_id TEXT NOT NULL,
        direction TEXT NOT NULL CHECK (direction IN ('DEBIT', 'CREDIT')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        balance_after INTEGER NOT NULL CHECK (balance_after >= 0),
        FOREIGN KEY (wallet_id) REFERENCES wallets(wallet_id)
      ) STRICT;
    `);
  }

  public reset(): void {
    this.assertOpen();
    this.database.exec(`
      BEGIN IMMEDIATE;
      DELETE FROM ledger;
      DELETE FROM wallets;
      DELETE FROM sqlite_sequence WHERE name = 'ledger';
      COMMIT;
    `);
  }

  public seed(
    wallets: Readonly<Record<string, number>> = { A: 10_000, B: 5_000 },
  ): void {
    this.assertOpen();
    const entries = Object.entries(wallets).sort(([left], [right]) =>
      left.localeCompare(right),
    );
    if (entries.length === 0) {
      throw new VulnerableWalletError(
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

  public transfer(input: VulnerableTransferInput): VulnerableTransferResult {
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
      throw new VulnerableWalletError(
        "INVALID_INPUT",
        "sourceWalletId and destinationWalletId must be different.",
        400,
      );
    }

    this.database.exec("BEGIN IMMEDIATE;");
    try {
      const source = this.wallet(sourceWalletId);
      const destination = this.wallet(destinationWalletId);
      if (source === undefined || destination === undefined) {
        throw new VulnerableWalletError(
          "WALLET_NOT_FOUND",
          "Source or destination wallet not found.",
          404,
        );
      }
      if (source.balance < amount) {
        throw new VulnerableWalletError(
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
      this.database.exec("COMMIT;");

      return {
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
    const balances: Record<string, number> = {};
    for (const row of rows) {
      balances[row.wallet_id] = row.balance;
    }
    return balances;
  }

  public getLedger(requestId?: string): readonly VulnerableLedgerEntry[] {
    this.assertOpen();
    const rows = (requestId === undefined
      ? this.database
          .prepare(
            `
              SELECT id, request_id, wallet_id, direction, amount, balance_after
              FROM ledger ORDER BY id
            `,
          )
          .all()
      : this.database
          .prepare(
            `
              SELECT id, request_id, wallet_id, direction, amount, balance_after
              FROM ledger WHERE request_id = ? ORDER BY id
            `,
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
      throw new VulnerableWalletError(
        "STORE_CLOSED",
        "Wallet store is closed.",
        500,
      );
    }
  }
}
