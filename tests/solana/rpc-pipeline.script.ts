// Local Solana network test (Surfpool) — validates build/simulate/sign/submit/
// confirm/reconcile against a real Solana runtime. Keys are ephemeral.
import { Surfnet } from "@solana/surfpool";
import { createKeyPairSignerFromBytes, pipe, createTransactionMessage, setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash, appendTransactionMessageInstructions, compileTransaction,
  getBase64EncodedWireTransaction, signTransactionMessageWithSigners, getSignatureFromTransaction, address } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

const net = await Surfnet.start({});
console.log("surfnet rpc:", net.rpcUrl, "payer:", net.payer);
process.env["SOLANA_RPC_URL"] = net.rpcUrl;
process.env["SOLANA_CLUSTER"] = "devnet";
const { SolanaRpcProvider } = await import("../../src/integrations/solana/solanaRpc.server.ts");
const provider = new SolanaRpcProvider();
const log = (...a: unknown[]) => console.log(...a);

const signer = await createKeyPairSignerFromBytes(new Uint8Array(net.payerSecretKey));
log("health:", JSON.stringify(await provider.health()));
log("balance:", JSON.stringify(await provider.getBalance(String(signer.address))));
log("token accounts:", JSON.stringify(await provider.getTokenAccounts(String(signer.address))));

const bh = await provider.getLatestBlockhash();
if (!bh.ok) throw new Error("blockhash");
const build = (amount: bigint, dest = signer.address) => pipe(
  createTransactionMessage({ version: 0 }),
  m => setTransactionMessageFeePayerSigner(signer, m),
  m => setTransactionMessageLifetimeUsingBlockhash({ blockhash: bh.data.blockhash as never, lastValidBlockHeight: BigInt(bh.data.lastValidBlockHeight) }, m),
  m => appendTransactionMessageInstructions([getTransferSolInstruction({ source: signer, destination: dest, amount })], m),
);

const ok = build(1_000n);
log("simulate ok:", JSON.stringify(await provider.simulateTransaction(getBase64EncodedWireTransaction(compileTransaction(ok)))));
const bad = build(10_000_000_000_000_000n, address("11111111111111111111111111111112"));
log("simulate insufficient funds:", JSON.stringify(await provider.simulateTransaction(getBase64EncodedWireTransaction(compileTransaction(bad)))));

const signed = await signTransactionMessageWithSigners(ok);
const sig = getSignatureFromTransaction(signed);
log("signature:", sig);
const sent = await provider.sendTransaction(getBase64EncodedWireTransaction(signed));
log("submit:", JSON.stringify(sent));
if (sent.ok) {
  for (let i = 0; i < 20; i++) {
    const st = await provider.getSignatureStatuses([sent.data]);
    if (st.ok && st.data[0]?.found) { log("confirmation:", JSON.stringify(st.data[0])); break; }
    await new Promise(r => setTimeout(r, 500));
  }
  const tx = await provider.getTransaction(sent.data);
  log("reconcile:", JSON.stringify(tx).slice(0, 400));
  log("duplicate submit of same signed tx:", JSON.stringify(await provider.sendTransaction(getBase64EncodedWireTransaction(signed))));
}
await net.stop();
