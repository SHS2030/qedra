import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { generateEvidenceDashboard } from "../../../apps/evidence-dashboard/src/index.js";
import {
  detectOpenAiApiKeyPresence,
  REPAIR_REQUEST_SCHEMA_VERSION,
  REPAIR_RESULT_SCHEMA_VERSION,
  validateRecordedChangeSet,
  type RecordedChangeSet,
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
  RECORDED_CHANGE_SET_PATH,
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
  readonly bundleVerification: PassportVerificationResult;
  readonly paths: {
    readonly json: typeof PASSPORT_JSON_PATH;
    readonly html: typeof PASSPORT_HTML_PATH;
    readonly dashboard: string;
    readonly liveRepairBlocker: string | null;
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
  readonly repairArtifactsValid: boolean;
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
  attempt: RepairResult["attempts"][number],
  index: number,
): "not-run" | "succeeded" | "failed" | "timed-out" | "no-progress" {
  if (attempt.deterministicValidationPassed === true) {
    return "succeeded";
  }
  const isLastAttempt = index === result.attempts.length - 1;
  if (isLastAttempt && result.status === "TIMED_OUT") {
    return "timed-out";
  }
  if (isLastAttempt && result.status === "NO_PROGRESS") {
    return "no-progress";
  }
  if (attempt.invocationStarted === true || result.mode === "record-replay") {
    return "failed";
  }
  return "not-run";
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
  const liveInvocationAttempted =
    execution.request.mode === "live" &&
    execution.result.attempts.some(
      (attempt) => attempt.invocationStarted === true,
    );
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
      liveInvocationAttempted,
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
    attempts: execution.result.attempts.map((attempt, index) => {
      const outcome = attemptOutcome(execution.result, attempt, index);
      return {
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
          outcome === "succeeded" || outcome === "not-run"
            ? null
            : (execution.result.blocker?.message ??
              "The attempt did not satisfy deterministic validation."),
      };
    }),
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
  if (execution.result.status !== "SUCCEEDED") {
    throw new Error(
      `A verified passport requires a successful repair; received ${execution.result.status}.`,
    );
  }
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
    ...(execution.changeSet === undefined ? [] : [RECORDED_CHANGE_SET_PATH]),
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
  const codexCallAttempts =
    execution.result.mode === "live"
      ? execution.result.attempts.filter(
          (attempt) => attempt.invocationStarted === true,
        )
      : [];
  const codexCalls = codexCallAttempts.length;
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
      inputTokens: aggregateTokenMetric(codexCallAttempts, "inputTokens"),
      outputTokens: aggregateTokenMetric(codexCallAttempts, "outputTokens"),
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
  const bundleVerification = await verifyPassportBundle(repositoryRoot);
  if (bundleVerification.status !== "VERIFIED") {
    throw new Error(
      "The generated evidence passport or one of its linked repair artifacts failed integrity verification.",
    );
  }
  await generateEvidenceDashboard(
    {
      counterexample,
      repair: repairEvidence,
      passport,
      bundleVerification,
    },
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
    bundleVerification,
    paths: {
      json: PASSPORT_JSON_PATH,
      html: PASSPORT_HTML_PATH,
      dashboard: `${DASHBOARD_OUTPUT_PATH}/index.html`,
      liveRepairBlocker: liveBlockerPath,
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isStringArray(value: unknown): value is readonly string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === "string")
  );
}

function sameStringSet(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const sortedLeft = [...new Set(left)].sort((a, b) => a.localeCompare(b));
  const sortedRight = [...new Set(right)].sort((a, b) => a.localeCompare(b));
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((item, index) => item === sortedRight[index])
  );
}

function assertStoredRepairRequest(
  value: unknown,
): asserts value is RepairRequest {
  const repository = isRecord(value) ? value.repository : null;
  const scenario = isRecord(value) ? value.scenario : null;
  if (
    !isRecord(value) ||
    value.schemaVersion !== REPAIR_REQUEST_SCHEMA_VERSION ||
    value.humanApprovalRequired !== true ||
    typeof value.requestId !== "string" ||
    (value.mode !== "live" && value.mode !== "record-replay") ||
    !isRecord(value.invariant) ||
    typeof value.invariant.id !== "string" ||
    typeof value.invariant.statement !== "string" ||
    !isRecord(scenario) ||
    typeof scenario.counterexampleArtifactPath !== "string" ||
    !/^[0-9a-f]{64}$/u.test(String(scenario.counterexampleSha256)) ||
    !isRecord(repository) ||
    !/^[0-9a-f]{40,64}$/u.test(String(repository.baseCommit)) ||
    !isStringArray(repository.affectedFiles) ||
    !Array.isArray(value.validationCommands) ||
    !isRecord(value.limits)
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
    !isRecord(value) ||
    value.schemaVersion !== REPAIR_RESULT_SCHEMA_VERSION ||
    value.humanApprovalRequired !== true ||
    value.approvalStatus !== "PENDING" ||
    value.merged !== false ||
    value.appliedToSourceRepository !== false ||
    typeof value.committed !== "boolean" ||
    typeof value.requestId !== "string" ||
    (value.mode !== "live" && value.mode !== "record-replay") ||
    typeof value.status !== "string" ||
    !Array.isArray(value.attempts)
  ) {
    throw new Error(
      "The stored repair report does not match the supported contract.",
    );
  }
}

function assertStoredChangeSet(
  value: unknown,
): asserts value is RecordedChangeSet {
  if (
    !isRecord(value) ||
    !isRecord(value.patch) ||
    !isStringArray(value.affectedFiles)
  ) {
    throw new Error(
      "The stored recorded change set does not match the supported contract.",
    );
  }
  const errors = validateRecordedChangeSet(
    value as unknown as RecordedChangeSet,
  );
  if (errors.length > 0) {
    throw new Error(
      `The stored recorded change set is invalid: ${errors.join("; ")}`,
    );
  }
}

async function assertStoredRepairLinks(
  repositoryRoot: string,
  request: RepairRequest,
  result: RepairResult,
  changeSet: RecordedChangeSet | undefined,
): Promise<void> {
  if (request.requestId !== result.requestId || request.mode !== result.mode) {
    throw new Error("Stored repair request and report do not belong together.");
  }
  const [counterexampleBytes, diffSource] = await Promise.all([
    readFile(
      resolve(repositoryRoot, request.scenario.counterexampleArtifactPath),
    ),
    readFile(resolve(repositoryRoot, REPAIR_DIFF_PATH), "utf8"),
  ]);
  if (
    sha256Hex(counterexampleBytes) !== request.scenario.counterexampleSha256
  ) {
    throw new Error(
      "The stored repair request counterexample hash is invalid.",
    );
  }
  const counterexample = parseAndVerifyCounterexample(
    JSON.parse(counterexampleBytes.toString("utf8")) as unknown,
  );
  if (
    counterexample.invariant.id !== request.invariant.id ||
    counterexample.invariant.statement !== request.invariant.statement ||
    counterexample.scenario.id !== request.scenario.id ||
    counterexample.scenario.deterministicSeed !==
      request.scenario.deterministicSeed ||
    counterexample.reproductionCommand !==
      request.scenario.reproductionCommand ||
    counterexample.repository.commit !== request.repository.baseCommit
  ) {
    throw new Error(
      "The stored repair request is not bound to its counterexample.",
    );
  }

  const changedFiles = result.changedFiles ?? [];
  const allowedFiles = new Set(request.repository.affectedFiles);
  if (changedFiles.some((path) => !allowedFiles.has(path))) {
    throw new Error(
      "The stored repair report contains a file outside the allowlist.",
    );
  }
  if (result.patch !== undefined) {
    if (
      sha256Hex(Buffer.from(result.patch.content, "utf8")) !==
        result.patch.sha256 ||
      diffSource !== result.patch.content
    ) {
      throw new Error(
        "The stored repair diff does not match the repair report.",
      );
    }
  } else if (result.status === "SUCCEEDED") {
    throw new Error(
      "A successful stored repair must contain a captured patch.",
    );
  }

  if (result.status === "SUCCEEDED") {
    const validations = result.validationResults ?? [];
    if (
      result.committed ||
      validations.length !== request.validationCommands.length ||
      !validations.every((validation, index) => {
        const declared = request.validationCommands[index];
        return (
          declared !== undefined &&
          validation.id === declared.id &&
          validation.command === declared.command &&
          JSON.stringify(validation.args) === JSON.stringify(declared.args) &&
          validation.passed
        );
      })
    ) {
      throw new Error(
        "The successful stored repair does not satisfy its declared validation contract.",
      );
    }
  }

  if (request.mode === "record-replay") {
    if (changeSet === undefined || result.patch === undefined) {
      throw new Error(
        "A recorded repair requires its stored change set and patch.",
      );
    }
    if (
      changeSet.requestId !== request.requestId ||
      changeSet.invariantId !== request.invariant.id ||
      changeSet.baseCommit !== request.repository.baseCommit ||
      !sameStringSet(
        changeSet.affectedFiles,
        request.repository.affectedFiles,
      ) ||
      !sameStringSet(changedFiles, changeSet.affectedFiles) ||
      changeSet.patch.content !== result.patch.content ||
      changeSet.patch.sha256 !== result.patch.sha256
    ) {
      throw new Error(
        "The stored recorded change set is not bound to its request and result.",
      );
    }
  } else if (changeSet !== undefined) {
    throw new Error(
      "A live repair cannot be represented as a recorded change set.",
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
  let changeSet: RecordedChangeSet | undefined;
  if (request.mode === "record-replay") {
    const source = await readFile(
      resolve(repositoryRoot, RECORDED_CHANGE_SET_PATH),
      "utf8",
    );
    const value: unknown = JSON.parse(source);
    assertStoredChangeSet(value);
    changeSet = value;
  }
  await assertStoredRepairLinks(repositoryRoot, request, result, changeSet);
  return {
    request,
    result,
    ...(changeSet === undefined ? {} : { changeSet }),
  };
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
  } else if (path === REPAIR_REQUEST_PATH) {
    assertStoredRepairRequest(value);
  } else if (path === REPAIR_REPORT_PATH) {
    assertStoredRepairResult(value);
  } else if (path === RECORDED_CHANGE_SET_PATH) {
    assertStoredChangeSet(value);
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
    let repairArtifactsValid = false;
    try {
      const execution = await readStoredRepairExecution(repositoryRoot);
      const requiredPaths: string[] = [REPAIR_REQUEST_PATH, REPAIR_REPORT_PATH];
      if (execution.result.patch !== undefined) {
        requiredPaths.push(REPAIR_DIFF_PATH);
      }
      if (execution.changeSet !== undefined) {
        requiredPaths.push(RECORDED_CHANGE_SET_PATH);
      }
      repairArtifactsValid = requiredPaths.every((path) =>
        passport.artifacts.some((artifact) => artifact.path === path),
      );
    } catch {
      repairArtifactsValid = false;
    }
    const allValid =
      checks.every((check) => check.valid) &&
      htmlMatches &&
      repairArtifactsValid;
    return {
      status: allValid ? "VERIFIED" : "INVALID",
      evidenceHash: passport.evidenceHash,
      evidenceHashValid: verifyEvidenceHash(passport),
      embeddedRepairHashValid: verifyEvidenceHash(passport.repair),
      repairArtifactsValid,
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
      repairArtifactsValid: false,
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
