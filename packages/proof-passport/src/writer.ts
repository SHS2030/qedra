import {
  atomicWriteJson,
  atomicWriteText,
  canonicalJsonStringify,
  sha256Hex,
} from "../../shared/src/index.js";

import { renderPassportHtml } from "./html.js";
import { parseAndVerifyPassport } from "./integrity.js";
import type { Passport } from "./schemas.js";

export interface PassportOutputPaths {
  readonly jsonPath: string;
  readonly htmlPath: string;
}

export interface WrittenPassportArtifacts {
  readonly jsonPath: string;
  readonly jsonSha256: string;
  readonly htmlPath: string;
  readonly htmlSha256: string;
}

/** Writes verified JSON and a standalone HTML view using atomic replacements. */
export async function writePassportArtifacts(
  input: Passport,
  paths: PassportOutputPaths,
): Promise<WrittenPassportArtifacts> {
  const passport = parseAndVerifyPassport(input);
  const jsonContents = `${canonicalJsonStringify(passport, 2)}\n`;
  const htmlContents = renderPassportHtml(passport);

  await atomicWriteJson(paths.jsonPath, passport);
  await atomicWriteText(paths.htmlPath, htmlContents);

  return {
    jsonPath: paths.jsonPath,
    jsonSha256: sha256Hex(jsonContents),
    htmlPath: paths.htmlPath,
    htmlSha256: sha256Hex(htmlContents),
  };
}
