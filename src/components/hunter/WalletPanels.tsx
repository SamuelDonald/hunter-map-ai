// Trading wallet UI.
//
// Two clearly separated concepts:
//  - CONNECTED WALLET: the user's own Phantom / Solflare / Backpack. Identity,
//    funding and withdrawal destination only. Never traded by the bot.
//  - HUNTER EXECUTION WALLET: segregated per user, provisioned through the
//    custody provider, holds trading capital. Keys never exist in the browser.
import { useEffect, useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import QRCode from "qrcode";
import { ArrowDownToLine, ArrowUpFromLine, ShieldAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NotConnected, Panel } from "./HunterUI";
import { useTradingWallet } from "./hooks";
import {
  addTradingWithdrawalAddress,
  connectExternalWallet,
  createTradingWallet,
  disconnectExternalWallet,
  setLiveTrading,
  submitTradingWithdrawal,
  syncTradingWalletDeposits,
} from "@/lib/hunter/wallet.functions";

const short = (a: string | null | undefined) => (a ? `${a.slice(0, 4)}…${a.slice(-4)}` : "—");
const amount = (v: number, digits = 4) => v.toLocaleString(undefined, { maximumFractionDigits: digits });

const statusTone: Record<string, string> = {
  READY: "text-bullish",
  PROVISIONING: "text-warning",
  LOW_BALANCE: "text-warning",
  BLOCKED: "text-bearish",
  ERROR: "text-bearish",
  DISABLED: "text-muted-foreground",
  NOT_CONFIGURED: "text-muted-foreground",
};

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border/40 py-1.5 text-xs last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className={tone ?? "font-mono text-foreground"}>{value}</span>
    </div>
  );
}

// ------------------------------------------------------- HUNTER trading wallet
export function TradingWalletPanel() {
  const { data, isLoading } = useTradingWallet();
  const queryClient = useQueryClient();
  const create = useServerFn(createTradingWallet);
  const sync = useServerFn(syncTradingWalletDeposits);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"none" | "fund" | "withdraw">("none");

  const wallet = data?.wallet;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["trading-wallet"] });

  const onCreate = async () => {
    setBusy(true);
    try {
      const result = await create();
      if (result.ok) {
        toast.success(`Trading wallet created: ${short(result.address)}`);
        await refresh();
      } else {
        toast.error(
          result.reason === "CUSTODY_NOT_CONFIGURED"
            ? "Wallet custody is not configured on the server yet."
            : `Wallet creation failed: ${result.reason}`,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  const onSync = async () => {
    setBusy(true);
    try {
      const result = await sync();
      if (result.error) toast.error(`Deposit check failed: ${result.error}`);
      else toast.success(`Checked ${result.scanned} transfers · ${result.recorded} new deposit(s)`);
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) {
    return (
      <Panel title="HUNTER TRADING WALLET">
        <p className="text-xs text-muted-foreground">Loading wallet…</p>
      </Panel>
    );
  }

  if (!wallet?.provisioned) {
    return (
      <Panel title="HUNTER TRADING WALLET" aside={<span className="text-xs text-muted-foreground">{wallet?.cluster}</span>}>
        <p className="text-xs text-muted-foreground">
          No execution wallet configured. HUNTER creates a wallet that is yours alone — never shared with another account.
          Signing stays with the custody provider, so no private key or seed phrase ever reaches this app, the database or
          your browser.
        </p>
        {wallet?.custodyConfigured === false ? (
          <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
            Wallet custody is not configured on the server, so a wallet cannot be created yet.
          </p>
        ) : null}
        <Button className="mt-4" disabled={busy || wallet?.custodyConfigured === false} onClick={onCreate}>
          <Wallet className="mr-2 h-4 w-4" /> CREATE TRADING WALLET
        </Button>
      </Panel>
    );
  }

  const c = wallet.capital;
  return (
    <Panel
      title="HUNTER TRADING WALLET"
      aside={<span className={`text-xs ${statusTone[wallet.status] ?? "text-muted-foreground"}`}>{wallet.status}</span>}
    >
      <div className="rounded-lg border border-border/60 bg-card/40 p-3">
        <Row label="Address" value={wallet.address ?? "—"} />
        <Row label="Network" value={`Solana ${wallet.cluster}`} />
        <Row label="Custody" value={wallet.custodyProvider ?? "—"} />
        <Row label="SOL balance" value={`${amount(c.solBalance)} SOL`} />
        <Row label="USDC balance" value={`${amount(c.usdcBalance, 2)} USDC`} />
        <Row label="Reserved by open positions" value={`${amount(c.reservedCapital, 2)}`} />
        <Row
          label="Available trading capital"
          value={`${amount(c.availableCapital, 2)}`}
          tone={c.availableCapital > 0 ? "font-mono text-bullish" : "font-mono text-muted-foreground"}
        />
        <Row
          label="Minimum SOL reserve"
          value={`${amount(wallet.minSolReserve)} SOL`}
          tone={c.belowReserve ? "font-mono text-warning" : "font-mono text-foreground"}
        />
        <Row label="Live trading" value={wallet.liveExecutionEnabled ? "ENABLED" : "DISABLED"} tone={wallet.liveExecutionEnabled ? "text-bearish" : "text-muted-foreground"} />
      </div>

      {c.belowReserve ? (
        <p className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          SOL is below the minimum reserve. New entries are blocked and the bot will never spend below the reserve.
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Button size="sm" onClick={() => setTab(tab === "fund" ? "none" : "fund")}>
          <ArrowDownToLine className="mr-2 h-4 w-4" /> FUND WALLET
        </Button>
        <Button size="sm" variant="outline" onClick={() => setTab(tab === "withdraw" ? "none" : "withdraw")}>
          <ArrowUpFromLine className="mr-2 h-4 w-4" /> WITHDRAW
        </Button>
        <Button size="sm" variant="ghost" disabled={busy} onClick={onSync}>
          CHECK FOR DEPOSITS
        </Button>
      </div>

      {tab === "fund" ? <FundSection address={wallet.address} cluster={wallet.cluster} /> : null}
      {tab === "withdraw" ? <WithdrawSection /> : null}
    </Panel>
  );
}

// ----------------------------------------------------------------- funding
function FundSection({ address, cluster }: { address: string | null; cluster: string }) {
  const [qr, setQr] = useState<string | null>(null);

  useEffect(() => {
    if (!address) return;
    let cancelled = false;
    void QRCode.toDataURL(address, { margin: 1, width: 176 }).then((url) => {
      if (!cancelled) setQr(url);
    });
    return () => {
      cancelled = true;
    };
  }, [address]);

  return (
    <div className="mt-4 rounded-lg border border-border/60 bg-card/40 p-3">
      <p className="text-xs font-semibold tracking-wide text-foreground">FUND THIS WALLET</p>
      <div className="mt-3 flex flex-wrap items-start gap-4">
        {qr ? <img src={qr} alt="Trading wallet deposit address QR code" className="rounded-md border border-border/60" width={176} height={176} /> : null}
        <div className="min-w-[220px] flex-1 space-y-2">
          <Row label="Send to" value={address ?? "—"} />
          <Row label="Network" value={`Solana ${cluster}`} />
          <Row label="Supported assets" value="SOL, USDC" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (address) void navigator.clipboard.writeText(address).then(() => toast.success("Address copied"));
            }}
          >
            COPY ADDRESS
          </Button>
        </div>
      </div>
      <p className="mt-3 rounded-md border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
        Send only SOL or USDC on Solana {cluster}. Anything else is not accepted as trading capital and may be
        unrecoverable. Deposits are confirmed from the blockchain, not from this screen.
      </p>
    </div>
  );
}

// -------------------------------------------------------------- withdrawals
function WithdrawSection() {
  const { data } = useTradingWallet();
  const queryClient = useQueryClient();
  const submit = useServerFn(submitTradingWithdrawal);
  const addAddress = useServerFn(addTradingWithdrawalAddress);
  const [asset, setAsset] = useState<"SOL" | "USDC">("SOL");
  const [value, setValue] = useState("");
  const [destination, setDestination] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);

  const addresses = data?.addresses ?? [];
  const usable = useMemo(
    () => addresses.filter((a) => a.status === "ACTIVE" && new Date(a.usable_after).getTime() <= Date.now()),
    [addresses],
  );
  const refresh = () => queryClient.invalidateQueries({ queryKey: ["trading-wallet"] });

  const onAdd = async () => {
    setBusy(true);
    try {
      const result = await addAddress({ data: { address: newAddress.trim() } });
      if (result.ok) {
        toast.success("Address added — usable after the cooldown");
        setNewAddress("");
        await refresh();
      } else toast.error(`Could not add address: ${result.reason}`);
    } finally {
      setBusy(false);
    }
  };

  const onWithdraw = async () => {
    if (confirmText.trim().toUpperCase() !== "CONFIRM") {
      toast.error('Type CONFIRM to authorise this withdrawal');
      return;
    }
    setBusy(true);
    try {
      const result = await submit({ data: { asset, amount: Number(value), destination, confirmed: true } });
      if (result.ok) toast.success(`Withdrawal ${result.status}`);
      else toast.error(`Withdrawal rejected: ${result.reason ?? result.status}`);
      setConfirmText("");
      setValue("");
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-4 space-y-3 rounded-lg border border-border/60 bg-card/40 p-3">
      <p className="text-xs font-semibold tracking-wide text-foreground">WITHDRAW</p>
      <p className="text-xs text-muted-foreground">
        Only you can move funds out. The trading strategy, the AI layer and the market data provider have no withdrawal
        authority at all.
      </p>

      <div className="space-y-1">
        <Label className="text-xs">Approved destination</Label>
        <select
          className="h-9 w-full rounded-md border border-border/60 bg-background px-2 text-xs"
          value={destination}
          onChange={(e) => setDestination(e.target.value)}
        >
          <option value="">Select an approved address…</option>
          {usable.map((a) => (
            <option key={a.id} value={a.address}>
              {a.label ? `${a.label} · ` : ""}
              {short(a.address)}
            </option>
          ))}
        </select>
        {addresses.length > usable.length ? (
          <p className="text-xs text-warning">Some addresses are still in their cooldown period.</p>
        ) : null}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1">
          <Label className="text-xs">Asset</Label>
          <select
            className="h-9 rounded-md border border-border/60 bg-background px-2 text-xs"
            value={asset}
            onChange={(e) => setAsset(e.target.value === "USDC" ? "USDC" : "SOL")}
          >
            <option value="SOL">SOL</option>
            <option value="USDC">USDC</option>
          </select>
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Amount</Label>
          <Input className="h-9 w-32" value={value} onChange={(e) => setValue(e.target.value)} placeholder="0.00" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Type CONFIRM</Label>
          <Input className="h-9 w-32" value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="CONFIRM" />
        </div>
        <Button size="sm" disabled={busy || !destination || !value} onClick={onWithdraw}>
          WITHDRAW
        </Button>
      </div>

      <div className="flex flex-wrap items-end gap-2 border-t border-border/40 pt-3">
        <div className="space-y-1">
          <Label className="text-xs">Add a destination address</Label>
          <Input
            className="h-9 w-64"
            value={newAddress}
            onChange={(e) => setNewAddress(e.target.value)}
            placeholder="Solana address"
          />
        </div>
        <Button size="sm" variant="outline" disabled={busy || !newAddress.trim()} onClick={onAdd}>
          ADD ADDRESS
        </Button>
      </div>
    </div>
  );
}

// ------------------------------------------------------- connected user wallet
type StandardWallet = {
  name: string;
  chains: readonly string[];
  features: Record<string, unknown>;
};

export function ConnectedWalletPanel() {
  const { data } = useTradingWallet();
  const queryClient = useQueryClient();
  const connect = useServerFn(connectExternalWallet);
  const disconnect = useServerFn(disconnectExternalWallet);
  const [wallets, setWallets] = useState<StandardWallet[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void import("@wallet-standard/app").then(({ getWallets }) => {
      const api = getWallets();
      const read = () =>
        setWallets(
          api
            .get()
            .filter((w) => w.chains.some((c) => c.startsWith("solana:")) && "standard:connect" in w.features)
            .map((w) => ({ name: w.name, chains: w.chains, features: w.features as Record<string, unknown> })),
        );
      if (!cancelled) {
        read();
        api.on("register", read);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const onConnect = async (name: string) => {
    setBusy(true);
    try {
      const { getWallets } = await import("@wallet-standard/app");
      const target = getWallets().get().find((w) => w.name === name);
      const feature = target?.features["standard:connect"] as
        | { connect: () => Promise<{ accounts: readonly { address: string; chains: readonly string[] }[] }> }
        | undefined;
      if (!feature) {
        toast.error("This wallet does not support connecting.");
        return;
      }
      const { accounts } = await feature.connect();
      const account = accounts.find((a) => a.chains.some((c) => c.startsWith("solana:"))) ?? accounts[0];
      if (!account) {
        toast.error("No Solana account was shared.");
        return;
      }
      const result = await connect({ data: { address: account.address, walletName: name } });
      if (result.ok) {
        toast.success(`${name} connected · ${short(account.address)}`);
        await queryClient.invalidateQueries({ queryKey: ["trading-wallet"] });
      } else toast.error(`Could not save the connection: ${result.reason}`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Wallet connection failed");
    } finally {
      setBusy(false);
    }
  };

  const connected = data?.connected ?? [];

  return (
    <Panel title="CONNECTED WALLET" aside={<span className="text-xs text-muted-foreground">Funding &amp; withdrawals only</span>}>
      <p className="text-xs text-muted-foreground">
        Your own wallet, used to fund the HUNTER wallet and to receive withdrawals. Connecting it never gives HUNTER
        permission to trade from it.
      </p>

      {connected.length ? (
        <div className="mt-3 space-y-2">
          {connected.map((w) => (
            <div key={w.id} className="flex items-center justify-between rounded-lg border border-border/60 bg-card/40 p-2 text-xs">
              <span>
                <span className="text-muted-foreground">{w.wallet_name ?? "Wallet"} · </span>
                <span className="font-mono">{short(w.address)}</span>
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={async () => {
                  await disconnect({ data: { address: w.address } });
                  await queryClient.invalidateQueries({ queryKey: ["trading-wallet"] });
                }}
              >
                DISCONNECT
              </Button>
            </div>
          ))}
        </div>
      ) : null}

      <div className="mt-3 flex flex-wrap gap-2">
        {wallets.length ? (
          wallets.map((w) => (
            <Button key={w.name} size="sm" variant="outline" disabled={busy} onClick={() => void onConnect(w.name)}>
              CONNECT {w.name.toUpperCase()}
            </Button>
          ))
        ) : (
          <p className="text-xs text-muted-foreground">
            No Solana wallet detected in this browser. Install Phantom, Solflare or Backpack to connect one.
          </p>
        )}
      </div>
    </Panel>
  );
}

// --------------------------------------------------------- live trading switch
export function LiveTradingPanel() {
  const { data } = useTradingWallet();
  const queryClient = useQueryClient();
  const setLive = useServerFn(setLiveTrading);
  const [phrase, setPhrase] = useState("");
  const [busy, setBusy] = useState(false);
  const wallet = data?.wallet;

  const apply = async (enabled: boolean) => {
    setBusy(true);
    try {
      const result = await setLive({ data: { enabled, confirmation: enabled ? phrase : "" } });
      if (!result.ok) {
        toast.error(
          result.reason === "CONFIRMATION_REQUIRED"
            ? 'Type ENABLE LIVE TRADING exactly to turn it on.'
            : `Not applied: ${result.reason}`,
        );
        return;
      }
      toast.success(enabled ? "Live trading enabled for this wallet" : "Live trading disabled");
      setPhrase("");
      await queryClient.invalidateQueries({ queryKey: ["trading-wallet"] });
      await queryClient.invalidateQueries({ queryKey: ["solana-wallet"] });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel
      title="LIVE TRADING"
      aside={
        <span className={`text-xs ${wallet?.liveExecutionEnabled ? "text-bearish" : "text-muted-foreground"}`}>
          {wallet?.liveExecutionEnabled ? "ENABLED" : "DISABLED"}
        </span>
      }
    >
      <p className="text-xs text-muted-foreground">
        Live trading is off for every new wallet, even after funding. Once enabled, trades are executed with real funds and
        are irreversible after they confirm on Solana.
      </p>
      {wallet?.firstLiveTradeCompleted === false ? (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-2 text-xs text-warning">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0" />
          First-trade safety mode: one open position at a time until a live trade has executed and reconciled.
        </p>
      ) : null}

      {wallet?.liveExecutionEnabled ? (
        <Button className="mt-4" size="sm" variant="outline" disabled={busy} onClick={() => void apply(false)}>
          DISABLE LIVE TRADING
        </Button>
      ) : (
        <div className="mt-4 flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Type ENABLE LIVE TRADING</Label>
            <Input className="h-9 w-56" value={phrase} onChange={(e) => setPhrase(e.target.value)} placeholder="ENABLE LIVE TRADING" />
          </div>
          <Button size="sm" disabled={busy || !wallet?.provisioned} onClick={() => void apply(true)}>
            ENABLE LIVE TRADING
          </Button>
        </div>
      )}
    </Panel>
  );
}

// ------------------------------------------------------------------- history
export function DepositTable() {
  const { data } = useTradingWallet();
  const rows = data?.deposits ?? [];
  return (
    <Panel title="DEPOSITS" aside={<span className="text-xs text-muted-foreground">Confirmed on-chain</span>}>
      {!rows.length ? (
        <NotConnected title="NO DEPOSITS RECORDED" detail="Deposits appear once they are confirmed on Solana." />
      ) : (
        <div className="overflow-x-auto">
          <table className="hunter-table">
            <thead>
              <tr>
                <th>ASSET</th><th>AMOUNT</th><th>FROM</th><th>SLOT</th><th>STATUS</th><th>SIGNATURE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((d) => (
                <tr key={d.id}>
                  <td>{d.asset}</td>
                  <td className="text-bullish">{amount(Number(d.amount), 6)}</td>
                  <td className="font-mono">{short(d.sender)}</td>
                  <td>{d.slot ?? "—"}</td>
                  <td>{d.confirmation_status}</td>
                  <td className="font-mono">{short(d.signature)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

export function WithdrawalTable() {
  const { data } = useTradingWallet();
  const rows = data?.withdrawals ?? [];
  return (
    <Panel title="WITHDRAWALS" aside={<span className="text-xs text-muted-foreground">User-authorised only</span>}>
      {!rows.length ? (
        <NotConnected title="NO WITHDRAWALS" detail="Withdrawals require your explicit confirmation each time." />
      ) : (
        <div className="overflow-x-auto">
          <table className="hunter-table">
            <thead>
              <tr>
                <th>ASSET</th><th>AMOUNT</th><th>DESTINATION</th><th>STATUS</th><th>DETAIL</th><th>SIGNATURE</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((w) => (
                <tr key={w.id}>
                  <td>{w.asset}</td>
                  <td>{amount(Number(w.amount), 6)}</td>
                  <td className="font-mono">{short(w.destination)}</td>
                  <td>{w.status}</td>
                  <td className="text-muted-foreground">{w.rejection_reason ?? w.error_message ?? "—"}</td>
                  <td className="font-mono">{short(w.signature)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
