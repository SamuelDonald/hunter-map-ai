// SignerProvider abstraction for the execution wallet.
//
// SECURITY BOUNDARY. The execution wallet secret is read from the server
// runtime environment inside this module only. It is never returned, logged,
// persisted, or exposed through any server function or HTTP route. There is
// deliberately no export that yields key material, and no key generation:
// the operator supplies a key out-of-band.
//
// Future backends (encrypted secret storage, KMS/HSM, managed signing service)
// implement the same SignerProvider interface — business logic never learns
// which one is in use.
import { createKeyPairSignerFromBytes, getBase58Encoder, type KeyPairSigner } from "@solana/kit";

export type SignerBackend = "ENV_SECRET" | "KMS" | "EXTERNAL_SERVICE";

export type SignerAvailability = {
  configured: boolean;
  backend: SignerBackend | null;
  address: string | null;
  /** Set when a secret is present but unusable, or does not match the pinned address. */
  error: string | null;
};

export interface SignerProvider {
  readonly backend: SignerBackend;
  /** Safe metadata only. Never key material. */
  availability(): Promise<SignerAvailability>;
  /** Only the execution service may call this; the signer never leaves the server. */
  getSigner(): Promise<KeyPairSigner | null>;
}

const SECRET_ENV = "EXECUTION_WALLET_SECRET_KEY";
const PINNED_ADDRESS_ENV = "EXECUTION_WALLET_ADDRESS";

function readSecretBytes(): Uint8Array | null {
  const raw = process.env[SECRET_ENV];
  if (!raw || !raw.trim()) return null;
  const value = raw.trim();
  try {
    if (value.startsWith("[")) {
      const parsed = JSON.parse(value) as number[];
      return Uint8Array.from(parsed);
    }
    return Uint8Array.from(getBase58Encoder().encode(value));
  } catch {
    return null;
  }
}

/** Environment-secret signer. Suitable for devnet infrastructure work. */
class EnvSecretSignerProvider implements SignerProvider {
  readonly backend = "ENV_SECRET" as const;
  private cached: KeyPairSigner | null = null;

  async availability(): Promise<SignerAvailability> {
    const bytes = readSecretBytes();
    if (!bytes) return { configured: false, backend: null, address: null, error: null };
    if (bytes.length !== 64) {
      return { configured: false, backend: this.backend, address: null, error: "Execution wallet secret must be a 64-byte keypair" };
    }
    let signer: KeyPairSigner;
    try {
      signer = await this.load(bytes);
    } catch {
      return { configured: false, backend: this.backend, address: null, error: "Execution wallet secret could not be loaded" };
    }
    const pinned = process.env[PINNED_ADDRESS_ENV]?.trim();
    if (pinned && pinned !== String(signer.address)) {
      return { configured: false, backend: this.backend, address: null, error: "Execution wallet secret does not match the pinned public address" };
    }
    return { configured: true, backend: this.backend, address: String(signer.address), error: null };
  }

  async getSigner(): Promise<KeyPairSigner | null> {
    const bytes = readSecretBytes();
    if (!bytes || bytes.length !== 64) return null;
    try {
      return await this.load(bytes);
    } catch {
      return null;
    }
  }

  private async load(bytes: Uint8Array): Promise<KeyPairSigner> {
    if (!this.cached) this.cached = await createKeyPairSignerFromBytes(bytes);
    return this.cached;
  }
}

const provider: SignerProvider = new EnvSecretSignerProvider();

/** Configuration, not a hardcoded mechanism: swap the backend here only. */
export function getSignerProvider(): SignerProvider {
  return provider;
}

/** Safe: public address only, or null when no signer is configured. */
export async function getExecutionWalletAddress(): Promise<string | null> {
  return (await provider.availability()).address;
}
