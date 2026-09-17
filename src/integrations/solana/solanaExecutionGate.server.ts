// Server-side execution gating. Every gate must pass before any transaction
// may be signed. The strategy kill switch and the emergency block are separate
// controls and both must permit execution.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getNetworkConfig, isLiveExecutionEnvEnabled, type SolanaCluster } from "./solanaConfig.server";
import { getSignerProvider } from "./solanaSigner.server";

type Client = SupabaseClient<Database>;

export type Gate = { name: string; ok: boolean; detail: string };

export type ExecutionReadiness = {
  cluster: SolanaCluster;
  /** Signing is permitted at all (infrastructure / devnet work included). */
  signingAllowed: boolean;
  /** Real trading on the configured cluster is technically available. */
  liveExecutionAvailable: boolean;
  emergencyBlock: "ENABLED" | "DISABLED";
  gates: Gate[];
  reasons: string[];
};

export async function evaluateExecutionReadiness(
  supabase: Client,
  userId: string,
): Promise<ExecutionReadiness> {
  const config = getNetworkConfig();
  const [{ data: controls }, { data: risk }, { data: bot }, { data: walletRow }, availability] = await Promise.all([
    supabase.from("execution_controls").select("*").eq("id", "GLOBAL").maybeSingle(),
    supabase.from("risk_settings").select("kill_switch").eq("user_id", userId).maybeSingle(),
    supabase.from("bot_status").select("state").eq("user_id", userId).maybeSingle(),
    supabase
      .from("execution_wallets")
      .select("public_address, custody_provider, status, live_execution_enabled, live_execution_confirmed_at")
      .eq("user_id", userId)
      .eq("purpose", "EXECUTION")
      .eq("cluster", config.cluster)
      .maybeSingle(),
    getSignerProvider().availability(),
  ]);

  const emergencyBlock = (controls?.emergency_block ?? "ENABLED") as "ENABLED" | "DISABLED";
  const custodyWallet =
    walletRow?.public_address && walletRow.custody_provider && walletRow.custody_provider !== "NONE"
      ? walletRow
      : null;
  const walletConfigured = Boolean(custodyWallet) || availability.configured;
  const userLiveConfirmed = Boolean(custodyWallet?.live_execution_enabled && custodyWallet.live_execution_confirmed_at);

  const gates: Gate[] = [
    { name: "AUTHENTICATED_EXECUTION_CONTEXT", ok: Boolean(userId), detail: "Server-side authenticated context" },
    {
      name: "EXECUTION_WALLET_CONFIGURED",
      ok: walletConfigured,
      detail: custodyWallet
        ? `Custody wallet ready (${custodyWallet.custody_provider})`
        : availability.error ?? (availability.configured ? "Env signer available" : "No execution wallet provisioned"),
    },
    { name: "KILL_SWITCH_DISABLED", ok: !risk?.kill_switch, detail: risk?.kill_switch ? "Risk kill switch engaged" : "Kill switch off" },
    { name: "BOT_NOT_KILLED", ok: bot?.state !== "KILLED", detail: `Bot state ${bot?.state ?? "UNKNOWN"}` },
    { name: "EMERGENCY_BLOCK_DISABLED", ok: emergencyBlock === "DISABLED", detail: `Emergency block ${emergencyBlock}` },
    {
      name: "LIVE_EXECUTION_ENABLED",
      ok: Boolean(controls?.live_execution_enabled) || isLiveExecutionEnvEnabled(),
      detail: "Platform-level live execution switch",
    },
    {
      name: "USER_LIVE_TRADING_CONFIRMED",
      ok: userLiveConfirmed,
      detail: userLiveConfirmed
        ? "User explicitly enabled live trading for this wallet"
        : "Live trading is disabled for this wallet until the user confirms it",
    },
    { name: "WALLET_STATUS_READY", ok: custodyWallet?.status === "READY", detail: `Wallet status ${custodyWallet?.status ?? "NOT_PROVISIONED"}` },
    { name: "RISK_ENGINE_READY", ok: Boolean(risk), detail: risk ? "Risk settings present" : "No risk settings for this account" },
    { name: "GMGN_EXECUTION_READY", ok: false, detail: "GMGN signed execution routes are not implemented" },
  ];

  // Infrastructure signing (devnet self-tests) requires a configured wallet, no
  // kill switch and a bot that is not killed. It never requires live execution.
  const signingReasons: string[] = [];
  for (const gate of gates.slice(0, 4)) if (!gate.ok) signingReasons.push(gate.name);
  if (config.cluster !== "devnet") signingReasons.push("NON_DEVNET_INFRASTRUCTURE_SIGNING_BLOCKED");

  const liveReasons = gates.filter((g) => !g.ok).map((g) => g.name);
  const liveExecutionAvailable = liveReasons.length === 0;

  return {
    cluster: config.cluster,
    signingAllowed: signingReasons.length === 0,
    liveExecutionAvailable,
    emergencyBlock,
    gates,
    reasons: signingReasons.length ? signingReasons : liveReasons,
  };
}
