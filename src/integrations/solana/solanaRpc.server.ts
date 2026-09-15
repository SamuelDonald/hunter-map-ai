// SolanaRpcProvider — the single place the application talks to a Solana RPC.
// Built on @solana/kit (the SDK recommended by the Solana Foundation skill).
// Nothing else in the codebase may call an RPC endpoint directly.
import { address, createSolanaRpc, isAddress, signature as toSignature, type Address } from "@solana/kit";
import { getNetworkConfig, LIMITS, TOKEN_2022_PROGRAM, TOKEN_PROGRAM, type SolanaCluster } from "./solanaConfig.server";

export type RpcStatus = "READY" | "DEGRADED" | "ERROR";

export type RpcResult<T> =
  | { ok: true; data: T; latencyMs: number }
  | { ok: false; error: string; code: string; latencyMs: number };

export type RpcHealth = {
  cluster: SolanaCluster;
  status: RpcStatus;
  endpointConfigured: boolean;
  latencyMs: number | null;
  slot: number | null;
  blockHeight: number | null;
  lastError: string | null;
  lastErrorAt: string | null;
  lastSuccessAt: string | null;
};

const health: RpcHealth = {
  cluster: "devnet",
  status: "ERROR",
  endpointConfigured: false,
  latencyMs: null,
  slot: null,
  blockHeight: null,
  lastError: null,
  lastErrorAt: null,
  lastSuccessAt: null,
};

export type TokenBalance = {
  mint: string;
  tokenAccount: string;
  amount: string;
  decimals: number;
  uiAmount: number;
  program: "TOKEN" | "TOKEN_2022";
};

export type SimulationOutcome = {
  success: boolean;
  error: string | null;
  errorCode: string | null;
  logs: string[];
  unitsConsumed: number | null;
};

export type SignatureState = {
  found: boolean;
  confirmationStatus: "processed" | "confirmed" | "finalized" | null;
  slot: number | null;
  err: string | null;
};

export class SolanaRpcProvider {
  readonly cluster: SolanaCluster;
  readonly endpoint: string;
  readonly endpointConfigured: boolean;
  private readonly rpc: ReturnType<typeof createSolanaRpc>;

  constructor() {
    const config = getNetworkConfig();
    this.cluster = config.cluster;
    this.endpoint = config.rpcUrl;
    this.endpointConfigured = config.rpcConfigured;
    this.rpc = createSolanaRpc(config.rpcUrl);
    health.cluster = config.cluster;
    health.endpointConfigured = config.rpcConfigured;
  }

  /** Wraps every RPC call with a timeout, latency capture and health tracking. */
  private async call<T>(label: string, fn: () => Promise<T>): Promise<RpcResult<T>> {
    const started = Date.now();
    for (let attempt = 0; attempt <= LIMITS.RPC_MAX_RETRIES; attempt += 1) {
      try {
        const data = await withTimeout(fn(), LIMITS.RPC_TIMEOUT_MS, label);
        const latencyMs = Date.now() - started;
        health.latencyMs = latencyMs;
        health.lastSuccessAt = new Date().toISOString();
        health.status = latencyMs > LIMITS.DEGRADED_LATENCY_MS ? "DEGRADED" : "READY";
        return { ok: true, data, latencyMs };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt === LIMITS.RPC_MAX_RETRIES) {
          const latencyMs = Date.now() - started;
          health.status = "ERROR";
          health.lastError = `${label}: ${message}`;
          health.lastErrorAt = new Date().toISOString();
          return { ok: false, error: message, code: `RPC_${label.toUpperCase()}_FAILED`, latencyMs };
        }
        await sleep(250 * (attempt + 1));
      }
    }
    return { ok: false, error: "unreachable", code: "RPC_UNKNOWN", latencyMs: 0 };
  }

  static isValidAddress(value: string): boolean {
    return typeof value === "string" && isAddress(value);
  }

  async getSlot(): Promise<RpcResult<number>> {
    return this.call("getSlot", async () => Number(await this.rpc.getSlot().send()));
  }

  async getBlockHeight(): Promise<RpcResult<number>> {
    return this.call("getBlockHeight", async () => Number(await this.rpc.getBlockHeight().send()));
  }

  async getBalance(owner: string): Promise<RpcResult<number>> {
    return this.call("getBalance", async () => {
      const result = await this.rpc.getBalance(address(owner)).send();
      return Number(result.value);
    });
  }

  async getAccountInfo(account: string): Promise<
    RpcResult<{ exists: boolean; owner: string | null; lamports: number; executable: boolean; dataBase64: string | null }>
  > {
    return this.call("getAccountInfo", async () => {
      const result = await this.rpc.getAccountInfo(address(account), { encoding: "base64" }).send();
      const value = result.value;
      if (!value) return { exists: false, owner: null, lamports: 0, executable: false, dataBase64: null };
      return {
        exists: true,
        owner: String(value.owner),
        lamports: Number(value.lamports),
        executable: Boolean(value.executable),
        dataBase64: Array.isArray(value.data) ? value.data[0] : null,
      };
    });
  }

  async getTokenAccounts(owner: string): Promise<RpcResult<TokenBalance[]>> {
    return this.call("getTokenAccounts", async () => {
      const balances: TokenBalance[] = [];
      for (const [programId, program] of [
        [TOKEN_PROGRAM, "TOKEN"],
        [TOKEN_2022_PROGRAM, "TOKEN_2022"],
      ] as const) {
        const result = await this.rpc
          .getTokenAccountsByOwner(address(owner), { programId: address(programId) }, { encoding: "jsonParsed" })
          .send();
        for (const entry of result.value) {
          const info = entry.account.data.parsed.info as {
            mint: string;
            tokenAmount: { amount: string; decimals: number; uiAmount: number | null };
          };
          balances.push({
            mint: info.mint,
            tokenAccount: String(entry.pubkey),
            amount: info.tokenAmount.amount,
            decimals: info.tokenAmount.decimals,
            uiAmount: info.tokenAmount.uiAmount ?? 0,
            program,
          });
        }
      }
      return balances;
    });
  }

  async getLatestBlockhash(): Promise<RpcResult<{ blockhash: string; lastValidBlockHeight: number }>> {
    return this.call("getLatestBlockhash", async () => {
      const result = await this.rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
      return {
        blockhash: String(result.value.blockhash),
        lastValidBlockHeight: Number(result.value.lastValidBlockHeight),
      };
    });
  }

  /** Simulation is mandatory before signing — see SolanaTransactionService. */
  async simulateTransaction(wireBase64: string): Promise<RpcResult<SimulationOutcome>> {
    return this.call("simulateTransaction", async () => {
      const result = await this.rpc
        .simulateTransaction(wireBase64 as Parameters<typeof this.rpc.simulateTransaction>[0], {
          encoding: "base64",
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: "confirmed",
        })
        .send();
      const err = result.value.err;
      return {
        success: err === null,
        error: err === null ? null : safeStringify(err),
        errorCode: err === null ? null : classifySimulationError(safeStringify(err), result.value.logs ?? []),
        logs: (result.value.logs ?? []).map(String),
        unitsConsumed: result.value.unitsConsumed === undefined ? null : Number(result.value.unitsConsumed),
      };
    });
  }

  async sendTransaction(wireBase64: string): Promise<RpcResult<string>> {
    return this.call("sendTransaction", async () => {
      const signature = await this.rpc
        .sendTransaction(wireBase64 as Parameters<typeof this.rpc.sendTransaction>[0], {
          encoding: "base64",
          preflightCommitment: "confirmed",
          maxRetries: 0n,
        })
        .send();
      return String(signature);
    });
  }

  async getSignatureStatuses(signatures: string[]): Promise<RpcResult<SignatureState[]>> {
    return this.call("getSignatureStatuses", async () => {
      const result = await this.rpc
        .getSignatureStatuses(signatures.map(toSignature), {
          searchTransactionHistory: true,
        })
        .send();
      return result.value.map((status) => ({
        found: status !== null,
        confirmationStatus: status?.confirmationStatus ?? null,
        slot: status ? Number(status.slot) : null,
        err: status?.err ? safeStringify(status.err) : null,
      }));
    });
  }

  /** Reads always allow transaction v1 (SIMD-0385). */
  async getTransaction(signature: string): Promise<
    RpcResult<{ found: boolean; slot: number | null; fee: number | null; err: string | null; logs: string[]; preBalances: number[]; postBalances: number[] }>
  > {
    return this.call("getTransaction", async () => {
      const result = await this.rpc
        .getTransaction(toSignature(signature), {
          maxSupportedTransactionVersion: 1 as 0,
          encoding: "json",
          commitment: "confirmed",
        })
        .send();
      if (!result) return { found: false, slot: null, fee: null, err: null, logs: [], preBalances: [], postBalances: [] };
      return {
        found: true,
        slot: Number(result.slot),
        fee: result.meta ? Number(result.meta.fee) : null,
        err: result.meta?.err ? safeStringify(result.meta.err) : null,
        logs: (result.meta?.logMessages ?? []).map(String),
        preBalances: (result.meta?.preBalances ?? []).map(Number),
        postBalances: (result.meta?.postBalances ?? []).map(Number),
      };
    });
  }

  /** Signature history for an address — used by deposit detection. */
  async getSignaturesForAddress(
    owner: string,
    limit = 25,
  ): Promise<RpcResult<{ signature: string; slot: number; blockTime: string | null; err: string | null; confirmationStatus: "processed" | "confirmed" | "finalized" | null }[]>> {
    return this.call("getSignaturesForAddress", async () => {
      const result = await this.rpc.getSignaturesForAddress(address(owner), { limit }).send();
      return result.map((entry) => ({
        signature: String(entry.signature),
        slot: Number(entry.slot),
        blockTime: entry.blockTime === null || entry.blockTime === undefined ? null : new Date(Number(entry.blockTime) * 1000).toISOString(),
        err: entry.err ? safeStringify(entry.err) : null,
        confirmationStatus: entry.confirmationStatus ?? null,
      }));
    });
  }

  /** Parsed transaction payload. The caller decides how to interpret it. */
  async getParsedTransaction(signature: string): Promise<RpcResult<unknown>> {
    return this.call("getParsedTransaction", async () => {
      const result = await this.rpc
        .getTransaction(toSignature(signature), {
          maxSupportedTransactionVersion: 1 as 0,
          encoding: "jsonParsed",
          commitment: "confirmed",
        })
        .send();
      return result as unknown;
    });
  }

  async health(): Promise<RpcHealth> {
    const slot = await this.getSlot();
    if (slot.ok) {
      health.slot = slot.data;
      const blockHeight = await this.getBlockHeight();
      health.blockHeight = blockHeight.ok ? blockHeight.data : null;
    }
    return { ...health, cluster: this.cluster, endpointConfigured: this.endpointConfigured };
  }
}

export function getRpcProvider(): SolanaRpcProvider {
  return new SolanaRpcProvider();
}

export function toAddress(value: string): Address {
  return address(value);
}

/** RPC errors can contain bigints, which JSON.stringify refuses. */
function safeStringify(value: unknown): string {
  return JSON.stringify(value, (_key, val) => (typeof val === "bigint" ? val.toString() : val)) ?? "unknown";
}

function classifySimulationError(err: string, logs: string[]): string {
  const haystack = `${err} ${logs.join(" ")}`.toLowerCase();
  if (haystack.includes("insufficient")) return "INSUFFICIENT_FUNDS";
  if (haystack.includes("blockhashnotfound") || haystack.includes("blockhash not found")) return "EXPIRED_BLOCKHASH";
  if (haystack.includes("accountnotfound")) return "INVALID_ACCOUNT";
  if (haystack.includes("slippage")) return "SLIPPAGE_FAILURE";
  if (haystack.includes("computationalbudget") || haystack.includes("exceeded cus")) return "COMPUTE_BUDGET";
  if (haystack.includes("invalidinstruction") || haystack.includes("unsupported")) return "INVALID_INSTRUCTION";
  if (haystack.includes("custom")) return "PROGRAM_ERROR";
  return "SIMULATION_FAILED";
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}
