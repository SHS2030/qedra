export type JsonPrimitive = boolean | number | string | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonValue[];
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type ScenarioHttpMethod = "GET" | "POST";

export interface ScenarioHttpRequest {
  readonly method: ScenarioHttpMethod;
  readonly path: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: JsonValue;
  /** Canonical bytes sent over HTTP. Replays use this value without regenerating it. */
  readonly bodyText?: string;
}

export interface ScenarioHttpResponse {
  readonly statusCode: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: JsonValue;
  readonly bodyText: string;
}

export interface ScenarioStep {
  readonly name:
    | "RESET"
    | "SEED"
    | "TRANSFER_TIMEOUT_AFTER_COMMIT"
    | "TRANSFER_RETRY"
    | "READ_BALANCES"
    | "READ_LEDGER";
  readonly expectedStatusCode: number;
  readonly request: ScenarioHttpRequest;
}

export interface ScenarioDefinition {
  readonly schemaVersion: "qedra.scenario-definition.v1";
  readonly invariantId: "TRANSFER_IDEMPOTENCY";
  readonly invariantStatement: string;
  readonly scenarioId: "transfer-timeout-after-commit-retry";
  readonly deterministicSeed: "qedra-transfer-idempotency-seed-v1";
  readonly steps: readonly ScenarioStep[];
}

export interface ScenarioEvent extends ScenarioStep {
  readonly sequence: number;
  readonly response: ScenarioHttpResponse;
}

export interface ScenarioRun {
  readonly schemaVersion: "qedra.scenario-run.v1";
  readonly invariantId: "TRANSFER_IDEMPOTENCY";
  readonly invariantStatement: string;
  readonly scenarioId: "transfer-timeout-after-commit-retry";
  readonly deterministicSeed: "qedra-transfer-idempotency-seed-v1";
  readonly targetId: string;
  readonly attackRequestHash: string;
  readonly events: readonly ScenarioEvent[];
}

export interface ScenarioTarget {
  readonly id: string;
  execute(request: ScenarioHttpRequest): Promise<ScenarioHttpResponse>;
}

export interface ObservedLedgerEntry {
  readonly id: number;
  readonly requestId: string;
  readonly walletId: string;
  readonly direction: "DEBIT" | "CREDIT";
  readonly amount: number;
  readonly balanceAfter: number;
}

export interface ObservedWalletState {
  readonly balances: Readonly<Record<string, number>>;
  readonly ledger: readonly ObservedLedgerEntry[];
}
