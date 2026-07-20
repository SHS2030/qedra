import { z } from "zod";

export const CONSTITUTION_SCHEMA_VERSION = "1.0.0" as const;
export const TRANSFER_IDEMPOTENCY = "TRANSFER_IDEMPOTENCY" as const;
export const IDEMPOTENCY_KEY_PAYLOAD_BINDING =
  "IDEMPOTENCY_KEY_PAYLOAD_BINDING" as const;

export const TransferExpectedStateSchema = z
  .object({
    sourceBalance: z.number().int().nonnegative(),
    destinationBalance: z.number().int().nonnegative(),
    debitEntries: z.number().int().nonnegative(),
    creditEntries: z.number().int().nonnegative(),
  })
  .strict();

export const PayloadBindingExpectedStateSchema = z
  .object({
    sourceBalance: z.number().int().nonnegative(),
    destinationBalance: z.number().int().nonnegative(),
    alternateDestinationBalance: z.number().int().nonnegative(),
    ledgerEntries: z.number().int().nonnegative(),
    conflictStatusCode: z.number().int().min(400).max(499),
    conflictError: z.literal("IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD"),
    identicalRetryStatusCode: z.literal(200),
  })
  .strict();

export const ExpectedStateSchema = z.union([
  TransferExpectedStateSchema,
  PayloadBindingExpectedStateSchema,
]);

export const ScenarioDefinitionSchema = z
  .object({
    id: z.string().min(1),
    deterministicSeed: z.string().min(1),
    description: z.string().min(1),
    attackCommand: z.string().min(1),
    verificationCommand: z.string().min(1),
    timeoutMs: z.number().int().positive().max(300_000),
    expectedState: ExpectedStateSchema,
  })
  .strict();

export const InvariantDefinitionSchema = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    version: z.number().int().positive(),
    title: z.string().min(1),
    statement: z.string().min(1),
    severity: z.enum(["critical", "high", "medium", "low"]),
    enabled: z.boolean(),
    tags: z.array(z.string().min(1)).min(1),
    scenario: ScenarioDefinitionSchema,
  })
  .strict();

export const ConstitutionSchema = z
  .object({
    schemaVersion: z.literal(CONSTITUTION_SCHEMA_VERSION),
    name: z.string().min(1),
    description: z.string().min(1),
    invariants: z.array(InvariantDefinitionSchema).min(1),
  })
  .strict()
  .superRefine((constitution, context) => {
    const ids = new Set<string>();
    for (const [index, invariant] of constitution.invariants.entries()) {
      if (ids.has(invariant.id)) {
        context.addIssue({
          code: "custom",
          message: `Duplicate invariant id: ${invariant.id}`,
          path: ["invariants", index, "id"],
        });
      }
      ids.add(invariant.id);
    }
  });

export type TransferExpectedState = z.infer<typeof TransferExpectedStateSchema>;
export type PayloadBindingExpectedState = z.infer<
  typeof PayloadBindingExpectedStateSchema
>;
export type ScenarioDefinition = z.infer<typeof ScenarioDefinitionSchema>;
export type InvariantDefinition = z.infer<typeof InvariantDefinitionSchema>;
export type Constitution = z.infer<typeof ConstitutionSchema>;

export const TRANSFER_IDEMPOTENCY_STATEMENT =
  "The same transfer request must never debit a wallet more than once, including after a network timeout, client retry, duplicate callback, or concurrent duplicate request." as const;

export const IDEMPOTENCY_KEY_PAYLOAD_BINDING_STATEMENT =
  "The same idempotency key must never be accepted for two semantically different transfer requests." as const;

export const DEFAULT_CONSTITUTION: Constitution = ConstitutionSchema.parse({
  schemaVersion: CONSTITUTION_SCHEMA_VERSION,
  name: "QEDRA Constitution",
  description:
    "Non-negotiable software laws enforced by deterministic attacks and verification.",
  invariants: [
    {
      id: TRANSFER_IDEMPOTENCY,
      version: 1,
      title: "Transfer idempotency",
      statement: TRANSFER_IDEMPOTENCY_STATEMENT,
      severity: "critical",
      enabled: true,
      tags: ["payments", "idempotency", "ledger"],
      scenario: {
        id: "transfer-timeout-after-commit-retry",
        deterministicSeed: "qedra-transfer-idempotency-seed-v1",
        description:
          "Commit TX-001, lose the response, and retry the exact request with the same idempotency key.",
        attackCommand:
          "node --import tsx packages/cli/src/bin.ts attack TRANSFER_IDEMPOTENCY --target vulnerable --json",
        verificationCommand:
          "node --import tsx packages/cli/src/bin.ts verify TRANSFER_IDEMPOTENCY --target fixed --json",
        timeoutMs: 30_000,
        expectedState: {
          sourceBalance: 9_000,
          destinationBalance: 6_000,
          debitEntries: 1,
          creditEntries: 1,
        },
      },
    },
    {
      id: IDEMPOTENCY_KEY_PAYLOAD_BINDING,
      version: 1,
      title: "Idempotency key payload binding",
      statement: IDEMPOTENCY_KEY_PAYLOAD_BINDING_STATEMENT,
      severity: "critical",
      enabled: true,
      tags: ["payments", "idempotency", "payload-integrity"],
      scenario: {
        id: "idempotency-key-payload-conflict",
        deterministicSeed: "qedra-idempotency-key-payload-binding-seed-v1",
        description:
          "Commit TX-001, then reuse its idempotency key with a different amount, destination, and source.",
        attackCommand:
          "node --import tsx packages/cli/src/bin.ts attack IDEMPOTENCY_KEY_PAYLOAD_BINDING --target vulnerable --json",
        verificationCommand:
          "node --import tsx packages/cli/src/bin.ts verify IDEMPOTENCY_KEY_PAYLOAD_BINDING --target fixed --json",
        timeoutMs: 30_000,
        expectedState: {
          sourceBalance: 9_000,
          destinationBalance: 6_000,
          alternateDestinationBalance: 2_000,
          ledgerEntries: 2,
          conflictStatusCode: 409,
          conflictError: "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD",
          identicalRetryStatusCode: 200,
        },
      },
    },
  ],
});
