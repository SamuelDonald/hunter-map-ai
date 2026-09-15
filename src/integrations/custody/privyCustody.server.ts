// Privy custody backend.
//
// Credentials are read from the server runtime only and are never returned to
// a caller, stored in Postgres or logged. Privy holds the wallet key; this app
// only ever asks Privy to sign or submit a prepared transaction.
import type { WalletCustodyProvider } from "./custodyProvider.server";
import type { CustodyResult, CustodyWallet } from "./custodyTypes";
import type { SolanaCluster } from "@/integrations/solana/solanaConfig.server";

const API = "https://api.privy.io";
const TIMEOUT_MS = 20_000;

const CAIP2: Record<SolanaCluster, string> = {
  "mainnet-beta": "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp",
  devnet: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
};

const env = (name: string): string | null => {
  const value = process.env[name];
  return value && value.trim() ? value.trim() : null;
};

type PrivyWalletResponse = { id?: string; address?: string; chain_type?: string };

export class PrivyCustodyProvider implements WalletCustodyProvider {
  readonly name = "PRIVY" as const;

  isConfigured(): boolean {
    return env("PRIVY_APP_ID") !== null && env("PRIVY_APP_SECRET") !== null;
  }

  async createWallet(reference: { userId: string; cluster: SolanaCluster }): Promise<CustodyResult<CustodyWallet>> {
    const result = await this.call<PrivyWalletResponse>("POST", "/v1/wallets", {
      chain_type: "solana",
      // Correlates the provider wallet with the HUNTER account without leaking PII.
      additional_signers: [],
      policy_ids: [],
      idempotency_key: `hunter-exec-${reference.userId}-${reference.cluster}`,
    });
    if (!result.ok) return result;
    const { id, address } = result.data;
    if (!id || !address) return { ok: false, code: "CUSTODY_BAD_RESPONSE", error: "Privy did not return a wallet id and address" };
    return { ok: true, data: { provider: "PRIVY", providerWalletId: id, address } };
  }

  async getWallet(providerWalletId: string): Promise<CustodyResult<CustodyWallet>> {
    const result = await this.call<PrivyWalletResponse>("GET", `/v1/wallets/${providerWalletId}`);
    if (!result.ok) return result;
    if (!result.data.address) return { ok: false, code: "CUSTODY_BAD_RESPONSE", error: "Privy wallet has no address" };
    return { ok: true, data: { provider: "PRIVY", providerWalletId, address: result.data.address } };
  }

  async getAddress(providerWalletId: string): Promise<CustodyResult<string>> {
    const wallet = await this.getWallet(providerWalletId);
    return wallet.ok ? { ok: true, data: wallet.data.address } : wallet;
  }

  async signAndSendTransaction(
    providerWalletId: string,
    wireBase64: string,
    cluster: SolanaCluster,
  ): Promise<CustodyResult<{ signature: string }>> {
    const result = await this.call<{ data?: { hash?: string; signature?: string } }>(
      "POST",
      `/v1/wallets/${providerWalletId}/rpc`,
      {
        method: "signAndSendTransaction",
        caip2: CAIP2[cluster],
        params: { transaction: wireBase64, encoding: "base64" },
      },
    );
    if (!result.ok) return result;
    const signature = result.data.data?.hash ?? result.data.data?.signature;
    if (!signature) return { ok: false, code: "CUSTODY_BAD_RESPONSE", error: "Privy did not return a transaction signature" };
    return { ok: true, data: { signature } };
  }

  async signTransaction(
    providerWalletId: string,
    wireBase64: string,
    cluster: SolanaCluster,
  ): Promise<CustodyResult<{ signedWireBase64: string }>> {
    const result = await this.call<{ data?: { signed_transaction?: string } }>(
      "POST",
      `/v1/wallets/${providerWalletId}/rpc`,
      {
        method: "signTransaction",
        caip2: CAIP2[cluster],
        params: { transaction: wireBase64, encoding: "base64" },
      },
    );
    if (!result.ok) return result;
    const signed = result.data.data?.signed_transaction;
    if (!signed) return { ok: false, code: "CUSTODY_BAD_RESPONSE", error: "Privy did not return a signed transaction" };
    return { ok: true, data: { signedWireBase64: signed } };
  }

  async signMessage(providerWalletId: string, messageBase64: string): Promise<CustodyResult<{ signatureBase64: string }>> {
    const result = await this.call<{ data?: { signature?: string } }>("POST", `/v1/wallets/${providerWalletId}/rpc`, {
      method: "signMessage",
      params: { message: messageBase64, encoding: "base64" },
    });
    if (!result.ok) return result;
    const signature = result.data.data?.signature;
    if (!signature) return { ok: false, code: "CUSTODY_BAD_RESPONSE", error: "Privy did not return a message signature" };
    return { ok: true, data: { signatureBase64: signature } };
  }

  // ------------------------------------------------------------------ transport
  private async call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<CustodyResult<T>> {
    const appId = env("PRIVY_APP_ID");
    const appSecret = env("PRIVY_APP_SECRET");
    if (!appId || !appSecret) return { ok: false, code: "CUSTODY_NOT_CONFIGURED", error: "Privy credentials are not configured" };

    const url = `${API}${path}`;
    const headers: Record<string, string> = {
      Authorization: `Basic ${btoa(`${appId}:${appSecret}`)}`,
      "privy-app-id": appId,
      "Content-Type": "application/json",
    };

    // Optional authorization key: required when the Privy app enforces
    // request signing for wallet operations.
    const authorizationKey = env("PRIVY_AUTHORIZATION_PRIVATE_KEY");
    if (authorizationKey && method === "POST") {
      const signature = await signAuthorizationRequest(authorizationKey, { version: 1, method, url, body: body ?? {}, headers: { "privy-app-id": appId } });
      if (signature) headers["privy-authorization-signature"] = signature;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await response.text();
      if (!response.ok) {
        // Provider error text is surfaced without credentials.
        return { ok: false, code: `CUSTODY_HTTP_${response.status}`, error: safeError(text, response.status) };
      }
      return { ok: true, data: (text ? JSON.parse(text) : {}) as T };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, code: "CUSTODY_UNAVAILABLE", error: message.includes("abort") ? "Custody provider timed out" : message };
    } finally {
      clearTimeout(timer);
    }
  }
}

function safeError(text: string, status: number): string {
  try {
    const parsed = JSON.parse(text) as { error?: string; message?: string };
    return parsed.error ?? parsed.message ?? `Custody provider returned HTTP ${status}`;
  } catch {
    return `Custody provider returned HTTP ${status}`;
  }
}

/** ECDSA P-256 request signature over the canonical Privy payload. */
async function signAuthorizationRequest(privateKey: string, payload: unknown): Promise<string | null> {
  try {
    const pkcs8 = privateKey.replace(/^wallet-auth:/, "").replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
    const raw = Uint8Array.from(atob(pkcs8), (c) => c.charCodeAt(0));
    const key = await crypto.subtle.importKey("pkcs8", raw, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
    const data = new TextEncoder().encode(JSON.stringify(payload));
    const signature = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, data);
    return btoa(String.fromCharCode(...new Uint8Array(signature)));
  } catch {
    // A malformed key must not silently downgrade to an unsigned request path
    // that leaks anything; the request simply proceeds unsigned and Privy rejects it.
    return null;
  }
}
