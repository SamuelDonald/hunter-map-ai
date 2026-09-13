// Signals derived from provider intelligence.
// Signals are strictly INPUT to the strategy engine: nothing here can create an
// order, and a signal never bypasses strategy validation or the risk engine.
import type { NormalizedWalletEvent } from "./gmgnTypes";

export type DerivedSignal = {
  providerSignalId: string;
  tokenChain: string;
  tokenAddress: string;
  signalType: "SMART_MONEY_BUY" | "MOMENTUM" | "VOLUME_ACCELERATION" | "BUY_PRESSURE" | "RISK_WARNING";
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number | null;
  reasonCodes: string[];
  metadata: Record<string, unknown>;
  occurredAt: string;
};

/** Wallet-cluster aware: several smart wallets buying one token raises confidence. */
export function signalsFromWalletEvents(events: NormalizedWalletEvent[]): DerivedSignal[] {
  const buyersByToken = new Map<string, Set<string>>();
  for (const event of events) {
    if (event.activityType !== "BUY") continue;
    const set = buyersByToken.get(event.tokenAddress) ?? new Set<string>();
    set.add(event.wallet.address);
    buyersByToken.set(event.tokenAddress, set);
  }

  return events.map((event) => {
    const buyers = buyersByToken.get(event.tokenAddress)?.size ?? 0;
    const cluster = buyers >= 3;
    const bullish = event.activityType === "BUY";
    const reasonCodes = [
      `GMGN_SMART_MONEY_${event.activityType}`,
      `WALLET_TYPE_${event.wallet.walletType}`,
      ...(cluster ? [`WALLET_CLUSTER_ACTIVITY_${buyers}`] : []),
      ...(event.amountUsd !== null ? [`TRADE_USD_${Math.round(event.amountUsd)}`] : []),
    ];
    return {
      providerSignalId: event.fingerprint,
      tokenChain: event.tokenChain,
      tokenAddress: event.tokenAddress,
      signalType: bullish ? "SMART_MONEY_BUY" : "RISK_WARNING",
      direction: bullish ? "BULLISH" : "BEARISH",
      confidence: bullish ? Math.min(100, 40 + buyers * 15) : null,
      reasonCodes,
      metadata: {
        provider: "GMGN",
        wallet_address: event.wallet.address,
        wallet_type: event.wallet.walletType,
        token_symbol: event.tokenSymbol,
        amount_usd: event.amountUsd,
        transaction_hash: event.transactionHash,
        distinct_smart_buyers: buyers,
      },
      occurredAt: event.occurredAt,
    } satisfies DerivedSignal;
  });
}
