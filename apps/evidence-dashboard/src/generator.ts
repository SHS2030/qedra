import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import type {
  Counterexample,
  Passport,
  RepairEvidence,
} from "../../../packages/proof-passport/src/index.js";

import { dashboardShell } from "./template.js";

export const DASHBOARD_SCHEMA_VERSION = "qedra.evidence-dashboard.v1" as const;

export interface DashboardArtifacts {
  readonly counterexample: Counterexample;
  readonly repair: RepairEvidence;
  readonly passport: Passport;
}

export interface DashboardGenerationOptions {
  /** Defaults to apps/evidence-dashboard/public below the supplied repository root. */
  readonly outputDirectory?: string;
  /** Defaults to the current working directory. */
  readonly repositoryRoot?: string;
}

export interface DashboardTimelineEvent {
  readonly sequence: number;
  readonly type: string;
  readonly label: string;
  readonly requestId: string | null;
  readonly requestPath: string | null;
  readonly expectedStatusCode: number | null;
  readonly actualStatusCode: number | null;
  readonly responseMatched: boolean | null;
  readonly emphasis: "setup" | "timeout" | "retry" | "observation";
}

export interface DashboardComparisonRow {
  readonly metric: string;
  readonly before: unknown;
  readonly afterTarget: unknown;
  readonly changed: boolean;
}

export interface DashboardIntegrityCheck {
  readonly label: string;
  readonly valid: boolean;
  readonly hash: string | null;
}

export interface DashboardData {
  readonly schemaVersion: typeof DASHBOARD_SCHEMA_VERSION;
  readonly generatedAt: string;
  readonly law: {
    readonly id: string;
    readonly statement: string;
  };
  readonly initialState: Record<string, unknown> | null;
  readonly timeline: readonly DashboardTimelineEvent[];
  readonly counterexample: {
    readonly scenarioId: string;
    readonly deterministicSeed: string;
    readonly evidenceHash: string;
    readonly expectedState: Record<string, unknown>;
    readonly actualState: Record<string, unknown>;
    readonly affectedFiles: readonly string[];
    readonly reproductionCommand: string;
    readonly status: "CONFIRMED";
  };
  readonly repair: {
    readonly mode: RepairEvidence["mode"];
    readonly status: RepairEvidence["status"];
    readonly requestArtifact: RepairEvidence["requestArtifact"];
    readonly diffArtifact: RepairEvidence["diffArtifact"];
    readonly authentication: RepairEvidence["authentication"];
    readonly limits: RepairEvidence["limits"];
    readonly attempts: RepairEvidence["attempts"];
    readonly validation: RepairEvidence["validation"];
  };
  readonly comparison: {
    readonly beforeResult: Passport["attack"]["status"];
    readonly afterResult: Passport["verification"]["status"];
    readonly replayResult: Passport["replay"]["status"];
    readonly afterStateLabel: string;
    readonly rows: readonly DashboardComparisonRow[];
  };
  readonly replay: {
    readonly result: Passport["replay"]["status"];
    readonly command: string;
    readonly completedAt: string | null;
    /** Recorded by the scenario engine before the counterexample is emitted. */
    readonly exactRequestHash: string;
    /** Independently recomputed from the canonical HTTP events for comparison. */
    readonly recomputedRequestHash: string | null;
    readonly requestHashMatches: boolean;
    readonly artifactPath: string | null;
    readonly artifactSha256: string | null;
  };
  readonly passport: {
    readonly evidenceHash: string;
    readonly integrity: "VERIFIED" | "INVALID";
    readonly evidenceBundleIntegrity: "VERIFIED" | "INVALID";
    readonly checks: readonly DashboardIntegrityCheck[];
    readonly artifactCount: number;
    readonly repository: Passport["repository"];
    readonly limitations: readonly string[];
    readonly reproductionCommands: readonly string[];
  };
  readonly humanApproval: {
    readonly required: boolean;
    readonly status: "PENDING";
    readonly explanation: string;
  };
}

export interface GeneratedDashboard {
  readonly indexPath: string;
  readonly dataPath: string;
  readonly data: DashboardData;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function canonicalize(value: unknown, ancestors = new Set<object>()): unknown {
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
        "Dashboard JSON does not support non-finite numbers.",
      );
    }
    return Object.is(value, -0) ? 0 : value;
  }
  if (typeof value !== "object") {
    throw new TypeError(
      `Dashboard JSON does not support values of type ${typeof value}.`,
    );
  }
  if (ancestors.has(value)) {
    throw new TypeError("Dashboard JSON does not support circular references.");
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return value.map((entry) => canonicalize(entry, ancestors));
    }
    const normalized: Record<string, unknown> = {};
    for (const key of Object.keys(value).sort()) {
      normalized[key] = canonicalize(
        (value as Record<string, unknown>)[key],
        ancestors,
      );
    }
    return normalized;
  } finally {
    ancestors.delete(value);
  }
}

function canonicalJson(value: unknown, space?: number): string {
  return JSON.stringify(canonicalize(value), undefined, space);
}

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function withoutEvidenceHash(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (key !== "evidenceHash") {
      result[key] = item;
    }
  }
  return result;
}

function evidenceHashValid(value: unknown): boolean {
  if (!isRecord(value) || typeof value.evidenceHash !== "string") {
    return false;
  }
  const unsigned = withoutEvidenceHash(value);
  return (
    unsigned !== null &&
    /^[0-9a-f]{64}$/u.test(value.evidenceHash) &&
    sha256(canonicalJson(unsigned)) === value.evidenceHash
  );
}

function evidenceDocumentsMatch(left: unknown, right: unknown): boolean {
  try {
    return canonicalJson(left) === canonicalJson(right);
  } catch {
    return false;
  }
}

function requestFromEvent(
  event: Counterexample["events"][number],
): Record<string, unknown> | null {
  const request = event.data.request;
  return isRecord(request) ? request : null;
}

function responseFromEvent(
  event: Counterexample["events"][number],
): Record<string, unknown> | null {
  const response = event.data.response;
  return isRecord(response) ? response : null;
}

function sortedStringRecord(value: unknown): Record<string, string> | null {
  if (!isRecord(value)) {
    return null;
  }
  const result: Record<string, string> = {};
  for (const key of Object.keys(value).sort()) {
    const item = value[key];
    if (typeof item !== "string") {
      return null;
    }
    result[key] = item;
  }
  return result;
}

/** Recreates the scenario engine's exact request-sequence fingerprint. */
export function exactRequestHash(
  counterexample: Counterexample,
): string | null {
  const requests: Record<string, unknown>[] = [];
  for (const event of counterexample.events) {
    const request = requestFromEvent(event);
    if (request === null) {
      return null;
    }
    const { method, path, bodyText } = request;
    const headers = sortedStringRecord(request.headers);
    if (
      typeof method !== "string" ||
      typeof path !== "string" ||
      headers === null ||
      (bodyText !== undefined && typeof bodyText !== "string")
    ) {
      return null;
    }
    const fingerprintRequest: Record<string, unknown> = {
      method,
      path,
      headers,
    };
    if (typeof bodyText === "string") {
      fingerprintRequest.bodyText = bodyText;
    }
    requests.push(fingerprintRequest);
  }
  return sha256(canonicalJson(requests));
}

function extractInitialState(
  counterexample: Counterexample,
): Record<string, unknown> | null {
  const seed = counterexample.events.find((event) => event.type === "SEED");
  if (seed === undefined) {
    return null;
  }
  const request = requestFromEvent(seed);
  if (request === null || !isRecord(request.body)) {
    return null;
  }
  const wallets = request.body.wallets;
  return isRecord(wallets) ? wallets : null;
}

function timelineLabel(type: string): string {
  const labels: Readonly<Record<string, string>> = {
    RESET: "Reset deterministic state",
    SEED: "Seed wallet balances",
    TRANSFER_TIMEOUT_AFTER_COMMIT: "Commit transfer, then return timeout",
    TRANSFER_RETRY: "Retry the identical transfer request",
    READ_BALANCES: "Observe final balances",
    READ_LEDGER: "Observe transfer ledger",
  };
  return labels[type] ?? type.replaceAll("_", " ").toLowerCase();
}

function timelineEmphasis(type: string): DashboardTimelineEvent["emphasis"] {
  if (type === "TRANSFER_TIMEOUT_AFTER_COMMIT") {
    return "timeout";
  }
  if (type === "TRANSFER_RETRY") {
    return "retry";
  }
  if (type.startsWith("READ_")) {
    return "observation";
  }
  return "setup";
}

function timeline(counterexample: Counterexample): DashboardTimelineEvent[] {
  return counterexample.events.map((event) => {
    const request = requestFromEvent(event);
    const response = responseFromEvent(event);
    const expectedStatusCode = event.data.expectedStatusCode;
    const actualStatusCode = response?.statusCode;
    const expected =
      typeof expectedStatusCode === "number" ? expectedStatusCode : null;
    const actual =
      typeof actualStatusCode === "number" ? actualStatusCode : null;
    return {
      sequence: event.sequence,
      type: event.type,
      label: timelineLabel(event.type),
      requestId: event.requestId,
      requestPath:
        request !== null && typeof request.path === "string"
          ? request.path
          : null,
      expectedStatusCode: expected,
      actualStatusCode: actual,
      responseMatched:
        expected === null || actual === null ? null : expected === actual,
      emphasis: timelineEmphasis(event.type),
    };
  });
}

function comparableScalars(
  value: Record<string, unknown>,
): Map<string, unknown> {
  const scalars = new Map<string, unknown>();
  for (const [key, item] of Object.entries(value)) {
    if (key === "relevantLedgerEntries") {
      continue;
    }
    if (isRecord(item)) {
      for (const [childKey, childItem] of Object.entries(item)) {
        if (!isRecord(childItem) && !Array.isArray(childItem)) {
          scalars.set(`${key}.${childKey}`, childItem);
        }
      }
      continue;
    }
    if (!Array.isArray(item)) {
      scalars.set(key, item);
    }
  }
  return scalars;
}

function comparisonRows(
  expected: Record<string, unknown>,
  actual: Record<string, unknown>,
): DashboardComparisonRow[] {
  const expectedValues = comparableScalars(expected);
  const actualValues = comparableScalars(actual);
  const keys = new Set([...expectedValues.keys(), ...actualValues.keys()]);
  return [...keys]
    .sort((left, right) => left.localeCompare(right))
    .map((metric) => {
      const before = actualValues.get(metric) ?? null;
      const afterTarget = expectedValues.get(metric) ?? null;
      return {
        metric,
        before,
        afterTarget,
        changed: canonicalJson(before) !== canonicalJson(afterTarget),
      };
    });
}

function integrityChecks(
  artifacts: DashboardArtifacts,
): readonly DashboardIntegrityCheck[] {
  const { counterexample, repair, passport } = artifacts;
  const recomputedRequestHash = exactRequestHash(counterexample);
  return [
    {
      label: "Counterexample evidence hash",
      valid: evidenceHashValid(counterexample),
      hash: counterexample.evidenceHash,
    },
    {
      label: "Repair evidence hash",
      valid: evidenceHashValid(repair),
      hash: repair.evidenceHash,
    },
    {
      label: "Embedded repair evidence hash",
      valid: evidenceHashValid(passport.repair),
      hash: passport.repair.evidenceHash,
    },
    {
      label: "Repair evidence matches passport",
      valid: evidenceDocumentsMatch(repair, passport.repair),
      hash: repair.evidenceHash,
    },
    {
      label: "Passport evidence hash",
      valid: evidenceHashValid(passport),
      hash: passport.evidenceHash,
    },
    {
      label: "Invariant identity is consistent",
      valid:
        counterexample.invariant.id === repair.invariant.id &&
        repair.invariant.id === passport.invariant.id,
      hash: null,
    },
    {
      label: "Exact attack request hash",
      valid:
        recomputedRequestHash !== null &&
        recomputedRequestHash === counterexample.scenario.attackRequestHash,
      hash: counterexample.scenario.attackRequestHash,
    },
  ];
}

/** Builds the stable, JSON-safe view model used by both dashboard outputs. */
export function buildDashboardData(
  artifacts: DashboardArtifacts,
): DashboardData {
  const { counterexample, repair, passport } = artifacts;
  const recomputedRequestHash = exactRequestHash(counterexample);
  const checks = integrityChecks(artifacts);
  const embeddedRepairValid = checks[2]?.valid === true;
  const passportHashValid = checks[4]?.valid === true;
  const passportIntegrityValid = embeddedRepairValid && passportHashValid;
  const bundleIntegrityValid = checks.every((check) => check.valid);
  const replayVerified =
    passport.replay.status === "PASS" &&
    passport.verification.status === "PASS";

  return {
    schemaVersion: DASHBOARD_SCHEMA_VERSION,
    generatedAt: passport.generatedAt,
    law: {
      id: passport.invariant.id,
      statement: passport.invariant.statement,
    },
    initialState: extractInitialState(counterexample),
    timeline: timeline(counterexample),
    counterexample: {
      scenarioId: counterexample.scenario.id,
      deterministicSeed: counterexample.scenario.deterministicSeed,
      evidenceHash: counterexample.evidenceHash,
      expectedState: counterexample.expectedState,
      actualState: counterexample.actualState,
      affectedFiles: counterexample.affectedFiles,
      reproductionCommand: counterexample.reproductionCommand,
      status: "CONFIRMED",
    },
    repair: {
      mode: repair.mode,
      status: repair.status,
      requestArtifact: repair.requestArtifact,
      diffArtifact: repair.diffArtifact,
      authentication: repair.authentication,
      limits: repair.limits,
      attempts: repair.attempts,
      validation: repair.validation,
    },
    comparison: {
      beforeResult: passport.attack.status,
      afterResult: passport.verification.status,
      replayResult: passport.replay.status,
      afterStateLabel: replayVerified
        ? "Expected state satisfied by deterministic replay and verification"
        : "Expected state target; replay verification is not complete",
      rows: comparisonRows(
        counterexample.expectedState,
        counterexample.actualState,
      ),
    },
    replay: {
      result: passport.replay.status,
      command: passport.replay.command,
      completedAt: passport.replay.completedAt,
      exactRequestHash: counterexample.scenario.attackRequestHash,
      recomputedRequestHash,
      requestHashMatches:
        recomputedRequestHash !== null &&
        recomputedRequestHash === counterexample.scenario.attackRequestHash,
      artifactPath: passport.replay.artifact?.path ?? null,
      artifactSha256: passport.replay.artifact?.sha256 ?? null,
    },
    passport: {
      evidenceHash: passport.evidenceHash,
      integrity: passportIntegrityValid ? "VERIFIED" : "INVALID",
      evidenceBundleIntegrity: bundleIntegrityValid ? "VERIFIED" : "INVALID",
      checks,
      artifactCount: passport.artifacts.length,
      repository: passport.repository,
      limitations: passport.limitations,
      reproductionCommands: passport.reproductionCommands,
    },
    humanApproval: {
      required:
        counterexample.kind === "qedra.counterexample" &&
        repair.humanApprovalRequired &&
        passport.humanApprovalRequired,
      status: "PENDING",
      explanation:
        "The repair remains unmerged until a human reviews the reproducible evidence and explicitly approves it.",
    },
  };
}

/**
 * Serializes JSON safely for both data.json and an inline script element.
 * Escaping HTML-significant characters prevents a value such as </script>
 * from terminating the inert application/json element.
 */
export function serializeDashboardData(data: DashboardData): string {
  return `${canonicalJson(data, 2)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029")}\n`;
}

/** Renders a single-file dashboard that works without a web server or network. */
export function renderEvidenceDashboard(artifacts: DashboardArtifacts): string {
  const serialized = serializeDashboardData(
    buildDashboardData(artifacts),
  ).trim();
  return dashboardShell(serialized);
}

/** Renders the polished empty shell committed with the repository. */
export function renderDashboardFallback(): string {
  return dashboardShell("null");
}

/** Writes index.html and data.json from the same evidence view model. */
export async function generateEvidenceDashboard(
  artifacts: DashboardArtifacts,
  options: DashboardGenerationOptions = {},
): Promise<GeneratedDashboard> {
  const repositoryRoot = options.repositoryRoot ?? process.cwd();
  const outputDirectory =
    options.outputDirectory ??
    resolve(repositoryRoot, "apps", "evidence-dashboard", "public");
  const indexPath = resolve(outputDirectory, "index.html");
  const dataPath = resolve(outputDirectory, "data.json");
  const data = buildDashboardData(artifacts);

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all([
    writeFile(indexPath, dashboardShell(serializeDashboardData(data).trim()), {
      encoding: "utf8",
    }),
    writeFile(dataPath, serializeDashboardData(data), { encoding: "utf8" }),
  ]);

  return { indexPath, dataPath, data };
}
