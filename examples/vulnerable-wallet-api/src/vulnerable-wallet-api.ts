import Fastify, {
  type FastifyInstance,
  type FastifyReply,
  type FastifyRequest,
} from "fastify";

import {
  VulnerableWalletError,
  VulnerableWalletStore,
  type VulnerableTransferInput,
} from "./vulnerable-wallet-store.js";

interface VulnerableWalletApiOptions {
  readonly databasePath?: string;
  readonly store?: VulnerableWalletStore;
  readonly logger?: boolean;
}

export type VulnerableWalletApi = FastifyInstance & {
  readonly walletStore: VulnerableWalletStore;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function transferInput(value: unknown): {
  readonly input: VulnerableTransferInput;
  readonly timeoutAfterCommit: boolean;
} {
  if (!isObject(value)) {
    throw new VulnerableWalletError(
      "INVALID_INPUT",
      "Transfer body must be a JSON object.",
      400,
    );
  }
  const requestId = value.requestId;
  const sourceWalletId =
    value.sourceWalletId ?? value.fromWalletId ?? value.from;
  const destinationWalletId =
    value.destinationWalletId ?? value.toWalletId ?? value.to;
  const amount = value.amount;
  if (
    typeof requestId !== "string" ||
    typeof sourceWalletId !== "string" ||
    typeof destinationWalletId !== "string" ||
    typeof amount !== "number"
  ) {
    throw new VulnerableWalletError(
      "INVALID_INPUT",
      "requestId, sourceWalletId, destinationWalletId, and amount are required.",
      400,
    );
  }

  return {
    input: { requestId, sourceWalletId, destinationWalletId, amount },
    timeoutAfterCommit:
      value.failureMode === "timeout-after-commit" ||
      value.injectFailure === "timeout-after-commit" ||
      value.simulateTimeoutAfterCommit === true,
  };
}

function seedWallets(value: unknown): Readonly<Record<string, number>> {
  if (value === undefined || value === null) {
    return { A: 10_000, B: 5_000 };
  }
  if (!isObject(value)) {
    throw new VulnerableWalletError(
      "INVALID_INPUT",
      "Seed body must be a JSON object.",
      400,
    );
  }
  const candidate = isObject(value.wallets) ? value.wallets : value;
  const wallets: Record<string, number> = {};
  for (const [walletId, balance] of Object.entries(candidate)) {
    if (typeof balance !== "number") {
      throw new VulnerableWalletError(
        "INVALID_INPUT",
        `Balance for ${walletId} must be a number.`,
        400,
      );
    }
    wallets[walletId] = balance;
  }
  return wallets;
}

export function createVulnerableWalletApi(
  options: VulnerableWalletApiOptions = {},
): VulnerableWalletApi {
  const ownsStore = options.store === undefined;
  const store =
    options.store ?? new VulnerableWalletStore(options.databasePath);
  const app = Fastify({ logger: options.logger ?? false });
  app.decorate("walletStore", store);

  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof VulnerableWalletError) {
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

  const handler = (
    request: FastifyRequest<{ Body: unknown }>,
    reply: FastifyReply,
  ): unknown => {
    const transfer = transferInput(request.body);
    const result = store.transfer(transfer.input);
    if (transfer.timeoutAfterCommit) {
      return reply.status(504).send({
        error: "TIMEOUT_AFTER_COMMIT",
        message: "Transfer committed but the response was intentionally lost.",
        requestId: result.requestId,
      });
    }
    return result;
  };
  app.post("/transfer", handler);
  app.post("/transfers", handler);
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
  return app as unknown as VulnerableWalletApi;
}

export const buildVulnerableWalletApi = createVulnerableWalletApi;
