import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";

import {
  DEFAULT_WALLETS,
  WalletStoreError,
  type TransferInput,
} from "../../../packages/core/src/index.js";
import { PayloadBlindWalletStore } from "./payload-blind-wallet-store.js";

interface PayloadBlindWalletApiOptions {
  readonly databasePath?: string;
  readonly store?: PayloadBlindWalletStore;
  readonly logger?: boolean;
}

export type PayloadBlindWalletApi = FastifyInstance & {
  readonly walletStore: PayloadBlindWalletStore;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function transferInput(value: unknown): TransferInput {
  if (!isObject(value)) {
    throw new WalletStoreError(
      "INVALID_INPUT",
      "Transfer body must be a JSON object.",
      400,
    );
  }
  const { requestId, sourceWalletId, destinationWalletId, amount } = value;
  if (
    typeof requestId !== "string" ||
    typeof sourceWalletId !== "string" ||
    typeof destinationWalletId !== "string" ||
    typeof amount !== "number"
  ) {
    throw new WalletStoreError(
      "INVALID_INPUT",
      "requestId, sourceWalletId, destinationWalletId, and amount are required.",
      400,
    );
  }
  return { requestId, sourceWalletId, destinationWalletId, amount };
}

function seedWallets(value: unknown): Readonly<Record<string, number>> {
  if (value === undefined || value === null) {
    return DEFAULT_WALLETS;
  }
  if (!isObject(value)) {
    throw new WalletStoreError(
      "INVALID_INPUT",
      "Seed body must be a JSON object.",
      400,
    );
  }
  const candidate = isObject(value.wallets) ? value.wallets : value;
  const wallets: Record<string, number> = {};
  for (const [walletId, balance] of Object.entries(candidate)) {
    if (typeof balance !== "number") {
      throw new WalletStoreError(
        "INVALID_INPUT",
        `Balance for ${walletId} must be a number.`,
        400,
      );
    }
    wallets[walletId] = balance;
  }
  return wallets;
}

export function createPayloadBlindWalletApi(
  options: PayloadBlindWalletApiOptions = {},
): PayloadBlindWalletApi {
  const ownsStore = options.store === undefined;
  const store =
    options.store ?? new PayloadBlindWalletStore(options.databasePath);
  const app = Fastify({ logger: options.logger ?? false });
  app.decorate("walletStore", store);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof WalletStoreError) {
      void reply
        .status(error.statusCode)
        .send({ error: error.code, message: error.message });
      return;
    }
    void reply
      .status(500)
      .send({ error: "INTERNAL_ERROR", message: "Internal server error." });
  });

  app.post("/reset", () => {
    store.reset();
    return { status: "reset" as const };
  });
  app.post("/seed", (request: FastifyRequest<{ Body: unknown }>) => {
    store.seed(seedWallets(request.body));
    return { status: "seeded" as const, balances: store.getBalances() };
  });
  const transfer = (request: FastifyRequest<{ Body: unknown }>): unknown =>
    store.transfer(transferInput(request.body));
  app.post("/transfer", transfer);
  app.post("/transfers", transfer);
  app.get("/balances", () => ({ balances: store.getBalances() }));
  app.get(
    "/ledger",
    (request: FastifyRequest<{ Querystring: { requestId?: string } }>) => ({
      entries: store.getLedger(request.query.requestId),
    }),
  );
  if (ownsStore) {
    app.addHook("onClose", () => {
      store.close();
    });
  }
  return app as unknown as PayloadBlindWalletApi;
}
