export type Token = {
  symbol: string; name: string; address: string; price: string; marketCap: number; liquidity: number;
  change5m: number; change1h: number; volume: number; smartMoney: number; holders: number;
  hunterScore: number; signal: "BUY" | "WATCH" | "CAUTION"; age: number; x: number; y: number;
};

const symbols = ["ABC","BONK","WIF","DOG","PEPE","MOON","NOVA","FROG","CHAD","PONK","SOLX","BORK","MEW","POPCAT","SLERF","MUMU","WEN","MYRO","PENG","GIGA","RETRO","BULL","BYTE","ZAP","HYPE","FLUX","NOM","RUNE","PIXEL","AURA","KRAKEN","DINO"];
export const tokens: Token[] = symbols.map((symbol, i) => ({
  symbol, name: `${symbol} Protocol`, address: `${(8 + i).toString(16)}x${symbol.toLowerCase()}...${(9021 + i * 37).toString(16)}`,
  price: i % 4 === 0 ? `$${(0.00021 + i * 0.000013).toFixed(5)}` : `$${(0.012 + i * 0.0031).toFixed(4)}`,
  marketCap: 78_000 + ((i * 97_331) % 1_420_000), liquidity: 28_000 + ((i * 31_751) % 340_000),
  change5m: ((i * 17) % 73) - 24, change1h: ((i * 29) % 151) - 42, volume: 35_000 + ((i * 71_113) % 680_000),
  smartMoney: 52 + ((i * 11) % 47), holders: 614 + ((i * 487) % 8_800), hunterScore: 57 + ((i * 13) % 42),
  signal: i % 5 === 0 ? "CAUTION" : i % 3 === 0 ? "WATCH" : "BUY", age: 1 + ((i * 9) % 92),
  x: 70 + ((i * 137) % 790), y: 65 + ((i * 83) % 420),
}));

export type RelationType = "Smart Money" | "Wallet" | "Correlation" | "Cluster" | "Liquidity";
export const relationships: { from: string; to: string; type: RelationType }[] = tokens.slice(1).map((token, i) => ({
  from: tokens[(i * 7) % (i + 1)]?.symbol ?? "ABC", to: token.symbol,
  type: (["Smart Money", "Wallet", "Correlation", "Cluster", "Liquidity"] as const)[i % 5] ?? "Cluster",
}));

export const portfolio = [
  { label: "Portfolio", value: "$247.81", trend: "+4.2%", tone: "neutral" },
  { label: "Today’s P&L", value: "+$18.42", trend: "+8.03%", tone: "positive" },
  { label: "Open positions", value: "4", trend: "2 in profit", tone: "neutral" },
  { label: "Win rate", value: "61.4%", trend: "44 trades", tone: "positive" },
  { label: "Hunter score", value: "87", trend: "Top 8%", tone: "ai" },
  { label: "Trades today", value: "37", trend: "Paper fills", tone: "neutral" },
];

export const signals = [
  { type: "SMART MONEY DETECTED", token: "$ABC", detail: "3 tracked wallets entered", score: 91, time: "2m ago", tone: "positive" },
  { type: "MOMENTUM ALERT", token: "$NOVA", detail: "5M volume +184%", score: 87, time: "1m ago", tone: "ai" },
  { type: "LIQUIDITY ALERT", token: "$DOG", detail: "Liquidity +31%", score: 82, time: "34s ago", tone: "warning" },
  { type: "WALLET CLUSTER", token: "$WIF", detail: "5 wallets accumulating", score: 89, time: "4m ago", tone: "positive" },
  { type: "RISK CHANGE", token: "$FROG", detail: "Holder concentration rising", score: 63, time: "7m ago", tone: "negative" },
];

export const wallets = Array.from({ length: 8 }, (_, i) => ({
  id: `WALLET ${String(i + 1).padStart(2, "0")}`, address: `${["7Fk2","Ax91","Bs44","Kw72","Pv03","Lm88","Qr12","Zu69"][i]}...${9120 + i * 73}`,
  score: 92 - i * 3, winRate: `${74 - i * 2.4}%`, pnl: `+$${(18_420 - i * 1_137).toLocaleString()}`,
  positions: 3 + (i % 4), buys: 12 - i, sells: 8 - Math.floor(i / 2), tokens: ["ABC", "WIF", "NOVA", "DOG"].slice(0, 2 + (i % 3)),
}));

export const positions = [
  { token: "$ABC", entry: "$0.00020", current: "$0.00037", size: "$15.00", pnl: "+$12.75", pnlPct: "+85.0%", score: 91, strategy: "MOMENTUM", tp: "2.0x", sl: "-20%", status: "RUNNING" },
  { token: "$WIF", entry: "$1.82", current: "$2.04", size: "$12.00", pnl: "+$1.45", pnlPct: "+12.1%", score: 88, strategy: "SMART MONEY", tp: "1.8x", sl: "-18%", status: "RUNNING" },
  { token: "$NOVA", entry: "$0.084", current: "$0.079", size: "$10.00", pnl: "-$0.60", pnlPct: "-6.0%", score: 84, strategy: "NEW LAUNCH", tp: "2.2x", sl: "-15%", status: "WATCH" },
  { token: "$DOG", entry: "$0.0021", current: "$0.0029", size: "$10.00", pnl: "+$3.81", pnlPct: "+38.1%", score: 82, strategy: "LIQUIDITY", tp: "2.0x", sl: "-20%", status: "RUNNING" },
];

export const trades = Array.from({ length: 14 }, (_, i) => ({
  time: `${String(15 - Math.floor(i / 3)).padStart(2, "0")}:${String((i * 17) % 60).padStart(2, "0")}`,
  token: `$${symbols[(i * 3) % symbols.length]}`, side: i % 4 === 0 ? "SELL" : "BUY", entry: `$${(0.0012 + i * .00031).toFixed(5)}`,
  exit: `$${(0.0014 + i * .00034).toFixed(5)}`, size: `$${10 + (i % 4) * 5}`, pnl: i % 4 === 2 ? `-$${(1.1 + i * .17).toFixed(2)}` : `+$${(2.4 + i * .61).toFixed(2)}`,
  strategy: ["MOMENTUM", "SMART MONEY", "LIQUIDITY"][i % 3], reason: ["TAKE PROFIT", "TRAILING STOP", "RISK EXIT"][i % 3],
}));

export const aiEvents = ["Scanning new Solana tokens…", "Analyzing Smart Money clusters…", "Evaluating liquidity depth…", "Ranking opportunities…", "Checking holder concentration…", "Recalculating Hunter Scores…"];
export const pnlSeries = [4, 7, 5, 11, 9, 16, 14, 21, 19, 27, 25, 34, 31, 42, 47, 44, 58, 62, 71, 68, 82];