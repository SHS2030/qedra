import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export type OpenAiApiKeySource = "environment" | "env-file" | null;

export interface EnvFilePresence {
  readonly path: string;
  readonly status: "present" | "missing" | "unreadable";
}

export interface OpenAiApiKeyPresence {
  readonly present: boolean;
  readonly source: OpenAiApiKeySource;
  readonly liveReady: boolean;
  readonly checkedFiles: readonly EnvFilePresence[];
}

export interface OpenAiApiKeyPresenceOptions {
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly envFiles?: readonly string[];
}

function hasUsableValue(value: string | undefined): boolean {
  if (value === undefined) {
    return false;
  }
  const candidate = value.trim();
  if (candidate.length === 0) {
    return false;
  }
  return !/^(?:undefined|null|changeme|replace[-_ ]?me|your[-_ ]?key)$/iu.test(
    candidate,
  );
}

function envFileContainsUsableKey(content: string): boolean {
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
    if (hasUsableValue(candidate)) {
      return true;
    }
  }
  return false;
}

export async function detectOpenAiApiKeyPresence(
  options: OpenAiApiKeyPresenceOptions,
): Promise<OpenAiApiKeyPresence> {
  const environment = options.env ?? process.env;
  if (hasUsableValue(environment.OPENAI_API_KEY)) {
    return {
      present: true,
      source: "environment",
      liveReady: true,
      checkedFiles: [],
    };
  }

  const envFiles = options.envFiles ?? [".env.local", ".env"];
  const checkedFiles: EnvFilePresence[] = [];
  let configuredFileFound = false;
  for (const name of envFiles) {
    const path = isAbsolute(name) ? resolve(name) : resolve(options.cwd, name);
    try {
      const content = await readFile(path, "utf8");
      const present = envFileContainsUsableKey(content);
      checkedFiles.push({ path, status: present ? "present" : "missing" });
      configuredFileFound ||= present;
    } catch (error) {
      const code =
        typeof error === "object" && error !== null && "code" in error
          ? error.code
          : undefined;
      checkedFiles.push({
        path,
        status: code === "ENOENT" ? "missing" : "unreadable",
      });
    }
  }

  return {
    present: configuredFileFound,
    source: configuredFileFound ? "env-file" : null,
    liveReady: configuredFileFound,
    checkedFiles,
  };
}
