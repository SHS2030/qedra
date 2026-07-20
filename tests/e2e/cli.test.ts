import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const REPOSITORY_ROOT = process.cwd();
const CLI_ENTRYPOINT = "packages/cli/src/bin.ts";
const SECRET_SENTINEL = "e2e-secret-sentinel-never-print";
const TRANSFER_EVIDENCE_DIRECTORY = "evidence/transfer-idempotency";
const PAYLOAD_BINDING_EVIDENCE_DIRECTORY =
  "evidence/idempotency-key-payload-binding";
const PAYLOAD_BINDING_CONFLICT_ERROR =
  "IDEMPOTENCY_KEY_REUSED_WITH_DIFFERENT_PAYLOAD";
const PAYLOAD_BINDING_REPAIR_FIXTURE = resolve(
  REPOSITORY_ROOT,
  "packages/codex-adapter/fixtures/IDEMPOTENCY_KEY_PAYLOAD_BINDING.patch",
);
let liveRepairSnapshotBeforeReplay: string | undefined;

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
  environment.QEDRA_DISABLE_ENV_FILE_AUTH = "1";
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
      invariantIds: ["TRANSFER_IDEMPOTENCY", "IDEMPOTENCY_KEY_PAYLOAD_BINDING"],
    });
  });

  it("reports replay readiness and never emits an API key value", async () => {
    const doctor = await runCli(["doctor", "--json"], {
      timeoutMs: 60_000,
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
      timeoutMs: 60_000,
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
  }, 135_000);

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
      counterexampleArtifact: `${TRANSFER_EVIDENCE_DIRECTORY}/counterexample.json`,
    });
    expect(attackActual).toMatchObject({
      balances: { A: 8_000, B: 7_000 },
      debitEntries: 2,
      creditEntries: 2,
      totalRelevantEntries: 4,
    });
    const counterexample = asRecord(
      JSON.parse(
        await readFile(
          resolve(
            REPOSITORY_ROOT,
            TRANSFER_EVIDENCE_DIRECTORY,
            "counterexample.json",
          ),
          "utf8",
        ),
      ) as unknown,
      "counterexample",
    );
    expect(counterexample.reproductionCommand).toBe(
      "node --import tsx packages/cli/src/bin.ts attack TRANSFER_IDEMPOTENCY --target vulnerable --json",
    );

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
      artifacts: {
        request: `${TRANSFER_EVIDENCE_DIRECTORY}/live-repair-request.json`,
        report: `${TRANSFER_EVIDENCE_DIRECTORY}/live-repair-report.json`,
        diff: null,
      },
    });
    liveRepairSnapshotBeforeReplay = await readFile(
      resolve(
        REPOSITORY_ROOT,
        TRANSFER_EVIDENCE_DIRECTORY,
        "live-repair-report.json",
      ),
      "utf8",
    );
    expect(liveRepairSnapshotBeforeReplay).not.toContain(SECRET_SENTINEL);
    expect(JSON.parse(liveRepairSnapshotBeforeReplay)).toMatchObject({
      mode: "live",
      status: "AUTHENTICATION_REQUIRED",
    });
  }, 45_000);

  it("reports payload-binding violations and corrected 409 conflicts as clean JSON", async () => {
    const attack = await runCli([
      "attack",
      "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
      "--target",
      "vulnerable",
      "--json",
    ]);
    expect(attack.code).toBe(10);
    const attackResult = asRecord(
      parseCleanJson(attack),
      "payload-binding attack result",
    );
    const attackExpected = asRecord(
      attackResult.expected,
      "payload-binding expected state",
    );
    const attackActual = asRecord(
      attackResult.actual,
      "payload-binding vulnerable state",
    );
    expect(attackResult).toMatchObject({
      schemaVersion: "1.0.0",
      invariantId: "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
      status: "FAILED",
      target: "vulnerable",
      scenarioId: "idempotency-key-payload-conflict",
      counterexampleArtifact: `${PAYLOAD_BINDING_EVIDENCE_DIRECTORY}/counterexample.json`,
    });
    expect(attackExpected).toMatchObject({
      amountConflictStatus: 409,
      amountConflictError: PAYLOAD_BINDING_CONFLICT_ERROR,
      destinationConflictStatus: 409,
      destinationConflictError: PAYLOAD_BINDING_CONFLICT_ERROR,
      sourceConflictStatus: 409,
      sourceConflictError: PAYLOAD_BINDING_CONFLICT_ERROR,
    });
    expect(attackActual).toMatchObject({
      balances: { A: 9_000, B: 6_000, C: 2_000 },
      ledgerEntries: 2,
      amountConflictStatus: 200,
      amountConflictError: null,
      amountConflictStateUnchanged: true,
      destinationConflictStatus: 200,
      destinationConflictError: null,
      destinationConflictStateUnchanged: true,
      sourceConflictStatus: 200,
      sourceConflictError: null,
      sourceConflictStateUnchanged: true,
      identicalRetryStatus: 200,
      identicalRetryMatchesInitialResult: true,
      originalTransferPreserved: true,
    });
    expect(asArray(attackActual.ledger, "vulnerable ledger")).toEqual(
      asArray(attackExpected.ledger, "expected ledger"),
    );
    expect(
      asArray(attackResult.violations, "payload-binding violations").map(
        (violation) => asRecord(violation, "payload-binding violation").code,
      ),
    ).toEqual([
      "AMOUNT_CONFLICT_NOT_REJECTED",
      "AMOUNT_CONFLICT_ERROR_MISMATCH",
      "DESTINATION_CONFLICT_NOT_REJECTED",
      "DESTINATION_CONFLICT_ERROR_MISMATCH",
      "SOURCE_CONFLICT_NOT_REJECTED",
      "SOURCE_CONFLICT_ERROR_MISMATCH",
    ]);

    const counterexample = asRecord(
      JSON.parse(
        await readFile(
          resolve(
            REPOSITORY_ROOT,
            PAYLOAD_BINDING_EVIDENCE_DIRECTORY,
            "counterexample.json",
          ),
          "utf8",
        ),
      ) as unknown,
      "payload-binding counterexample",
    );
    expect(counterexample).toMatchObject({
      invariant: { id: "IDEMPOTENCY_KEY_PAYLOAD_BINDING" },
      scenario: { id: "idempotency-key-payload-conflict" },
      reproductionCommand:
        "node --import tsx packages/cli/src/bin.ts attack IDEMPOTENCY_KEY_PAYLOAD_BINDING --target vulnerable --json",
    });

    const verification = await runCli([
      "verify",
      "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
      "--target",
      "fixed",
      "--json",
    ]);
    expect(verification.code).toBe(0);
    const verificationResult = asRecord(
      parseCleanJson(verification),
      "payload-binding verification result",
    );
    const verificationExpected = asRecord(
      verificationResult.expected,
      "payload-binding verification expectation",
    );
    const verificationActual = asRecord(
      verificationResult.actual,
      "payload-binding corrected state",
    );
    expect(verificationResult).toMatchObject({
      schemaVersion: "1.0.0",
      invariantId: "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
      status: "PASSED",
      target: "fixed",
      scenarioId: "idempotency-key-payload-conflict",
      counterexampleArtifact: null,
      violations: [],
    });
    expect(verificationActual).toEqual(verificationExpected);
    expect(verificationActual).toMatchObject({
      balances: { A: 9_000, B: 6_000, C: 2_000 },
      ledgerEntries: 2,
      amountConflictStatus: 409,
      amountConflictError: PAYLOAD_BINDING_CONFLICT_ERROR,
      amountConflictStateUnchanged: true,
      destinationConflictStatus: 409,
      destinationConflictError: PAYLOAD_BINDING_CONFLICT_ERROR,
      destinationConflictStateUnchanged: true,
      sourceConflictStatus: 409,
      sourceConflictError: PAYLOAD_BINDING_CONFLICT_ERROR,
      sourceConflictStateUnchanged: true,
      identicalRetryStatus: 200,
      identicalRetryMatchesInitialResult: true,
      originalTransferPreserved: true,
    });
    expect(asArray(verificationActual.ledger, "corrected ledger")).toHaveLength(
      2,
    );
  }, 45_000);

  it("completes deterministic repair replay and verifies the JSON and HTML passports", async () => {
    const demo = await runCli(["demo", "--replay", "--json"], {
      timeoutMs: 90_000,
    });
    expect(demo.code).toBe(0);
    expect(liveRepairSnapshotBeforeReplay).toBeDefined();
    expect(
      await readFile(
        resolve(
          REPOSITORY_ROOT,
          TRANSFER_EVIDENCE_DIRECTORY,
          "live-repair-report.json",
        ),
        "utf8",
      ),
    ).toBe(liveRepairSnapshotBeforeReplay);
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
      counterexample: `${TRANSFER_EVIDENCE_DIRECTORY}/counterexample.json`,
      passportJson: `${TRANSFER_EVIDENCE_DIRECTORY}/passport.json`,
      passportHtml: `${TRANSFER_EVIDENCE_DIRECTORY}/passport.html`,
      dashboard: `${TRANSFER_EVIDENCE_DIRECTORY}/dashboard/index.html`,
      liveRepairBlocker: `${TRANSFER_EVIDENCE_DIRECTORY}/live-repair-blocker.json`,
    });

    const passportSource = await readFile(
      resolve(REPOSITORY_ROOT, TRANSFER_EVIDENCE_DIRECTORY, "passport.json"),
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
      readFile(
        resolve(REPOSITORY_ROOT, TRANSFER_EVIDENCE_DIRECTORY, "passport.html"),
        "utf8",
      ),
      readFile(
        resolve(
          REPOSITORY_ROOT,
          TRANSFER_EVIDENCE_DIRECTORY,
          "dashboard/index.html",
        ),
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
      TRANSFER_EVIDENCE_DIRECTORY,
      "recorded-change-set.json",
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

  it.skipIf(!existsSync(PAYLOAD_BINDING_REPAIR_FIXTURE))(
    "repairs payload binding without changing the first passport and verifies aggregate evidence",
    async () => {
      const transferDemo = await runCli(
        ["demo", "TRANSFER_IDEMPOTENCY", "--replay", "--json"],
        { timeoutMs: 120_000 },
      );
      expect(transferDemo.code).toBe(0);
      expect(parseCleanJson(transferDemo)).toMatchObject({
        status: "PASSED",
        mode: "record-replay",
        invariantId: "TRANSFER_IDEMPOTENCY",
        humanApprovalRequired: true,
      });
      const transferPassportPath = resolve(
        REPOSITORY_ROOT,
        TRANSFER_EVIDENCE_DIRECTORY,
        "passport.json",
      );
      const transferPassportBeforePayloadRepair = await readFile(
        transferPassportPath,
        "utf8",
      );

      const attack = await runCli([
        "attack",
        "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
        "--target",
        "vulnerable",
        "--json",
      ]);
      expect(attack.code).toBe(10);
      expect(parseCleanJson(attack)).toMatchObject({
        invariantId: "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
        status: "FAILED",
        counterexampleArtifact: `${PAYLOAD_BINDING_EVIDENCE_DIRECTORY}/counterexample.json`,
      });

      const repair = await runCli(
        ["repair", "IDEMPOTENCY_KEY_PAYLOAD_BINDING", "--replay", "--json"],
        { timeoutMs: 120_000 },
      );
      expect(repair.code).toBe(0);
      const repairResult = asRecord(
        parseCleanJson(repair),
        "payload-binding repair result",
      );
      expect(repairResult).toMatchObject({
        schemaVersion: "1.0.0",
        invariantId: "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
        mode: "record-replay",
        status: "SUCCEEDED",
        humanApprovalRequired: true,
        approvalStatus: "PENDING",
        committed: false,
        merged: false,
        artifacts: {
          request: `${PAYLOAD_BINDING_EVIDENCE_DIRECTORY}/repair-request.json`,
          report: `${PAYLOAD_BINDING_EVIDENCE_DIRECTORY}/repair-report.json`,
          diff: `${PAYLOAD_BINDING_EVIDENCE_DIRECTORY}/repair.diff`,
        },
      });
      expect(repairResult.patchSha256).toMatch(/^[a-f0-9]{64}$/u);
      expect(asArray(repairResult.attempts, "repair attempts")).toHaveLength(1);
      expect(
        asArray(repairResult.changedFiles, "repair changed files"),
      ).toEqual([
        "examples/vulnerable-wallet-api/src/payload-blind-wallet-store.ts",
        "examples/vulnerable-wallet-api/tests/idempotency-key-payload-binding.regression.test.ts",
      ]);
      const validationResults = asArray(
        repairResult.validationResults,
        "repair validation results",
      );
      expect(
        validationResults.map(
          (validation) => asRecord(validation, "repair validation").id,
        ),
      ).toEqual(["non-regression-test", "exact-attack-replay"]);
      expect(
        validationResults.every(
          (validation) =>
            asRecord(validation, "repair validation").passed === true,
        ),
      ).toBe(true);
      expect(
        existsSync(
          resolve(
            REPOSITORY_ROOT,
            ".qedra/worktrees/idempotency-key-payload-binding",
          ),
        ),
      ).toBe(false);

      const generated = await runCli(
        ["passport", "IDEMPOTENCY_KEY_PAYLOAD_BINDING", "--json"],
        { timeoutMs: 60_000 },
      );
      expect(generated.code).toBe(0);
      expect(parseCleanJson(generated)).toMatchObject({
        schemaVersion: "1.0.0",
        status: "GENERATED",
        humanApprovalRequired: true,
        artifacts: {
          json: `${PAYLOAD_BINDING_EVIDENCE_DIRECTORY}/passport.json`,
          html: `${PAYLOAD_BINDING_EVIDENCE_DIRECTORY}/passport.html`,
          liveRepairBlocker: `${PAYLOAD_BINDING_EVIDENCE_DIRECTORY}/live-repair-blocker.json`,
        },
      });
      expect(await readFile(transferPassportPath, "utf8")).toBe(
        transferPassportBeforePayloadRepair,
      );

      const payloadPassport = asRecord(
        JSON.parse(
          await readFile(
            resolve(
              REPOSITORY_ROOT,
              PAYLOAD_BINDING_EVIDENCE_DIRECTORY,
              "passport.json",
            ),
            "utf8",
          ),
        ) as unknown,
        "payload-binding passport",
      );
      expect(payloadPassport).toMatchObject({
        schemaVersion: "1.0.0",
        kind: "qedra.passport",
        invariant: { id: "IDEMPOTENCY_KEY_PAYLOAD_BINDING" },
        humanApprovalRequired: true,
        attack: { status: "FAIL" },
        repair: {
          mode: "record-replay",
          status: "replayed",
          validation: { passed: true },
          humanApprovalRequired: true,
        },
        replay: { status: "PASS" },
        verification: { status: "PASS" },
      });

      const payloadVerification = await runCli(
        ["passport", "IDEMPOTENCY_KEY_PAYLOAD_BINDING", "--verify", "--json"],
        { timeoutMs: 60_000 },
      );
      expect(payloadVerification.code).toBe(0);
      const payloadVerificationResult = asRecord(
        parseCleanJson(payloadVerification),
        "payload-binding passport verification",
      );
      expect(payloadVerificationResult).toMatchObject({
        status: "VERIFIED",
        evidenceHashValid: true,
        embeddedRepairHashValid: true,
        repairArtifactsValid: true,
        passportHtmlMatches: true,
        humanApprovalRequired: true,
      });
      expect(
        asArray(
          payloadVerificationResult.artifactChecks,
          "payload-binding artifact checks",
        ).every(
          (check) =>
            asRecord(check, "payload-binding artifact check").valid === true,
        ),
      ).toBe(true);

      const aggregateGeneration = await runCli(
        ["passport", "--all", "--json"],
        { timeoutMs: 120_000 },
      );
      expect(aggregateGeneration.code).toBe(0);
      const aggregateGenerationResult = asRecord(
        parseCleanJson(aggregateGeneration),
        "aggregate passport generation",
      );
      expect(aggregateGenerationResult).toMatchObject({
        schemaVersion: "1.0.0",
        status: "GENERATED",
        artifacts: {
          summary: "evidence/summary.json",
          dashboardData: "evidence/dashboard/data.json",
          dashboardHtml: "evidence/dashboard/index.html",
        },
        humanApprovalRequired: true,
      });
      expect(aggregateGenerationResult.summaryEvidenceHash).toMatch(
        /^[a-f0-9]{64}$/u,
      );
      const evidenceHashes = asRecord(
        aggregateGenerationResult.evidenceHashes,
        "aggregate evidence hashes",
      );
      expect(evidenceHashes.TRANSFER_IDEMPOTENCY).toMatch(/^[a-f0-9]{64}$/u);
      expect(evidenceHashes.IDEMPOTENCY_KEY_PAYLOAD_BINDING).toMatch(
        /^[a-f0-9]{64}$/u,
      );

      const [summarySource, dashboardHtml] = await Promise.all([
        readFile(resolve(REPOSITORY_ROOT, "evidence/summary.json"), "utf8"),
        readFile(
          resolve(REPOSITORY_ROOT, "evidence/dashboard/index.html"),
          "utf8",
        ),
      ]);
      expect(JSON.parse(summarySource)).toMatchObject({
        kind: "qedra.evidence-summary",
        humanApproval: { required: true, status: "PENDING" },
        invariants: [
          {
            invariantId: "TRANSFER_IDEMPOTENCY",
            evidenceDirectory: TRANSFER_EVIDENCE_DIRECTORY,
            humanApproval: { required: true, status: "PENDING" },
          },
          {
            invariantId: "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
            evidenceDirectory: PAYLOAD_BINDING_EVIDENCE_DIRECTORY,
            humanApproval: { required: true, status: "PENDING" },
          },
        ],
      });
      expect(dashboardHtml).toContain("TRANSFER_IDEMPOTENCY");
      expect(dashboardHtml).toContain("IDEMPOTENCY_KEY_PAYLOAD_BINDING");
      expect(dashboardHtml).toContain("PENDING");

      const aggregateVerification = await runCli(
        ["passport", "--all", "--verify", "--json"],
        { timeoutMs: 60_000 },
      );
      expect(aggregateVerification.code).toBe(0);
      const aggregateVerificationResult = asRecord(
        parseCleanJson(aggregateVerification),
        "aggregate passport verification",
      );
      expect(aggregateVerificationResult).toMatchObject({
        schemaVersion: "1.0.0",
        status: "VERIFIED",
        humanApprovalRequired: true,
        summary: {
          status: "VERIFIED",
          invariantIds: [
            "TRANSFER_IDEMPOTENCY",
            "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
          ],
          humanApprovalRequired: true,
          approvalStatus: "PENDING",
          error: null,
        },
      });
      const bundles = asRecord(
        aggregateVerificationResult.bundles,
        "aggregate passport bundles",
      );
      for (const invariantId of [
        "TRANSFER_IDEMPOTENCY",
        "IDEMPOTENCY_KEY_PAYLOAD_BINDING",
      ]) {
        const bundle = asRecord(bundles[invariantId], `${invariantId} bundle`);
        expect(bundle).toMatchObject({
          status: "VERIFIED",
          evidenceHashValid: true,
          embeddedRepairHashValid: true,
          repairArtifactsValid: true,
          passportHtmlMatches: true,
          humanApprovalRequired: true,
        });
        expect(
          asArray(
            bundle.artifactChecks,
            `${invariantId} artifact checks`,
          ).every(
            (check) => asRecord(check, `${invariantId} artifact check`).valid,
          ),
        ).toBe(true);
      }
      expect(
        existsSync(
          resolve(
            REPOSITORY_ROOT,
            ".qedra/worktrees/idempotency-key-payload-binding",
          ),
        ),
      ).toBe(false);
      expect(
        existsSync(
          resolve(REPOSITORY_ROOT, ".qedra/worktrees/transfer-idempotency"),
        ),
      ).toBe(false);
    },
    360_000,
  );
});
