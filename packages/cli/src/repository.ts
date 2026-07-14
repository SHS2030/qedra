import { access } from "node:fs/promises";
import { dirname, resolve } from "node:path";

export async function findRepositoryRoot(
  start = process.cwd(),
): Promise<string> {
  let current = resolve(start);

  for (;;) {
    try {
      await access(resolve(current, "docs", "GENESIS_MISSION.md"));
      await access(resolve(current, "package.json"));
      return current;
    } catch {
      const parent = dirname(current);
      if (parent === current) {
        throw new Error(`Unable to locate the QEDRA repository from ${start}`);
      }
      current = parent;
    }
  }
}
