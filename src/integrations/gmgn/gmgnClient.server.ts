// Thin server-side client for the GMGN OpenAPI (https://openapi.gmgn.ai).
// Read-only intelligence endpoints only: the request-signing routes used for
// swaps and strategy orders are intentionally not implemented in this phase.
//
// Includes throttling, in-flight de-duplication, short-lived caching, timeouts,
// bounded retry with backoff, and structured logging that never records secrets.
import { GMGN_HOST, LIMITS, getGmgnApiKey } from "./gmgnConfig.server";
import { recordFailure, recordSuccess } from "./gmgnHealth.server";
import type { GmgnCapability } from "./gmgnTypes";

export type GmgnResult<T> =
  | { ok: true; data: T; latencyMs: number }
  | { ok: false; error: string; status: number; retryable: boolean; terminal: boolean };

type Query = Record<string, string | number | boolean | string[] | undefined>;

const inFlight = new Map<string, Promise<GmgnResult<unknown>>>();
const cache = new Map<string, { at: number; value: GmgnResult<unknown> }>();
let throttleChain: Promise<void> = Promise.resolve();

function throttle(): Promise<void> {
  const next = throttleChain.then(
    () => new Promise<void>((resolve) => setTimeout(resolve, LIMITS.MIN_REQUEST_INTERVAL_MS)),
  );
  throttleChain = next;
  return next;
}

function buildUrl(path: string, query: Query): string {
  const url = new URL(`${GMGN_HOST}${path}`);
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((v) => url.searchParams.append(key, String(v)));
    else url.searchParams.set(key, String(value));
  }
  // Auth params: unix seconds (server allows ±5s) and a unique id per request
  // (replays are rejected), so they are never part of the cache key.
  url.searchParams.set("timestamp", String(Math.floor(Date.now() / 1000)));
  url.searchParams.set("client_id", crypto.randomUUID());
  return url.toString();
}

function log(event: string, fields: Record<string, unknown>) {
  console.log(`[gmgn] ${event}`, JSON.stringify(fields));
}

async function once<T>(
  capability: GmgnCapability,
  method: "GET" | "POST",
  path: string,
  query: Query,
  body: unknown,
): Promise<GmgnResult<T>> {
  const apiKey = getGmgnApiKey();
  if (!apiKey) {
    return { ok: false, error: "GMGN_NOT_CONFIGURED", status: 0, retryable: false, terminal: true };
  }
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LIMITS.REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(buildUrl(path, query), {
      method,
      headers: {
        "X-APIKEY": apiKey,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : null,
      signal: controller.signal,
    });
    const latencyMs = Date.now() - started;
    const text = await response.text();
    let envelope: { code?: number | string; data?: unknown; error?: string; message?: string } = {};
    try {
      envelope = JSON.parse(text) as typeof envelope;
    } catch {
      log("parse_error", { path, capability, status: response.status, latencyMs });
      return { ok: false, error: `INVALID_RESPONSE (${response.status})`, status: response.status, retryable: response.status >= 500, terminal: false };
    }

    const code = Number(envelope.code ?? (response.ok ? 0 : response.status));
    if (!response.ok || code !== 0) {
      const message = envelope.error ?? envelope.message ?? `HTTP ${response.status}`;
      const status = response.status || code;
      const authFailure = status === 401 || status === 403;
      const rateLimited = status === 429 || isRateLimitMessage(String(message));
      log("request_failed", { path, capability, status, code, message, latencyMs });
      return {
        ok: false,
        error: `${message}`,
        status,
        // Retrying a throttled provider only deepens the throttle.
        retryable: !rateLimited && status >= 500,
        terminal: authFailure,
        rateLimited,
      };
    }

    log("request_ok", { path, capability, latencyMs });
    // Some GMGN endpoints wrap the payload twice ({code,data:{code,data:{...}}}).
    let payload: unknown = envelope.data ?? null;
    let guard = 0;
    while (
      payload && typeof payload === "object" && !Array.isArray(payload) &&
      "code" in (payload as Record<string, unknown>) && "data" in (payload as Record<string, unknown>) &&
      guard < 3
    ) {
      payload = (payload as Record<string, unknown>)["data"];
      guard += 1;
    }
    return { ok: true, data: payload as T, latencyMs };
  } catch (error) {
    const latencyMs = Date.now() - started;
    const aborted = error instanceof Error && error.name === "AbortError";
    log(aborted ? "timeout" : "network_error", { path, capability, latencyMs });
    return {
      ok: false,
      error: aborted ? "PROVIDER_TIMEOUT" : `NETWORK_ERROR: ${(error as Error).message}`,
      status: 0,
      retryable: true,
      terminal: false,
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Performs a GMGN request with de-duplication, caching and bounded retry, then
 * persists the outcome to the provider health record.
 */
export async function gmgnRequest<T>(options: {
  capability: GmgnCapability;
  method?: "GET" | "POST";
  path: string;
  query?: Query;
  body?: unknown;
  cacheTtlMs?: number;
}): Promise<GmgnResult<T>> {
  const { capability, method = "GET", path, query = {}, body, cacheTtlMs = 0 } = options;
  const key = `${method} ${path} ${JSON.stringify(query)} ${body ? JSON.stringify(body) : ""}`;

  const cached = cache.get(key);
  if (cached && cacheTtlMs > 0 && Date.now() - cached.at < cacheTtlMs) {
    return cached.value as GmgnResult<T>;
  }
  const pending = inFlight.get(key);
  if (pending) return pending as Promise<GmgnResult<T>>;

  const run = (async (): Promise<GmgnResult<T>> => {
    let attempt = 0;
    let result: GmgnResult<T> = { ok: false, error: "NOT_ATTEMPTED", status: 0, retryable: false, terminal: false };
    while (attempt <= LIMITS.MAX_RETRIES) {
      await throttle();
      result = await once<T>(capability, method, path, query, body);
      if (result.ok || !result.retryable) break;
      attempt += 1;
      if (attempt > LIMITS.MAX_RETRIES) break;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** (attempt - 1)));
    }

    if (result.ok) {
      await recordSuccess(capability, result.latencyMs);
      if (cacheTtlMs > 0) cache.set(key, { at: Date.now(), value: result });
    } else if (result.error !== "GMGN_NOT_CONFIGURED") {
      await recordFailure(capability, result.error, {
        capabilityUnavailable: result.status === 404 || result.status === 405,
        terminal: result.terminal,
      });
    }
    return result;
  })();

  inFlight.set(key, run as Promise<GmgnResult<unknown>>);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}

/** Health probe — a real authenticated request against the account endpoint. */
export async function gmgnPing(): Promise<GmgnResult<unknown>> {
  return gmgnRequest({ capability: "ACCOUNT", path: "/v1/user/info", cacheTtlMs: 30_000 });
}
