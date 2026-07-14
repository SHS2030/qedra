import { timingSafeEqual } from "node:crypto";

import { hashCanonicalJson } from "../../shared/src/index.js";

import {
  CounterexampleSchema,
  PassportSchema,
  RepairEvidenceSchema,
  UnsignedCounterexampleSchema,
  UnsignedPassportSchema,
  UnsignedRepairEvidenceSchema,
  type Counterexample,
  type Passport,
  type RepairEvidence,
  type UnsignedCounterexample,
  type UnsignedPassport,
  type UnsignedRepairEvidence,
} from "./schemas.js";

export class EvidenceIntegrityError extends Error {
  public constructor(message = "Evidence hash verification failed.") {
    super(message);
    this.name = "EvidenceIntegrityError";
  }
}

function withoutEvidenceHash(document: unknown): Record<string, unknown> {
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  ) {
    throw new TypeError("Evidence must be a JSON object.");
  }

  const unsigned = { ...(document as Record<string, unknown>) };
  delete unsigned.evidenceHash;
  return unsigned;
}

/** Computes SHA-256 over canonical JSON after removing only the top-level hash. */
export function computeEvidenceHash(document: unknown): string {
  return hashCanonicalJson(withoutEvidenceHash(document));
}

export function addEvidenceHash<T extends Record<string, unknown>>(
  document: T,
): Omit<T, "evidenceHash"> & { evidenceHash: string } {
  const unsigned = withoutEvidenceHash(document);
  return {
    ...unsigned,
    evidenceHash: hashCanonicalJson(unsigned),
  } as Omit<T, "evidenceHash"> & { evidenceHash: string };
}

/** Returns false for malformed, missing, or mismatched hashes. */
export function verifyEvidenceHash(document: unknown): boolean {
  if (
    document === null ||
    typeof document !== "object" ||
    Array.isArray(document)
  ) {
    return false;
  }

  const suppliedHash = (document as Record<string, unknown>).evidenceHash;
  if (
    typeof suppliedHash !== "string" ||
    !/^[0-9a-f]{64}$/u.test(suppliedHash)
  ) {
    return false;
  }

  try {
    const computedHash = computeEvidenceHash(document);
    return timingSafeEqual(
      Buffer.from(suppliedHash, "hex"),
      Buffer.from(computedHash, "hex"),
    );
  } catch {
    return false;
  }
}

export function assertEvidenceHash(document: unknown): void {
  if (!verifyEvidenceHash(document)) {
    throw new EvidenceIntegrityError();
  }
}

export function createCounterexample(
  input: UnsignedCounterexample,
): Counterexample {
  const unsigned = UnsignedCounterexampleSchema.parse(input);
  return CounterexampleSchema.parse(addEvidenceHash(unsigned));
}

export function createRepairEvidence(
  input: UnsignedRepairEvidence,
): RepairEvidence {
  const unsigned = UnsignedRepairEvidenceSchema.parse(input);
  return RepairEvidenceSchema.parse(addEvidenceHash(unsigned));
}

export function createPassport(input: UnsignedPassport): Passport {
  const unsigned = UnsignedPassportSchema.parse(input);
  assertEvidenceHash(unsigned.repair);
  return PassportSchema.parse(addEvidenceHash(unsigned));
}

export function parseAndVerifyCounterexample(input: unknown): Counterexample {
  const counterexample = CounterexampleSchema.parse(input);
  assertEvidenceHash(counterexample);
  return counterexample;
}

export function parseAndVerifyRepairEvidence(input: unknown): RepairEvidence {
  const repair = RepairEvidenceSchema.parse(input);
  assertEvidenceHash(repair);
  return repair;
}

export function parseAndVerifyPassport(input: unknown): Passport {
  const passport = PassportSchema.parse(input);
  assertEvidenceHash(passport.repair);
  assertEvidenceHash(passport);
  return passport;
}
