import { stat } from "node:fs/promises";
import { join, resolve } from "node:path";

import { Codex } from "@openai/codex-sdk";

import {
  detectOpenAiApiKeyPresence,
  type OpenAiApiKeyPresenceOptions,
} from "./auth.js";
import {
  REPAIR_RESULT_SCHEMA_VERSION,
  type ObservableTokenUsage,
  type RepairAttemptEvidence,
  type RepairBlocker,
  type RepairRequest,
  type RepairResult,
  type RepairStatus,
} from "./contracts.js";
import { loadOpenAiApiKey } from "./credential-loader.js";

const MAX_REPAIR_ATTEMPTS = 10;
const MAX_ATTEMPT_TIMEOUT_MS = 900_000;

export interface CodexUsagePort {
  readonly input_tokens: number;
  readonly cached_input_tokens: number;
  readonly output_tokens: number;
  readonly reasoning_output_tokens: number;
}

export interface CodexRunResultPort {
  readonly finalResponse: string;
  readonly items: readonly unknown[];
  readonly usage: CodexUsagePort | null;
}

export interface CodexThreadPort {
  readonly id: string | null;
  run(
    prompt: string,
    options: { readonly signal: AbortSignal },
  ): Promise<CodexRunResultPort>;
}

export interface CodexClientPort {
  startThread(options: {
    readonly workingDirectory: string;
    readonly skipGitRepoCheck: false;
    readonly sandboxMode: "workspace-write";
    readonly approvalPolicy: "never";
    readonly networkAccessEnabled: false;
  }): CodexThreadPort;
}

export interface WorkspaceAssessment {
  readonly passed: boolean;
  readonly fingerprint: string;
}

export interface LiveRepairContext {
  readonly workingDirectory: string;
  readonly signal?: AbortSignal;
  assessWorkspace(
    workingDirectory: string,
    signal?: AbortSignal,
  ): Promise<WorkspaceAssessment>;
}

export interface LiveCodexRepairAdapterOptions {
  readonly environment?: NodeJS.ProcessEnv;
  readonly envFiles?: readonly string[];
  readonly clientFactory?: () => CodexClientPort;
}

class BoundedAttemptAbort extends Error {
  constructor(readonly timedOut: boolean) {
    super(timedOut ? "Codex attempt timed out" : "Codex attempt was cancelled");
    this.name = "BoundedAttemptAbort";
  }
}

function normalizePath(value: string): string {
  const normalized = resolve(value).replaceAll("\\", "/").replace(/\/$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function hasAborted(signal: AbortSignal | undefined): boolean {
  return signal?.aborted === true;
}

function validateLimits(request: RepairRequest): void {
  const { maxAttempts, attemptTimeoutMs, noProgressLimit } = request.limits;
  if (
    !Number.isSafeInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > MAX_REPAIR_ATTEMPTS
  ) {
    throw new RangeError(
      `maxAttempts must be an integer between 1 and ${MAX_REPAIR_ATTEMPTS}`,
    );
  }
  if (
    !Number.isSafeInteger(attemptTimeoutMs) ||
    attemptTimeoutMs < 1 ||
    attemptTimeoutMs > MAX_ATTEMPT_TIMEOUT_MS
  ) {
    throw new RangeError(
      `attemptTimeoutMs must be an integer between 1 and ${MAX_ATTEMPT_TIMEOUT_MS}`,
    );
  }
  if (
    !Number.isSafeInteger(noProgressLimit) ||
    noProgressLimit < 1 ||
    noProgressLimit > maxAttempts
  ) {
    throw new RangeError(
      "noProgressLimit must be a positive integer no greater than maxAttempts",
    );
  }
}

function controlledCodexEnvironment(
  source: NodeJS.ProcessEnv,
  apiKey: string,
): Record<string, string> {
  const allowedNames = [
    "PATH",
    "Path",
    "PATHEXT",
    "SYSTEMROOT",
    "SystemRoot",
    "COMSPEC",
    "HOME",
    "USERPROFILE",
    "TEMP",
    "TMP",
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "NO_PROXY",
    "http_proxy",
    "https_proxy",
    "no_proxy",
    "SSL_CERT_FILE",
    "NODE_EXTRA_CA_CERTS",
  ] as const;
  const environment: Record<string, string> = {};
  for (const name of allowedNames) {
    const value = source[name];
    if (value !== undefined) {
      environment[name] = value;
    }
  }

  // The user-facing input remains OPENAI_API_KEY. The SDK/CLI mapping exists only
  // in this controlled child environment and is never included in evidence.
  environment.CODEX_API_KEY = apiKey;
  return environment;
}

function createOfficialClient(
  environment: NodeJS.ProcessEnv,
  apiKey: string,
): CodexClientPort {
  return new Codex({
    apiKey,
    env: controlledCodexEnvironment(environment, apiKey),
  });
}

function mapUsage(
  usage: CodexUsagePort | null,
): ObservableTokenUsage | undefined {
  if (usage === null) {
    return undefined;
  }
  return {
    inputTokens: usage.input_tokens,
    cachedInputTokens: usage.cached_input_tokens,
    outputTokens: usage.output_tokens,
    reasoningOutputTokens: usage.reasoning_output_tokens,
  };
}

function blocker(
  kind: RepairBlocker["kind"],
  code: RepairStatus,
  message: string,
): RepairBlocker {
  return { kind, code, message };
}

function result(
  request: RepairRequest,
  status: RepairStatus,
  attempts: readonly RepairAttemptEvidence[],
  repairBlocker?: RepairBlocker,
): RepairResult {
  return {
    schemaVersion: REPAIR_RESULT_SCHEMA_VERSION,
    requestId: request.requestId,
    mode: "live",
    status,
    attempts,
    ...(repairBlocker === undefined ? {} : { blocker: repairBlocker }),
    humanApprovalRequired: true,
    approvalStatus: "PENDING",
    committed: false,
    merged: false,
    appliedToSourceRepository: false,
  };
}

function isAuthenticationError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  return /(?:401|unauthori[sz]ed|authentication|required api key|api[_ ]?key)/iu.test(
    error.message,
  );
}

function sdkFailureResult(
  request: RepairRequest,
  attempts: readonly RepairAttemptEvidence[],
  error: unknown,
): RepairResult {
  if (isAuthenticationError(error)) {
    return result(
      request,
      "AUTHENTICATION_REQUIRED",
      attempts,
      blocker(
        "external",
        "AUTHENTICATION_REQUIRED",
        "The live Codex SDK rejected the configured API authentication.",
      ),
    );
  }
  return result(
    request,
    "LIVE_EXECUTION_FAILED",
    attempts,
    blocker(
      "execution",
      "LIVE_EXECUTION_FAILED",
      "The bounded Codex SDK attempt failed before deterministic validation.",
    ),
  );
}

async function isIsolatedGitWorktree(
  request: RepairRequest,
  workingDirectory: string,
): Promise<boolean> {
  if (
    normalizePath(workingDirectory) !==
      normalizePath(request.repository.isolatedWorktreePath) ||
    normalizePath(workingDirectory) === normalizePath(request.repository.path)
  ) {
    return false;
  }
  try {
    await stat(join(workingDirectory, ".git"));
    return true;
  } catch {
    return false;
  }
}

function repairPrompt(request: RepairRequest, attempt: number): string {
  return [
    request.prompt,
    "",
    `QEDRA bounded repair attempt ${String(attempt)} of ${String(request.limits.maxAttempts)}.`,
    "Work only in the provided isolated Git worktree.",
    "Do not commit, merge, push, alter Git history, or modify the source repository.",
    "Deterministic validation, not this response, decides whether the repair passes.",
  ].join("\n");
}

async function runBoundedAttempt(
  thread: CodexThreadPort,
  prompt: string,
  timeoutMs: number,
  externalSignal: AbortSignal | undefined,
): Promise<CodexRunResultPort> {
  const controller = new AbortController();
  let timedOut = false;
  const onExternalAbort = (): void => {
    controller.abort(new BoundedAttemptAbort(false));
  };
  externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  if (externalSignal?.aborted === true) {
    onExternalAbort();
  }

  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new BoundedAttemptAbort(true));
  }, timeoutMs);
  timer.unref();

  let removeAbortListener: (() => void) | undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    const onAbort = (): void => {
      reject(new BoundedAttemptAbort(timedOut));
    };
    if (controller.signal.aborted) {
      onAbort();
      return;
    }
    controller.signal.addEventListener("abort", onAbort, { once: true });
    removeAbortListener = () => {
      controller.signal.removeEventListener("abort", onAbort);
    };
  });

  try {
    return await Promise.race([
      thread.run(prompt, { signal: controller.signal }),
      aborted,
    ]);
  } finally {
    clearTimeout(timer);
    externalSignal?.removeEventListener("abort", onExternalAbort);
    removeAbortListener?.();
  }
}

export class LiveCodexRepairAdapter {
  readonly #environment: NodeJS.ProcessEnv;
  readonly #envFiles: readonly string[];
  readonly #clientFactory: (() => CodexClientPort) | undefined;

  constructor(options: LiveCodexRepairAdapterOptions = {}) {
    this.#environment = options.environment ?? process.env;
    this.#envFiles = options.envFiles ?? [".env.local", ".env"];
    this.#clientFactory = options.clientFactory;
  }

  async execute(
    request: RepairRequest,
    context: LiveRepairContext,
  ): Promise<RepairResult> {
    validateLimits(request);
    if (request.mode !== "live") {
      throw new Error("LiveCodexRepairAdapter requires a live repair request");
    }

    const presenceOptions: OpenAiApiKeyPresenceOptions = {
      cwd: request.repository.path,
      env: this.#environment,
      envFiles: this.#envFiles,
    };
    const presence = await detectOpenAiApiKeyPresence(presenceOptions);
    if (!presence.present) {
      return result(
        request,
        "AUTHENTICATION_REQUIRED",
        [],
        blocker(
          "external",
          "AUTHENTICATION_REQUIRED",
          "Live Codex repair requires OPENAI_API_KEY; deterministic record/replay remains available.",
        ),
      );
    }

    const apiKey = await loadOpenAiApiKey({
      cwd: request.repository.path,
      environment: this.#environment,
      envFiles: this.#envFiles,
    });
    if (apiKey === null) {
      return result(
        request,
        "AUTHENTICATION_REQUIRED",
        [],
        blocker(
          "external",
          "AUTHENTICATION_REQUIRED",
          "OPENAI_API_KEY was detected but could not be loaded securely for the live SDK process.",
        ),
      );
    }

    if (!(await isIsolatedGitWorktree(request, context.workingDirectory))) {
      return result(
        request,
        "ISOLATION_REQUIRED",
        [],
        blocker(
          "policy",
          "ISOLATION_REQUIRED",
          "Live Codex repair can run only inside the declared isolated Git worktree.",
        ),
      );
    }
    if (hasAborted(context.signal)) {
      return result(request, "CANCELLED", []);
    }

    let assessment: WorkspaceAssessment;
    try {
      assessment = await context.assessWorkspace(
        context.workingDirectory,
        context.signal,
      );
    } catch {
      return result(
        request,
        "VALIDATION_FAILED",
        [],
        blocker(
          "execution",
          "VALIDATION_FAILED",
          "The deterministic workspace assessment could not be executed.",
        ),
      );
    }
    if (assessment.passed) {
      return result(request, "SUCCEEDED", []);
    }

    const attempts: RepairAttemptEvidence[] = [];
    let client: CodexClientPort;
    try {
      client =
        this.#clientFactory?.() ??
        createOfficialClient(this.#environment, apiKey);
    } catch (error) {
      return sdkFailureResult(request, attempts, error);
    }
    let previousFingerprint = assessment.fingerprint;
    let noProgressCount = 0;

    for (let attempt = 1; attempt <= request.limits.maxAttempts; attempt += 1) {
      const startedAt = performance.now();
      let thread: CodexThreadPort;
      try {
        thread = client.startThread({
          workingDirectory: context.workingDirectory,
          skipGitRepoCheck: false,
          sandboxMode: "workspace-write",
          approvalPolicy: "never",
          networkAccessEnabled: false,
        });
      } catch (error) {
        attempts.push({
          attempt,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        });
        return sdkFailureResult(request, attempts, error);
      }

      let turn: CodexRunResultPort;
      try {
        turn = await runBoundedAttempt(
          thread,
          repairPrompt(request, attempt),
          request.limits.attemptTimeoutMs,
          context.signal,
        );
      } catch (error) {
        const evidence: RepairAttemptEvidence = {
          attempt,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          invocationStarted: true,
          ...(thread.id === null ? {} : { threadId: thread.id }),
        };
        attempts.push(evidence);
        if (error instanceof BoundedAttemptAbort) {
          return result(
            request,
            error.timedOut ? "TIMED_OUT" : "CANCELLED",
            attempts,
          );
        }
        return sdkFailureResult(request, attempts, error);
      }

      if (hasAborted(context.signal)) {
        const tokenUsage = mapUsage(turn.usage);
        attempts.push({
          attempt,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          invocationStarted: true,
          ...(thread.id === null ? {} : { threadId: thread.id }),
          ...(tokenUsage === undefined ? {} : { tokenUsage }),
        });
        return result(request, "CANCELLED", attempts);
      }
      try {
        assessment = await context.assessWorkspace(
          context.workingDirectory,
          context.signal,
        );
      } catch {
        const tokenUsage = mapUsage(turn.usage);
        attempts.push({
          attempt,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          invocationStarted: true,
          ...(thread.id === null ? {} : { threadId: thread.id }),
          ...(tokenUsage === undefined ? {} : { tokenUsage }),
        });
        return result(
          request,
          "VALIDATION_FAILED",
          attempts,
          blocker(
            "execution",
            "VALIDATION_FAILED",
            "The deterministic workspace assessment failed after a Codex attempt.",
          ),
        );
      }

      const tokenUsage = mapUsage(turn.usage);
      attempts.push({
        attempt,
        durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
        invocationStarted: true,
        ...(thread.id === null ? {} : { threadId: thread.id }),
        progressFingerprint: assessment.fingerprint,
        deterministicValidationPassed: assessment.passed,
        ...(tokenUsage === undefined ? {} : { tokenUsage }),
      });

      if (assessment.passed) {
        return result(request, "SUCCEEDED", attempts);
      }
      if (assessment.fingerprint === previousFingerprint) {
        noProgressCount += 1;
      } else {
        noProgressCount = 0;
        previousFingerprint = assessment.fingerprint;
      }
      if (noProgressCount >= request.limits.noProgressLimit) {
        return result(
          request,
          "NO_PROGRESS",
          attempts,
          blocker(
            "policy",
            "NO_PROGRESS",
            "The repair stopped after the configured number of attempts without a workspace change.",
          ),
        );
      }
    }

    return result(
      request,
      "ATTEMPT_LIMIT_REACHED",
      attempts,
      blocker(
        "policy",
        "ATTEMPT_LIMIT_REACHED",
        "The deterministic repair attempt limit was reached.",
      ),
    );
  }

  async repair(
    request: RepairRequest,
    context: LiveRepairContext,
  ): Promise<RepairResult> {
    return await this.execute(request, context);
  }
}
