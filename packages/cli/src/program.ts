import { Command, CommanderError } from "commander";

import { initConstitution } from "../../constitution/src/index.js";
import {
  buildCounterexample,
  COUNTEREXAMPLE_PATH,
  readCounterexample,
  writeCounterexample,
} from "./counterexample.js";
import { runDoctor, type DoctorReport, type ToolDiagnostic } from "./doctor.js";
import { ExitCode, type ExitCodeValue } from "./exit-codes.js";
import { runDemo, type DemoResult } from "./demo.js";
import { type CliIo, processIo, writeJson } from "./output.js";
import {
  generatePassportFromStoredArtifacts,
  verifyPassportBundle,
  type PassportVerificationResult,
} from "./passport.js";
import {
  runProofLoop,
  type ProofLoopRun,
  type ProofTarget,
} from "./proof-loop.js";
import {
  executeLiveRepair,
  executeRecordedRepair,
  REPAIR_DIFF_PATH,
  REPAIR_REPORT_PATH,
  REPAIR_REQUEST_PATH,
  type RepairExecution,
} from "./repair.js";
import { findRepositoryRoot } from "./repository.js";

function formatTool(name: string, diagnostic: ToolDiagnostic): string {
  if (diagnostic.available) {
    return `  PASS  ${name}: ${diagnostic.version ?? "available"}`;
  }
  return `  WARN  ${name}: ${diagnostic.detail ?? "unavailable"}`;
}

function formatDoctor(report: DoctorReport): string {
  const lines = [
    "QEDRA doctor",
    `Status: ${report.status}`,
    formatTool("Node.js", report.node),
    formatTool("pnpm", report.pnpm),
    formatTool("Git", report.git),
    formatTool("Docker", report.docker),
    formatTool("Flutter", report.flutter),
    formatTool("Codex SDK", report.codexSdk),
    report.openaiAuthentication.present
      ? "  PASS  OpenAI authentication: available (value not displayed)"
      : "  BLOCK OpenAI authentication: OPENAI_API_KEY not found; live repair disabled",
    "  PASS  Deterministic repair replay: available",
  ];
  return `${lines.join("\n")}\n`;
}

function commandJsonOption(command: Command): boolean {
  const local = command.opts<{ json?: boolean }>();
  const global = command.optsWithGlobals<{ json?: boolean }>();
  return local.json === true || global.json === true;
}

function requireInvariant(invariant: string): void {
  if (invariant !== "TRANSFER_IDEMPOTENCY") {
    throw new Error(`Unsupported invariant: ${invariant}`);
  }
}

function proofTarget(value: string): ProofTarget {
  if (value !== "vulnerable" && value !== "fixed") {
    throw new Error(
      `Target must be "vulnerable" or "fixed"; received ${value}`,
    );
  }
  return value;
}

function proofLoopOutput(run: ProofLoopRun, artifact: string | null): object {
  return {
    schemaVersion: "1.0.0",
    invariantId: run.verification.invariantId,
    status: run.verification.status,
    target: run.target,
    scenarioId: run.scenario.scenarioId,
    deterministicSeed: run.scenario.deterministicSeed,
    attackRequestHash: run.scenario.attackRequestHash,
    expected: run.verification.expected,
    actual: run.verification.actual,
    violations: run.verification.violations,
    counterexampleArtifact: artifact,
    durationMs: run.durationMs,
  };
}

function formatProofLoop(run: ProofLoopRun, artifact: string | null): string {
  const actual = run.verification.actual;
  const expected = run.verification.expected;
  const lines = [
    `TRANSFER_IDEMPOTENCY ${run.verification.status}`,
    `Target: ${run.target}`,
    `Wallet A: ${String(actual.balances.A)} FCFA (expected ${String(expected.balances.A)})`,
    `Wallet B: ${String(actual.balances.B)} FCFA (expected ${String(expected.balances.B)})`,
    `TX-001 ledger: ${actual.debitEntries} debit(s), ${actual.creditEntries} credit(s)`,
    `Exact attack hash: ${run.scenario.attackRequestHash}`,
  ];
  if (artifact !== null) {
    lines.push(`Counterexample: ${artifact}`);
  }
  for (const violation of run.verification.violations) {
    lines.push(`  - ${violation.code}: ${violation.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function repairOutput(execution: RepairExecution): object {
  return {
    schemaVersion: "1.0.0",
    invariantId: execution.request.invariant.id,
    mode: execution.request.mode,
    status: execution.result.status,
    attempts: execution.result.attempts,
    blocker: execution.result.blocker ?? null,
    changedFiles: execution.result.changedFiles ?? [],
    validationResults: execution.result.validationResults ?? [],
    patchSha256: execution.result.patch?.sha256 ?? null,
    humanApprovalRequired: execution.result.humanApprovalRequired,
    approvalStatus: execution.result.approvalStatus,
    committed: execution.result.committed,
    merged: execution.result.merged,
    artifacts: {
      request: REPAIR_REQUEST_PATH,
      report: REPAIR_REPORT_PATH,
      diff: execution.result.patch === undefined ? null : REPAIR_DIFF_PATH,
    },
  };
}

function formatRepair(execution: RepairExecution): string {
  const validations = execution.result.validationResults ?? [];
  const lines = [
    `TRANSFER_IDEMPOTENCY repair ${execution.result.status}`,
    `Mode: ${execution.request.mode}`,
    `Attempts: ${String(execution.result.attempts.length)} / ${String(execution.request.limits.maxAttempts)}`,
    `Changed files: ${(execution.result.changedFiles ?? []).join(", ") || "none"}`,
    `Validation: ${
      validations.length > 0 &&
      validations.every(
        (result) =>
          typeof result === "object" &&
          result !== null &&
          "passed" in result &&
          result.passed === true,
      )
        ? "PASSED"
        : "NOT PASSED"
    }`,
    `Human approval: ${execution.result.approvalStatus} (required)`,
    `Repair request: ${REPAIR_REQUEST_PATH}`,
    `Repair report: ${REPAIR_REPORT_PATH}`,
  ];
  if (execution.result.blocker !== undefined) {
    lines.push(`Blocker: ${execution.result.blocker.message}`);
  }
  return `${lines.join("\n")}\n`;
}

function formatPassportVerification(
  result: PassportVerificationResult,
): string {
  const lines = [
    `QEDRA passport ${result.status}`,
    `Evidence hash: ${result.evidenceHash ?? "unavailable"}`,
    `Passport hash: ${result.evidenceHashValid ? "VERIFIED" : "INVALID"}`,
    `Embedded repair hash: ${result.embeddedRepairHashValid ? "VERIFIED" : "INVALID"}`,
    `Standalone HTML: ${result.passportHtmlMatches ? "VERIFIED" : "INVALID"}`,
    `Referenced artifacts: ${String(result.artifactChecks.filter((check) => check.valid).length)} / ${String(result.artifactChecks.length)}`,
    `Human approval required: ${String(result.humanApprovalRequired)}`,
  ];
  return `${lines.join("\n")}\n`;
}

function displayRecordField(
  record: Readonly<Record<string, unknown>> | null,
  field: string,
  fallback = "NOT_RUN",
): string {
  const value = record?.[field];
  return typeof value === "string" || typeof value === "number"
    ? String(value)
    : fallback;
}

function formatDemo(result: DemoResult): string {
  const attackBalances = result.attack.balances as
    | Readonly<Record<string, unknown>>
    | undefined;
  const lines = [
    `QEDRA Genesis demo ${result.status}`,
    `Mode: ${result.mode}`,
    `Law: ${result.invariantId}`,
    `Attack: ${displayRecordField(result.attack, "status")}`,
    ...(attackBalances === undefined
      ? []
      : [
          `Vulnerable balances: A=${String(attackBalances.A)} FCFA, B=${String(attackBalances.B)} FCFA`,
          `Duplicate ledger: ${displayRecordField(result.attack, "debitEntries", "unknown")} debit(s), ${displayRecordField(result.attack, "creditEntries", "unknown")} credit(s)`,
        ]),
    `Repair: ${displayRecordField(result.repair, "status")}`,
    `Replay: ${displayRecordField(result.replay, "status")}`,
    `Verification: ${displayRecordField(result.verification, "status")}`,
    `Human approval: PENDING (required)`,
    ...Object.entries(result.artifacts).map(
      ([name, path]) => `${name}: ${path}`,
    ),
  ];
  return `${lines.join("\n")}\n`;
}

export async function runCli(
  args: readonly string[],
  io: CliIo = processIo,
): Promise<ExitCodeValue> {
  let exitCode: ExitCodeValue = ExitCode.SUCCESS;
  const program = new Command();
  program
    .name("qedra")
    .description("Executable evidence for autonomous software engineering.")
    .version("0.1.0")
    .option("--json", "emit one machine-readable JSON document")
    .showHelpAfterError()
    .exitOverride()
    .configureOutput({
      writeOut: io.stdout,
      writeErr: io.stderr,
    });

  program
    .command("doctor")
    .description(
      "inspect the environment and repair capabilities without upgrading tools",
    )
    .option("--json", "emit one machine-readable JSON document")
    .action(async (_options, command: Command) => {
      const repositoryRoot = await findRepositoryRoot();
      const report = await runDoctor(repositoryRoot);
      if (commandJsonOption(command)) {
        writeJson(io, report);
      } else {
        io.stdout(formatDoctor(report));
      }
      exitCode =
        report.status === "DEGRADED"
          ? ExitCode.EXECUTION_FAILED
          : ExitCode.SUCCESS;
    });

  program
    .command("init")
    .description("create or validate the QEDRA constitution")
    .option("--json", "emit one machine-readable JSON document")
    .action(async (_options, command: Command) => {
      const repositoryRoot = await findRepositoryRoot();
      const result = await initConstitution(repositoryRoot);
      const output = {
        schemaVersion: "1.0.0",
        status: result.created ? "CREATED" : "VALIDATED",
        path: "constitutions/qedra.yaml",
        invariantIds: result.constitution.invariants.map(
          (invariant) => invariant.id,
        ),
      } as const;
      if (commandJsonOption(command)) {
        writeJson(io, output);
      } else {
        io.stdout(
          `Constitution ${output.status.toLowerCase()}: ${output.path}\nProtected laws: ${output.invariantIds.join(", ")}\n`,
        );
      }
    });

  program
    .command("verify")
    .description("execute and evaluate selected software invariants")
    .argument("[invariant]", "invariant ID", "TRANSFER_IDEMPOTENCY")
    .option("--target <target>", "wallet target: fixed or vulnerable", "fixed")
    .option("--json", "emit one machine-readable JSON document")
    .action(
      async (
        invariant: string,
        options: { target: string },
        command: Command,
      ) => {
        requireInvariant(invariant);
        const repositoryRoot = await findRepositoryRoot();
        await initConstitution(repositoryRoot);
        const run = await runProofLoop(
          repositoryRoot,
          proofTarget(options.target),
        );
        if (commandJsonOption(command)) {
          writeJson(io, proofLoopOutput(run, null));
        } else {
          io.stdout(formatProofLoop(run, null));
        }
        exitCode = run.verification.passed
          ? ExitCode.SUCCESS
          : ExitCode.VIOLATION_CONFIRMED;
      },
    );

  program
    .command("attack")
    .description("execute a reproducible adversarial counterexample")
    .argument("[invariant]", "invariant ID", "TRANSFER_IDEMPOTENCY")
    .option(
      "--target <target>",
      "wallet target: vulnerable or fixed",
      "vulnerable",
    )
    .option("--json", "emit one machine-readable JSON document")
    .action(
      async (
        invariant: string,
        options: { target: string },
        command: Command,
      ) => {
        requireInvariant(invariant);
        const repositoryRoot = await findRepositoryRoot();
        await initConstitution(repositoryRoot);
        const run = await runProofLoop(
          repositoryRoot,
          proofTarget(options.target),
        );
        let artifact: string | null = null;
        if (!run.verification.passed) {
          const counterexample = await buildCounterexample(
            repositoryRoot,
            run.scenario,
            run.verification,
          );
          await writeCounterexample(repositoryRoot, counterexample);
          artifact = COUNTEREXAMPLE_PATH;
        }
        if (commandJsonOption(command)) {
          writeJson(io, proofLoopOutput(run, artifact));
        } else {
          io.stdout(formatProofLoop(run, artifact));
        }
        exitCode = run.verification.passed
          ? ExitCode.SUCCESS
          : ExitCode.VIOLATION_CONFIRMED;
      },
    );

  program
    .command("repair")
    .description("run a bounded repair in an isolated Git worktree")
    .argument("[invariant]", "invariant ID", "TRANSFER_IDEMPOTENCY")
    .option(
      "--live",
      "use the official Codex SDK instead of deterministic replay",
      false,
    )
    .option("--replay", "use the deterministic recorded change set", true)
    .option("--json", "emit one machine-readable JSON document")
    .action(
      async (
        invariant: string,
        options: { live: boolean; replay: boolean },
        command: Command,
      ) => {
        requireInvariant(invariant);
        const repositoryRoot = await findRepositoryRoot();
        const counterexample = await readCounterexample(repositoryRoot);
        const execution = options.live
          ? await executeLiveRepair(repositoryRoot, counterexample)
          : await executeRecordedRepair(repositoryRoot, counterexample);
        if (commandJsonOption(command)) {
          writeJson(io, repairOutput(execution));
        } else {
          io.stdout(formatRepair(execution));
        }
        exitCode =
          execution.result.status === "SUCCEEDED"
            ? ExitCode.SUCCESS
            : execution.result.status === "AUTHENTICATION_REQUIRED"
              ? ExitCode.LIVE_REPAIR_BLOCKED
              : ExitCode.EXECUTION_FAILED;
      },
    );

  program
    .command("passport")
    .description("generate or verify the machine-verifiable evidence passport")
    .option("--verify", "verify hashes and every referenced artifact", false)
    .option("--json", "emit one machine-readable JSON document")
    .action(async (options: { verify: boolean }, command: Command) => {
      const repositoryRoot = await findRepositoryRoot();
      if (options.verify) {
        const result = await verifyPassportBundle(repositoryRoot);
        if (commandJsonOption(command)) {
          writeJson(io, result);
        } else {
          io.stdout(formatPassportVerification(result));
        }
        exitCode =
          result.status === "VERIFIED"
            ? ExitCode.SUCCESS
            : ExitCode.EXECUTION_FAILED;
        return;
      }

      const generated =
        await generatePassportFromStoredArtifacts(repositoryRoot);
      const result = {
        schemaVersion: "1.0.0",
        status: "GENERATED",
        evidenceHash: generated.passport.evidenceHash,
        humanApprovalRequired: generated.passport.humanApprovalRequired,
        artifacts: generated.paths,
      } as const;
      if (commandJsonOption(command)) {
        writeJson(io, result);
      } else {
        io.stdout(
          `QEDRA passport generated\nEvidence hash: ${result.evidenceHash}\nJSON: ${result.artifacts.json}\nHTML: ${result.artifacts.html}\nDashboard: ${result.artifacts.dashboard}\nHuman approval: PENDING (required)\n`,
        );
      }
    });

  program
    .command("demo")
    .description("run the complete judge-friendly proof loop")
    .option("--replay", "use the deterministic recorded repair", false)
    .option("--live", "use the official Codex SDK live repair", false)
    .option("--json", "emit one machine-readable JSON document")
    .action(
      async (options: { replay: boolean; live: boolean }, command: Command) => {
        if (options.live && options.replay) {
          throw new Error("Choose either --live or --replay, not both.");
        }
        const repositoryRoot = await findRepositoryRoot();
        const result = await runDemo(
          repositoryRoot,
          options.live ? "live" : "record-replay",
        );
        if (commandJsonOption(command)) {
          writeJson(io, result);
        } else {
          io.stdout(formatDemo(result));
        }
        exitCode =
          result.status === "PASSED"
            ? ExitCode.SUCCESS
            : ExitCode.LIVE_REPAIR_BLOCKED;
      },
    );

  try {
    await program.parseAsync(["node", "qedra", ...args]);
  } catch (error) {
    if (error instanceof CommanderError) {
      if (
        error.code === "commander.helpDisplayed" ||
        error.code === "commander.version"
      ) {
        return ExitCode.SUCCESS;
      }
      return ExitCode.USAGE_OR_CONFIGURATION;
    }
    const message = error instanceof Error ? error.message : String(error);
    io.stderr(`QEDRA execution failed: ${message}\n`);
    return ExitCode.EXECUTION_FAILED;
  }

  return exitCode;
}
