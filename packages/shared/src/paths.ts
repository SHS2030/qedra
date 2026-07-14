import { isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";

/** Rejects absolute and traversal paths intended to be relative to a repository. */
export function assertSafeRepositoryRelativePath(candidate: string): void {
  if (candidate.length === 0 || candidate.trim().length === 0) {
    throw new TypeError("Repository-relative path must not be empty.");
  }

  if (candidate.includes("\0")) {
    throw new TypeError(
      "Repository-relative path must not contain a null byte.",
    );
  }

  if (
    isAbsolute(candidate) ||
    win32.isAbsolute(candidate) ||
    posix.isAbsolute(candidate)
  ) {
    throw new TypeError(`Absolute paths are not allowed: ${candidate}`);
  }

  const segments = candidate.replaceAll("\\", "/").split("/");
  if (segments.some((segment) => segment === "..")) {
    throw new TypeError(`Path traversal is not allowed: ${candidate}`);
  }
}

export function isSafeRepositoryRelativePath(candidate: string): boolean {
  try {
    assertSafeRepositoryRelativePath(candidate);
    return true;
  } catch {
    return false;
  }
}

/** Resolves a validated repository-relative path and checks containment. */
export function resolveRepositoryPath(
  repositoryRoot: string,
  candidate: string,
): string {
  assertSafeRepositoryRelativePath(candidate);

  const root = resolve(repositoryRoot);
  const target = resolve(root, candidate);
  const fromRoot = relative(root, target);

  if (
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new TypeError(`Path escapes the repository: ${candidate}`);
  }

  return target;
}

/** Converts an in-repository absolute path into portable slash-separated form. */
export function toRepositoryRelativePath(
  repositoryRoot: string,
  targetPath: string,
): string {
  const root = resolve(repositoryRoot);
  const target = resolve(targetPath);
  const fromRoot = relative(root, target);

  if (
    fromRoot.length === 0 ||
    fromRoot === ".." ||
    fromRoot.startsWith(`..${sep}`) ||
    isAbsolute(fromRoot)
  ) {
    throw new TypeError(`Path is not a repository file: ${targetPath}`);
  }

  return fromRoot.split(sep).join("/");
}
