import { createHash } from "node:crypto";

import type { TransferInput } from "./types.js";

export interface FinancialTransferPayload {
  readonly sourceWalletId: string;
  readonly destinationWalletId: string;
  readonly amount: number;
}

/**
 * Produces the stable semantic identity of a transfer request. The idempotency
 * key is deliberately excluded: it identifies the stored result, while this
 * canonical payload determines whether a retry is the same financial request.
 */
export function canonicalFinancialPayload(
  payload: FinancialTransferPayload,
): string {
  return JSON.stringify({
    amount: payload.amount,
    destinationWalletId: payload.destinationWalletId,
    sourceWalletId: payload.sourceWalletId,
  });
}

export function financialPayloadFingerprint(
  payload: FinancialTransferPayload,
): string {
  return createHash("sha256")
    .update(canonicalFinancialPayload(payload), "utf8")
    .digest("hex");
}

export function sameFinancialPayload(
  stored: FinancialTransferPayload & { readonly payloadFingerprint: string },
  incoming: Pick<
    TransferInput,
    "sourceWalletId" | "destinationWalletId" | "amount"
  >,
): boolean {
  return (
    stored.payloadFingerprint === financialPayloadFingerprint(incoming) &&
    stored.sourceWalletId === incoming.sourceWalletId &&
    stored.destinationWalletId === incoming.destinationWalletId &&
    stored.amount === incoming.amount
  );
}
