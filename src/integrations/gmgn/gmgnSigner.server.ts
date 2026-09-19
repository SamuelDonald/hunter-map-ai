// Server-only request signing for GMGN's signed trade routes.
//
// The signing credential is a PEM private key issued by GMGN for API request
// authentication. It is NOT a Solana wallet key and can never move funds by
// itself — it only authenticates trade requests. It is read from the server
// environment, never logged and never returned to a client.
import { createPrivateKey, constants, sign as nodeSign } from "node:crypto";

export type SigningAlgorithm = "Ed25519" | "RSA-SHA256";

/** Normalises a PEM that was stored as a single line with escaped newlines. */
function normalisePem(raw: string): string {
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export function detectAlgorithm(pem: string): SigningAlgorithm {
  const key = createPrivateKey(normalisePem(pem));
  if (key.asymmetricKeyType === "ed25519") return "Ed25519";
  if (key.asymmetricKeyType === "rsa") return "RSA-SHA256";
  throw new Error(`UNSUPPORTED_SIGNING_KEY_TYPE:${key.asymmetricKeyType}`);
}

/**
 * Signature message format required by GMGN:
 *   {sub_path}:{sorted_query_string}:{request_body}:{timestamp}
 * Query params (including timestamp and client_id) are sorted by key; array
 * values are emitted as repeated sorted key=value pairs.
 */
export function buildSignatureMessage(
  subPath: string,
  query: Record<string, string | number | boolean | string[] | undefined>,
  body: string,
  timestamp: number,
): string {
  const sortedQs = Object.keys(query)
    .filter((k) => query[k] !== undefined)
    .sort()
    .flatMap((k) => {
      const encodedKey = encodeURIComponent(k);
      const value = query[k];
      if (Array.isArray(value)) {
        return [...value].sort().map((item) => `${encodedKey}=${encodeURIComponent(item)}`);
      }
      return [`${encodedKey}=${encodeURIComponent(String(value))}`];
    })
    .join("&");
  return `${subPath}:${sortedQs}:${body}:${timestamp}`;
}

/** Ed25519 signs raw bytes; RSA uses PSS + SHA-256 with a 32-byte salt. */
export function signMessage(message: string, pem: string): string {
  const key = normalisePem(pem);
  const algorithm = detectAlgorithm(key);
  const buffer = Buffer.from(message, "utf-8");
  if (algorithm === "Ed25519") return nodeSign(null, buffer, key).toString("base64");
  return nodeSign("sha256", buffer, {
    key,
    padding: constants.RSA_PKCS1_PSS_PADDING,
    saltLength: 32,
  }).toString("base64");
}

/** Configuration check that never reveals key material. */
export function inspectSigningKey(pem: string | null): { configured: boolean; algorithm: SigningAlgorithm | null; error: string | null } {
  if (!pem) return { configured: false, algorithm: null, error: null };
  try {
    return { configured: true, algorithm: detectAlgorithm(pem), error: null };
  } catch (error) {
    return { configured: false, algorithm: null, error: (error as Error).message };
  }
}
