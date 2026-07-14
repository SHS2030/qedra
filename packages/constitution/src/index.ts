import { readFile } from "node:fs/promises";

import { parse, stringify } from "yaml";

import {
  atomicCreateText,
  resolveRepositoryPath,
} from "../../shared/src/index.js";

import {
  ConstitutionSchema,
  DEFAULT_CONSTITUTION,
  type Constitution,
  type InvariantDefinition,
} from "./schema.js";

export * from "./schema.js";

export const DEFAULT_CONSTITUTION_RELATIVE_PATH =
  "constitutions/qedra.yaml" as const;

export interface ConstitutionInitResult {
  readonly created: boolean;
  readonly path: string;
  readonly constitution: Constitution;
}

export function serializeConstitution(constitution: Constitution): string {
  const validated = ConstitutionSchema.parse(constitution);
  return stringify(validated, { indent: 2, lineWidth: 0 });
}

export async function loadConstitution(
  constitutionPath: string,
): Promise<Constitution> {
  const source = await readFile(constitutionPath, "utf8");
  return ConstitutionSchema.parse(parse(source));
}

/** Creates the default constitution once and validates existing content unchanged. */
export async function initConstitution(
  repositoryRoot: string,
  relativePath: string = DEFAULT_CONSTITUTION_RELATIVE_PATH,
): Promise<ConstitutionInitResult> {
  const constitutionPath = resolveRepositoryPath(repositoryRoot, relativePath);

  try {
    const constitution = await loadConstitution(constitutionPath);
    return { created: false, path: constitutionPath, constitution };
  } catch (error: unknown) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      throw error;
    }
  }

  const created = await atomicCreateText(
    constitutionPath,
    serializeConstitution(DEFAULT_CONSTITUTION),
  );
  const constitution = await loadConstitution(constitutionPath);
  return { created, path: constitutionPath, constitution };
}

export const ensureConstitution = initConstitution;

export function findInvariant(
  constitution: Constitution,
  invariantId: string,
): InvariantDefinition | undefined {
  return constitution.invariants.find(
    (invariant) => invariant.id === invariantId,
  );
}

export function getInvariant(
  constitution: Constitution,
  invariantId: string,
): InvariantDefinition {
  const invariant = findInvariant(constitution, invariantId);
  if (invariant === undefined) {
    throw new Error(`Invariant not found: ${invariantId}`);
  }
  return invariant;
}
