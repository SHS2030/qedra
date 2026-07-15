import { spawn } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = process.cwd();
const CLI_ENTRYPOINT = "packages/cli/src/bin.ts";
const SECRET_SENTINEL = "e2e-secret-sentinel-never-print";

interface ProcessResult {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
}

interface RunOptions {
  readonly environment?: Readonly<Record<string, string>>;
  readonly timeoutMs?: number;
}

function sanitizedEnvironment(
  overrides: Readonly<Record<string, string>> = {},
): NodeJS.ProcessEnv {
  const environment = { ...process.env, ...overrides };
  delete environment.OPENAI_API_KEY;
  delete environment.CODEX_API_KEY;
  return environment;
}

async function runCli(
  args: readonly string[],
  options: RunOptions = {},
): Promise<ProcessResult> {
  const environment = sanitizedEnvironment(options.environment);
  if (options.environment?.OPENAI_API_KEY !== undefined) {
    environment.OPENAI_API_KEY = options.environment.OPENAI_API_KEY;
  }

  return await new Promise<ProcessResult>((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", CLI_ENTRYPOINT, ...args],
      {
        cwd: REPOSITORY_ROOT,
        env: environment,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
        timeout: options.timeoutMs ?? 60_000,
        windowsHide: true,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      resolveResult({ code, signal, stdout, stderr });
    });
  });
}

function parseCleanJson(result: ProcessResult): unknown {
  expect(result.signal).toBeNull();
  expect(result.stderr).toBe("");
  const parsed: unknown = JSON.parse(result.stdout);
  expect(result.stdout).toBe(`${JSON.stringify(parsed, null, 2)}\n`);
  return parsed;
}

function asRecord(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${name} must be a JSON object.`);
  }
  return value as Record<string, unknown>;
}

function asArray(value: unknown, name: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new TypeError(`${name} must be a JSON array.`);
  }
  return value;
}

describe.sequential("QEDRA direct-process CLI", () => {
  it("exposes the complete command surface and validates the constitution", async () => {
    const help = await runCli(["--help"]);
    expect(help).toMatchObject({ code: 0, signal: null, stderr: "" });
    expect(help.stdout).toContain(
      "Executable evidence for autonomous software engineering.",
    );
    for (const command of [
      "doctor",
      "init",
      "verify",
      "attack",
      "repair",
      "passport",
      "demo",
    ]) {
      expect(help.stdout).toMatch(new RegExp(`\\b${command}\\b`, "u"));
    }

    const version = await runCli(["--version"]);
    expect(version).toEqual({
      code: 0,
      signal: null,
      stdout: "0.1.0\n",
      stderr: "",
    });

    const unsupported = await runCli(["not-a-command"]);
    expect(unsupported.code).toBe(20);
    expect(unsupported.signal).toBeNull();
    expect(unsupported.stderr).toContain("unknown command");

    const initialization = await runCli(["init", "--json"]);
    expect(initialization.code).toBe(0);
    expect(parseCleanJson(initialization)).toEqual({
      schemaVersion: "1.0.0",
      status: "VALIDATED",
      path: "constitutions/qedra.yaml",
      invariantIds: ["TRANSFER_IDEMPOTENCY"],
    });
  });

  it("reports replay readiness and never emits an API key value", async () => {
    const doctor = await runCli(["doctor", "--json"], {
      timeoutMs: 30_000,
    });
    expect(doctor.code).toBe(0);
    const report = asRecord(parseCleanJson(doctor), "doctor report");
    const authentication = asRecord(
      report.openaiAuthentication,
      "doctor authentication",
    );
    const capabilities = asRecord(report.capabilities, "doctor capabilities");

    expect(report.status).toBe("READY_FOR_REPLAY");
    expect(authentication).toEqual({
      present: false,
      source: null,
      liveRepairAvailable: false,
      blocker:
        "OPENAI_API_KEY is not available; live Codex repair is disabled.",
    });
    expect(capabilities).toMatchObject({
      deterministicReplay: true,
      isolatedGitWorktrees: true,
      liveCodexRepair: false,
    });

    const keyPresenceProbe = await runCli(["doctor", "--json"], {
      environment: { OPENAI_API_KEY: SECRET_SENTINEL },
      timeoutMs: 30_000,
    });
    expect(keyPresenceProbe.code).toBe(0);
    const keyPresenceReport = asRecord(
      parseCleanJson(keyPresenceProbe),
      "doctor key-presence report",
    );
    expect(keyPresenceReport.status).toBe("READY_FOR_LIVE_REPAIR");
    expect(
      asRecord(
        keyPresenceReport.openaiAuthentication,
        "doctor key-presence authentication",
      ),
    ).toEqual({
      present: true,
      source: "environment",
      liveRepairAvailable: true,
      blocker: null,
    });
    expect(keyPresenceProbe.stdout).not.toContain(SECRET_SENTINEL);
  }, 45_000);

  it("uses stable exit codes for the vulnerable proof, fixed proof, and absent live authentication", async () => {
    const attack = await runCli([
      "attack",
      "TRANSFER_IDEMPOTENCY",
      "--target",
      "vulnerable",
      "--json",
    ]);
    expect(attack.code).toBe(10);
    const attackResult = asRecord(parseCleanJson(attack), "attack result");
    const attackActual = asRecord(attackResult.actual, "attack actual state");
    expect(attackResult).toMatchObject({
      schemaVersion: "1.0.0",
      invariantId: "TRANSFER_IDEMPOTENCY",
      status: "FAILED",
      target: "vulnerable",
      counterexampleArtifact: "evidence/counterexample.json",
    });
    expect(attackActual).toMatchObject({
      balances: { A: 8_000, B: 7_000 },
      debitEntries: 2,
      creditEntries: 2,
      totalRelevantEntries: 4,
    });

    const verification = await runCli([
      "verify",
      "TRANSFER_IDEMPOTENCY",
      "--target",
      "fixed",
      "--json",
    ]);
    expect(verification.code).toBe(0);
    const verificationResult = asRecord(
      parseCleanJson(verification),
      "verification result",
    );
    const verificationActual = asRecord(
      verificationResult.actual,
      "verification actual state",
    );
    expect(verificationResult).toMatchObject({
      schemaVersion: "1.0.0",
      invariantId: "TRANSFER_IDEMPOTENCY",
      status: "PASSED",
      target: "fixed",
      counterexampleArtifact: null,
      violations: [],
    });
    expect(verificationActual).toMatchObject({
      balances: { A: 9_000, B: 6_000 },
      debitEntries: 1,
      creditEntries: 1,
      totalRelevantEntries: 2,
    });

    const liveRepair = await runCli([
      "repair",
      "TRANSFER_IDEMPOTENCY",
      "--live",
      "--json",
    ]);
    expect(liveRepair.code).toBe(40);
    expect(parseCleanJson(liveRepair)).toMatchObject({
      schemaVersion: "1.0.0",
      invariantId: "TRANSFER_IDEMPOTENCY",
      mode: "live",
      status: "AUTHENTICATION_REQUIRED",
      attempts: [],
      blocker: {
        kind: "external",
        code: "AUTHENTICATION_REQUIRED",
        message:
          "Live Codex repair requires OPENAI_API_KEY; deterministic record/replay remains available.",
      },
      changedFiles: [],
      validationResults: [],
      patchSha256: null,
      humanApprovalRequired: true,
      approvalStatus: "PENDING",
      committed: false,
      merged: false,
    });
  }, 45_000);

  it("completes deterministic repair replay and verifies the JSON and HTML passports", async () => {
    const demo = await runCli(["demo", "--replay", "--json"], {
      timeoutMs: 90_000,
    });
    expect(demo.code).toBe(0);
    const demoResult = asRecord(parseCleanJson(demo), "demo result");
    expect(demoResult).toMatchObject({
      schemaVersion: "1.0.0",
      status: "PASSED",
      mode: "record-replay",
      invariantId: "TRANSFER_IDEMPOTENCY",
      attack: {
        status: "FAILED_AS_EXPECTED",
        balances: { A: 8_000, B: 7_000 },
        debitEntries: 2,
        creditEntries: 2,
      },
      repair: {
        status: "SUCCEEDED",
        attempts: 1,
        validationsPassed: true,
        committed: false,
        merged: false,
        humanApprovalRequired: true,
      },
      replay: {
        status: "PASSED",
        balances: { A: 9_000, B: 6_000 },
        debitEntries: 1,
        creditEntries: 1,
      },
      verification: {
        status: "PASSED",
        balances: { A: 9_000, B: 6_000 },
        debitEntries: 1,
        creditEntries: 1,
      },
      humanApprovalRequired: true,
    });
    expect(asRecord(demoResult.artifacts, "demo artifacts")).toEqual({
      counterexample: "evidence/counterexample.json",
      passportJson: "evidence/passport.json",
      passportHtml: "evidence/passport.html",
      dashboard: "evidence/dashboard/index.html",
      liveRepairBlocker: "evidence/live-repair-blocker.json",
    });

    const passportSource = await readFile(
      resolve(REPOSITORY_ROOT, "evidence/passport.json"),
      "utf8",
    );
    const passport = asRecord(
      JSON.parse(passportSource) as unknown,
      "passport",
    );
    const evidenceHash = passport.evidenceHash;
    expect(evidenceHash).toMatch(/^[a-f0-9]{64}$/u);
    expect(passport).toMatchObject({
      schemaVersion: "1.0.0",
      kind: "qedra.passport",
      humanApprovalRequired: true,
      attack: { status: "FAIL" },
      repair: {
        mode: "record-replay",
        status: "replayed",
        authentication: {
          provider: "official-codex-sdk",
          apiKeyDetected: false,
          liveInvocationAttempted: false,
        },
        humanApprovalRequired: true,
      },
      replay: { status: "PASS" },
      verification: { status: "PASS" },
      metrics: {
        repairAttempts: 1,
        codexCalls: 0,
        inputTokens: null,
        outputTokens: null,
        costUsd: null,
      },
    });

    const [passportHtml, dashboardHtml] = await Promise.all([
      readFile(resolve(REPOSITORY_ROOT, "evidence/passport.html"), "utf8"),
      readFile(
        resolve(REPOSITORY_ROOT, "evidence/dashboard/index.html"),
        "utf8",
      ),
    ]);
    expect(passportHtml).toContain("<!doctype html>");
    expect(passportHtml).toContain("TRANSFER_IDEMPOTENCY");
    expect(passportHtml).toContain(evidenceHash);
    expect(dashboardHtml).toContain("QEDRA Evidence Dashboard");
    expect(dashboardHtml).toContain(evidenceHash);

    const verification = await runCli(["passport", "--verify", "--json"], {
      timeoutMs: 30_000,
    });
    expect(verification.code).toBe(0);
    const verificationResult = asRecord(
      parseCleanJson(verification),
      "passport verification",
    );
    const artifactChecks = asArray(
      verificationResult.artifactChecks,
      "passport artifact checks",
    );
    expect(verificationResult).toMatchObject({
      status: "VERIFIED",
      evidenceHash,
      evidenceHashValid: true,
      embeddedRepairHashValid: true,
      repairArtifactsValid: true,
      passportHtmlMatches: true,
      humanApprovalRequired: true,
    });
    expect(artifactChecks).toHaveLength(10);
    expect(
      artifactChecks.every(
        (check) => asRecord(check, "artifact check").valid === true,
      ),
    ).toBe(true);

    const recordedChangeSetPath = resolve(
      REPOSITORY_ROOT,
      "evidence/recorded-change-set.json",
    );
    const recordedChangeSet = await readFile(recordedChangeSetPath, "utf8");
    try {
      await writeFile(recordedChangeSetPath, `${recordedChangeSet} `, "utf8");
      const tampered = await runCli(["passport", "--verify", "--json"], {
        timeoutMs: 30_000,
      });
      expect(tampered.code).toBe(30);
      expect(parseCleanJson(tampered)).toMatchObject({
        status: "INVALID",
      });
    } finally {
      await writeFile(recordedChangeSetPath, recordedChangeSet, "utf8");
    }

    const regenerated = await runCli(["passport", "--json"], {
      timeoutMs: 30_000,
    });
    expect(regenerated.code).toBe(0);
    expect(parseCleanJson(regenerated)).toMatchObject({
      status: "GENERATED",
      humanApprovalRequired: true,
    });

    const restored = await runCli(["passport", "--verify", "--json"], {
      timeoutMs: 30_000,
    });
    expect(restored.code).toBe(0);
    expect(
      asArray(
        asRecord(parseCleanJson(restored), "restored passport verification")
          .artifactChecks,
        "restored artifact checks",
      ),
    ).toHaveLength(10);
  }, 120_000);
});
