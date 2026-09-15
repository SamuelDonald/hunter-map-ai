// Browser-safe custody types. Nothing here can carry key material.
export type CustodyProviderName = "NONE" | "PRIVY" | "ENV_SIGNER" | "EXTERNAL";

export type CustodyWallet = {
  provider: CustodyProviderName;
  /** Provider-side wallet identifier. Never a credential. */
  providerWalletId: string;
  /** Public Solana address. Safe to display. */
  address: string;
};

export type CustodyResult<T> = { ok: true; data: T } | { ok: false; error: string; code?: string };

export type SupportedAsset = "SOL" | "USDC";
