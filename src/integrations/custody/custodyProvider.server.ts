// WalletCustodyProvider — the only place in HUNTER 2X that may hold signing
// authority for an execution wallet.
//
// SECURITY BOUNDARY. No implementation of this interface may return, log or
// persist private keys, seed phrases or provider credentials. The trading
// engine talks to this interface only, so the custody backend can be replaced
// without touching strategy, risk or execution code.
import type { CustodyProviderName, CustodyResult, CustodyWallet } from "./custodyTypes";
import type { SolanaCluster } from "@/integrations/solana/solanaConfig.server";

export interface WalletCustodyProvider {
  readonly name: CustodyProviderName;
  isConfigured(): boolean;
  /** Provisions a segregated wallet. One wallet per user — never a shared wallet. */
  createWallet(reference: { userId: string; cluster: SolanaCluster }): Promise<CustodyResult<CustodyWallet>>;
  getWallet(providerWalletId: string): Promise<CustodyResult<CustodyWallet>>;
  getAddress(providerWalletId: string): Promise<CustodyResult<string>>;
  /** Signs and submits a prepared transaction. The key never leaves the provider. */
  signAndSendTransaction(
    providerWalletId: string,
    wireBase64: string,
    cluster: SolanaCluster,
  ): Promise<CustodyResult<{ signature: string }>>;
  signTransaction(
    providerWalletId: string,
    wireBase64: string,
    cluster: SolanaCluster,
  ): Promise<CustodyResult<{ signedWireBase64: string }>>;
  signMessage(providerWalletId: string, messageBase64: string): Promise<CustodyResult<{ signatureBase64: string }>>;
}

/** Used when no custody provider is configured. It refuses everything. */
class UnconfiguredCustodyProvider implements WalletCustodyProvider {
  readonly name = "NONE" as const;
  isConfigured() {
    return false;
  }
  private refuse<T>(): CustodyResult<T> {
    return { ok: false, code: "CUSTODY_NOT_CONFIGURED", error: "No wallet custody provider is configured" };
  }
  async createWallet() {
    return this.refuse<CustodyWallet>();
  }
  async getWallet() {
    return this.refuse<CustodyWallet>();
  }
  async getAddress() {
    return this.refuse<string>();
  }
  async signAndSendTransaction() {
    return this.refuse<{ signature: string }>();
  }
  async signTransaction() {
    return this.refuse<{ signedWireBase64: string }>();
  }
  async signMessage() {
    return this.refuse<{ signatureBase64: string }>();
  }
}

const unconfigured = new UnconfiguredCustodyProvider();

/**
 * Provider selection is configuration, not a hardcoded choice. Privy is used
 * when its server credentials are present; otherwise custody is unavailable
 * and no wallet can be provisioned or signed with.
 */
export async function getCustodyProvider(): Promise<WalletCustodyProvider> {
  const { PrivyCustodyProvider } = await import("./privyCustody.server");
  const privy = new PrivyCustodyProvider();
  if (privy.isConfigured()) return privy;
  return unconfigured;
}

export function custodyUnavailable(): WalletCustodyProvider {
  return unconfigured;
}
