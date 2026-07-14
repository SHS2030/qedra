export const DEFAULT_WALLETS = Object.freeze({ A: 10_000, B: 5_000 });

export const TIMEOUT_AFTER_COMMIT = "timeout-after-commit" as const;

export type FailureMode = typeof TIMEOUT_AFTER_COMMIT;

export interface TransferInput {
  readonly requestId: string;
  readonly sourceWalletId: string;
  readonly destinationWalletId: string;
  readonly amount: number;
}

export interface TransferRequest extends TransferInput {
  readonly failureMode?: FailureMode;
}

export interface TransferResult extends TransferInput {
  readonly status: "completed";
  readonly balances: Readonly<Record<string, number>>;
  readonly ledgerEntryIds: readonly number[];
}

export type LedgerDirection = "DEBIT" | "CREDIT";

export interface LedgerEntry {
  readonly id: number;
  readonly requestId: string;
  readonly walletId: string;
  readonly direction: LedgerDirection;
  readonly amount: number;
  readonly balanceAfter: number;
}

export interface BalancesResponse {
  readonly balances: Readonly<Record<string, number>>;
}

export interface LedgerResponse {
  readonly entries: readonly LedgerEntry[];
}

export interface TimeoutAfterCommitResponse {
  readonly error: "TIMEOUT_AFTER_COMMIT";
  readonly message: "Transfer committed but the response was intentionally lost.";
  readonly requestId: string;
}

export interface ApiErrorResponse {
  readonly error: string;
  readonly message: string;
}
