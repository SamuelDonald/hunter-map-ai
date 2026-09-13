// GMGN integration health. Status is derived from real request outcomes only —
// CONNECTED is impossible unless a live request has actually succeeded.
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { LIMITS } from "./gmgnConfig.server";
import type { CapabilityState, GmgnCapability, IntegrationHealth, IntegrationStatus } from "./gmgnTypes";

const PROVIDER = "GMGN";

type Row = {
  provider: string;
  status: string;
  last_success_at: string | null;
  last_error_at: string | null;
  last_error: string | null;
  latency_ms: number | null;
  capabilities: unknown;
  consecutive_failures: number;
  paused_until: string | null;
  updated_at: string | null;
};

function toHealth(row: Row | null, configured: boolean): IntegrationHealth {
  if (!row) {
    return {
      provider: PROVIDER,
      status: configured ? "CONNECTING" : "NOT_CONFIGURED",
      last_success_at: null, last_error_at: null, last_error: null, latency_ms: null,
      capabilities: {}, paused_until: null, updated_at: null,
    };
  }
  return {
    provider: row.provider,
    status: (configured ? row.status : "NOT_CONFIGURED") as IntegrationStatus,
    last_success_at: row.last_success_at,
    last_error_at: row.last_error_at,
    last_error: row.last_error,
    latency_ms: row.latency_ms,
    capabilities: (row.capabilities && typeof row.capabilities === "object"
      ? row.capabilities
      : {}) as Partial<Record<GmgnCapability, CapabilityState>>,
    paused_until: row.paused_until,
    updated_at: row.updated_at,
  };
}

export async function readGmgnHealth(configured: boolean): Promise<IntegrationHealth> {
  const { data } = await supabaseAdmin
    .from("provider_integrations")
    .select("*")
    .eq("provider", PROVIDER)
    .maybeSingle();
  return toHealth((data as Row | null) ?? null, configured);
}

/** True while the provider circuit breaker is open. */
export async function isGmgnPaused(): Promise<{ paused: boolean; until: string | null }> {
  const { data } = await supabaseAdmin
    .from("provider_integrations")
    .select("paused_until")
    .eq("provider", PROVIDER)
    .maybeSingle();
  const until = (data as { paused_until: string | null } | null)?.paused_until ?? null;
  return { paused: until !== null && new Date(until).getTime() > Date.now(), until };
}

export async function recordSuccess(
  capability: GmgnCapability,
  latencyMs: number,
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("provider_integrations")
    .select("capabilities")
    .eq("provider", PROVIDER)
    .maybeSingle();
  const capabilities = {
    ...(((data as { capabilities?: Record<string, string> } | null)?.capabilities) ?? {}),
    [capability]: "AVAILABLE" as CapabilityState,
  };
  await supabaseAdmin
    .from("provider_integrations")
    .upsert(
      {
        provider: PROVIDER,
        status: "CONNECTED",
        last_success_at: new Date().toISOString(),
        latency_ms: Math.round(latencyMs),
        capabilities,
        consecutive_failures: 0,
        paused_until: null,
      },
      { onConflict: "provider" },
    );
}

export async function recordFailure(
  capability: GmgnCapability,
  message: string,
  options: { capabilityUnavailable?: boolean; terminal?: boolean; rateLimited?: boolean } = {},
): Promise<void> {
  const { data } = await supabaseAdmin
    .from("provider_integrations")
    .select("capabilities, consecutive_failures, last_success_at")
    .eq("provider", PROVIDER)
    .maybeSingle();
  const row = data as { capabilities?: Record<string, string>; consecutive_failures?: number; last_success_at?: string | null } | null;
  const failures = (row?.consecutive_failures ?? 0) + 1;
  const capabilities = {
    ...(row?.capabilities ?? {}),
    ...(options.capabilityUnavailable ? { [capability]: "UNAVAILABLE" as CapabilityState } : {}),
  };
  const breaker = options.terminal || failures >= LIMITS.FAILURE_CIRCUIT_BREAK;
  const status: IntegrationStatus = options.terminal
    ? "ERROR"
    : row?.last_success_at
      ? "DEGRADED"
      : "ERROR";
  await supabaseAdmin.from("provider_integrations").upsert(
    {
      provider: PROVIDER,
      status,
      last_error_at: new Date().toISOString(),
      last_error: message.slice(0, 500),
      capabilities,
      consecutive_failures: failures,
      paused_until: breaker ? new Date(Date.now() + LIMITS.CIRCUIT_PAUSE_MS).toISOString() : null,
    },
    { onConflict: "provider" },
  );
}

export async function markNotConfigured(): Promise<void> {
  await supabaseAdmin
    .from("provider_integrations")
    .upsert({ provider: PROVIDER, status: "NOT_CONFIGURED" }, { onConflict: "provider" });
}
