import { spawn } from "node:child_process";

import {
  DEFAULT_MAX_OUTPUT_BYTES,
  DEFAULT_PROCESS_TIMEOUT_MS,
  MAX_PROCESS_TIMEOUT_MS,
  type ProcessExecutionRequest,
  type ProcessExecutionResult,
  type ProcessRunner,
} from "./types.js";

function validatePositiveInteger(
  value: number,
  name: string,
  maximum: number,
): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new RangeError(`${name} must be an integer between 1 and ${maximum}`);
  }
}

function appendBounded(
  current: string,
  chunk: Buffer,
  maximumBytes: number,
): { readonly value: string; readonly truncated: boolean } {
  const currentBytes = Buffer.byteLength(current);
  if (currentBytes >= maximumBytes) {
    return { value: current, truncated: true };
  }

  const remaining = maximumBytes - currentBytes;
  if (chunk.byteLength <= remaining) {
    return { value: current + chunk.toString("utf8"), truncated: false };
  }

  return {
    value: current + chunk.subarray(0, remaining).toString("utf8"),
    truncated: true,
  };
}

function childEnvironment(
  overrides: Readonly<Record<string, string>> | undefined,
  omittedNames: readonly string[],
): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = { ...process.env, ...overrides };
  const omitted = new Set(omittedNames.map((name) => name.toUpperCase()));
  for (const name of Object.keys(environment)) {
    if (omitted.has(name.toUpperCase())) {
      delete environment[name];
    }
  }
  return environment;
}

export interface ProcessInvocation {
  readonly command: string;
  readonly args: readonly string[];
}

export function prepareProcessInvocation(
  command: string,
  args: readonly string[],
  platform: NodeJS.Platform = process.platform,
  commandInterpreter = process.env.ComSpec ?? "cmd.exe",
): ProcessInvocation {
  if (platform !== "win32" || command.toLowerCase() !== "pnpm") {
    return { command, args };
  }

  const tokens = [command, ...args];
  if (
    tokens.some(
      (token) =>
        token.length === 0 || !/^[A-Za-z0-9_./\\:@=,+-]+$/u.test(token),
    )
  ) {
    throw new Error(
      "Windows pnpm validation arguments contain unsupported shell characters",
    );
  }
  return {
    command: commandInterpreter,
    args: ["/d", "/s", "/c", tokens.join(" ")],
  };
}

export class NodeProcessRunner implements ProcessRunner {
  async run(request: ProcessExecutionRequest): Promise<ProcessExecutionResult> {
    const command = request.command.trim();
    if (command.length === 0) {
      throw new TypeError("Process command must not be empty");
    }

    const args = [...(request.args ?? [])];
    const invocation = prepareProcessInvocation(command, args);
    const timeoutMs = request.timeoutMs ?? DEFAULT_PROCESS_TIMEOUT_MS;
    const maxOutputBytes = request.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
    validatePositiveInteger(timeoutMs, "timeoutMs", MAX_PROCESS_TIMEOUT_MS);
    validatePositiveInteger(
      maxOutputBytes,
      "maxOutputBytes",
      Number.MAX_SAFE_INTEGER,
    );

    if (request.signal?.aborted === true) {
      return {
        command,
        args,
        exitCode: null,
        stdout: "",
        stderr: "",
        durationMs: 0,
        timedOut: false,
        cancelled: true,
        outputTruncated: false,
      };
    }

    const startedAt = performance.now();
    return await new Promise<ProcessExecutionResult>((resolve) => {
      let stdout = "";
      let stderr = "";
      let outputTruncated = false;
      let timedOut = false;
      let cancelled = false;
      let settled = false;

      const child = spawn(invocation.command, invocation.args, {
        cwd: request.cwd,
        env: childEnvironment(
          request.env,
          request.omitEnvironmentVariables ?? [],
        ),
        shell: false,
        windowsHide: true,
        stdio: [
          request.stdin === undefined ? "ignore" : "pipe",
          "pipe",
          "pipe",
        ],
      });

      const finish = (exitCode: number | null): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timeout);
        request.signal?.removeEventListener("abort", onAbort);
        resolve({
          command,
          args,
          exitCode,
          stdout,
          stderr,
          durationMs: Math.max(0, Math.round(performance.now() - startedAt)),
          timedOut,
          cancelled,
          outputTruncated,
        });
      };

      const terminate = (): void => {
        if (!child.killed) {
          child.kill();
        }
      };

      const onAbort = (): void => {
        cancelled = true;
        terminate();
      };

      const timeout = setTimeout(() => {
        timedOut = true;
        terminate();
      }, timeoutMs);
      timeout.unref();

      request.signal?.addEventListener("abort", onAbort, { once: true });

      child.stdout?.on("data", (chunk: Buffer) => {
        const appended = appendBounded(stdout, chunk, maxOutputBytes);
        stdout = appended.value;
        outputTruncated ||= appended.truncated;
      });
      child.stderr?.on("data", (chunk: Buffer) => {
        const appended = appendBounded(stderr, chunk, maxOutputBytes);
        stderr = appended.value;
        outputTruncated ||= appended.truncated;
      });
      child.once("error", (error) => {
        stderr =
          error instanceof Error ? error.message : "Process launch failed";
        finish(null);
      });
      child.once("close", (code) => {
        finish(code);
      });

      if (request.stdin !== undefined) {
        child.stdin?.end(request.stdin);
      }
    });
  }
}
