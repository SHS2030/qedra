import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { generateEvidenceDashboard } from "../../../apps/evidence-dashboard/src/index.js";
import {
  detectOpenAiApiKeyPresence,
  REPAIR_REQUEST_SCHEMA_VERSION,
  REPAIR_RESULT_SCHEMA_VERSION,
  type RepairRequest,
  type RepairResult,
} from "../../codex-adapter/src/index.js";
import {
  addEvidenceHash,
  createPassport,
  createRepairEvidence,
  parseAndVerifyCounterexample,
  parseAndVerifyPassport,
  parseAndVerifyRepairEvidence,
  renderPassportHtml,
  verifyEvidenceHash,
  writePassportArtifacts,
  type ArtifactReference,
  type Counterexample,
  type Passport,
  type RepairEvidence,
} from "../../proof-passport/src/index.js";
import {
  atomicWriteJson,
  canonicalizeJson,
  readGitMetadata,
  sha256Hex,
} from "../../shared/src/index.js";
import type { TransferIdempotencyVerification } from "../../verification-engine/src/index.js";

import {
  COUNTEREXAMPLE_PATH,
  readCounterexample,
  scenarioRunFromCounterexample,
} from "./counterexample.js";
import { runProofLoop, type ProofLoopRun } from "./proof-loop.js";
import {
  REPAIR_DIFF_PATH,
  REPAIR_REPORT_PATH,
  REPAIR_REQUEST_PATH,
  type RepairExecution,
} from "./repair.js";

export const REPAIR_EVIDENCE_PATH = "evidence/repair-evidence.json" as const;
export const REPLAY_RESULT_PATH = "evidence/replay-result.json" as const;
export const VERIFICATION_RESULT_PATH =
  "evidence/verification-result.json" as const;
export const PASSPORT_JSON_PATH = "evidence/passport.json" as const;
export const PASSPORT_HTML_PATH = "evidence/passport.html" as const;
export const LIVE_REPAIR_BLOCKER_PATH =
  "evidence/live-repair-blocker.json" as const;
export const DASHBOARD_OUTPUT_PATH = "evidence/dashboard" as const;

interface SignedProofResult extends Record<string, unknown> {
  readonly evidenceHash: string;
}

export interface PassportGenerationResult {
  readonly passport: Passport;
  readonly repairEvidence: RepairEvidence;
  readonly replay: ProofLoopRun;
  readonly verification: ProofLoopRun;
  readonly paths: {
    readonly json: typeof PASSPORT_JSON_PATH;
    readonly html: typeof PASSPORT_HTML_PATH;
    readonly dashboard: string;
  };
}

export interface PassportVerificationCheck {
  readonly path: string;
  readonly expectedSha256: string;
  readonly actualSha256: string | null;
  readonly valid: boolean;
}

export interface PassportVerificationResult {
  readonly status: "VERIFIED" | "INVALID";
  readonly evidenceHash: string | null;
  readonly evidenceHashValid: boolean;
  readonly embeddedRepairHashValid: boolean;
  readonly passportHtmlMatches: boolean;
  readonly artifactChecks: readonly PassportVerificationCheck[];
  readonly humanApprovalRequired: boolean | null;
}

async function artifactReference(
  repositoryRoot: string,
  path: string,
): Promise<ArtifactReference> {
  return {
    path,
    sha256: sha256Hex(await readFile(resolve(repositoryRoot, path))),
  };
}

function commandText(command: string, args: readonly string[]): string {
  return [command, ...args]
    .map((part) =>
      /^[A-Za-z0-9_./:=@-]+$/u.test(part) ? part : JSON.stringify(part),
    )
    .join(" ");
}

function attemptOutcome(
  result: RepairResult,
): "not-run" | "succeeded" | "failed" | "timed-out" | "no-progress" {
  if (result.status === "SUCCEEDED") {
    return "succeeded";
  }
  if (result.status === "TIMED_OUT") {
    return "timed-out";
  }
  if (result.status === "NO_PROGRESS") {
    return "no-progress";
  }
  return result.attempts.length === 0 ? "not-run" : "failed";
}

function repairStatus(result: RepairResult): RepairEvidence["status"] {
  if (result.status === "SUCCEEDED") {
    return result.mode === "record-replay" ? "replayed" : "validated";
  }
  if (result.status === "AUTHENTICATION_REQUIRED") {
    return "blocked";
  }
  return "failed";
}

async function createRepairEvidenceArtifact(
  repositoryRoot: string,
  execution: RepairExecution,
  generatedAt: string,
): Promise<RepairEvidence> {
  const authentication = await detectOpenAiApiKeyPresence({
    cwd: repositoryRoot,
    env: process.env,
    envFiles: [".env.local", ".env"],
  });
  const validations = execution.result.validationResults ?? [];
  const requestArtifact = await artifactReference(
    repositoryRoot,
    REPAIR_REQUEST_PATH,
  );
  const hasDiff = (execution.result.patch?.content.length ?? 0) > 0;
  const outcome = attemptOutcome(execution.result);
  const blocker = authentication.present
    ? (execution.result.blocker?.message ?? null)
    : "OPENAI_API_KEY was not detected; live Codex repair was not invoked.";

  const repair = createRepairEvidence({
    schemaVersion: "1.0.0",
    kind: "qedra.repair",
    generatedAt,
    invariant: execution.request.invariant,
    mode: execution.request.mode,
    status: repairStatus(execution.result),
    requestArtifact,
    authentication: {
      provider: "official-codex-sdk",
      apiKeyDetected: authentication.present,
      liveInvocationAttempted:
        execution.request.mode === "live" &&
        authentication.present &&
        execution.result.attempts.length > 0,
      blocker,
    },
    limits: {
      maxAttempts: execution.request.limits.maxAttempts,
      timeoutMs: execution.request.limits.attemptTimeoutMs,
      noProgressLimit: execution.request.limits.noProgressLimit,
    },
    isolation: {
      strategy: "git-worktree",
      worktreePath: ".qedra/worktrees/transfer-idempotency",
      baseCommit: execution.request.repository.baseCommit,
    },
    attempts: execution.result.attempts.map((attempt) => ({
      attempt: attempt.attempt,
      mode: execution.request.mode,
      startedAt: null,
      completedAt: null,
      durationMs: attempt.durationMs,
      outcome,
      codexCallId: null,
      model: null,
      inputTokens: attempt.tokenUsage?.inputTokens ?? null,
      outputTokens: attempt.tokenUsage?.outputTokens ?? null,
      costUsd: null,
      error:
        outcome === "succeeded"
          ? null
          : (execution.result.blocker?.message ?? null),
    })),
    diffArtifact: hasDiff
      ? await artifactReference(repositoryRoot, REPAIR_DIFF_PATH)
      : null,
    validation: {
      commands: execution.request.validationCommands.map((validation) =>
        commandText(validation.command, validation.args),
      ),
      passed:
        validations.length === 0
          ? null
          : validations.every((validation) => validation.passed),
      completedAt: validations.length === 0 ? null : generatedAt,
    },
    humanApprovalRequired: true,
  });
  await atomicWriteJson(resolve(repositoryRoot, REPAIR_EVIDENCE_PATH), repair);
  return repair;
}

function proofResultArtifact(
  kind: "qedra.replay" | "qedra.verification",
  counterexample: Counterexample,
  run: ProofLoopRun,
  generatedAt: string,
): SignedProofResult {
  return addEvidenceHash({
    schemaVersion: "1.0.0",
    kind,
    generatedAt,
    invariant: counterexample.invariant,
    sourceCounterexample: {
      path: COUNTEREXAMPLE_PATH,
      evidenceHash: counterexample.evidenceHash,
    },
    scenario: {
      id: run.scenario.scenarioId,
      deterministicSeed: run.scenario.deterministicSeed,
      recordedAttackRequestHash: counterexample.scenario.attackRequestHash,
      replayAttackRequestHash: run.scenario.attackRequestHash,
      exactRequestHashMatched:
        run.scenario.attackRequestHash ===
        counterexample.scenario.attackRequestHash,
      targetId: run.scenario.targetId,
    },
    status: run.verification.status,
    verification: canonicalizeJson(run.verification),
    durationMs: run.durationMs,
  });
}

async function writeLiveBlocker(
  repositoryRoot: string,
  generatedAt: string,
): Promise<string | null> {
  const authentication = await detectOpenAiApiKeyPresence({
    cwd: repositoryRoot,
    env: process.env,
    envFiles: [".env.local", ".env"],
  });
  if (authentication.present) {
    return null;
  }
  const blocker = addEvidenceHash({
    schemaVersion: "1.0.0",
    kind: "qedra.live-repair-blocker",
    generatedAt,
    status: "BLOCKED",
    provider: "official-codex-sdk",
    credentialName: "OPENAI_API_KEY",
    apiKeyDetected: false,
    liveInvocationAttempted: false,
    blocker:
      "OPENAI_API_KEY was not detected. Live repair is disabled until explicit operator configuration.",
    deterministicReplayAvailable: true,
  });
  await atomicWriteJson(
    resolve(repositoryRoot, LIVE_REPAIR_BLOCKER_PATH),
    blocker,
  );
  return LIVE_REPAIR_BLOCKER_PATH;
}

function aggregateTokenMetric(
  attempts: RepairResult["attempts"],
  field: "inputTokens" | "outputTokens",
): number | null {
  if (
    attempts.length === 0 ||
    attempts.some((attempt) => attempt.tokenUsage === undefined)
  ) {
    return null;
  }
  return attempts.reduce(
    (sum, attempt) => sum + (attempt.tokenUsage?.[field] ?? 0),
    0,
  );
}

export async function generatePassport(
  repositoryRoot: string,
  counterexample: Counterexample,
  execution: RepairExecution,
  durationMs: number | null = null,
): Promise<PassportGenerationResult> {
  const generatedAt = new Date().toISOString();
  const recordedScenario = scenarioRunFromCounterexample(counterexample);
  const replay = await runProofLoop(repositoryRoot, "fixed", recordedScenario);
  const verification = await runProofLoop(repositoryRoot, "fixed");
  if (
    !replay.verification.passed ||
    replay.scenario.attackRequestHash !==
      counterexample.scenario.attackRequestHash
  ) {
    throw new Error(
      "The exact recorded attack did not pass against the corrected wallet.",
    );
  }
  if (!verification.verification.passed) {
    throw new Error(
      "The corrected wallet did not pass fresh deterministic verification.",
    );
  }

  const replayArtifact = proofResultArtifact(
    "qedra.replay",
    counterexample,
    replay,
    generatedAt,
  );
  const verificationArtifact = proofResultArtifact(
    "qedra.verification",
    counterexample,
    verification,
    generatedAt,
  );
  await atomicWriteJson(
    resolve(repositoryRoot, REPLAY_RESULT_PATH),
    replayArtifact,
  );
  await atomicWriteJson(
    resolve(repositoryRoot, VERIFICATION_RESULT_PATH),
    verificationArtifact,
  );

  const repairEvidence = await createRepairEvidenceArtifact(
    repositoryRoot,
    execution,
    generatedAt,
  );
  const liveBlockerPath = await writeLiveBlocker(repositoryRoot, generatedAt);
  const artifactPaths = [
    "constitutions/qedra.yaml",
    COUNTEREXAMPLE_PATH,
    REPAIR_REQUEST_PATH,
    REPAIR_REPORT_PATH,
    REPAIR_DIFF_PATH,
    REPAIR_EVIDENCE_PATH,
    REPLAY_RESULT_PATH,
    VERIFICATION_RESULT_PATH,
    ...(liveBlockerPath === null ? [] : [liveBlockerPath]),
  ];
  const artifacts = await Promise.all(
    artifactPaths.map(
      async (path) => await artifactReference(repositoryRoot, path),
    ),
  );
  artifacts.sort((left, right) => left.path.localeCompare(right.path));
  const git = await readGitMetadata(repositoryRoot);
  const validationCount = execution.result.validationResults?.length ?? 0;
  const codexCalls =
    execution.result.mode === "live" ? execution.result.attempts.length : 0;
  const apiKeyDetected = repairEvidence.authentication.apiKeyDetected;
  const limitations = [
    "The candidate repair remains isolated, uncommitted, and unmerged until explicit human approval.",
    "The deterministic record/replay change set is not represented as output from a live Codex invocation.",
    apiKeyDetected
      ? "Live credentials were detected, but this passport records only the repair mode explicitly selected by the operator."
      : "Live Codex repair is currently blocked because OPENAI_API_KEY was not detected; no API call was attempted.",
    codexCalls === 0
      ? "Model, token, and monetary metrics are unavailable because no live model call occurred."
      : "Monetary cost is unavailable because the SDK did not expose a verified cost value.",
  ];

  const passport = createPassport({
    schemaVersion: "1.0.0",
    kind: "qedra.passport",
    generatedAt,
    invariant: counterexample.invariant,
    repository: {
      commit: git.commit,
      branch: git.branch,
      dirty: git.dirty,
      remoteUrl: git.remoteUrl,
    },
    qualification: {
      status: "PASS",
      command: "qedra init --json",
      completedAt: generatedAt,
      artifact: await artifactReference(
        repositoryRoot,
        "constitutions/qedra.yaml",
      ),
    },
    attack: {
      status: "FAIL",
      command: "qedra attack TRANSFER_IDEMPOTENCY --target vulnerable --json",
      completedAt: counterexample.generatedAt,
      artifact: await artifactReference(repositoryRoot, COUNTEREXAMPLE_PATH),
    },
    repair: repairEvidence,
    replay: {
      status: "PASS",
      command: "qedra demo --replay --json",
      completedAt: generatedAt,
      artifact: await artifactReference(repositoryRoot, REPLAY_RESULT_PATH),
    },
    verification: {
      status: "PASS",
      command: "qedra verify TRANSFER_IDEMPOTENCY --target fixed --json",
      completedAt: generatedAt,
      artifact: await artifactReference(
        repositoryRoot,
        VERIFICATION_RESULT_PATH,
      ),
    },
    artifacts,
    reproductionCommands: [
      "pnpm install --frozen-lockfile",
      "pnpm --silent qedra doctor --json",
      "pnpm --silent qedra attack TRANSFER_IDEMPOTENCY --target vulnerable --json",
      "pnpm --silent qedra repair TRANSFER_IDEMPOTENCY --replay --json",
      "pnpm --silent qedra demo --replay --json",
      "pnpm --silent evidence:verify",
    ],
    metrics: {
      durationMs,
      scenariosExecuted: 3 + validationCount,
      verificationCommandsExecuted: 3 + validationCount,
      repairAttempts: execution.result.attempts.length,
      codexCalls,
      inputTokens: aggregateTokenMetric(
        execution.result.attempts,
        "inputTokens",
      ),
      outputTokens: aggregateTokenMetric(
        execution.result.attempts,
        "outputTokens",
      ),
      costUsd: null,
      budgetThresholdUsd: null,
      budgetExceeded: null,
    },
    limitations,
    humanApprovalRequired: true,
  });
  await writePassportArtifacts(passport, {
    jsonPath: resolve(repositoryRoot, PASSPORT_JSON_PATH),
    htmlPath: resolve(repositoryRoot, PASSPORT_HTML_PATH),
  });
  await generateEvidenceDashboard(
    { counterexample, repair: repairEvidence, passport },
    {
      repositoryRoot,
      outputDirectory: resolve(repositoryRoot, DASHBOARD_OUTPUT_PATH),
    },
  );
  return {
    passport,
    repairEvidence,
    replay,
    verification,
    paths: {
      json: PASSPORT_JSON_PATH,
      html: PASSPORT_HTML_PATH,
      dashboard: `${DASHBOARD_OUTPUT_PATH}/index.html`,
    },
  };
}

function assertStoredRepairRequest(
  value: unknown,
): asserts value is RepairRequest {
  if (
    value === null ||
    typeof value !== "object" ||
    (value as { schemaVersion?: unknown }).schemaVersion !==
      REPAIR_REQUEST_SCHEMA_VERSION ||
    (value as { humanApprovalRequired?: unknown }).humanApprovalRequired !==
      true
  ) {
    throw new Error(
      "The stored repair request does not match the supported contract.",
    );
  }
}

function assertStoredRepairResult(
  value: unknown,
): asserts value is RepairResult {
  if (
    value === null ||
    typeof value !== "object" ||
    (value as { schemaVersion?: unknown }).schemaVersion !==
      REPAIR_RESULT_SCHEMA_VERSION ||
    (value as { humanApprovalRequired?: unknown }).humanApprovalRequired !==
      true ||
    (value as { merged?: unknown }).merged !== false
  ) {
    throw new Error(
      "The stored repair report does not match the supported contract.",
    );
  }
}

export async function readStoredRepairExecution(
  repositoryRoot: string,
): Promise<RepairExecution> {
  const [requestSource, resultSource] = await Promise.all([
    readFile(resolve(repositoryRoot, REPAIR_REQUEST_PATH), "utf8"),
    readFile(resolve(repositoryRoot, REPAIR_REPORT_PATH), "utf8"),
  ]);
  const request: unknown = JSON.parse(requestSource);
  const result: unknown = JSON.parse(resultSource);
  assertStoredRepairRequest(request);
  assertStoredRepairResult(result);
  if (request.requestId !== result.requestId || request.mode !== result.mode) {
    throw new Error("Stored repair request and report do not belong together.");
  }
  return { request, result };
}

export async function generatePassportFromStoredArtifacts(
  repositoryRoot: string,
): Promise<PassportGenerationResult> {
  const [counterexample, execution] = await Promise.all([
    readCounterexample(repositoryRoot),
    readStoredRepairExecution(repositoryRoot),
  ]);
  return await generatePassport(repositoryRoot, counterexample, execution);
}

function validateArtifactDocument(path: string, source: string): boolean {
  const value: unknown = JSON.parse(source);
  if (path === COUNTEREXAMPLE_PATH) {
    parseAndVerifyCounterexample(value);
  } else if (path === REPAIR_EVIDENCE_PATH) {
    parseAndVerifyRepairEvidence(value);
  } else if (
    path === REPLAY_RESULT_PATH ||
    path === VERIFICATION_RESULT_PATH ||
    path === LIVE_REPAIR_BLOCKER_PATH
  ) {
    if (!verifyEvidenceHash(value)) {
      return false;
    }
  }
  return true;
}

export async function verifyPassportBundle(
  repositoryRoot: string,
): Promise<PassportVerificationResult> {
  try {
    const source = await readFile(
      resolve(repositoryRoot, PASSPORT_JSON_PATH),
      "utf8",
    );
    const passport = parseAndVerifyPassport(JSON.parse(source) as unknown);
    const checks: PassportVerificationCheck[] = [];
    for (const artifact of passport.artifacts) {
      try {
        const bytes = await readFile(resolve(repositoryRoot, artifact.path));
        const actualSha256 = sha256Hex(bytes);
        let documentValid = true;
        if (artifact.path.endsWith(".json")) {
          documentValid = validateArtifactDocument(
            artifact.path,
            bytes.toString("utf8"),
          );
        }
        checks.push({
          path: artifact.path,
          expectedSha256: artifact.sha256,
          actualSha256,
          valid: actualSha256 === artifact.sha256 && documentValid,
        });
      } catch {
        checks.push({
          path: artifact.path,
          expectedSha256: artifact.sha256,
          actualSha256: null,
          valid: false,
        });
      }
    }
    const htmlSource = await readFile(
      resolve(repositoryRoot, PASSPORT_HTML_PATH),
      "utf8",
    );
    const htmlMatches = htmlSource === renderPassportHtml(passport);
    const allValid = checks.every((check) => check.valid) && htmlMatches;
    return {
      status: allValid ? "VERIFIED" : "INVALID",
      evidenceHash: passport.evidenceHash,
      evidenceHashValid: verifyEvidenceHash(passport),
      embeddedRepairHashValid: verifyEvidenceHash(passport.repair),
      passportHtmlMatches: htmlMatches,
      artifactChecks: checks,
      humanApprovalRequired: passport.humanApprovalRequired,
    };
  } catch {
    return {
      status: "INVALID",
      evidenceHash: null,
      evidenceHashValid: false,
      embeddedRepairHashValid: false,
      passportHtmlMatches: false,
      artifactChecks: [],
      humanApprovalRequired: null,
    };
  }
}

export function proofSummary(
  verification: TransferIdempotencyVerification,
): Readonly<Record<string, unknown>> {
  return {
    status: verification.status,
    balances: verification.actual.balances,
    debitEntries: verification.actual.debitEntries,
    creditEntries: verification.actual.creditEntries,
  };
}
