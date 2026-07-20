import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { z } from "zod";

import {
  addEvidenceHash,
  parseAndVerifyPassport,
  verifyEvidenceHash,
  type Passport,
} from "../../proof-passport/src/index.js";
import {
  atomicWriteJson,
  atomicWriteText,
  canonicalJsonStringify,
  sha256Hex,
} from "../../shared/src/index.js";

import {
  EVIDENCE_DASHBOARD_DATA_PATH,
  EVIDENCE_DASHBOARD_HTML_PATH,
  EVIDENCE_SUMMARY_PATH,
  SUPPORTED_INVARIANT_IDS,
  invariantEvidencePaths,
  type SupportedInvariantId,
} from "./evidence-layout.js";

export const EVIDENCE_SUMMARY_SCHEMA_VERSION =
  "qedra.evidence-summary.v1" as const;
export const EVIDENCE_SUMMARY_DASHBOARD_SCHEMA_VERSION =
  "qedra.evidence-summary-dashboard.v1" as const;

const Sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u);
const CommitSchema = z.string().regex(/^[0-9a-f]{40,64}$/u);
const SupportedInvariantIdSchema = z.enum(SUPPORTED_INVARIANT_IDS);
const HumanApprovalSchema = z
  .object({
    required: z.literal(true),
    status: z.literal("PENDING"),
  })
  .strict();

const SummaryInvariantSchema = z
  .object({
    invariantId: SupportedInvariantIdSchema,
    statement: z.string().min(1),
    evidenceDirectory: z.string().min(1),
    repositoryCommit: CommitSchema,
    passport: z
      .object({
        path: z.string().min(1),
        sha256: Sha256Schema,
        evidenceHash: Sha256Schema,
        generatedAt: z.string().datetime({ offset: true }),
      })
      .strict(),
    proof: z
      .object({
        attack: z.literal("FAIL"),
        repair: z.literal("replayed"),
        replay: z.literal("PASS"),
        verification: z.literal("PASS"),
      })
      .strict(),
    humanApproval: HumanApprovalSchema,
  })
  .strict();

function requireExactInvariantOrder(
  values: readonly { readonly invariantId: SupportedInvariantId }[],
  context: z.RefinementCtx,
): void {
  if (values.length !== SUPPORTED_INVARIANT_IDS.length) {
    context.addIssue({
      code: "custom",
      message: `Expected exactly ${String(SUPPORTED_INVARIANT_IDS.length)} invariants.`,
    });
    return;
  }
  const seen = new Set<SupportedInvariantId>();
  values.forEach((value, index) => {
    if (seen.has(value.invariantId)) {
      context.addIssue({
        code: "custom",
        message: `Duplicate invariant: ${value.invariantId}.`,
        path: [index, "invariantId"],
      });
    }
    seen.add(value.invariantId);
    if (value.invariantId !== SUPPORTED_INVARIANT_IDS[index]) {
      context.addIssue({
        code: "custom",
        message: "Invariants must use the canonical supported order.",
        path: [index, "invariantId"],
      });
    }
  });
}

export const EvidenceSummarySchema = z
  .object({
    schemaVersion: z.literal(EVIDENCE_SUMMARY_SCHEMA_VERSION),
    kind: z.literal("qedra.evidence-summary"),
    generatedAt: z.string().datetime({ offset: true }),
    repository: z
      .object({
        commit: CommitSchema,
        branch: z.string().min(1).nullable(),
      })
      .strict(),
    invariants: z.array(SummaryInvariantSchema),
    humanApproval: HumanApprovalSchema,
    evidenceHash: Sha256Schema,
  })
  .strict()
  .superRefine((summary, context) => {
    requireExactInvariantOrder(summary.invariants, context);
    const directories = summary.invariants.map(
      (invariant) => invariant.evidenceDirectory,
    );
    if (new Set(directories).size !== directories.length) {
      context.addIssue({
        code: "custom",
        message: "Invariant evidence directories must be distinct.",
        path: ["invariants"],
      });
    }
    summary.invariants.forEach((invariant, index) => {
      if (invariant.repositoryCommit !== summary.repository.commit) {
        context.addIssue({
          code: "custom",
          message: "Every passport must use the common repository commit.",
          path: ["invariants", index, "repositoryCommit"],
        });
      }
    });
  });

const DashboardInvariantSchema = z
  .object({
    invariantId: SupportedInvariantIdSchema,
    statement: z.string().min(1),
    passportPath: z.string().min(1),
    passportEvidenceHash: Sha256Schema,
    attack: z.literal("FAIL"),
    repair: z.literal("replayed"),
    replay: z.literal("PASS"),
    verification: z.literal("PASS"),
    humanApproval: HumanApprovalSchema,
  })
  .strict();

export const EvidenceSummaryDashboardDataSchema = z
  .object({
    schemaVersion: z.literal(EVIDENCE_SUMMARY_DASHBOARD_SCHEMA_VERSION),
    kind: z.literal("qedra.evidence-summary-dashboard"),
    generatedAt: z.string().datetime({ offset: true }),
    summary: z
      .object({
        path: z.literal(EVIDENCE_SUMMARY_PATH),
        sha256: Sha256Schema,
        evidenceHash: Sha256Schema,
      })
      .strict(),
    repositoryCommit: CommitSchema,
    invariants: z.array(DashboardInvariantSchema),
    humanApproval: HumanApprovalSchema,
    evidenceHash: Sha256Schema,
  })
  .strict()
  .superRefine((dashboard, context) => {
    requireExactInvariantOrder(dashboard.invariants, context);
  });

export type EvidenceSummary = z.infer<typeof EvidenceSummarySchema>;
export type EvidenceSummaryDashboardData = z.infer<
  typeof EvidenceSummaryDashboardDataSchema
>;

interface LoadedPassport {
  readonly invariantId: SupportedInvariantId;
  readonly path: string;
  readonly bytes: Buffer;
  readonly passport: Passport;
}

export interface EvidenceSummaryGenerationResult {
  readonly summary: EvidenceSummary;
  readonly dashboard: EvidenceSummaryDashboardData;
  readonly paths: {
    readonly summary: typeof EVIDENCE_SUMMARY_PATH;
    readonly dashboardData: typeof EVIDENCE_DASHBOARD_DATA_PATH;
    readonly dashboardHtml: typeof EVIDENCE_DASHBOARD_HTML_PATH;
  };
}

export interface EvidenceSummaryVerificationResult {
  readonly status: "VERIFIED" | "INVALID";
  readonly evidenceHash: string | null;
  readonly repositoryCommit: string | null;
  readonly invariantIds: readonly SupportedInvariantId[];
  readonly humanApprovalRequired: boolean | null;
  readonly approvalStatus: "PENDING" | null;
  readonly error: string | null;
}

function summaryBytes(summary: EvidenceSummary): string {
  return `${canonicalJsonStringify(summary, 2)}\n`;
}

function dashboardBytes(dashboard: EvidenceSummaryDashboardData): string {
  return `${canonicalJsonStringify(dashboard, 2)}\n`;
}

function assertScopedPath(
  path: string,
  invariantId: SupportedInvariantId,
): void {
  const directory = invariantEvidencePaths(invariantId).directory;
  if (
    path !== "constitutions/qedra.yaml" &&
    !path.startsWith(`${directory}/`)
  ) {
    throw new Error(
      `Artifact ${path} is outside the ${invariantId} evidence directory.`,
    );
  }
}

function assertPassportPolicy(
  passport: Passport,
  invariantId: SupportedInvariantId,
): void {
  const paths = invariantEvidencePaths(invariantId);
  if (
    passport.invariant.id !== invariantId ||
    passport.repair.invariant.id !== invariantId ||
    passport.repair.invariant.statement !== passport.invariant.statement
  ) {
    throw new Error(`Passport identity mismatch for ${invariantId}.`);
  }
  if (
    passport.humanApprovalRequired !== true ||
    passport.repair.humanApprovalRequired !== true
  ) {
    throw new Error(`Human approval is not mandatory for ${invariantId}.`);
  }
  if (
    passport.qualification.status !== "PASS" ||
    passport.attack.status !== "FAIL" ||
    passport.repair.mode !== "record-replay" ||
    passport.repair.status !== "replayed" ||
    passport.repair.validation.passed !== true ||
    passport.replay.status !== "PASS" ||
    passport.verification.status !== "PASS"
  ) {
    throw new Error(`Passport proof loop is not green for ${invariantId}.`);
  }
  if (
    passport.repair.isolation.worktreePath !== null &&
    passport.repair.isolation.worktreePath !== paths.worktree
  ) {
    throw new Error(`Passport worktree mismatch for ${invariantId}.`);
  }

  const referencedPaths = [
    ...passport.artifacts.map((artifact) => artifact.path),
    passport.qualification.artifact?.path,
    passport.attack.artifact?.path,
    passport.replay.artifact?.path,
    passport.verification.artifact?.path,
    passport.repair.requestArtifact.path,
    passport.repair.diffArtifact?.path,
  ].filter((path): path is string => path !== undefined);
  referencedPaths.forEach((path) => {
    assertScopedPath(path, invariantId);
  });
}

async function loadPassport(
  repositoryRoot: string,
  invariantId: SupportedInvariantId,
): Promise<LoadedPassport> {
  const path = invariantEvidencePaths(invariantId).passportJson;
  const bytes = await readFile(resolve(repositoryRoot, path));
  const passport = parseAndVerifyPassport(
    JSON.parse(bytes.toString("utf8")) as unknown,
  );
  assertPassportPolicy(passport, invariantId);
  return { invariantId, path, bytes, passport };
}

async function loadPassports(
  repositoryRoot: string,
): Promise<LoadedPassport[]> {
  return await Promise.all(
    SUPPORTED_INVARIANT_IDS.map(
      async (invariantId) => await loadPassport(repositoryRoot, invariantId),
    ),
  );
}

function buildSummary(passports: readonly LoadedPassport[]): EvidenceSummary {
  const first = passports[0];
  if (first === undefined) {
    throw new Error("No evidence passports were loaded.");
  }
  const commit = first.passport.repository.commit;
  if (commit === null) {
    throw new Error("Evidence passports require a committed repository base.");
  }
  const branch = first.passport.repository.branch;
  for (const loaded of passports) {
    if (loaded.passport.repository.commit !== commit) {
      throw new Error("Evidence passports belong to different commits.");
    }
    if (loaded.passport.repository.branch !== branch) {
      throw new Error("Evidence passports belong to different branches.");
    }
  }
  const generatedAt = passports
    .map((loaded) => loaded.passport.generatedAt)
    .toSorted((left, right) => left.localeCompare(right))
    .at(-1);
  if (generatedAt === undefined) {
    throw new Error("Evidence passports do not contain a generation time.");
  }

  const unsigned = {
    schemaVersion: EVIDENCE_SUMMARY_SCHEMA_VERSION,
    kind: "qedra.evidence-summary" as const,
    generatedAt,
    repository: { commit, branch },
    invariants: passports.map((loaded) => ({
      invariantId: loaded.invariantId,
      statement: loaded.passport.invariant.statement,
      evidenceDirectory: invariantEvidencePaths(loaded.invariantId).directory,
      repositoryCommit: commit,
      passport: {
        path: loaded.path,
        sha256: sha256Hex(loaded.bytes),
        evidenceHash: loaded.passport.evidenceHash,
        generatedAt: loaded.passport.generatedAt,
      },
      proof: {
        attack: "FAIL" as const,
        repair: "replayed" as const,
        replay: "PASS" as const,
        verification: "PASS" as const,
      },
      humanApproval: { required: true as const, status: "PENDING" as const },
    })),
    humanApproval: { required: true as const, status: "PENDING" as const },
  };
  return EvidenceSummarySchema.parse(addEvidenceHash(unsigned));
}

export function buildEvidenceSummaryDashboardData(
  summary: EvidenceSummary,
): EvidenceSummaryDashboardData {
  const verifiedSummary = EvidenceSummarySchema.parse(summary);
  if (!verifyEvidenceHash(verifiedSummary)) {
    throw new Error("Evidence summary hash is invalid.");
  }
  const unsigned = {
    schemaVersion: EVIDENCE_SUMMARY_DASHBOARD_SCHEMA_VERSION,
    kind: "qedra.evidence-summary-dashboard" as const,
    generatedAt: verifiedSummary.generatedAt,
    summary: {
      path: EVIDENCE_SUMMARY_PATH,
      sha256: sha256Hex(summaryBytes(verifiedSummary)),
      evidenceHash: verifiedSummary.evidenceHash,
    },
    repositoryCommit: verifiedSummary.repository.commit,
    invariants: verifiedSummary.invariants.map((invariant) => ({
      invariantId: invariant.invariantId,
      statement: invariant.statement,
      passportPath: invariant.passport.path,
      passportEvidenceHash: invariant.passport.evidenceHash,
      attack: invariant.proof.attack,
      repair: invariant.proof.repair,
      replay: invariant.proof.replay,
      verification: invariant.proof.verification,
      humanApproval: invariant.humanApproval,
    })),
    humanApproval: verifiedSummary.humanApproval,
  };
  return EvidenceSummaryDashboardDataSchema.parse(addEvidenceHash(unsigned));
}

function escapeHtml(value: unknown): string {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function renderEvidenceSummaryDashboardHtml(
  dashboard: EvidenceSummaryDashboardData,
): string {
  const data = EvidenceSummaryDashboardDataSchema.parse(dashboard);
  if (!verifyEvidenceHash(data)) {
    throw new Error("Evidence dashboard data hash is invalid.");
  }
  const cards = data.invariants
    .map(
      (invariant) => `<article class="law">
        <p class="eyebrow">Financial law</p>
        <h2>${escapeHtml(invariant.invariantId)}</h2>
        <p>${escapeHtml(invariant.statement)}</p>
        <dl>
          <div><dt>Vulnerable attack</dt><dd class="fail">${escapeHtml(invariant.attack)}</dd></div>
          <div><dt>Recorded repair</dt><dd class="pass">${escapeHtml(invariant.repair)}</dd></div>
          <div><dt>Exact replay</dt><dd class="pass">${escapeHtml(invariant.replay)}</dd></div>
          <div><dt>Verification</dt><dd class="pass">${escapeHtml(invariant.verification)}</dd></div>
        </dl>
        <p class="hash"><strong>Passport</strong><br>${escapeHtml(invariant.passportPath)}<br>${escapeHtml(invariant.passportEvidenceHash)}</p>
      </article>`,
    )
    .join("\n");
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>QEDRA — Two-law evidence summary</title>
  <style>
    :root{color-scheme:dark;--bg:#07100d;--panel:#101b17;--line:#29443a;--ink:#f4fbf7;--muted:#9eb7ac;--green:#56e39f;--red:#ff6b6b;--amber:#ffd166}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at top right,#17362a 0,var(--bg) 38rem);color:var(--ink);font:15px/1.55 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}main{max-width:1120px;margin:auto;padding:48px 24px 80px}h1{font-size:clamp(2.5rem,7vw,5rem);line-height:.95;letter-spacing:-.06em;margin:.2em 0}.lead{max-width:760px;color:var(--muted);font-size:1.12rem}.eyebrow{color:var(--green);font-weight:800;letter-spacing:.13em;text-transform:uppercase}.meta,.law,.approval{border:1px solid var(--line);border-radius:16px;background:rgba(16,27,23,.94);padding:20px}.meta{margin:30px 0;color:var(--muted)}.meta strong{color:var(--ink)}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px}.law h2{font-size:1.25rem;overflow-wrap:anywhere}.law>p:not(.eyebrow):not(.hash){color:var(--muted);min-height:4.7em}dl{margin:22px 0}dl div{display:flex;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding:9px 0}dd{margin:0;font-weight:800}.pass{color:var(--green)}.fail{color:var(--red)}.hash{color:var(--muted);font:12px/1.55 ui-monospace,"Cascadia Code",monospace;overflow-wrap:anywhere}.approval{margin-top:20px;border-color:var(--amber);color:var(--amber);font-weight:800}@media(max-width:640px){main{padding:30px 16px 60px}}
  </style>
</head>
<body>
<main>
  <p class="eyebrow">Deterministic record/replay · machine-verifiable evidence</p>
  <h1>Two financial laws. One evidence checkpoint.</h1>
  <p class="lead">QEDRA reproduced both vulnerable behaviors, validated isolated recorded repairs, replayed the exact attacks, and verified every linked passport.</p>
  <section class="meta">Commit<br><strong>${escapeHtml(data.repositoryCommit)}</strong><br><br>Summary evidence hash<br><strong>${escapeHtml(data.summary.evidenceHash)}</strong></section>
  <section class="grid">${cards}</section>
  <section class="approval">Human approval: ${escapeHtml(data.humanApproval.status)} (required)</section>
</main>
</body>
</html>
`;
}

export async function generateEvidenceSummary(
  repositoryRoot: string,
): Promise<EvidenceSummaryGenerationResult> {
  const summary = buildSummary(await loadPassports(repositoryRoot));
  const dashboard = buildEvidenceSummaryDashboardData(summary);
  await atomicWriteJson(
    resolve(repositoryRoot, EVIDENCE_SUMMARY_PATH),
    summary,
  );
  await atomicWriteJson(
    resolve(repositoryRoot, EVIDENCE_DASHBOARD_DATA_PATH),
    dashboard,
  );
  await atomicWriteText(
    resolve(repositoryRoot, EVIDENCE_DASHBOARD_HTML_PATH),
    renderEvidenceSummaryDashboardHtml(dashboard),
  );
  return {
    summary,
    dashboard,
    paths: {
      summary: EVIDENCE_SUMMARY_PATH,
      dashboardData: EVIDENCE_DASHBOARD_DATA_PATH,
      dashboardHtml: EVIDENCE_DASHBOARD_HTML_PATH,
    },
  };
}

function parseSummary(source: string): EvidenceSummary {
  const summary = EvidenceSummarySchema.parse(JSON.parse(source) as unknown);
  if (!verifyEvidenceHash(summary)) {
    throw new Error("Evidence summary hash is invalid.");
  }
  if (source !== summaryBytes(summary)) {
    throw new Error("Evidence summary bytes are not canonical.");
  }
  return summary;
}

function parseDashboard(source: string): EvidenceSummaryDashboardData {
  const dashboard = EvidenceSummaryDashboardDataSchema.parse(
    JSON.parse(source) as unknown,
  );
  if (!verifyEvidenceHash(dashboard)) {
    throw new Error("Evidence dashboard data hash is invalid.");
  }
  if (source !== dashboardBytes(dashboard)) {
    throw new Error("Evidence dashboard data bytes are not canonical.");
  }
  return dashboard;
}

export async function verifyEvidenceSummary(
  repositoryRoot: string,
): Promise<EvidenceSummaryVerificationResult> {
  try {
    const [summarySource, dashboardSource, dashboardHtml, passports] =
      await Promise.all([
        readFile(resolve(repositoryRoot, EVIDENCE_SUMMARY_PATH), "utf8"),
        readFile(resolve(repositoryRoot, EVIDENCE_DASHBOARD_DATA_PATH), "utf8"),
        readFile(resolve(repositoryRoot, EVIDENCE_DASHBOARD_HTML_PATH), "utf8"),
        loadPassports(repositoryRoot),
      ]);
    const summary = parseSummary(summarySource);
    const expectedSummary = buildSummary(passports);
    if (
      canonicalJsonStringify(summary) !==
      canonicalJsonStringify(expectedSummary)
    ) {
      throw new Error("Evidence summary does not match the two passports.");
    }
    const dashboard = parseDashboard(dashboardSource);
    const expectedDashboard = buildEvidenceSummaryDashboardData(summary);
    if (
      canonicalJsonStringify(dashboard) !==
      canonicalJsonStringify(expectedDashboard)
    ) {
      throw new Error("Evidence dashboard data is stale or substituted.");
    }
    if (dashboardHtml !== renderEvidenceSummaryDashboardHtml(dashboard)) {
      throw new Error("Evidence dashboard HTML is stale or substituted.");
    }
    return {
      status: "VERIFIED",
      evidenceHash: summary.evidenceHash,
      repositoryCommit: summary.repository.commit,
      invariantIds: summary.invariants.map(
        (invariant) => invariant.invariantId,
      ),
      humanApprovalRequired: true,
      approvalStatus: "PENDING",
      error: null,
    };
  } catch (error) {
    return {
      status: "INVALID",
      evidenceHash: null,
      repositoryCommit: null,
      invariantIds: [],
      humanApprovalRequired: null,
      approvalStatus: null,
      error: error instanceof Error ? error.message : "Unknown error.",
    };
  }
}

export const generateEvidenceSummaryBundle = generateEvidenceSummary;
export const verifyEvidenceSummaryBundle = verifyEvidenceSummary;
