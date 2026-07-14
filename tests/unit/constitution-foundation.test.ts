import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  ConstitutionSchema,
  DEFAULT_CONSTITUTION_RELATIVE_PATH,
  TRANSFER_IDEMPOTENCY,
  findInvariant,
  getInvariant,
  initConstitution,
  loadConstitution,
} from "../../packages/constitution/src/index.js";

const temporaryRoots: string[] = [];

async function makeTemporaryRoot(): Promise<string> {
  const parent = resolve(process.cwd(), "reports/runtime/test-temp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "constitution-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("QEDRA constitution", () => {
  it("loads the checked-in TRANSFER_IDEMPOTENCY law", async () => {
    const constitution = await loadConstitution(
      resolve(process.cwd(), DEFAULT_CONSTITUTION_RELATIVE_PATH),
    );
    const invariant = getInvariant(constitution, TRANSFER_IDEMPOTENCY);

    expect(invariant.severity).toBe("critical");
    expect(invariant.enabled).toBe(true);
    expect(invariant.scenario.expectedState).toEqual({
      sourceBalance: 9_000,
      destinationBalance: 6_000,
      debitEntries: 1,
      creditEntries: 1,
    });
    expect(findInvariant(constitution, "UNKNOWN")).toBeUndefined();
  });

  it("initializes once and preserves an existing valid file byte-for-byte", async () => {
    const root = await makeTemporaryRoot();
    const first = await initConstitution(root);
    await appendFile(first.path, "# human-owned note\n", "utf8");
    const before = await readFile(first.path, "utf8");

    const second = await initConstitution(root);
    const after = await readFile(second.path, "utf8");

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    expect(after).toBe(before);
    expect(second.constitution).toEqual(first.constitution);
  });

  it("rejects invalid, duplicate, and unsafe constitutions", async () => {
    expect(() =>
      ConstitutionSchema.parse({
        schemaVersion: "1.0.0",
        name: "Invalid",
        description: "Duplicate ids",
        invariants: [
          ...ConstitutionSchema.parse({
            schemaVersion: "1.0.0",
            name: "Inner",
            description: "Valid inner fixture",
            invariants: [
              {
                id: "LAW",
                version: 1,
                title: "Law",
                statement: "Statement",
                severity: "critical",
                enabled: true,
                tags: ["test"],
                scenario: {
                  id: "scenario",
                  deterministicSeed: "seed",
                  description: "description",
                  attackCommand: "attack",
                  verificationCommand: "verify",
                  timeoutMs: 1_000,
                  expectedState: {
                    sourceBalance: 1,
                    destinationBalance: 2,
                    debitEntries: 1,
                    creditEntries: 1,
                  },
                },
              },
            ],
          }).invariants,
          {
            id: "LAW",
            version: 1,
            title: "Duplicate law",
            statement: "Statement",
            severity: "critical",
            enabled: true,
            tags: ["test"],
            scenario: {
              id: "scenario-2",
              deterministicSeed: "seed",
              description: "description",
              attackCommand: "attack",
              verificationCommand: "verify",
              timeoutMs: 1_000,
              expectedState: {
                sourceBalance: 1,
                destinationBalance: 2,
                debitEntries: 1,
                creditEntries: 1,
              },
            },
          },
        ],
      }),
    ).toThrow(/Duplicate invariant/u);

    const root = await makeTemporaryRoot();
    const invalidPath = join(root, "invalid.yaml");
    await mkdir(root, { recursive: true });
    await writeFile(invalidPath, "schemaVersion: invalid\n", "utf8");
    await expect(loadConstitution(invalidPath)).rejects.toThrow();
    await expect(initConstitution(root, "../outside.yaml")).rejects.toThrow(
      /traversal/u,
    );
  });
});
