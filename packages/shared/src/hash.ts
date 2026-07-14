import { createHash } from "node:crypto";

import { canonicalJsonStringify } from "./json.js";

export type HashInput = string | NodeJS.ArrayBufferView;

/** Returns a lowercase SHA-256 digest without a prefix. */
export function sha256Hex(input: HashInput): string {
  return createHash("sha256").update(input).digest("hex");
}

/** Hashes the compact canonical JSON representation of a value. */
export function hashCanonicalJson(value: unknown): string {
  return sha256Hex(canonicalJsonStringify(value));
}
