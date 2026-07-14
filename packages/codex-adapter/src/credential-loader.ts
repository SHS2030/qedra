import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export interface CredentialLoaderOptions {
  readonly cwd: string;
  readonly environment: NodeJS.ProcessEnv;
  readonly envFiles: readonly string[];
}

function usable(value: string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const candidate = value.trim();
  if (
    candidate.length === 0 ||
    /^(?:undefined|null|changeme|replace[-_ ]?me|your[-_ ]?key)$/iu.test(
      candidate,
    )
  ) {
    return null;
  }
  return candidate;
}

function extractFromEnvFile(content: string): string | null {
  for (const sourceLine of content.replace(/^\uFEFF/u, "").split(/\r?\n/u)) {
    const line = sourceLine.trim();
    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    const match = /^(?:export\s+)?OPENAI_API_KEY\s*=\s*(.*)$/u.exec(line);
    if (match === null) {
      continue;
    }
    let candidate = match[1]?.trim() ?? "";
    const quote = candidate[0];
    if (
      (quote === '"' || quote === "'") &&
      candidate.length >= 2 &&
      candidate.at(-1) === quote
    ) {
      candidate = candidate.slice(1, -1).trim();
    } else {
      candidate = candidate.replace(/\s+#.*$/u, "").trim();
    }
    const value = usable(candidate);
    if (value !== null) {
      return value;
    }
  }
  return null;
}

/**
 * Internal credential loading for the controlled SDK process environment.
 * This module is intentionally not exported from the package entry point.
 */
export async function loadOpenAiApiKey(
  options: CredentialLoaderOptions,
): Promise<string | null> {
  const fromEnvironment = usable(options.environment.OPENAI_API_KEY);
  if (fromEnvironment !== null) {
    return fromEnvironment;
  }

  for (const name of options.envFiles) {
    const path = isAbsolute(name) ? resolve(name) : resolve(options.cwd, name);
    try {
      const value = extractFromEnvFile(await readFile(path, "utf8"));
      if (value !== null) {
        return value;
      }
    } catch {
      // Presence diagnostics are produced separately without exposing file content.
    }
  }
  return null;
}
