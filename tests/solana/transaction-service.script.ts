// Full transaction-service test: gates, idempotency, simulation stop, submit,
// confirm, reconcile, persistence. Runs against a local Surfpool network.
import { Surfnet } from "@solana/surfpool";
import { getBase58Decoder } from "@solana/kit";
import { getTransferSolInstruction } from "@solana-program/system";

const USER = "d5f13a86-9ffa-432a-a324-1acee29ea6e4";
const net = await Surfnet.start({});
process.env["SOLANA_RPC_URL"] = net.rpcUrl;
process.env["SOLANA_CLUSTER"] = "devnet";
process.env["EXECUTION_WALLET_SECRET_KEY"] = getBase58Decoder().decode(new Uint8Array(net.payerSecretKey));
const log = (l: string, v: unknown) => console.log(l, JSON.stringify(v));

const { getTransactionService } = await import("../../src/integrations/solana/solanaTransactionService.server.ts");
const { evaluateExecutionReadiness } = await import("../../src/integrations/solana/solanaExecutionGate.server.ts");
const { SolanaWalletService } = await import("../../src/integrations/solana/solanaWalletService.server.ts");
const { supabaseAdmin } = await import("../../src/integrations/supabase/client.server.ts");

log("readiness:", await evaluateExecutionReadiness(supabaseAdmin, USER));
const snapshot = await new SolanaWalletService().getExecutionWalletSnapshot(supabaseAdmin, USER);
log("wallet:", { state: snapshot.state, address: snapshot.address, sol: snapshot.solBalance, reserve: snapshot.minSolReserve, reasons: snapshot.reasons });

const svc = getTransactionService();
const req = (key: string, extra: Record<string, unknown> = {}) => ({
  userId: USER, idempotencyKey: key, purpose: "INFRASTRUCTURE_TEST", executionProvider: "SOLANA_INFRASTRUCTURE",
  expectedLamportsSpend: 1_000,
  build: (signer: { address: string }) => [getTransferSolInstruction({ source: signer as never, destination: signer.address as never, amount: 1_000n })],
  ...extra,
});
const stamp = Date.now();

log("A happy path:", await svc.execute(supabaseAdmin, req(`test:${stamp}:a`)));
log("B duplicate key:", await svc.execute(supabaseAdmin, req(`test:${stamp}:a`)));
log("C risk rejected:", await svc.execute(supabaseAdmin, req(`test:${stamp}:c`, { riskCheck: async () => ({ approved: false, reasons: ["RISK_TEST_REJECT"] }) })));
log("D slippage above cap:", await svc.execute(supabaseAdmin, req(`test:${stamp}:d`, { requestedSlippage: 30, slippageCap: 5 })));
log("E simulation must fail:", await svc.execute(supabaseAdmin, {
  ...req(`test:${stamp}:e`),
  build: (signer: { address: string }) => [getTransferSolInstruction({ source: signer as never, destination: "11111111111111111111111111111112" as never, amount: 10_000_000_000_000n })],
}));

// kill switch must block signing
await supabaseAdmin.from("risk_settings").update({ kill_switch: true }).eq("user_id", USER);
log("F kill switch:", await svc.execute(supabaseAdmin, req(`test:${stamp}:f`)));
await supabaseAdmin.from("risk_settings").update({ kill_switch: false }).eq("user_id", USER);

// insufficient balance: raise the reserve above the balance
await supabaseAdmin.from("risk_settings").update({ min_sol_reserve: 100 }).eq("user_id", USER);
log("G below reserve:", await svc.execute(supabaseAdmin, req(`test:${stamp}:g`)));
await supabaseAdmin.from("risk_settings").update({ min_sol_reserve: 0.05 }).eq("user_id", USER);

// RPC failure must not corrupt state
process.env["SOLANA_RPC_URL"] = "http://127.0.0.1:1";
const { getTransactionService: gts2 } = await import("../../src/integrations/solana/solanaTransactionService.server.ts?bust=1");
log("H rpc down:", await gts2().execute(supabaseAdmin, req(`test:${stamp}:h`)));
process.env["SOLANA_RPC_URL"] = net.rpcUrl;

const { data: rows } = await supabaseAdmin.from("solana_transactions").select("idempotency_key,status,error_code,reconciliation_status,signature,fee_lamports,slot").like("idempotency_key", `test:${stamp}:%`).order("created_at");
log("persisted:", rows);
await net.stop();
