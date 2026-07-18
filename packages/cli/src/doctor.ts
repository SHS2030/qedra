import { spawnSync } from "node:child_process";
import {
  detectOpenAiApiKeyPresence,
  openAiEnvFiles,
} from "../../codex-adapter/src/index.js";

export interface ToolDiagnostic {
  readonly available: boolean;
  readonly version: string | null;
  readonly detail: string | null;
}

export interface DoctorReport {
  readonly schemaVersion: "1.0.0";
  readonly status: "READY_FOR_REPLAY" | "READY_FOR_LIVE_REPAIR" | "DEGRADED";
  readonly node: ToolDiagnostic;
  readonly pnpm: ToolDiagnostic;
  readonly git: ToolDiagnostic;
  readonly docker: ToolDiagnostic;
  readonly flutter: ToolDiagnostic;
  readonly codexSdk: ToolDiagnostic;
  readonly openaiAuthentication: {
    readonly present: boolean;
    readonly source: "environment" | "env-file" | null;
    readonly liveRepairAvailable: boolean;
    readonly blocker: string | null;
  };
  readonly capabilities: {
    readonly deterministicReplay: true;
    readonly isolatedGitWorktrees: boolean;
    readonly liveCodexRepair: boolean;
  };
}

function firstLine(value: string | undefined): string | null {
  const line = value?.trim().split(/\r?\n/u)[0]?.trim();
  return line ? line : null;
}

function inspectTool(
  command: string,
  args: readonly string[],
  timeoutMs = 5_000,
): ToolDiagnostic {
  const executable =
    process.platform === "win32" ? (process.env.ComSpec ?? "cmd.exe") : command;
  const executableArgs =
    process.platform === "win32"
      ? ["/d", "/s", "/c", [command, ...args].join(" ")]
      : [...args];
  const result = spawnSync(executable, executableArgs, {
    encoding: "utf8",
    timeout: timeoutMs,
    windowsHide: true,
  });

  if (result.error) {
    const timedOut =
      result.error.name === "ETIMEDOUT" ||
      (result.error as NodeJS.ErrnoException).code === "ETIMEDOUT";
    return {
      available: false,
      version: null,
      detail: timedOut
        ? `timed out after ${String(timeoutMs)}ms`
        : result.error.message,
    };
  }

  const output = firstLine(result.stdout) ?? firstLine(result.stderr);
  return {
    available: result.status === 0,
    version: result.status === 0 ? output : null,
    detail:
      result.status === 0
        ? null
        : (output ?? `exit code ${String(result.status)}`),
  };
}

export async function runDoctor(repositoryRoot: string): Promise<DoctorReport> {
  const authentication = await detectOpenAiApiKeyPresence({
    cwd: repositoryRoot,
    env: process.env,
    envFiles: openAiEnvFiles(process.env),
  });

  const node: ToolDiagnostic = {
    available: true,
    version: process.version,
    detail: null,
  };
  const pnpm = inspectTool("pnpm", ["--version"]);
  const git = inspectTool("git", ["--version"]);
  const docker = inspectTool("docker", ["--version"]);
  const flutter = inspectTool(
    "flutter",
    ["--no-version-check", "--suppress-analytics", "--version"],
    30_000,
  );

  let codexSdk: ToolDiagnostic;
  try {
    const sdk = await import("@openai/codex-sdk");
    codexSdk =
      typeof sdk.Codex === "function"
        ? { available: true, version: "0.144.3", detail: null }
        : { available: false, version: null, detail: "Codex export not found" };
  } catch (error) {
    codexSdk = {
      available: false,
      version: null,
      detail: error instanceof Error ? error.message : "SDK resolution failed",
    };
  }

  const replayReady = pnpm.available && git.available && codexSdk.available;
  const liveRepairAvailable = replayReady && authentication.present;

  return {
    schemaVersion: "1.0.0",
    status: liveRepairAvailable
      ? "READY_FOR_LIVE_REPAIR"
      : replayReady
        ? "READY_FOR_REPLAY"
        : "DEGRADED",
    node,
    pnpm,
    git,
    docker,
    flutter,
    codexSdk,
    openaiAuthentication: {
      present: authentication.present,
      source: authentication.source,
      liveRepairAvailable,
      blocker: authentication.present
        ? null
        : "OPENAI_API_KEY is not available; live Codex repair is disabled.",
    },
    capabilities: {
      deterministicReplay: true,
      isolatedGitWorktrees: git.available,
      liveCodexRepair: liveRepairAvailable,
    },
  };
}
