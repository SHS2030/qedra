import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

import {
  GitWorktreeRunner,
  NodeProcessRunner,
  prepareProcessInvocation,
  type ProcessExecutionRequest,
  type ProcessExecutionResult,
  type ProcessRunner,
} from "../../packages/git-adapter/src/index.js";

const BASE_COMMIT = "a".repeat(40);
const OTHER_COMMIT = "b".repeat(40);
const PATCH = [
  "diff --git a/src/value.ts b/src/value.ts",
  `index ${"1".repeat(40)}..${"2".repeat(40)} 100644`,
  "--- a/src/value.ts",
  "+++ b/src/value.ts",
  "@@ -1 +1 @@",
  "-export const value = 1;",
  "+export const value = 2;",
  "",
].join("\n");
const execFileAsync = promisify(execFile);

async function runGitFixture(
  cwd: string,
  args: readonly string[],
): Promise<string> {
  const result = await execFileAsync(
    "git",
    ["-c", `safe.directory=${cwd}`, "-C", cwd, ...args],
    { encoding: "utf8", windowsHide: true },
  );
  return result.stdout;
}

class FakeProcessRunner implements ProcessRunner {
  readonly calls: ProcessExecutionRequest[] = [];

  constructor(readonly headCommit = BASE_COMMIT) {}

  run(request: ProcessExecutionRequest): Promise<ProcessExecutionResult> {
    this.calls.push(request);
    const args = [...(request.args ?? [])];
    let stdout = "";
    if (args.includes("--show-toplevel")) {
      stdout = request.cwd;
    } else if (args.includes("--verify")) {
      stdout = `${BASE_COMMIT}\n`;
    } else if (args.includes("HEAD")) {
      stdout = `${this.headCommit}\n`;
    } else if (args.includes("--name-only")) {
      stdout = "src/value.ts\0";
    } else if (args.includes("--binary")) {
      stdout = PATCH;
    }

    return Promise.resolve({
      command: request.command,
      args,
      exitCode: 0,
      stdout,
      stderr: "",
      durationMs: 1,
      timedOut: false,
      cancelled: false,
      outputTruncated: false,
    });
  }
}

describe("GitWorktreeRunner", () => {
  it("keeps a real source repository unchanged and removes the isolated worktree", async () => {
    const temporaryRoot = await mkdtemp(join(tmpdir(), "qedra-git-adapter-"));
    const repositoryPath = join(temporaryRoot, "repository");
    const worktreePath = join(temporaryRoot, "worktree");
    await mkdir(repositoryPath);
    try {
      await runGitFixture(repositoryPath, ["init"]);
      await runGitFixture(repositoryPath, [
        "config",
        "user.email",
        "qedra-test@example.invalid",
      ]);
      await runGitFixture(repositoryPath, [
        "config",
        "user.name",
        "QEDRA Test",
      ]);
      await writeFile(join(repositoryPath, "value.txt"), "before\n", "utf8");
      await runGitFixture(repositoryPath, ["add", "value.txt"]);
      await runGitFixture(repositoryPath, ["commit", "-m", "fixture baseline"]);
      const sourceCommit = (
        await runGitFixture(repositoryPath, ["rev-parse", "HEAD"])
      ).trim();

      const runner = new GitWorktreeRunner();
      const result = await runner.run(
        {
          repositoryPath,
          worktreePath,
          baseRef: sourceCommit,
          validationCommands: [
            {
              id: "content-check",
              command: process.execPath,
              args: [
                "-e",
                "const fs=require('node:fs');process.exit(fs.readFileSync('value.txt','utf8')==='after\\n'?0:1)",
              ],
              timeoutMs: 5_000,
            },
          ],
        },
        async (context) => {
          await writeFile(
            join(context.workingDirectory, "value.txt"),
            "after\n",
            "utf8",
          );
        },
      );

      expect(result.status).toBe("PASSED");
      expect(result.changedFiles).toEqual(["value.txt"]);
      expect(result.patch).toContain("+after");
      expect(result.validationResults[0]?.passed).toBe(true);
      expect(result.cleanup.succeeded).toBe(true);
      expect(await readFile(join(repositoryPath, "value.txt"), "utf8")).toBe(
        "before\n",
      );
      expect(
        (await runGitFixture(repositoryPath, ["rev-parse", "HEAD"])).trim(),
      ).toBe(sourceCommit);
      await expect(
        readFile(join(worktreePath, "value.txt"), "utf8"),
      ).rejects.toThrow();
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true });
    }
  });

  it("runs a mutation and validation in a detached worktree with scoped safe.directory", async () => {
    const repositoryPath = join(process.cwd(), ".unit-fixture-repository");
    const worktreePath = join(process.cwd(), ".unit-fixture-worktree");
    const processRunner = new FakeProcessRunner();
    const runner = new GitWorktreeRunner({ processRunner });

    const result = await runner.run(
      {
        repositoryPath,
        worktreePath,
        baseRef: "HEAD",
        validationCommands: [
          {
            id: "unit",
            command: process.execPath,
            args: ["--version"],
            timeoutMs: 1_000,
          },
        ],
      },
      async (context) => {
        const applied = await context.runGit(["apply", "--check"], {
          stdin: PATCH,
          timeoutMs: 1_000,
        });
        expect(applied.exitCode).toBe(0);
        return { repaired: true as const };
      },
    );

    expect(result.status).toBe("PASSED");
    expect(result.patch).toBe(PATCH);
    expect(result.patchSha256).toBe(
      createHash("sha256").update(PATCH).digest("hex"),
    );
    expect(result.changedFiles).toEqual(["src/value.ts"]);
    expect(result.validationResults).toHaveLength(1);
    expect(result.validationResults[0]?.passed).toBe(true);
    expect(result.cleanup).toEqual({
      attempted: true,
      succeeded: true,
      pruned: true,
    });
    expect(result.humanApprovalRequired).toBe(true);
    expect(result.approvalStatus).toBe("PENDING");
    expect(result.merged).toBe(false);
    expect(result.appliedToSourceRepository).toBe(false);

    const gitCalls = processRunner.calls.filter(
      (call) => call.command === "git",
    );
    expect(gitCalls.length).toBeGreaterThan(0);
    for (const call of gitCalls) {
      expect(call.args).toContain(`safe.directory=${repositoryPath}`);
      expect(call.args).not.toContain("--global");
    }
    expect(
      gitCalls.some((call) => call.args?.includes("commit") === true),
    ).toBe(false);
    expect(gitCalls.some((call) => call.args?.includes("merge") === true)).toBe(
      false,
    );
    const validationCall = processRunner.calls.find(
      (call) => call.command === process.execPath,
    );
    expect(validationCall?.omitEnvironmentVariables).toEqual(
      expect.arrayContaining(["OPENAI_API_KEY", "CODEX_API_KEY"]),
    );
  });

  it("preserves the patch and cleans up after a failed mutation", async () => {
    const repositoryPath = join(process.cwd(), ".unit-failed-repository");
    const worktreePath = join(process.cwd(), ".unit-failed-worktree");
    const processRunner = new FakeProcessRunner();
    const runner = new GitWorktreeRunner({ processRunner });

    const result = await runner.run(
      {
        repositoryPath,
        worktreePath,
        baseRef: BASE_COMMIT,
        validationCommands: [],
      },
      () => {
        throw new Error("deterministic mutation failure");
      },
    );

    expect(result.status).toBe("MUTATION_FAILED");
    expect(result.patch).toBe(PATCH);
    expect(result.error).toBe("deterministic mutation failure");
    expect(result.cleanup.succeeded).toBe(true);
  });

  it("detects an unexpected commit as a policy violation", async () => {
    const repositoryPath = join(process.cwd(), ".unit-policy-repository");
    const worktreePath = join(process.cwd(), ".unit-policy-worktree");
    const runner = new GitWorktreeRunner({
      processRunner: new FakeProcessRunner(OTHER_COMMIT),
    });

    const result = await runner.run(
      {
        repositoryPath,
        worktreePath,
        baseRef: BASE_COMMIT,
        validationCommands: [],
      },
      () => Promise.resolve({ repaired: true }),
    );

    expect(result.status).toBe("POLICY_VIOLATION");
    expect(result.committed).toBe(true);
    expect(result.patch).toBe(PATCH);
    expect(result.appliedToSourceRepository).toBe(false);
  });
});

describe("prepareProcessInvocation", () => {
  it("uses the Windows command interpreter for safe pnpm validation commands", () => {
    expect(
      prepareProcessInvocation(
        "pnpm",
        ["test", "--", "idempotency"],
        "win32",
        "C:\\Windows\\System32\\cmd.exe",
      ),
    ).toEqual({
      command: "C:\\Windows\\System32\\cmd.exe",
      args: ["/d", "/s", "/c", "pnpm test -- idempotency"],
    });
  });

  it("rejects shell metacharacters before invoking cmd.exe", () => {
    expect(() =>
      prepareProcessInvocation("pnpm", ["test", "&", "whoami"], "win32"),
    ).toThrow("unsupported shell characters");
  });
});

describe("NodeProcessRunner environment isolation", () => {
  it("removes API credentials from validation child processes", async () => {
    const runner = new NodeProcessRunner();
    const result = await runner.run({
      command: process.execPath,
      args: [
        "-e",
        "process.stdout.write(String(process.env.OPENAI_API_KEY === undefined && process.env.CODEX_API_KEY === undefined))",
      ],
      cwd: process.cwd(),
      env: {
        OPENAI_API_KEY: "unit-test-openai-sentinel",
        CODEX_API_KEY: "unit-test-codex-sentinel",
      },
      omitEnvironmentVariables: ["OPENAI_API_KEY", "CODEX_API_KEY"],
      timeoutMs: 5_000,
    });

    expect(result).toMatchObject({
      exitCode: 0,
      stdout: "true",
      stderr: "",
      timedOut: false,
      cancelled: false,
    });
  });
});
