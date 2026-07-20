import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { generateEvidenceDashboard } from "../../../apps/evidence-dashboard/src/index.js";
import {
  detectOpenAiApiKeyPresence,
  openAiEnvFiles,
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
import type {
  IdempotencyKeyPayloadBindingVerification,
  TransferIdempotencyVerification,
} from "../../verification-engine/src/index.js";

import { scenarioRunFromCounterexample } from "./counterexample.js";
import { runProofLoop, type ProofLoopRun } from "./proof-loop.js";
import {
  runPayloadBindingProofLoop,
  type PayloadBindingProofLoopRun,
} from "./payload-binding.js";
import {
  invariantEvidencePaths,
  isSupportedInvariantId,
  type InvariantEvidencePaths,
  type SupportedInvariantId,
} from "./evidence-layout.js";
import { type RepairExecution } from "./repair.js";

const TRANSFER_EVIDENCE_PATHS = invariantEvidencePaths("TRANSFER_IDEMPOTENCY");
export const REPAIR_EVIDENCE_PATH = TRANSFER_EVIDENCE_PATHS.repairEvidence;
export const REPLAY_RESULT_PATH = TRANSFER_EVIDENCE_PATHS.replayResult;
export const VERIFICATION_RESULT_PATH =
  TRANSFER_EVIDENCE_PATHS.verificationResult;
export const PASSPORT_JSON_PATH = TRANSFER_EVIDENCE_PATHS.passportJson;
export const PASSPORT_HTML_PATH = TRANSFER_EVIDENCE_PATHS.passportHtml;
export const LIVE_REPAIR_BLOCKER_PATH =
  TRANSFER_EVIDENCE_PATHS.liveRepairBlocker;
export const DASHBOARD_OUTPUT_PATH =
  `${TRANSFER_EVIDENCE_PATHS.directory}/dashboard` as const;

interface SignedProofResult extends Record<string, unknown> {
  readonly evidenceHash: string;
}

export interface PassportGenerationResult {
  readonly passport: Passport;
  readonly repairEvidence: RepairEvidence;
  readonly replay: SupportedProofLoopRun;
  readonly verification: SupportedProofLoopRun;
  readonly bundleVerification: PassportVerificationResult;
  readonly paths: {
    readonly json: string;
    readonly html: string;
    readonly dashboard: string;
    readonly liveRepairBlocker: string | null;
  };
}

export type SupportedProofLoopRun = ProofLoopRun | PayloadBindingProofLoopRun;

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
  paths: InvariantEvidencePaths,
): Promise<RepairEvidence> {
  const authentication = await detectOpenAiApiKeyPresence({
    cwd: repositoryRoot,
    env: process.env,
    envFiles: openAiEnvFiles(process.env),
  });
  const validations = execution.result.validationResults ?? [];
  const requestArtifact = await artifactReference(
    repositoryRoot,
    paths.repairRequest,
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
      worktreePath: paths.worktree,
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
      ? await artifactReference(repositoryRoot, paths.repairDiff)
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
  await atomicWriteJson(resolve(repositoryRoot, paths.repairEvidence), repair);
  return repair;
}

function proofResultArtifact(
  kind: "qedra.replay" | "qedra.verification",
  counterexample: Counterexample,
  run: SupportedProofLoopRun,
  generatedAt: string,
  counterexamplePath: string,
): SignedProofResult {
  return addEvidenceHash({
    schemaVersion: "1.0.0",
    kind,
    generatedAt,
    invariant: counterexample.invariant,
    sourceCounterexample: {
      path: counterexamplePath,
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
  paths: InvariantEvidencePaths,
): Promise<string | null> {
  const authentication = await detectOpenAiApiKeyPresence({
    cwd: repositoryRoot,
    env: process.env,
    envFiles: openAiEnvFiles(process.env),
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
    resolve(repositoryRoot, paths.liveRepairBlocker),
    blocker,
  );
  return paths.liveRepairBlocker;
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
  if (!isSupportedInvariantId(counterexample.invariant.id)) {
    throw new Error(
      `Unsupported passport invariant: ${counterexample.invariant.id}`,
    );
  }
  const invariantId = counterexample.invariant.id;
  if (execution.request.invariant.id !== invariantId) {
    throw new Error(
      "The repair execution belongs to a different invariant than the counterexample.",
    );
  }
  const paths = invariantEvidencePaths(invariantId);
  if (execution.result.status !== "SUCCEEDED") {
    throw new Error(
      `A verified passport requires a successful repair; received ${execution.result.status}.`,
    );
  }
  const generatedAt = new Date().toISOString();
  const recordedScenario = scenarioRunFromCounterexample(counterexample);
  const replay =
    invariantId === "TRANSFER_IDEMPOTENCY"
      ? await runProofLoop(repositoryRoot, "fixed", recordedScenario)
      : await runPayloadBindingProofLoop(
          repositoryRoot,
          "fixed",
          recordedScenario,
        );
  const verification =
    invariantId === "TRANSFER_IDEMPOTENCY"
      ? await runProofLoop(repositoryRoot, "fixed")
      : await runPayloadBindingProofLoop(repositoryRoot, "fixed");
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
    paths.counterexample,
  );
  const verificationArtifact = proofResultArtifact(
    "qedra.verification",
    counterexample,
    verification,
    generatedAt,
    paths.counterexample,
  );
  await atomicWriteJson(
    resolve(repositoryRoot, paths.replayResult),
    replayArtifact,
  );
  await atomicWriteJson(
    resolve(repositoryRoot, paths.verificationResult),
    verificationArtifact,
  );

  const repairEvidence = await createRepairEvidenceArtifact(
    repositoryRoot,
    execution,
    generatedAt,
    paths,
  );
  const liveBlockerPath = await writeLiveBlocker(
    repositoryRoot,
    generatedAt,
    paths,
  );
  const artifactPaths = [
    "constitutions/qedra.yaml",
    paths.counterexample,
    paths.repairRequest,
    paths.repairReport,
    paths.repairDiff,
    ...(execution.changeSet === undefined ? [] : [paths.recordedChangeSet]),
    paths.repairEvidence,
    paths.replayResult,
    paths.verificationResult,
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
      command: `qedra attack ${invariantId} --target vulnerable --json`,
      completedAt: counterexample.generatedAt,
      artifact: await artifactReference(repositoryRoot, paths.counterexample),
    },
    repair: repairEvidence,
    replay: {
      status: "PASS",
      command: `qedra demo ${invariantId} --replay --json`,
      completedAt: generatedAt,
      artifact: await artifactReference(repositoryRoot, paths.replayResult),
    },
    verification: {
      status: "PASS",
      command: `qedra verify ${invariantId} --target fixed --json`,
      completedAt: generatedAt,
      artifact: await artifactReference(
        repositoryRoot,
        paths.verificationResult,
      ),
    },
    artifacts,
    reproductionCommands: [
      "pnpm install --frozen-lockfile",
      "node --import tsx packages/cli/src/bin.ts doctor --json",
      `node --import tsx packages/cli/src/bin.ts attack ${invariantId} --target vulnerable --json`,
      `node --import tsx packages/cli/src/bin.ts repair ${invariantId} --replay --json`,
      `node --import tsx packages/cli/src/bin.ts demo ${invariantId} --replay --json`,
      `node --import tsx packages/cli/src/bin.ts passport ${invariantId} --verify --json`,
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
    jsonPath: resolve(repositoryRoot, paths.passportJson),
    htmlPath: resolve(repositoryRoot, paths.passportHtml),
  });
  const bundleVerification = await verifyPassportBundle(
    repositoryRoot,
    invariantId,
  );
  if (bundleVerification.status !== "VERIFIED") {
    throw new Error(
      "The generated evidence passport or one of its linked repair artifacts failed integrity verification.",
    );
  }
  const dashboardPath = `${paths.directory}/dashboard/index.html`;
  if (invariantId === "TRANSFER_IDEMPOTENCY") {
    await generateEvidenceDashboard(
      {
        counterexample,
        repair: repairEvidence,
        passport,
        bundleVerification,
      },
      {
        repositoryRoot,
        outputDirectory: resolve(repositoryRoot, paths.directory, "dashboard"),
      },
    );
  }
  return {
    passport,
    repairEvidence,
    replay,
    verification,
    bundleVerification,
    paths: {
      json: paths.passportJson,
      html: paths.passportHtml,
      dashboard:
        invariantId === "TRANSFER_IDEMPOTENCY"
          ? dashboardPath
          : paths.passportHtml,
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
  invariantId: SupportedInvariantId,
  paths: InvariantEvidencePaths,
): Promise<void> {
  if (
    request.invariant.id !== invariantId ||
    request.scenario.counterexampleArtifactPath !== paths.counterexample ||
    request.repository.isolatedWorktreePath !==
      resolve(repositoryRoot, paths.worktree)
  ) {
    throw new Error(
      "The stored repair request is outside its invariant evidence boundary.",
    );
  }
  if (request.requestId !== result.requestId || request.mode !== result.mode) {
    throw new Error("Stored repair request and report do not belong together.");
  }
  const [counterexampleBytes, diffSource] = await Promise.all([
    readFile(
      resolve(repositoryRoot, request.scenario.counterexampleArtifactPath),
    ),
    readFile(resolve(repositoryRoot, paths.repairDiff), "utf8"),
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
  scenarioRunFromCounterexample(counterexample);
  const expectedTargetId =
    invariantId === "TRANSFER_IDEMPOTENCY"
      ? "vulnerable-wallet-api"
      : "vulnerable-payload-binding-wallet-api";
  if (
    counterexample.invariant.id !== request.invariant.id ||
    counterexample.invariant.statement !== request.invariant.statement ||
    counterexample.scenario.id !== request.scenario.id ||
    counterexample.scenario.deterministicSeed !==
      request.scenario.deterministicSeed ||
    counterexample.reproductionCommand !==
      request.scenario.reproductionCommand ||
    counterexample.scenario.targetId !== expectedTargetId ||
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
  invariantId: SupportedInvariantId = "TRANSFER_IDEMPOTENCY",
): Promise<RepairExecution> {
  const paths = invariantEvidencePaths(invariantId);
  const [requestSource, resultSource] = await Promise.all([
    readFile(resolve(repositoryRoot, paths.repairRequest), "utf8"),
    readFile(resolve(repositoryRoot, paths.repairReport), "utf8"),
  ]);
  const request: unknown = JSON.parse(requestSource);
  const result: unknown = JSON.parse(resultSource);
  assertStoredRepairRequest(request);
  assertStoredRepairResult(result);
  let changeSet: RecordedChangeSet | undefined;
  if (request.mode === "record-replay") {
    const source = await readFile(
      resolve(repositoryRoot, paths.recordedChangeSet),
      "utf8",
    );
    const value: unknown = JSON.parse(source);
    assertStoredChangeSet(value);
    changeSet = value;
  }
  await assertStoredRepairLinks(
    repositoryRoot,
    request,
    result,
    changeSet,
    invariantId,
    paths,
  );
  return {
    request,
    result,
    ...(changeSet === undefined ? {} : { changeSet }),
  };
}

export async function generatePassportFromStoredArtifacts(
  repositoryRoot: string,
  invariantId: SupportedInvariantId = "TRANSFER_IDEMPOTENCY",
): Promise<PassportGenerationResult> {
  const paths = invariantEvidencePaths(invariantId);
  const [counterexample, execution] = await Promise.all([
    readFile(resolve(repositoryRoot, paths.counterexample), "utf8").then(
      (source) => parseAndVerifyCounterexample(JSON.parse(source) as unknown),
    ),
    readStoredRepairExecution(repositoryRoot, invariantId),
  ]);
  if (counterexample.invariant.id !== invariantId) {
    throw new Error("Stored counterexample belongs to a different invariant.");
  }
  return await generatePassport(repositoryRoot, counterexample, execution);
}

function validateArtifactDocument(
  path: string,
  source: string,
  invariantId: SupportedInvariantId,
  paths: InvariantEvidencePaths,
): boolean {
  const value: unknown = JSON.parse(source);
  if (path === paths.counterexample) {
    const counterexample = parseAndVerifyCounterexample(value);
    return counterexample.invariant.id === invariantId;
  } else if (path === paths.repairRequest) {
    assertStoredRepairRequest(value);
    return value.invariant.id === invariantId;
  } else if (path === paths.repairReport) {
    assertStoredRepairResult(value);
  } else if (path === paths.recordedChangeSet) {
    assertStoredChangeSet(value);
    return value.invariantId === invariantId;
  } else if (path === paths.repairEvidence) {
    return parseAndVerifyRepairEvidence(value).invariant.id === invariantId;
  } else if (
    path === paths.replayResult ||
    path === paths.verificationResult ||
    path === paths.liveRepairBlocker
  ) {
    if (!verifyEvidenceHash(value)) {
      return false;
    }
    if (path !== paths.liveRepairBlocker) {
      if (
        !isRecord(value) ||
        !isRecord(value.invariant) ||
        value.invariant.id !== invariantId ||
        !isRecord(value.sourceCounterexample) ||
        value.sourceCounterexample.path !== paths.counterexample ||
        !isRecord(value.scenario) ||
        value.scenario.exactRequestHashMatched !== true ||
        value.status !== "PASSED"
      ) {
        return false;
      }
    }
  }
  return true;
}

export async function verifyPassportBundle(
  repositoryRoot: string,
  invariantId: SupportedInvariantId = "TRANSFER_IDEMPOTENCY",
): Promise<PassportVerificationResult> {
  const paths = invariantEvidencePaths(invariantId);
  try {
    const source = await readFile(
      resolve(repositoryRoot, paths.passportJson),
      "utf8",
    );
    const passport = parseAndVerifyPassport(JSON.parse(source) as unknown);
    if (passport.invariant.id !== invariantId) {
      throw new Error("Passport belongs to a different invariant.");
    }
    if (
      passport.attack.artifact?.path !== paths.counterexample ||
      passport.repair.invariant.id !== invariantId ||
      passport.repair.requestArtifact.path !== paths.repairRequest ||
      passport.replay.artifact?.path !== paths.replayResult ||
      passport.verification.artifact?.path !== paths.verificationResult
    ) {
      throw new Error("Passport phase links cross an invariant boundary.");
    }
    const artifactPathSet = new Set(passport.artifacts.map(({ path }) => path));
    if (
      artifactPathSet.size !== passport.artifacts.length ||
      passport.artifacts.some(
        ({ path }) =>
          path !== "constitutions/qedra.yaml" &&
          !path.startsWith(`${paths.directory}/`),
      )
    ) {
      throw new Error("Passport references a cross-invariant artifact.");
    }
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
            invariantId,
            paths,
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
      resolve(repositoryRoot, paths.passportHtml),
      "utf8",
    );
    const htmlMatches = htmlSource === renderPassportHtml(passport);
    let repairArtifactsValid = false;
    try {
      const execution = await readStoredRepairExecution(
        repositoryRoot,
        invariantId,
      );
      if (
        passport.repository.commit !== execution.request.repository.baseCommit
      ) {
        throw new Error(
          "Passport repository commit differs from the repair base commit.",
        );
      }
      const requiredPaths: string[] = [
        paths.counterexample,
        paths.repairRequest,
        paths.repairReport,
        paths.repairEvidence,
        paths.replayResult,
        paths.verificationResult,
      ];
      if (execution.result.patch !== undefined) {
        requiredPaths.push(paths.repairDiff);
      }
      if (execution.changeSet !== undefined) {
        requiredPaths.push(paths.recordedChangeSet);
      }
      repairArtifactsValid = requiredPaths.every((path) =>
        passport.artifacts.some((artifact) => artifact.path === path),
      );
      const standaloneRepair = parseAndVerifyRepairEvidence(
        JSON.parse(
          await readFile(resolve(repositoryRoot, paths.repairEvidence), "utf8"),
        ) as unknown,
      );
      repairArtifactsValid &&=
        JSON.stringify(standaloneRepair) === JSON.stringify(passport.repair);
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
  verification:
    | TransferIdempotencyVerification
    | IdempotencyKeyPayloadBindingVerification,
): Readonly<Record<string, unknown>> {
  if (verification.invariantId === "IDEMPOTENCY_KEY_PAYLOAD_BINDING") {
    return {
      status: verification.status,
      balances: verification.actual.balances,
      ledgerEntries: verification.actual.ledgerEntries,
      amountConflictStatus: verification.actual.amountConflictStatus,
      destinationConflictStatus: verification.actual.destinationConflictStatus,
      sourceConflictStatus: verification.actual.sourceConflictStatus,
      conflictError: verification.actual.amountConflictError,
      identicalRetryMatchesInitialResult:
        verification.actual.identicalRetryMatchesInitialResult,
    };
  }
  return {
    status: verification.status,
    balances: verification.actual.balances,
    debitEntries: verification.actual.debitEntries,
    creditEntries: verification.actual.creditEntries,
  };
}
