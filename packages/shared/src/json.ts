export type JsonPrimitive = string | number | boolean | null;

export type JsonValue =
  | JsonPrimitive
  | JsonValue[]
  | { [key: string]: JsonValue };

export type JsonObject = { [key: string]: JsonValue };

function normalizeJsonValue(value: unknown, ancestors: Set<object>): JsonValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "boolean"
  ) {
    return value;
  }

  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw new TypeError(
        "Canonical JSON does not support non-finite numbers.",
      );
    }

    return Object.is(value, -0) ? 0 : value;
  }

  if (typeof value !== "object") {
    throw new TypeError(
      `Canonical JSON does not support values of type ${typeof value}.`,
    );
  }

  if (ancestors.has(value)) {
    throw new TypeError("Canonical JSON does not support circular references.");
  }

  ancestors.add(value);

  try {
    if (Array.isArray(value)) {
      return value.map((entry) => normalizeJsonValue(entry, ancestors));
    }

    const prototype = Reflect.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError(
        "Canonical JSON only supports plain objects and arrays.",
      );
    }

    const result: JsonObject = {};
    for (const key of Object.keys(value).sort()) {
      result[key] = normalizeJsonValue(
        (value as Record<string, unknown>)[key],
        ancestors,
      );
    }

    return result;
  } finally {
    ancestors.delete(value);
  }
}

/**
 * Produces a JSON-compatible value whose object keys are recursively sorted.
 * Arrays keep their original order. Unsupported JSON values are rejected rather
 * than silently omitted so that evidence hashes cannot depend on runtime quirks.
 */
export function canonicalizeJson(value: unknown): JsonValue {
  return normalizeJsonValue(value, new Set<object>());
}

/** Returns deterministic JSON with recursively sorted object keys. */
export function canonicalJsonStringify(value: unknown, space?: number): string {
  if (
    space !== undefined &&
    (!Number.isInteger(space) || space < 0 || space > 10)
  ) {
    throw new RangeError(
      "JSON indentation must be an integer between 0 and 10.",
    );
  }

  return JSON.stringify(canonicalizeJson(value), undefined, space);
}
