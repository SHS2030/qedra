import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  atomicWriteJson,
  atomicWriteText,
  canonicalJsonStringify,
  hashCanonicalJson,
  isSafeRepositoryRelativePath,
  readGitMetadata,
  resolveRepositoryPath,
  sha256Hex,
  toRepositoryRelativePath,
} from "../../packages/shared/src/index.js";

const temporaryRoots: string[] = [];

async function makeTemporaryRoot(): Promise<string> {
  const parent = resolve(process.cwd(), "reports/runtime/test-temp");
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, "shared-"));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  for (const root of temporaryRoots.splice(0)) {
    await rm(root, { recursive: true, force: true });
  }
});

describe("canonical JSON and SHA-256", () => {
  it("sorts object keys recursively while preserving array order", () => {
    const first = { z: 1, nested: { y: [3, { b: true, a: false }], x: 2 } };
    const second = { nested: { x: 2, y: [3, { a: false, b: true }] }, z: 1 };

    expect(canonicalJsonStringify(first)).toBe(
      '{"nested":{"x":2,"y":[3,{"a":false,"b":true}]},"z":1}',
    );
    expect(hashCanonicalJson(first)).toBe(hashCanonicalJson(second));
    expect(sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("rejects values JSON cannot faithfully represent", () => {
    expect(() => canonicalJsonStringify({ missing: undefined })).toThrow(
      /does not support/u,
    );
    expect(() => canonicalJsonStringify({ value: Number.NaN })).toThrow(
      /non-finite/u,
    );
    const circular: { self?: unknown } = {};
    circular.self = circular;
    expect(() => canonicalJsonStringify(circular)).toThrow(/circular/u);
  });
});

describe("atomic files and repository paths", () => {
  it("atomically writes deterministic JSON and replaces text", async () => {
    const root = await makeTemporaryRoot();
    const jsonPath = join(root, "nested", "evidence.json");
    const textPath = join(root, "state.txt");

    await atomicWriteJson(jsonPath, { z: 1, a: { d: 4, c: 3 } });
    await atomicWriteText(textPath, "before");
    await atomicWriteText(textPath, "after");

    expect(await readFile(jsonPath, "utf8")).toBe(
      '{\n  "a": {\n    "c": 3,\n    "d": 4\n  },\n  "z": 1\n}\n',
    );
    expect(await readFile(textPath, "utf8")).toBe("after");
  });

  it("accepts contained paths and rejects absolute or traversing paths", () => {
    const root = resolve(process.cwd(), "reports/runtime/test-temp/path-root");
    const target = resolveRepositoryPath(root, "evidence/passport.json");

    expect(toRepositoryRelativePath(root, target)).toBe(
      "evidence/passport.json",
    );
    expect(isSafeRepositoryRelativePath("evidence\\passport.json")).toBe(true);
    expect(isSafeRepositoryRelativePath("../outside.json")).toBe(false);
    expect(isSafeRepositoryRelativePath("C:\\outside.json")).toBe(false);
    expect(() => resolveRepositoryPath(root, "/outside.json")).toThrow(
      /Absolute/u,
    );
  });
});

describe("scoped Git metadata", () => {
  it("reads a clean or dirty status despite repository ownership checks", async () => {
    const metadata = await readGitMetadata(process.cwd());

    expect(metadata.commit).toMatch(/^[0-9a-f]{40}$/u);
    expect(metadata.branch).toBeTruthy();
    expect(typeof metadata.dirty).toBe("boolean");
    expect(metadata.repositoryRoot).toBe(resolve(process.cwd()));
  });
});
