import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import {
  DEFAULT_WALLETS,
  TIMEOUT_AFTER_COMMIT,
  type ApiErrorResponse,
  type FailureMode,
  type TimeoutAfterCommitResponse,
  type TransferInput,
} from "./types.js";
import {
  WalletStore,
  WalletStoreError,
  type WalletStoreOptions,
} from "./wallet-store.js";

interface TransferBody {
  readonly requestId?: unknown;
  readonly sourceWalletId?: unknown;
  readonly destinationWalletId?: unknown;
  readonly fromWalletId?: unknown;
  readonly toWalletId?: unknown;
  readonly from?: unknown;
  readonly to?: unknown;
  readonly amount?: unknown;
  readonly failureMode?: unknown;
  readonly injectFailure?: unknown;
  readonly simulateTimeoutAfterCommit?: unknown;
}

interface SeedBody {
  readonly wallets?: unknown;
}

export interface WalletApiOptions extends WalletStoreOptions {
  readonly store?: WalletStore;
  readonly logger?: boolean;
}

export type WalletApi = FastifyInstance & { readonly walletStore: WalletStore };

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function parseTransferBody(value: unknown): {
  readonly input: TransferInput;
  readonly failureMode?: FailureMode;
} {
  if (!isObject(value)) {
    throw new WalletStoreError(
      "INVALID_INPUT",
      "Transfer body must be a JSON object.",
      400,
    );
  }

  const body = value as TransferBody;
  const requestId = body.requestId;
  const sourceWalletId = body.sourceWalletId ?? body.fromWalletId ?? body.from;
  const destinationWalletId =
    body.destinationWalletId ?? body.toWalletId ?? body.to;
  const amount = body.amount;
  const rawFailure = body.failureMode ?? body.injectFailure;
  const failureMode =
    rawFailure === TIMEOUT_AFTER_COMMIT ||
    body.simulateTimeoutAfterCommit === true
      ? TIMEOUT_AFTER_COMMIT
      : undefined;

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

  const input = { requestId, sourceWalletId, destinationWalletId, amount };
  return failureMode === undefined ? { input } : { input, failureMode };
}

function parseSeedBody(value: unknown): Readonly<Record<string, number>> {
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

  const seedBody = value as SeedBody;
  const candidate = seedBody.wallets ?? value;
  if (!isObject(candidate)) {
    throw new WalletStoreError(
      "INVALID_INPUT",
      "wallets must be a JSON object.",
      400,
    );
  }

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

function timeoutResponse(requestId: string): TimeoutAfterCommitResponse {
  return {
    error: "TIMEOUT_AFTER_COMMIT",
    message: "Transfer committed but the response was intentionally lost.",
    requestId,
  };
}

export function createWalletApi(options: WalletApiOptions = {}): WalletApi {
  const ownsStore = options.store === undefined;
  const store = options.store ?? new WalletStore(options.databasePath);
  const app = Fastify({ logger: options.logger ?? false });
  app.decorate("walletStore", store);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof WalletStoreError) {
      const body: ApiErrorResponse = {
        error: error.code,
        message: error.message,
      };
      void reply.status(error.statusCode).send(body);
      return;
    }

    const body: ApiErrorResponse = {
      error: "INTERNAL_ERROR",
      message: "Internal server error.",
    };
    void reply.status(500).send(body);
  });

  app.post("/reset", () => {
    store.reset();
    return { status: "reset" as const };
  });

  app.post("/seed", (request: FastifyRequest<{ Body: unknown }>) => {
    const wallets = parseSeedBody(request.body);
    store.seed(wallets);
    return { status: "seeded" as const, balances: store.getBalances() };
  });

  const transferHandler = (
    request: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
  ): unknown => {
    const transfer = parseTransferBody(request.body);
    const result = store.transfer(transfer.input);
    if (transfer.failureMode === TIMEOUT_AFTER_COMMIT) {
      return reply.status(504).send(timeoutResponse(result.requestId));
    }
    return result;
  };

  app.post("/transfer", transferHandler);
  app.post("/transfers", transferHandler);

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

  return app as unknown as WalletApi;
}

export const buildWalletApi = createWalletApi;
