import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { detectOpenAiApiKeyPresence } from "../../packages/codex-adapter/src/index.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(async (directory) => {
      await rm(directory, { recursive: true, force: true });
    }),
  );
});

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "qedra-auth-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

describe("detectOpenAiApiKeyPresence", () => {
  it("reports an active environment credential without returning its value", async () => {
    const cwd = await temporaryDirectory();
    const secret = "unit-test-value-that-must-not-be-returned";
    const result = await detectOpenAiApiKeyPresence({
      cwd,
      env: { OPENAI_API_KEY: secret },
      envFiles: ["named.env"],
    });

    expect(result).toMatchObject({
      present: true,
      source: "environment",
      liveReady: true,
    });
    expect(JSON.stringify(result)).not.toContain(secret);
    expect(result.checkedFiles).toEqual([]);
  });

  it("detects a credential in a named env file without exposing it", async () => {
    const cwd = await temporaryDirectory();
    const secret = "file-test-value-that-must-not-be-returned";
    await writeFile(
      join(cwd, "judge.env"),
      `# local only\nOPENAI_API_KEY="${secret}"\n`,
      "utf8",
    );

    const result = await detectOpenAiApiKeyPresence({
      cwd,
      env: {},
      envFiles: ["judge.env"],
    });

    expect(result).toMatchObject({
      present: true,
      source: "env-file",
      liveReady: true,
    });
    expect(result.checkedFiles).toEqual([
      { path: join(cwd, "judge.env"), status: "present" },
    ]);
    expect(JSON.stringify(result)).not.toContain(secret);
  });

  it("does not accept empty values or placeholders", async () => {
    const cwd = await temporaryDirectory();
    await writeFile(
      join(cwd, ".env.local"),
      "OPENAI_API_KEY=replace-me\n",
      "utf8",
    );

    const result = await detectOpenAiApiKeyPresence({
      cwd,
      env: { OPENAI_API_KEY: " " },
      envFiles: [".env.local", "missing.env"],
    });

    expect(result.present).toBe(false);
    expect(result.source).toBeNull();
    expect(result.liveReady).toBe(false);
    expect(result.checkedFiles.map((file) => file.status)).toEqual([
      "missing",
      "missing",
    ]);
  });
});
