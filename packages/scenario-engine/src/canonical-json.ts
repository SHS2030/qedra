import { createHash } from "node:crypto";

import type { JsonValue, ScenarioHttpRequest } from "./types.js";

function canonicalize(value: JsonValue): string {
  if (value === null) {
    return "null";
  }
  if (typeof value === "string" || typeof value === "boolean") {
    return JSON.stringify(value);
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Canonical JSON does not support non-finite numbers.",
      );
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(",")}]`;
  }

  const entries = Object.entries(value).sort(([left], [right]) =>
    left.localeCompare(right),
  );
  return `{${entries
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

export function canonicalJson(value: JsonValue): string {
  return canonicalize(value);
}

export function attackRequestHash(
  requests: readonly ScenarioHttpRequest[],
): string {
  const serializable = requests.map((request) => ({
    method: request.method,
    path: request.path,
    headers: Object.fromEntries(
      Object.entries(request.headers).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
    ...(request.bodyText === undefined ? {} : { bodyText: request.bodyText }),
  })) as unknown as JsonValue;
  return createHash("sha256").update(canonicalJson(serializable)).digest("hex");
}

export function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean" ||
    (typeof value === "number" && Number.isFinite(value))
  ) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.every((item) => isJsonValue(item));
  }
  if (typeof value !== "object") {
    return false;
  }
  return Object.values(value).every((item) => isJsonValue(item));
}

export function parseJsonBody(bodyText: string): JsonValue {
  if (bodyText.length === 0) {
    return null;
  }
  const parsed: unknown = JSON.parse(bodyText);
  if (!isJsonValue(parsed)) {
    throw new TypeError("HTTP response is not representable as JSON evidence.");
  }
  return parsed;
}
