# Hunter 2X Dashboard

Build the FRONTEND ONLY for a crypto trading intelligence platform called HUNTER 2X.

IMPORTANT:
This first phase is FRONTEND ONLY.

Do NOT build:

GMGN integration

GMGN Skills

Solana wallet integration

Real trading

Blockchain transactions

Private-key handling

Real authentication

Real API integrations

Real market-data connections

Backend trading logic

Use realistic MOCK DATA throughout the interface so the application looks fully populated and functional.

The backend and integrations will be added in later phases.

================================================== PRODUCT CONCEPT

HUNTER 2X is an AI-powered Solana memecoin discovery and automated trading platform.

The application continuously discovers tokens, analyzes their behavior, identifies Smart Money activity and ranks trading opportunities.

The primary visual identity should be inspired by:

crypto bubble maps

token relationship graphs

on-chain intelligence terminals

futuristic trading dashboards

dark Web3 interfaces

network graphs

glowing nodes

connected token clusters

The application should feel like a combination of:

Bubble Maps
+
GMGN
+
TradingView
+
on-chain intelligence terminal

But do NOT copy any company’s exact UI.

================================================== VISUAL STYLE

Use a dark crypto-native aesthetic.

Primary background:
dark aurora / deep royal colors.

Use subtle gradients and glow effects.

The most important visual element is the BUBBLE MAP.

The interface should contain:

circular token bubbles

connected bubbles

animated connections

token clusters

wallet nodes

Smart Money nodes

liquidity bubbles

floating signal indicators

Avoid excessive neon colors.

Use color primarily to communicate meaning:

GREEN = bullish / buying / profit
RED = bearish / selling / loss
YELLOW = warning
BLUE/PURPLE = AI / intelligence / neutral system state
GRAY = inactive

Keep the interface professional rather than looking like a gaming website.

Use glassmorphism selectively.

Use subtle blur.

Use thin borders.

Use small glowing indicators.

Typography should be clean, compact and highly readable.

================================================== GLOBAL LAYOUT

Create a persistent application shell.

Desktop layout:

LEFT SIDEBAR
CENTER CONTENT
RIGHT INTELLIGENCE PANEL

Top navigation should contain:

HUNTER 2X logo

Bot status:
● PAPER MODE

Wallet status:
NOT CONNECTED

System status:
ONLINE

User/settings icon

================================================== LEFT SIDEBAR

Navigation:

Overview
Hunter Map
Token Scanner
Smart Money
Positions
Trade History
Strategies
Risk
Wallet
AI Agent
Settings

At the bottom:

BOT STATUS

PAPER MODE

[START HUNTER]

Do not actually start anything.

This is a frontend interaction only.

================================================== MAIN OVERVIEW

The Overview page should be the main screen.

At the top:

HUNTER 2X

“AI-powered Solana opportunity detection”

Status:

● SYSTEM ONLINE

PAPER MODE

Below that show summary cards:

PORTFOLIO

$247.81

TODAY’S P&L

+$18.42
+8.03%

OPEN POSITIONS

4

WIN RATE

61.4%

HUNTER SCORE

87

TRADES TODAY

37

Use mock data.

================================================== PRIMARY BUBBLE MAP

Make the BUBBLE MAP the centerpiece of the dashboard.

Large interactive visualization.

Display approximately 25-40 token bubbles.

Each bubble represents a token.

Bubble size should represent configurable metrics such as:

market cap

liquidity

volume

Smart Money activity

Allow the user to switch:

SIZE BY:
Market Cap
Liquidity
Volume
Smart Money

Each bubble should display:

Token symbol

Example:

$ABC

$BONK

$WIF

$DOG

$PEPE

$MOON

Use fictional/mock token addresses and data where appropriate.

DO NOT imply the displayed data is live.

Use a small:

DEMO DATA

label.

================================================== BUBBLE MAP INTERACTIONS

When hovering over a token:

Show tooltip:

Token
Price
Market Cap
Liquidity
5M change
Volume
Smart Money score
Hunter score

When clicking a bubble:

Open a detailed token panel.

The selected bubble should visually expand/highlight.

Draw connections to related bubbles.

================================================== BUBBLE RELATIONSHIPS

Create visual connections representing:

Smart Money overlap
Wallet overlap
Trading correlation
Token cluster
Liquidity relationship

Different relationship types should have different subtle visual treatments.

Example:

TOKEN A
│
├──── TOKEN B
│
├──── TOKEN C
│
└──── TOKEN D

The visualization should feel like an on-chain network graph.

Allow:

Zoom
Pan
Reset view

Add controls:

zoom

zoom

RESET

FILTER

================================================== MAP FILTERS

Add floating filter controls above the bubble map.

Filters:

ALL

NEW LAUNCHES

SMART MONEY

MOMENTUM

HIGH LIQUIDITY

HIGH VOLUME

AI SIGNAL

WATCHLIST

Also add:

Minimum Hunter Score

Liquidity

Market Cap

Token Age

================================================== RIGHT INTELLIGENCE PANEL

Create a right-side panel called:

AI INTELLIGENCE

Show live-looking mock events.

Example:

SMART MONEY DETECTED

$ABC

3 tracked wallets entered

Hunter Score
91

2 minutes ago

MOMENTUM ALERT

$XYZ

5M volume +184%

Hunter Score
87

1 minute ago

LIQUIDITY ALERT

$DOG

Liquidity +31%

Hunter Score
82

34 seconds ago

Use animated status indicators.

================================================== TOKEN SCANNER

Create a Token Scanner page.

Table columns:

Token
Price
Market Cap
Liquidity
5M
1H
Volume
Smart Money
Holders
Hunter Score
Signal

Example:

$ABC
$0.00042
$145K
$62K
+38%
+92%
$84K
91
1,284
92
BUY

Use mock data.

Add sorting.

Add search.

Add filters.

Add pagination.

================================================== TOKEN DETAIL PANEL

When a token is selected, display:

Token symbol

Token address

Price

Market Cap

Liquidity

Volume

Holders

Smart Money Score

Hunter Score

5M chart

15M chart

1H chart

Buy/Sell ratio

Top holders

Smart Money wallets

Recent activity

AI analysis

Create a large:

HUNTER SCORE

91/100

visual gauge.

Below it:

SIGNAL

HIGH CONVICTION

Again, this is mock data only.

================================================== SMART MONEY PAGE

Create a Smart Money intelligence page.

Show:

Top wallets

Wallet score

Win rate

P&L

Current positions

Recent buys

Recent sells

Tokens traded

Create wallet bubbles.

Example:

WALLET 01
92 SCORE

WALLET 02
88 SCORE

WALLET 03
84 SCORE

Clicking a wallet opens its intelligence panel.

================================================== POSITIONS PAGE

Create an Open Positions page.

Columns:

Token
Entry
Current
Position Size
P&L
P&L %
Hunter Score
Strategy
TP
SL
Status

Use mock positions.

Example:

$ABC
$0.0002
$0.00037
$15
+$12.75
+85%
91
MOMENTUM
2.0x
-20%
RUNNING

Add a visual P&L chart.

================================================== TRADE HISTORY

Create a Trade History page.

Show:

Time
Token
Side
Entry
Exit
Size
P&L
Strategy
Exit reason

Use realistic mock trades.

Add:

Win rate

Average winner

Average loser

Profit factor

Total P&L

Maximum drawdown

================================================== STRATEGY BUILDER

Create a strategy configuration interface.

Title:

STRATEGY BUILDER

Default strategy:

HUNTER 2X

Settings:

Hunter Score
80

Minimum Liquidity
$50,000

Smart Money Score
75

Position Size
$10

Maximum Positions
5

Take Profit
2.00x

Stop Loss
20%

Trailing Stop
ON/OFF

Partial TP
ON/OFF

Allow New Launches
ON/OFF

Allow Smart Money Signals
ON/OFF

Allow Momentum Signals
ON/OFF

All controls should visually work.

Do not connect them to a backend yet.

================================================== RISK PAGE

Create:

RISK MANAGEMENT

Maximum Daily Loss
$50

Maximum Trade Loss
$10

Maximum Positions
5

Maximum Exposure
$50

Maximum Slippage
5%

Consecutive Loss Limit
5

Show:

DAILY RISK

$18.42 / $50

progress indicator.

Add:

BOT HEALTH

SAFE

================================================== WALLET PAGE

Create the frontend interface for the future wallet system.

Do NOT connect an actual wallet yet.

Display:

TRADING WALLET

NOT CONNECTED

[CONNECT WALLET]

Balance

Available

In Positions

P&L

Also create:

VAULT WALLET

NOT CONNECTED

[CONNECT]

Keep this page visually complete even though the actual integration comes later.

================================================== AI AGENT PAGE

Create an AI Agent control page.

Header:

HUNTER AI

Status:

● READY

Display:

AI MODEL

Connected later

GMGN AGENT

NOT CONNECTED

MARKET INTELLIGENCE

WAITING FOR DATA

Create a conversational-looking activity stream.

Example:

“Scanning new Solana tokens…”

“Analyzing Smart Money…”

“Evaluating liquidity…”

“Ranking opportunities…”

These are mock events.

Do NOT connect an actual AI API yet.

================================================== SETTINGS

Create:

Appearance

Notifications

Trading preferences

Data preferences

Risk preferences

Bot preferences

About

================================================== BOTTOM STATUS BAR

Add a persistent bottom status bar.

Show:

NETWORK
SOLANA

DATA
DEMO

BOT
PAPER

GMGN
NOT CONNECTED

WALLET
NOT CONNECTED

SYSTEM
ONLINE

================================================== RESPONSIVE DESIGN

Desktop is the primary experience.

Also support tablet and mobile.

On mobile:

Collapse sidebar.

Bubble map remains the centerpiece.

Right intelligence panel becomes a bottom drawer.

Tables become horizontally scrollable cards.

================================================== ANIMATION

Use subtle animations.

Bubble nodes should gently pulse.

New intelligence events should fade in.

Selected tokens should glow subtly.

Connections should animate slowly.

Avoid excessive animation that makes the interface difficult to use.

Performance is important.

================================================== COMPONENT STRUCTURE

Create reusable components:

BubbleMap
TokenBubble
TokenTooltip
TokenDetailPanel
SmartMoneyBubble
SignalFeed
HunterScore
MetricCard
TokenTable
PositionTable
StrategyPanel
RiskPanel
WalletPanel
AIActivityFeed
StatusBar
Sidebar
TopBar

Keep components modular so backend functionality can be connected later.

================================================== MOCK DATA

Create centralized mock data.

Do NOT scatter hardcoded fake values throughout components.

Create mock datasets for:

tokens
wallets
signals
positions
trades
portfolio
risk
AI events

Clearly label the application:

DEMO DATA

Do not make claims that the data is live.

================================================== IMPORTANT

This phase is ONLY the frontend.

Do not create:

GMGN API calls
GMGN Skills
Solana transactions
Wallet signing
Private keys
Seed phrases
Supabase database logic
Real authentication
Live trading

Prepare the UI and component architecture so those systems can be plugged in cleanly in subsequent phases.

The final result should look like a polished, premium, futuristic crypto intelligence terminal centered around a beautiful interactive bubble-map visualization.

This project was built with [Lovable](https://lovable.dev).

**Live app**: https://hunter-map-ai.lovable.app

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/773445d0-f0b8-4d47-8f0b-73c363ad5470).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm — [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
