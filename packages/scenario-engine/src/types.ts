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
    | "TRANSFER_INITIAL"
    | "READ_BALANCES_AFTER_INITIAL_TRANSFER"
    | "READ_LEDGER_AFTER_INITIAL_TRANSFER"
    | "TRANSFER_DIFFERENT_AMOUNT"
    | "TRANSFER_DIFFERENT_DESTINATION"
    | "TRANSFER_DIFFERENT_SOURCE"
    | "TRANSFER_IDENTICAL_RETRY"
    | "READ_BALANCES_AFTER_AMOUNT_CONFLICT"
    | "READ_LEDGER_AFTER_AMOUNT_CONFLICT"
    | "READ_BALANCES_AFTER_DESTINATION_CONFLICT"
    | "READ_LEDGER_AFTER_DESTINATION_CONFLICT"
    | "READ_BALANCES_AFTER_SOURCE_CONFLICT"
    | "READ_LEDGER_AFTER_SOURCE_CONFLICT"
    | "READ_BALANCES"
    | "READ_LEDGER";
  readonly expectedStatusCode: number;
  readonly request: ScenarioHttpRequest;
}

export interface ScenarioDefinition {
  readonly schemaVersion: "qedra.scenario-definition.v1";
  readonly invariantId:
    | "TRANSFER_IDEMPOTENCY"
    | "IDEMPOTENCY_KEY_PAYLOAD_BINDING";
  readonly invariantStatement: string;
  readonly scenarioId: string;
  readonly deterministicSeed: string;
  readonly steps: readonly ScenarioStep[];
}

export interface ScenarioEvent extends ScenarioStep {
  readonly sequence: number;
  readonly response: ScenarioHttpResponse;
}

export interface ScenarioRun {
  readonly schemaVersion: "qedra.scenario-run.v1";
  readonly invariantId:
    | "TRANSFER_IDEMPOTENCY"
    | "IDEMPOTENCY_KEY_PAYLOAD_BINDING";
  readonly invariantStatement: string;
  readonly scenarioId: string;
  readonly deterministicSeed: string;
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
