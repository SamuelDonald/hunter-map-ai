// Provider abstraction. The application never talks to a specific venue or
// data vendor directly — it talks to these interfaces. Nothing here fabricates
// data: unconfigured providers report NOT_CONFIGURED.
import type { ProviderState, ProviderStatus, TokenRow } from "./types";

export type ProviderResult<T> =
  | { ok: true; data: T }
  | { ok: false; status: Exclude<ProviderStatus, "READY">; error: string };

export const notConfigured = <T>(name: string): ProviderResult<T> => ({
  ok: false,
  status: "NOT_CONFIGURED",
  error: `${name} is not configured`,
});

// ---------------------------------------------------------------- data side
export interface MarketDataProvider {
  readonly name: string;
  status(): ProviderStatus;
  getTokenSnapshot(chain: string, address: string): Promise<ProviderResult<Partial<TokenRow>>>;
  getPrice(chain: string, address: string): Promise<ProviderResult<number>>;
}

export interface TokenIntelligenceProvider {
  readonly name: string;
  status(): ProviderStatus;
  discoverTokens(): Promise<ProviderResult<Partial<TokenRow>[]>>;
}

export interface WalletIntelligenceProvider {
  readonly name: string;
  status(): ProviderStatus;
  getTrackedWallets(): Promise<ProviderResult<unknown[]>>;
}

export interface SignalProvider {
  readonly name: string;
  status(): ProviderStatus;
  pullSignals(): Promise<ProviderResult<unknown[]>>;
}

// ----------------------------------------------------------- execution side
export type OrderRequest = {
  userId: string;
  strategyId: string;
  tokenId: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT" | "TAKE_PROFIT" | "STOP_LOSS" | "TRAILING_STOP";
  quantity: number;
  requestedPrice: number;
  maxSlippage: number;
  idempotencyKey: string;
};

export type ExecutionResult = {
  externalOrderId: string;
  executedPrice: number;
  filledQuantity: number;
  slippage: number;
  status: "FILLED" | "PARTIALLY_FILLED" | "FAILED";
};

export interface ExecutionProvider {
  readonly name: "PAPER" | "GMGN";
  status(): ProviderStatus;
  createOrder(request: OrderRequest): Promise<ProviderResult<ExecutionResult>>;
  cancelOrder(externalOrderId: string): Promise<ProviderResult<{ cancelled: boolean }>>;
  getOrder(externalOrderId: string): Promise<ProviderResult<ExecutionResult>>;
  getPosition(externalPositionId: string): Promise<ProviderResult<unknown>>;
  closePosition(externalPositionId: string): Promise<ProviderResult<{ closed: boolean }>>;
  getBalance(): Promise<ProviderResult<{ available: number; currency: string }>>;
  getPortfolio(): Promise<ProviderResult<unknown>>;
}

/**
 * Paper execution. Uses the same order lifecycle as live execution and fills
 * only at a real price supplied by the caller (which itself comes from the
 * connected market-data provider). It invents no prices of its own.
 */
export class PaperExecutionProvider implements ExecutionProvider {
  readonly name = "PAPER" as const;
  status(): ProviderStatus {
    return "READY";
  }
  async createOrder(request: OrderRequest): Promise<ProviderResult<ExecutionResult>> {
    if (!Number.isFinite(request.requestedPrice) || request.requestedPrice <= 0) {
      return { ok: false, status: "UNAVAILABLE", error: "No market price available for paper fill" };
    }
    if (!Number.isFinite(request.quantity) || request.quantity <= 0) {
      return { ok: false, status: "UNAVAILABLE", error: "Invalid quantity" };
    }
    return {
      ok: true,
      data: {
        externalOrderId: `paper_${request.idempotencyKey}`,
        executedPrice: request.requestedPrice,
        filledQuantity: request.quantity,
        slippage: 0,
        status: "FILLED",
      },
    };
  }
  async cancelOrder(): Promise<ProviderResult<{ cancelled: boolean }>> {
    return { ok: true, data: { cancelled: true } };
  }
  async getOrder(): Promise<ProviderResult<ExecutionResult>> {
    return { ok: false, status: "UNAVAILABLE", error: "Paper orders are settled synchronously" };
  }
  async getPosition(): Promise<ProviderResult<unknown>> {
    return { ok: false, status: "UNAVAILABLE", error: "Paper positions are stored in the database" };
  }
  async closePosition(): Promise<ProviderResult<{ closed: boolean }>> {
    return { ok: true, data: { closed: true } };
  }
  async getBalance(): Promise<ProviderResult<{ available: number; currency: string }>> {
    return { ok: false, status: "NOT_CONFIGURED", error: "Paper balance is derived from stored trades" };
  }
  async getPortfolio(): Promise<ProviderResult<unknown>> {
    return { ok: false, status: "NOT_CONFIGURED", error: "Portfolio is derived from stored positions" };
  }
}

/**
 * GMGN execution — architecture only. Phase 2 must not be able to move real
 * money, so every method refuses until the integration is completed.
 */
export class GMGNExecutionProvider implements ExecutionProvider {
  readonly name = "GMGN" as const;
  status(): ProviderStatus {
    return "NOT_CONFIGURED";
  }
  async createOrder(): Promise<ProviderResult<ExecutionResult>> {
    return notConfigured("GMGN execution");
  }
  async cancelOrder(): Promise<ProviderResult<{ cancelled: boolean }>> {
    return notConfigured("GMGN execution");
  }
  async getOrder(): Promise<ProviderResult<ExecutionResult>> {
    return notConfigured("GMGN execution");
  }
  async getPosition(): Promise<ProviderResult<unknown>> {
    return notConfigured("GMGN execution");
  }
  async closePosition(): Promise<ProviderResult<{ closed: boolean }>> {
    return notConfigured("GMGN execution");
  }
  async getBalance(): Promise<ProviderResult<{ available: number; currency: string }>> {
    return notConfigured("GMGN execution");
  }
  async getPortfolio(): Promise<ProviderResult<unknown>> {
    return notConfigured("GMGN execution");
  }
}

class UnconfiguredMarketData implements MarketDataProvider {
  readonly name = "MARKET_DATA";
  status(): ProviderStatus {
    return "NOT_CONFIGURED";
  }
  async getTokenSnapshot() {
    return notConfigured<Partial<TokenRow>>("Market data provider");
  }
  async getPrice() {
    return notConfigured<number>("Market data provider");
  }
}

class UnconfiguredTokenIntelligence implements TokenIntelligenceProvider {
  readonly name = "TOKEN_INTELLIGENCE";
  status(): ProviderStatus {
    return "NOT_CONFIGURED";
  }
  async discoverTokens() {
    return notConfigured<Partial<TokenRow>[]>("Token intelligence provider");
  }
}

class UnconfiguredWalletIntelligence implements WalletIntelligenceProvider {
  readonly name = "WALLET_INTELLIGENCE";
  status(): ProviderStatus {
    return "NOT_CONFIGURED";
  }
  async getTrackedWallets() {
    return notConfigured<unknown[]>("Wallet intelligence provider");
  }
}

class UnconfiguredSignals implements SignalProvider {
  readonly name = "SIGNAL_FEED";
  status(): ProviderStatus {
    return "NOT_CONFIGURED";
  }
  async pullSignals() {
    return notConfigured<unknown[]>("Signal provider");
  }
}

export const marketDataProvider: MarketDataProvider = new UnconfiguredMarketData();
export const tokenIntelligenceProvider: TokenIntelligenceProvider = new UnconfiguredTokenIntelligence();
export const walletIntelligenceProvider: WalletIntelligenceProvider = new UnconfiguredWalletIntelligence();
export const signalProvider: SignalProvider = new UnconfiguredSignals();

const paper = new PaperExecutionProvider();
const gmgn = new GMGNExecutionProvider();

/** Execution provider selection is configuration, never hardcoded per call site. */
export function getExecutionProvider(mode: "PAPER" | "LIVE"): ExecutionProvider {
  return mode === "LIVE" ? gmgn : paper;
}

export function providerStates(): ProviderState[] {
  return [
    { name: "MARKET_DATA", status: marketDataProvider.status() },
    { name: "TOKEN_INTELLIGENCE", status: tokenIntelligenceProvider.status() },
    { name: "WALLET_INTELLIGENCE", status: walletIntelligenceProvider.status() },
    { name: "SIGNAL_FEED", status: signalProvider.status() },
    { name: "PAPER_EXECUTION", status: paper.status() },
    { name: "LIVE_EXECUTION", status: gmgn.status(), detail: "LIVE EXECUTION — NOT CONFIGURED" },
  ];
}
