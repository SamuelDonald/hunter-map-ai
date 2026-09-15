// Supported trading capital assets. Deliberately narrow: only SOL and USDC are
// accepted as trading capital, so arbitrary SPL tokens sent to the execution
// wallet are never treated as funds.
import type { SolanaCluster } from "./solanaConfig.server";
import type { SupportedAsset } from "@/integrations/custody/custodyTypes";

export const USDC_MINT: Record<SolanaCluster, string> = {
  "mainnet-beta": "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  devnet: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
};

export const ASSET_DECIMALS: Record<SupportedAsset, number> = { SOL: 9, USDC: 6 };

export function assetForMint(mint: string, cluster: SolanaCluster): SupportedAsset | null {
  return mint === USDC_MINT[cluster] ? "USDC" : null;
}

export function mintForAsset(asset: SupportedAsset, cluster: SolanaCluster): string | null {
  return asset === "USDC" ? USDC_MINT[cluster] : null;
}

export const WITHDRAWAL_LIMITS = {
  /** Newly added destinations are unusable during this cooldown. */
  ADDRESS_COOLDOWN_MINUTES: 15,
  MAX_PER_DAY: 5,
  MIN_SOL: 0.001,
  MIN_USDC: 1,
} as const;
