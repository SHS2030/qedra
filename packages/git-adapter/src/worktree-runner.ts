import { createHash } from "node:crypto";
import { access } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { NodeProcessRunner } from "./process-runner.js";
import {
  DEFAULT_PROCESS_TIMEOUT_MS,
  type CleanupEvidence,
  type GitCommandOptions,
  type IsolatedWorktreeRequest,
  type IsolatedWorktreeResult,
  type ProcessExecutionResult,
  type ProcessRunner,
  type ValidationResult,
  type WorktreeMutationContext,
  type WorktreeRunStatus,
} from "./types.js";

const FORBIDDEN_MUTATION_GIT_COMMANDS = new Set([
  "am",
  "checkout",
  "cherry-pick",
  "clean",
  "commit",
  "merge",
  "push",
  "rebase",
  "reset",
  "switch",
  "worktree",
]);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function normalizedPathKey(value: string): string {
  const normalized = resolve(value).replaceAll("\\", "/").replace(/\/$/u, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function isAncestor(candidate: string, descendant: string): boolean {
  const pathFromCandidate = relative(candidate, descendant);
  return (
    pathFromCandidate.length === 0 ||
    (!pathFromCandidate.startsWith("..") && !isAbsolute(pathFromCandidate))
  );
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function safeErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof Error) || error.message.trim().length === 0) {
    return fallback;
  }

  return error.message
    .replace(/\bsk-[A-Za-z0-9_-]+/gu, "[REDACTED]")
    .replace(/(OPENAI_API_KEY\s*=\s*)\S+/giu, "$1[REDACTED]");
}

function assertSuccessful(
  result: ProcessExecutionResult,
  operation: string,
): void {
  if (result.cancelled) {
    throw new Error(`${operation} was cancelled`);
  }
  if (result.timedOut) {
    throw new Error(`${operation} timed out`);
  }
  if (result.exitCode !== 0) {
    throw new Error(
      `${operation} failed with exit code ${String(result.exitCode)}`,
    );
  }
}

function classifyFailure(
  result: ProcessExecutionResult,
  fallback: WorktreeRunStatus,
): WorktreeRunStatus {
  if (result.cancelled) {
    return "CANCELLED";
  }
  if (result.timedOut) {
    return "TIMED_OUT";
  }
  return fallback;
}

export interface GitWorktreeRunnerOptions {
  readonly processRunner?: ProcessRunner;
  readonly gitExecutable?: string;
  readonly gitTimeoutMs?: number;
}

export class GitWorktreeRunner {
  readonly #processRunner: ProcessRunner;
  readonly #gitExecutable: string;
  readonly #gitTimeoutMs: number;

  constructor(options: GitWorktreeRunnerOptions = {}) {
    this.#processRunner = options.processRunner ?? new NodeProcessRunner();
    this.#gitExecutable = options.gitExecutable ?? "git";
    this.#gitTimeoutMs = options.gitTimeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
  }

  async run<T>(
    request: IsolatedWorktreeRequest,
    mutate: (context: WorktreeMutationContext) => Promise<T>,
  ): Promise<IsolatedWorktreeResult<T>> {
    const repositoryPath = resolve(request.repositoryPath);
    const worktreePath = resolve(request.worktreePath);
    this.#validateRequest(request, repositoryPath, worktreePath);

    if (await pathExists(worktreePath)) {
      throw new Error("The isolated worktree path must not already exist");
    }

    let status: WorktreeRunStatus = "SETUP_FAILED";
    let error: string | undefined;
    let baseCommit: string | null = null;
    let headCommit: string | null = null;
    let patch = "";
    let changedFiles: readonly string[] = [];
    let mutationOutput: T | undefined;
    let worktreeCreated = false;
    let committed = false;
    const validationResults: ValidationResult[] = [];

    try {
      const rootResult = await this.#runGit(
        repositoryPath,
        repositoryPath,
        ["rev-parse", "--show-toplevel"],
        { signal: request.signal },
      );
      assertSuccessful(rootResult, "Git repository discovery");
      if (
        normalizedPathKey(rootResult.stdout.trim()) !==
        normalizedPathKey(repositoryPath)
      ) {
        throw new Error("repositoryPath must identify the Git repository root");
      }

      const commitResult = await this.#runGit(
        repositoryPath,
        repositoryPath,
        [
          "rev-parse",
          "--verify",
          "--end-of-options",
          `${request.baseRef}^{commit}`,
        ],
        { signal: request.signal },
      );
      assertSuccessful(commitResult, "Base revision resolution");
      baseCommit = commitResult.stdout.trim();
      if (!/^[0-9a-f]{40,64}$/u.test(baseCommit)) {
        throw new Error("Git returned an invalid base commit identifier");
      }

      const addResult = await this.#runGit(
        repositoryPath,
        repositoryPath,
        ["worktree", "add", "--detach", worktreePath, baseCommit],
        { signal: request.signal },
      );
      worktreeCreated = addResult.exitCode === 0;
      if (!worktreeCreated) {
        worktreeCreated = await this.#isRegisteredWorktree(
          repositoryPath,
          worktreePath,
        );
      }
      assertSuccessful(addResult, "Isolated worktree creation");

      const context: WorktreeMutationContext = {
        repositoryPath,
        workingDirectory: worktreePath,
        baseCommit,
        runGit: async (args, options = {}) => {
          const subcommand = args[0]?.toLowerCase();
          if (
            subcommand === undefined ||
            FORBIDDEN_MUTATION_GIT_COMMANDS.has(subcommand)
          ) {
            throw new Error(
              "The isolated mutation attempted a forbidden Git operation",
            );
          }
          return await this.#runGit(
            repositoryPath,
            worktreePath,
            args,
            options,
          );
        },
      };

      try {
        mutationOutput = await mutate(context);
        status = "PASSED";
      } catch (mutationError) {
        status =
          request.signal?.aborted === true ? "CANCELLED" : "MUTATION_FAILED";
        error = safeErrorMessage(mutationError, "The isolated mutation failed");
      }

      if (status === "PASSED") {
        for (const command of request.validationCommands) {
          const execution = await this.#processRunner.run({
            command: command.command,
            args: command.args ?? [],
            cwd: worktreePath,
            ...(command.timeoutMs === undefined
              ? {}
              : { timeoutMs: command.timeoutMs }),
            ...(command.env === undefined ? {} : { env: command.env }),
            ...(request.signal === undefined ? {} : { signal: request.signal }),
          });
          const passed =
            execution.exitCode === 0 &&
            !execution.timedOut &&
            !execution.cancelled;
          validationResults.push({
            id: command.id,
            command: execution.command,
            args: execution.args,
            exitCode: execution.exitCode,
            stdout: execution.stdout,
            stderr: execution.stderr,
            durationMs: execution.durationMs,
            passed,
            timedOut: execution.timedOut,
            cancelled: execution.cancelled,
            outputTruncated: execution.outputTruncated,
          });
          if (!passed) {
            status = classifyFailure(execution, "VALIDATION_FAILED");
            if (request.stopValidationOnFailure !== false) {
              break;
            }
          }
        }
      }

      const headResult = await this.#runGit(
        repositoryPath,
        worktreePath,
        ["rev-parse", "HEAD"],
        { signal: request.signal },
      );
      assertSuccessful(headResult, "Worktree HEAD inspection");
      headCommit = headResult.stdout.trim();
      committed = headCommit !== baseCommit;

      const intentResult = await this.#runGit(
        repositoryPath,
        worktreePath,
        ["add", "--intent-to-add", "--all", "--"],
        { signal: request.signal },
      );
      assertSuccessful(intentResult, "Untracked change discovery");

      const patchResult = await this.#runGit(
        repositoryPath,
        worktreePath,
        [
          "diff",
          "--binary",
          "--full-index",
          "--no-ext-diff",
          "--src-prefix=a/",
          "--dst-prefix=b/",
          baseCommit,
          "--",
        ],
        { signal: request.signal },
      );
      assertSuccessful(patchResult, "Repair patch capture");
      patch = patchResult.stdout;

      const namesResult = await this.#runGit(
        repositoryPath,
        worktreePath,
        ["diff", "--name-only", "-z", baseCommit, "--"],
        { signal: request.signal },
      );
      assertSuccessful(namesResult, "Changed file discovery");
      changedFiles = namesResult.stdout
        .split("\0")
        .filter((name) => name.length > 0)
        .sort((left, right) => left.localeCompare(right));

      if (committed) {
        status = "POLICY_VIOLATION";
        error =
          "The isolated repair created a commit; human review is required";
      } else if (status === "PASSED" && patch.length === 0) {
        status = "NO_CHANGES";
      }
    } catch (setupOrCaptureError) {
      if (status === "SETUP_FAILED" || status === "PASSED") {
        status =
          request.signal?.aborted === true ? "CANCELLED" : "SETUP_FAILED";
      }
      error ??= safeErrorMessage(
        setupOrCaptureError,
        "The isolated worktree operation failed",
      );
    }

    const cleanup = await this.#cleanup(
      repositoryPath,
      worktreePath,
      worktreeCreated,
    );

    return {
      status,
      repositoryPath,
      worktreePath,
      baseCommit,
      headCommit,
      changedFiles,
      patch,
      patchSha256: sha256(patch),
      validationResults,
      ...(mutationOutput === undefined ? {} : { mutationOutput }),
      ...(error === undefined ? {} : { error }),
      cleanup,
      humanApprovalRequired: true,
      approvalStatus: "PENDING",
      committed,
      merged: false,
      appliedToSourceRepository: false,
    };
  }

  #validateRequest(
    request: IsolatedWorktreeRequest,
    repositoryPath: string,
    worktreePath: string,
  ): void {
    if (
      !isAbsolute(request.repositoryPath) ||
      !isAbsolute(request.worktreePath)
    ) {
      throw new Error("Repository and worktree paths must be absolute");
    }
    if (normalizedPathKey(repositoryPath) === normalizedPathKey(worktreePath)) {
      throw new Error(
        "The repair worktree must differ from the source repository",
      );
    }
    if (isAncestor(worktreePath, repositoryPath)) {
      throw new Error(
        "The worktree path must not contain the source repository",
      );
    }
    if (
      request.baseRef.trim().length === 0 ||
      /[\r\n\0]/u.test(request.baseRef)
    ) {
      throw new Error("baseRef must be a non-empty single-line Git revision");
    }
    for (const command of request.validationCommands) {
      if (
        command.id.trim().length === 0 ||
        command.command.trim().length === 0
      ) {
        throw new Error(
          "Validation commands require non-empty ids and executables",
        );
      }
    }
  }

  async #runGit(
    repositoryPath: string,
    cwd: string,
    args: readonly string[],
    options: GitCommandOptions = {},
  ): Promise<ProcessExecutionResult> {
    const safeDirectories = [repositoryPath];
    if (normalizedPathKey(cwd) !== normalizedPathKey(repositoryPath)) {
      safeDirectories.push(cwd);
    }
    const scopedConfiguration = safeDirectories.flatMap((directory) => [
      "-c",
      `safe.directory=${directory}`,
    ]);
    return await this.#processRunner.run({
      command: this.#gitExecutable,
      args: [...scopedConfiguration, "-C", cwd, ...args],
      cwd,
      timeoutMs: options.timeoutMs ?? this.#gitTimeoutMs,
      ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
  }

  async #isRegisteredWorktree(
    repositoryPath: string,
    worktreePath: string,
  ): Promise<boolean> {
    const result = await this.#runGit(repositoryPath, repositoryPath, [
      "worktree",
      "list",
      "--porcelain",
    ]);
    if (result.exitCode !== 0) {
      return false;
    }
    return result.stdout
      .split(/\r?\n/u)
      .filter((line) => line.startsWith("worktree "))
      .map((line) => line.slice("worktree ".length))
      .some(
        (candidate) =>
          normalizedPathKey(candidate) === normalizedPathKey(worktreePath),
      );
  }

  async #cleanup(
    repositoryPath: string,
    worktreePath: string,
    worktreeCreated: boolean,
  ): Promise<CleanupEvidence> {
    if (!worktreeCreated) {
      return { attempted: false, succeeded: true, pruned: false };
    }

    const removeResult = await this.#runGit(repositoryPath, repositoryPath, [
      "worktree",
      "remove",
      "--force",
      worktreePath,
    ]);
    const pruneResult = await this.#runGit(repositoryPath, repositoryPath, [
      "worktree",
      "prune",
    ]);
    const succeeded =
      removeResult.exitCode === 0 && !(await pathExists(worktreePath));
    const pruned = pruneResult.exitCode === 0;
    return {
      attempted: true,
      succeeded,
      pruned,
      ...(!succeeded
        ? { error: "The isolated worktree could not be removed completely" }
        : !pruned
          ? {
              error:
                "The isolated worktree was removed but Git metadata pruning failed",
            }
          : {}),
    };
  }
}
