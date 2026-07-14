import type { FastifyInstance } from "fastify";

import { canonicalJson, parseJsonBody } from "./canonical-json.js";
import type {
  ScenarioHttpRequest,
  ScenarioHttpResponse,
  ScenarioTarget,
} from "./types.js";

function sortedHeaders(
  source: Readonly<Record<string, number | string | string[] | undefined>>,
): Readonly<Record<string, string>> {
  const result: Record<string, string> = {};
  for (const [name, value] of Object.entries(source).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (value !== undefined) {
      result[name.toLowerCase()] = Array.isArray(value)
        ? value.join(", ")
        : String(value);
    }
  }
  return result;
}

export function createFastifyInjectTarget(
  app: FastifyInstance,
  id = "fastify-wallet",
): ScenarioTarget {
  return {
    id,
    async execute(request: ScenarioHttpRequest): Promise<ScenarioHttpResponse> {
      const bodyText =
        request.bodyText ??
        (request.body === undefined ? undefined : canonicalJson(request.body));
      const base = {
        method: request.method,
        url: request.path,
        headers: { ...request.headers },
      };
      const response = await app.inject(
        bodyText === undefined ? base : { ...base, payload: bodyText },
      );
      return {
        statusCode: response.statusCode,
        headers: sortedHeaders(response.headers),
        body: parseJsonBody(response.body),
        bodyText: response.body,
      };
    },
  };
}

export interface FetchTargetOptions {
  readonly id?: string;
  readonly timeoutMs?: number;
}

export function createFetchTarget(
  baseUrl: string,
  options: FetchTargetOptions = {},
): ScenarioTarget {
  const normalizedBaseUrl = baseUrl.endsWith("/")
    ? baseUrl.slice(0, -1)
    : baseUrl;
  const timeoutMs = options.timeoutMs ?? 10_000;
  return {
    id: options.id ?? normalizedBaseUrl,
    async execute(request: ScenarioHttpRequest): Promise<ScenarioHttpResponse> {
      const bodyText =
        request.bodyText ??
        (request.body === undefined ? undefined : canonicalJson(request.body));
      const init: RequestInit = {
        method: request.method,
        headers: { ...request.headers },
        signal: AbortSignal.timeout(timeoutMs),
        ...(bodyText === undefined ? {} : { body: bodyText }),
      };
      const response = await fetch(`${normalizedBaseUrl}${request.path}`, init);
      const responseBodyText = await response.text();
      const headerEntries: [string, string][] = [];
      response.headers.forEach((value, name) => {
        headerEntries.push([name, value]);
      });
      const headers = Object.fromEntries(
        headerEntries.sort(([left], [right]) => left.localeCompare(right)),
      );
      return {
        statusCode: response.status,
        headers,
        body: parseJsonBody(responseBodyText),
        bodyText: responseBodyText,
      };
    },
  };
}
