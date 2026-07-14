import { execFile } from "node:child_process";
import { resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface GitMetadata {
  readonly repositoryRoot: string;
  readonly commit: string | null;
  readonly branch: string | null;
  readonly dirty: boolean | null;
  readonly remoteUrl: string | null;
}

export interface GitCommandResult {
  readonly stdout: string;
  readonly stderr: string;
}

/** Runs Git with safe.directory scoped to this process and never changes config. */
export async function runGit(
  repositoryRoot: string,
  arguments_: readonly string[],
): Promise<GitCommandResult> {
  const root = resolve(repositoryRoot);
  const safeDirectory = root.replaceAll("\\", "/");
  const { stdout, stderr } = await execFileAsync(
    "git",
    ["-c", `safe.directory=${safeDirectory}`, "-C", root, ...arguments_],
    {
      cwd: root,
      encoding: "utf8",
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    },
  );

  return { stdout, stderr };
}

async function optionalGitValue(
  repositoryRoot: string,
  arguments_: readonly string[],
): Promise<string | null> {
  try {
    const result = await runGit(repositoryRoot, arguments_);
    const value = result.stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

async function optionalGitOutput(
  repositoryRoot: string,
  arguments_: readonly string[],
): Promise<string | null> {
  try {
    const result = await runGit(repositoryRoot, arguments_);
    return result.stdout;
  } catch {
    return null;
  }
}

function sanitizeRemoteUrl(remoteUrl: string | null): string | null {
  if (remoteUrl === null) {
    return null;
  }

  try {
    const url = new URL(remoteUrl);
    url.username = "";
    url.password = "";
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    const [withoutQuery] = remoteUrl.split(/[?#]/u, 1);
    return withoutQuery ?? null;
  }
}

/** Reads observable repository facts, returning null for unavailable fields. */
export async function readGitMetadata(
  repositoryRoot: string,
): Promise<GitMetadata> {
  const root = resolve(repositoryRoot);
  const [commit, branch, status, remoteUrl] = await Promise.all([
    optionalGitValue(root, ["rev-parse", "--verify", "HEAD"]),
    optionalGitValue(root, ["symbolic-ref", "--quiet", "--short", "HEAD"]),
    optionalGitOutput(root, [
      "status",
      "--porcelain=v1",
      "--untracked-files=normal",
    ]),
    optionalGitValue(root, ["config", "--get", "remote.origin.url"]),
  ]);

  return {
    repositoryRoot: root,
    commit,
    branch,
    dirty: status === null ? null : status.trim().length > 0,
    remoteUrl: sanitizeRemoteUrl(remoteUrl),
  };
}
