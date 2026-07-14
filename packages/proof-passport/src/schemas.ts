import { z } from "zod";

import type { JsonValue } from "../../shared/src/index.js";
import { isSafeRepositoryRelativePath } from "../../shared/src/index.js";

export const EVIDENCE_SCHEMA_VERSION = "1.0.0" as const;

export const EvidenceHashSchema = z.string().regex(/^[0-9a-f]{64}$/u);
export const TimestampSchema = z.string().datetime({ offset: true });
export const RelativeEvidencePathSchema = z
  .string()
  .min(1)
  .refine(
    isSafeRepositoryRelativePath,
    "Expected a safe repository-relative path.",
  );

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number().finite(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const JsonObjectSchema = z.record(z.string(), JsonValueSchema);

export const InvariantIdentitySchema = z
  .object({
    id: z.string().regex(/^[A-Z][A-Z0-9_]*$/u),
    statement: z.string().min(1),
  })
  .strict();

export const RepositoryEvidenceSchema = z
  .object({
    commit: z
      .string()
      .regex(/^[0-9a-f]{40,64}$/u)
      .nullable(),
    branch: z.string().min(1).nullable(),
    dirty: z.boolean().nullable(),
    remoteUrl: z.string().min(1).nullable(),
  })
  .strict();

export const ArtifactReferenceSchema = z
  .object({
    path: RelativeEvidencePathSchema,
    sha256: EvidenceHashSchema,
  })
  .strict();

export const CounterexampleEventSchema = z
  .object({
    sequence: z.number().int().nonnegative(),
    type: z.string().min(1),
    requestId: z.string().min(1).nullable(),
    occurredAt: TimestampSchema.nullable(),
    data: JsonObjectSchema,
  })
  .strict();

export const CounterexampleSchema = z
  .object({
    schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
    kind: z.literal("qedra.counterexample"),
    generatedAt: TimestampSchema,
    invariant: InvariantIdentitySchema,
    scenario: z
      .object({
        id: z.string().min(1),
        deterministicSeed: z.string().min(1),
        targetId: z.string().min(1),
        attackRequestHash: EvidenceHashSchema,
      })
      .strict(),
    events: z.array(CounterexampleEventSchema).min(1),
    expectedState: JsonObjectSchema,
    actualState: JsonObjectSchema,
    ledgerEntries: z.array(JsonObjectSchema),
    affectedFiles: z.array(RelativeEvidencePathSchema).min(1),
    reproductionCommand: z.string().min(1),
    repository: RepositoryEvidenceSchema,
    evidenceHash: EvidenceHashSchema,
  })
  .strict()
  .superRefine((counterexample, context) => {
    counterexample.events.forEach((event, index) => {
      if (event.sequence !== index) {
        context.addIssue({
          code: "custom",
          message: `Event sequence must be contiguous and start at zero; expected ${index}.`,
          path: ["events", index, "sequence"],
        });
      }
    });
  });

export const UnsignedCounterexampleSchema = CounterexampleSchema.omit({
  evidenceHash: true,
});

export const RepairAttemptSchema = z
  .object({
    attempt: z.number().int().positive(),
    mode: z.enum(["live", "record-replay"]),
    startedAt: TimestampSchema.nullable(),
    completedAt: TimestampSchema.nullable(),
    durationMs: z.number().nonnegative().nullable(),
    outcome: z.enum([
      "not-run",
      "succeeded",
      "failed",
      "timed-out",
      "no-progress",
    ]),
    codexCallId: z.string().min(1).nullable(),
    model: z.string().min(1).nullable(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    costUsd: z.number().nonnegative().nullable(),
    error: z.string().min(1).nullable(),
  })
  .strict();

export const RepairEvidenceSchema = z
  .object({
    schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
    kind: z.literal("qedra.repair"),
    generatedAt: TimestampSchema,
    invariant: InvariantIdentitySchema,
    mode: z.enum(["live", "record-replay"]),
    status: z.enum([
      "not-requested",
      "blocked",
      "requested",
      "applied",
      "validated",
      "failed",
      "replayed",
    ]),
    requestArtifact: ArtifactReferenceSchema,
    authentication: z
      .object({
        provider: z.literal("official-codex-sdk"),
        apiKeyDetected: z.boolean(),
        liveInvocationAttempted: z.boolean(),
        blocker: z.string().min(1).nullable(),
      })
      .strict(),
    limits: z
      .object({
        maxAttempts: z.number().int().positive(),
        timeoutMs: z.number().int().positive(),
        noProgressLimit: z.number().int().positive(),
      })
      .strict(),
    isolation: z
      .object({
        strategy: z.literal("git-worktree"),
        worktreePath: RelativeEvidencePathSchema.nullable(),
        baseCommit: z
          .string()
          .regex(/^[0-9a-f]{40,64}$/u)
          .nullable(),
      })
      .strict(),
    attempts: z.array(RepairAttemptSchema),
    diffArtifact: ArtifactReferenceSchema.nullable(),
    validation: z
      .object({
        commands: z.array(z.string().min(1)),
        passed: z.boolean().nullable(),
        completedAt: TimestampSchema.nullable(),
      })
      .strict(),
    humanApprovalRequired: z.literal(true),
    evidenceHash: EvidenceHashSchema,
  })
  .strict();

export const UnsignedRepairEvidenceSchema = RepairEvidenceSchema.omit({
  evidenceHash: true,
});

export const EvidenceResultSchema = z
  .object({
    status: z.enum(["PASS", "FAIL", "BLOCKED", "NOT_RUN"]),
    command: z.string().min(1),
    completedAt: TimestampSchema.nullable(),
    artifact: ArtifactReferenceSchema.nullable(),
  })
  .strict();

export const ObservableMetricsSchema = z
  .object({
    durationMs: z.number().nonnegative().nullable(),
    scenariosExecuted: z.number().int().nonnegative().nullable(),
    verificationCommandsExecuted: z.number().int().nonnegative().nullable(),
    repairAttempts: z.number().int().nonnegative().nullable(),
    codexCalls: z.number().int().nonnegative().nullable(),
    inputTokens: z.number().int().nonnegative().nullable(),
    outputTokens: z.number().int().nonnegative().nullable(),
    costUsd: z.number().nonnegative().nullable(),
    budgetThresholdUsd: z.number().nonnegative().nullable(),
    budgetExceeded: z.boolean().nullable(),
  })
  .strict();

export const PassportSchema = z
  .object({
    schemaVersion: z.literal(EVIDENCE_SCHEMA_VERSION),
    kind: z.literal("qedra.passport"),
    generatedAt: TimestampSchema,
    invariant: InvariantIdentitySchema,
    repository: RepositoryEvidenceSchema,
    qualification: EvidenceResultSchema,
    attack: EvidenceResultSchema,
    repair: RepairEvidenceSchema,
    replay: EvidenceResultSchema,
    verification: EvidenceResultSchema,
    artifacts: z.array(ArtifactReferenceSchema),
    reproductionCommands: z.array(z.string().min(1)).min(1),
    metrics: ObservableMetricsSchema,
    limitations: z.array(z.string().min(1)),
    humanApprovalRequired: z.literal(true),
    evidenceHash: EvidenceHashSchema,
  })
  .strict();

export const UnsignedPassportSchema = PassportSchema.omit({
  evidenceHash: true,
});

export type Counterexample = z.infer<typeof CounterexampleSchema>;
export type ArtifactReference = z.infer<typeof ArtifactReferenceSchema>;
export type UnsignedCounterexample = z.infer<
  typeof UnsignedCounterexampleSchema
>;
export type RepairAttempt = z.infer<typeof RepairAttemptSchema>;
export type RepairEvidence = z.infer<typeof RepairEvidenceSchema>;
export type UnsignedRepairEvidence = z.infer<
  typeof UnsignedRepairEvidenceSchema
>;
export type EvidenceResult = z.infer<typeof EvidenceResultSchema>;
export type ObservableMetrics = z.infer<typeof ObservableMetricsSchema>;
export type Passport = z.infer<typeof PassportSchema>;
export type UnsignedPassport = z.infer<typeof UnsignedPassportSchema>;
