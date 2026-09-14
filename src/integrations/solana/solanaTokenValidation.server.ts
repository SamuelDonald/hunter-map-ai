// On-chain token validation. GMGN metadata is treated as untrusted input:
// mint address, program owner, decimals and initialization are confirmed
// against the chain before a token can be traded.
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from "./solanaConfig.server";
import { SolanaRpcProvider, getRpcProvider } from "./solanaRpc.server";

export type TokenValidation = {
  valid: boolean;
  mint: string;
  program: "TOKEN" | "TOKEN_2022" | null;
  decimals: number | null;
  initialized: boolean;
  supply: string | null;
  reasons: string[];
};

/** Mint layout: [mintAuthorityOption(4)+authority(32)][supply(8)][decimals(1)][isInitialized(1)]. */
export async function validateSolanaToken(
  mint: string,
  rpc: SolanaRpcProvider = getRpcProvider(),
): Promise<TokenValidation> {
  const result: TokenValidation = {
    valid: false,
    mint,
    program: null,
    decimals: null,
    initialized: false,
    supply: null,
    reasons: [],
  };

  if (!SolanaRpcProvider.isValidAddress(mint)) {
    result.reasons.push("INVALID_SOLANA_ADDRESS");
    return result;
  }

  const account = await rpc.getAccountInfo(mint);
  if (!account.ok) {
    result.reasons.push("RPC_UNAVAILABLE");
    return result;
  }
  if (!account.data.exists || !account.data.dataBase64) {
    result.reasons.push("MINT_ACCOUNT_NOT_FOUND");
    return result;
  }

  const owner = account.data.owner;
  if (owner === TOKEN_PROGRAM) result.program = "TOKEN";
  else if (owner === TOKEN_2022_PROGRAM) result.program = "TOKEN_2022";
  else {
    result.reasons.push("NOT_A_TOKEN_PROGRAM_ACCOUNT");
    return result;
  }

  const bytes = base64ToBytes(account.data.dataBase64);
  if (bytes.length < 82) {
    result.reasons.push("MINT_ACCOUNT_TOO_SMALL");
    return result;
  }

  let supply = 0n;
  for (let i = 7; i >= 0; i -= 1) supply = (supply << 8n) | BigInt(bytes[36 + i] ?? 0);
  result.supply = supply.toString();
  result.decimals = bytes[44] ?? null;
  result.initialized = bytes[45] === 1;

  if (!result.initialized) result.reasons.push("MINT_NOT_INITIALIZED");
  if (result.decimals === null || result.decimals > 18) result.reasons.push("UNSUPPORTED_DECIMALS");
  if (supply === 0n) result.reasons.push("ZERO_SUPPLY");

  result.valid = result.reasons.length === 0;
  return result;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}
