import { randomUUID } from "node:crypto";
import { link, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { dirname, basename, join, resolve } from "node:path";

import { canonicalJsonStringify } from "./json.js";

function temporarySiblingPath(targetPath: string): string {
  const absoluteTarget = resolve(targetPath);
  return join(
    dirname(absoluteTarget),
    `.${basename(absoluteTarget)}.${process.pid}.${randomUUID()}.tmp`,
  );
}

/**
 * Replaces a text file by renaming a fully written sibling into place. The
 * temporary file is always on the same volume, which preserves rename atomicity.
 */
export async function atomicWriteText(
  targetPath: string,
  contents: string,
): Promise<void> {
  const absoluteTarget = resolve(targetPath);
  const temporaryPath = temporarySiblingPath(absoluteTarget);
  await mkdir(dirname(absoluteTarget), { recursive: true });

  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, absoluteTarget);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/** Writes sorted, deterministic JSON followed by one newline. */
export async function atomicWriteJson(
  targetPath: string,
  value: unknown,
  indentation = 2,
): Promise<void> {
  await atomicWriteText(
    targetPath,
    `${canonicalJsonStringify(value, indentation)}\n`,
  );
}

/**
 * Atomically creates a file only when it does not already exist. Returns false
 * for an existing target and never replaces its content.
 */
export async function atomicCreateText(
  targetPath: string,
  contents: string,
): Promise<boolean> {
  const absoluteTarget = resolve(targetPath);
  const temporaryPath = temporarySiblingPath(absoluteTarget);
  await mkdir(dirname(absoluteTarget), { recursive: true });

  try {
    await writeFile(temporaryPath, contents, { encoding: "utf8", flag: "wx" });

    try {
      await link(temporaryPath, absoluteTarget);
      return true;
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") {
        return false;
      }

      throw error;
    }
  } finally {
    await rm(temporaryPath, { force: true });
  }
}
