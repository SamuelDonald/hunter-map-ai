// Deposit detection. The blockchain is authoritative: deposits are never
// recorded from a frontend callback, only from confirmed chain state.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { getNetworkConfig, SOL_LAMPORTS } from "./solanaConfig.server";
import { getRpcProvider } from "./solanaRpc.server";
import { USDC_MINT } from "./walletAssets.server";
import { getExecutionWalletRow } from "./walletProvisioning.server";

type Client = SupabaseClient<Database>;

type ParsedTx = {
  slot?: number | string;
  blockTime?: number | null;
  transaction?: { message?: { accountKeys?: { pubkey?: string }[] } };
  meta?: {
    err?: unknown;
    preBalances?: number[];
    postBalances?: number[];
    preTokenBalances?: { owner?: string; mint?: string; uiTokenAmount?: { uiAmount?: number | null } }[];
    postTokenBalances?: { owner?: string; mint?: string; uiTokenAmount?: { uiAmount?: number | null } }[];
  };
};

export type DepositSyncResult = { scanned: number; recorded: number; error: string | null };

/** Scans recent signatures for the execution wallet and records SOL/USDC credits. */
export async function syncWalletDeposits(supabase: Client, userId: string, limit = 25): Promise<DepositSyncResult> {
  const { cluster } = getNetworkConfig();
  const wallet = await getExecutionWalletRow(supabase, userId);
  if (!wallet?.public_address) return { scanned: 0, recorded: 0, error: "NO_EXECUTION_WALLET" };
  const address = wallet.public_address;

  const rpc = getRpcProvider();
  const signatures = await rpc.getSignaturesForAddress(address, limit);
  if (!signatures.ok) return { scanned: 0, recorded: 0, error: signatures.error };

  const { data: known } = await supabase
    .from("wallet_deposits")
    .select("signature")
    .eq("user_id", userId)
    .eq("cluster", cluster)
    .limit(500);
  const seen = new Set((known ?? []).map((row) => row.signature));

  let recorded = 0;
  for (const entry of signatures.data) {
    if (entry.err || seen.has(entry.signature)) continue;
    const parsed = await rpc.getParsedTransaction(entry.signature);
    if (!parsed.ok || !parsed.data) continue;
    const tx = parsed.data as ParsedTx;
    if (tx.meta?.err) continue;

    const keys = (tx.transaction?.message?.accountKeys ?? []).map((k) => k.pubkey ?? "");
    const index = keys.indexOf(address);
    const sender = keys[0] && keys[0] !== address ? keys[0] : null;
    const rows: Database["public"]["Tables"]["wallet_deposits"]["Insert"][] = [];

    // SOL credit: a positive lamport delta on the wallet's own account.
    if (index >= 0) {
      const pre = tx.meta?.preBalances?.[index] ?? 0;
      const post = tx.meta?.postBalances?.[index] ?? 0;
      const delta = post - pre;
      // The wallet pays its own fees, so only inbound (positive) deltas count.
      if (delta > 0) {
        rows.push({
          user_id: userId, wallet_id: wallet.id, cluster, signature: entry.signature,
          sender, recipient: address, asset: "SOL", mint: null,
          amount: delta / SOL_LAMPORTS, slot: entry.slot, block_time: entry.blockTime,
          confirmation_status: entry.confirmationStatus ?? "confirmed",
        });
      }
    }

    // USDC credit: compare the wallet's token balance before and after.
    const usdc = USDC_MINT[cluster];
    type TokenBalanceEntry = { owner?: string; mint?: string; uiTokenAmount?: { uiAmount?: number | null } };
    const amountOf = (list: TokenBalanceEntry[] | undefined) =>
      (list ?? [])
        .filter((b) => b.owner === address && b.mint === usdc)
        .reduce((sum: number, b) => sum + Number(b.uiTokenAmount?.uiAmount ?? 0), 0);
    const usdcDelta = amountOf(tx.meta?.postTokenBalances) - amountOf(tx.meta?.preTokenBalances);
    if (usdcDelta > 0) {
      rows.push({
        user_id: userId, wallet_id: wallet.id, cluster, signature: entry.signature,
        sender, recipient: address, asset: "USDC", mint: usdc,
        amount: usdcDelta, slot: entry.slot, block_time: entry.blockTime,
        confirmation_status: entry.confirmationStatus ?? "confirmed",
      });
    }

    if (rows.length === 0) continue;
    // Unique (cluster, signature, asset) makes duplicate records impossible.
    const { error } = await supabase
      .from("wallet_deposits")
      .upsert(rows, { onConflict: "cluster,signature,asset", ignoreDuplicates: true });
    if (!error) {
      recorded += rows.length;
      seen.add(entry.signature);
      for (const row of rows) {
        await supabase.from("system_logs").insert({
          user_id: userId, level: "INFO", component: "EXECUTION_WALLET", event: "DEPOSIT_DETECTED",
          message: `Detected ${row.amount} ${row.asset} deposit into the HUNTER trading wallet.`,
          metadata: { signature: row.signature, cluster, asset: row.asset },
        });
      }
    }
  }

  return { scanned: signatures.data.length, recorded, error: null };
}

export async function listDepositRows(supabase: Client, userId: string, limit = 25) {
  const { data } = await supabase
    .from("wallet_deposits")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(limit);
  return data ?? [];
}
