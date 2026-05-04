import Decimal from "decimal.js";
import { Keypair } from "@solana/web3.js";
import {
    dexPaperBidUsd,
    fetchDexPairPriceUsd,
    normalizeDexScreenerPairId,
    resolveDexTokenForStack,
    resolveDexTokenFromAddress,
    scanTopSignalsDexscreener,
    tokenSignalFromDexPairForStack,
} from "./dexscreenerScan";
import { BookTickerUpdate, marketStream } from "./marketStream";
import { normalizeBotMinEntryChartTimeframes, type MinEntryChartTimeframe } from "./minEntryChart";
import {
    normalizeLiquidityGuard,
    normalizeMaxMarketCapUsd,
    normalizeMinMarketCapUsd,
    scanTopSignals,
    TimeframeKey,
    TokenSignal,
    tokenPassesMinEntryCharts,
    type EntryGuardOptions,
    type LiquidityGuardMode,
} from "./scanner";
import { createBotStore } from "./storage";
import { decideExit, type ExitDecision, type ExitDecisionTradeSnapshot, type ExitRules } from "./trading/exitDecision";
import { TradeEngine } from "./trading";
import { normalizeWatchWalletAddress } from "./watchWalletAddress";
import { inferMainnetBuyFromTxSignature, inferMainnetSellStableFromTx, type InferredMainnetBuy } from "./solanaInferSwapFromTx";
import { solanaSignatureNetworkFeeUsdt } from "./solanaTxNetworkFee";
import {
    autoSignJupiterBuyUsd,
    autoSignJupiterSellRaw,
    getSolanaConnection,
    loadAutoSignKeypairFromEnv,
} from "./solanaAutoSign";

/** Rolling window for every bot-driven scan (`previewScan` may pass another). Not user-configurable. */
const BOT_SCAN_TIMEFRAME: TimeframeKey = "1h";

/** When `tradeCooldownSeconds` is 0, auto mode uses this spacing (seconds) so scans do not hammer APIs. */
const AUTO_SCAN_FALLBACK_INTERVAL_SEC = 120;
import { fetchSplTokenRawBalanceForOwner } from "./solanaSplTokenBalance";
import { tokenUiAmountToRawExactIn } from "./trading/jupiterSwap";

/** Default Solana address for Wallet on-chain snapshot (read-only). */
const DEFAULT_WATCH_WALLET_ADDRESS = "HxqXijmUcdsm7EdJpmDXYTF95igaVfrXMgcSwGE55gju";

type BotStatus = "stopped" | "running";
type TradeStatus = "open" | "closed";
type ExitReason =
    | "take_profit"
    | "stop_loss"
    | "time_stop"
    | "manual"
    | "break_even"
    | "red_dip"
    | "dip_retrace";

/** Queued Jupiter sell after the same exit rules as paper; user signs in UI. */
export type PendingMainnetSell = {
    createdAt: string;
    sellFraction: number;
    markPriceUsd: number;
    exitKind: "close_full" | "partial";
    partialMode?: "tp_step" | "dip_step" | "dip_retrace";
    stepPercent?: number;
    advanceTpHit?: number;
    advanceDipHit?: number;
    advanceDipRetraceHit?: number;
    closeReason?: ExitReason;
};

/** Normalize legacy `pendingMainnetSell` and `pendingMainnetSells` FIFO queue. */
export function normalizePendingMainnetSells(trade: {
    pendingMainnetSells?: PendingMainnetSell[] | null;
    pendingMainnetSell?: PendingMainnetSell | null;
}): PendingMainnetSell[] {
    if (Array.isArray(trade.pendingMainnetSells) && trade.pendingMainnetSells.length > 0) {
        return trade.pendingMainnetSells.map((p) => ({ ...p }));
    }
    if (trade.pendingMainnetSell) {
        return [{ ...trade.pendingMainnetSell }];
    }
    return [];
}

function pendingMainnetPartialDuplicate(a: PendingMainnetSell, b: PendingMainnetSell): boolean {
    if (a.exitKind !== "partial" || b.exitKind !== "partial") return false;
    return (
        a.partialMode === b.partialMode &&
        Number(a.advanceTpHit) === Number(b.advanceTpHit) &&
        Number(a.advanceDipHit) === Number(b.advanceDipHit) &&
        Number(a.advanceDipRetraceHit) === Number(b.advanceDipRetraceHit)
    );
}

/** Data source for scans; execution stays paper-only. Binance uses REST + WS; DexScreener uses public HTTP only. */
type MarketSource = "binance" | "coinbase" | "kraken" | "bybit" | "dexscreener";

const MARKET_SOURCES = new Set<MarketSource>([
    "binance",
    "coinbase",
    "kraken",
    "bybit",
    "dexscreener",
]);

export function normalizeMarketSource(value: unknown): MarketSource {
    if (typeof value === "string" && MARKET_SOURCES.has(value as MarketSource)) {
        return value as MarketSource;
    }
    return "binance";
}

const DEX_MIN_PAIR_AGE_MINUTES_MIN = 1;
const DEX_MIN_PAIR_AGE_MINUTES_MAX = 24 * 60;
const DEFAULT_DEX_MIN_PAIR_AGE_MINUTES = 30;

export function normalizeDexMinPairAgeMinutes(raw: unknown): number {
    const v = Number(raw);
    if (!Number.isFinite(v)) {
        return DEFAULT_DEX_MIN_PAIR_AGE_MINUTES;
    }
    return Math.max(
        DEX_MIN_PAIR_AGE_MINUTES_MIN,
        Math.min(DEX_MIN_PAIR_AGE_MINUTES_MAX, Math.round(v))
    );
}

export type BotConfig = {
    marketSource: MarketSource;
    autoMode: boolean;
    liquidityCheckRequired: boolean;
    scanLimit: number;
    liquidityGuard: LiquidityGuardMode;
    minFiveMinuteFlowUsdt: number;
    /** Minimum market cap (USD) when MC check is on. */
    minMarketCapUsd: number;
    /** Maximum market cap (USD) for scans and auto entry; `0` = no limit. */
    maxMarketCapUsd: number;
    /** DexScreener scam guard: minimum pool age in whole minutes (default 30). */
    dexMinPairAgeMinutes: number;
    /**
     * Scanner list: token must be strictly up on every selected window (5m–24h) to appear.
     * Default ["5m"].
     */
    minEntryChartTimeframes: MinEntryChartTimeframe[];
    positionSizeUsdt: number;
    takeProfitStepsPercent: number[];
    takeProfitStepSellFraction: number;
    /** Same length as takeProfitStepsPercent = sell that fraction of *remaining* at each step; empty = use takeProfitStepSellFraction for every step. */
    takeProfitStepSellFractions: number[];
    dipStepsPercent: number[];
    dipStepSellFractions: number[];
    /** Retracement of (peak−entry): sell fraction of *remaining* when giveback crosses each threshold. Empty = off (legacy peak dip only after TP). */
    dipRetracementStepsPercent: number[];
    dipRetracementSellFractions: number[];
    /** Skip retracement dip until (peak−entry)/entry×100 is at least this (avoids noisy % when MFE is tiny). */
    minDipRetracementMfeBasisPercent: number;
    stopLossPercent: number;
    maxHoldMinutes: number;
    /**
     * Optional Solana address to show on-chain SOL + USDT in the Wallet UI (e.g. same wallet you use with Trojan).
     * Read-only; does not move funds or sign transactions.
     */
    watchWalletAddress: string;
    /** Second optional Solana watch address (Wallet UI “Solana — W2”). Empty until configured. */
    watchWalletAddressW2: string;
    /** Max slippage % per swap (live / Jupiter-style); paper path uses separate spread model. Default 2%, max 10%. */
    maxSlippagePercent: number;
    /**
     * UI / wallet path only: `paper` = simulated bot + quote preview; `live` = show Solana mainnet signing (Jupiter + Phantom).
     * Does not change paper bot engine behavior.
     */
    executionMode: "paper" | "live";
    /**
     * With `executionMode: live`, attempt server-signed Jupiter for auto entries and pending sells.
     * Requires `SOLANA_AUTO_SIGN_SECRET_KEY` (JSON array of 64 secret key bytes) on the BFF process.
     */
    autoSignMainnet: boolean;
    /**
     * USDT notional for server-signed Jupiter **auto** entries only (live + auto-sign).
     * Same preset grid as Bet Amount ($0.05–$1 by 5¢, then $2–$10).
     */
    autoSignBetUsdt: number;
    /**
     * Minimum seconds after an auto momentum entry before the next auto entry is allowed.
     * Also sets the delay between auto scans when Auto mode is running (0 → 120s fallback for scan spacing only).
     */
    tradeCooldownSeconds: number;
};
export type BotConfigPatch = Partial<BotConfig>;

/** Bot + scanner settings frozen when a paper trade opens (for UI / audit). */
export type TradeSettingsAtOpen = {
    marketSource: MarketSource;
    autoMode: boolean;
    liquidityCheckRequired: boolean;
    scanLimit: number;
    liquidityGuard: LiquidityGuardMode;
    minFiveMinuteFlowUsdt: number;
    minMarketCapUsd: number;
    /** `0` = no cap; omitted on legacy persisted trades. */
    maxMarketCapUsd?: number;
    dexMinPairAgeMinutes: number;
    /** Omitted on trades opened before this field existed — treat as `["5m"]` in UI. */
    minEntryChartTimeframes?: MinEntryChartTimeframe[];
    positionSizeUsdt: number;
    takeProfitStepsPercent: number[];
    takeProfitStepSellFraction: number;
    takeProfitStepSellFractions: number[];
    dipStepsPercent: number[];
    dipStepSellFractions: number[];
    dipRetracementStepsPercent: number[];
    dipRetracementSellFractions: number[];
    minDipRetracementMfeBasisPercent: number;
    stopLossPercent: number;
    maxHoldMinutes: number;
    maxSlippagePercent: number;
    /** Omitted on legacy persisted trades. */
    autoSignBetUsdt?: number;
};

function tradeSettingsAtOpenFromConfig(config: BotConfig): TradeSettingsAtOpen {
    return {
        marketSource: config.marketSource,
        autoMode: config.autoMode,
        liquidityCheckRequired: config.liquidityCheckRequired,
        scanLimit: config.scanLimit,
        liquidityGuard: config.liquidityGuard,
        minFiveMinuteFlowUsdt: config.minFiveMinuteFlowUsdt,
        minMarketCapUsd: config.minMarketCapUsd,
        maxMarketCapUsd: config.maxMarketCapUsd,
        dexMinPairAgeMinutes: config.dexMinPairAgeMinutes,
        minEntryChartTimeframes: [...config.minEntryChartTimeframes],
        positionSizeUsdt: config.positionSizeUsdt,
        takeProfitStepsPercent: [...config.takeProfitStepsPercent],
        takeProfitStepSellFraction: config.takeProfitStepSellFraction,
        takeProfitStepSellFractions: [...config.takeProfitStepSellFractions],
        dipStepsPercent: [...config.dipStepsPercent],
        dipStepSellFractions: [...config.dipStepSellFractions],
        dipRetracementStepsPercent: [...config.dipRetracementStepsPercent],
        dipRetracementSellFractions: [...config.dipRetracementSellFractions],
        minDipRetracementMfeBasisPercent: config.minDipRetracementMfeBasisPercent,
        stopLossPercent: config.stopLossPercent,
        maxHoldMinutes: config.maxHoldMinutes,
        maxSlippagePercent: config.maxSlippagePercent,
        autoSignBetUsdt: config.autoSignBetUsdt,
    };
}

function exitRulesFromTradeSettings(s: TradeSettingsAtOpen): ExitRules {
    return {
        stopLossPercent: s.stopLossPercent,
        takeProfitStepsPercent: [...s.takeProfitStepsPercent],
        takeProfitStepSellFraction: s.takeProfitStepSellFraction,
        takeProfitStepSellFractions: [...s.takeProfitStepSellFractions],
        dipStepsPercent: [...s.dipStepsPercent],
        dipStepSellFractions: [...s.dipStepSellFractions],
        dipRetracementStepsPercent: [...s.dipRetracementStepsPercent],
        dipRetracementSellFractions: [...s.dipRetracementSellFractions],
        minDipRetracementMfeBasisPercent: s.minDipRetracementMfeBasisPercent,
        maxHoldMinutes: s.maxHoldMinutes,
    };
}

type PaperPartialFill = {
    time: string;
    price: number;
    /** Fraction of the position still open before this clip (e.g. 0.25 = sold 25% of remaining). */
    fractionOfRemaining: number;
    quantitySold: number;
    realizedUsdt: number;
    /** USDT notional at exit mark minus simulated sell fee (wallet out differs on mainnet). */
    proceedsUsdt?: number;
    /** Simulated swap-side fee for this clip (same PAPER_FEE_RATE as full sells). */
    feesUsdt?: number;
    /** Mainnet partial/full sell tx (for reference); network fee merged into display via `networkFeeUsdt`. */
    sellTxSignature?: string;
    /** Lamports network fee × SOL/USDT spot (from RPC meta.fee), optional. */
    networkFeeUsdt?: number;
    /**
     * Mainnet: Dex/Binance **mark** when the exit was queued (TP/dip condition used this).
     * `price` becomes the on-chain effective sell price after reconcile — can be lower than this.
     */
    signalMarkUsd?: number;
    mode: "tp_step" | "dip_step" | "dip_retrace";
    stepPercent: number;
    /**
     * Frozen at clip finalization: clip realized USDT ÷ original bet × 100. UI/logs use this so the row
     * does not drift if bet/entry is ever edited; updated once when chain reconcile adjusts `realizedUsdt`.
     */
    clipPnlPercentOfBet?: number;
};

type PaperTrade = {
    id: string;
    status: TradeStatus;
    symbol: string;
    baseAsset: string;
    entryPrice: number;
    quantity: number;
    positionSizeUsdt: number;
    openedAt: string;
    currentPrice: number;
    pnlPercent: number;
    pnlUsdt: number;
    /** Mark-to-market on remaining size only (excludes realized clips). */
    unrealizedPnlUsdt: number;
    realizedPnlUsdt: number;
    peakPrice: number;
    takeProfitStepsHit: number[];
    dipStepsHit: number[];
    dipRetracementStepsHit: number[];
    exitPrice?: number;
    closedAt?: string;
    exitReason?: ExitReason;
    entryMode?: "auto" | "manual";
    entryTimeframe?: TimeframeKey;
    entryGainPercent?: number | null;
    entryFiveMinuteChangePercent?: number | null;
    entryReason?: string;
    totalFeesUsdt?: number;
    maxHoldMinutesAtEntry?: number;
    /** When set, mark price from DexScreener pair endpoint (paper); Binance book stream is not used. */
    dexPaperPriceRef?: { chainId: string; pairAddress: string };
    /** Chart deep link (Dex pair page or Binance spot URL from last scan). */
    chartUrl?: string;
    /** Staged take-profit / dip partial sells for this open or closed trade. */
    partialFills?: PaperPartialFill[];
    /** Config used when this trade was opened (not live edits afterward). */
    settingsAtOpen?: TradeSettingsAtOpen;
    /** Default paper; mainnet legs use Jupiter for sells. */
    executionChannel?: "paper" | "mainnet";
    solanaOutputMint?: string;
    tokenDecimals?: number;
    mainnetBuyTxSignature?: string;
    /** @deprecated Mirror of `pendingMainnetSells[0]` for older clients; prefer `pendingMainnetSells`. */
    pendingMainnetSell?: PendingMainnetSell | null;
    /** FIFO: sign the first item in Run Bot; further exits keep queueing while price moves. */
    pendingMainnetSells?: PendingMainnetSell[];
};

/**
 * Mainnet `close_full`: if the signed swap’s token-in raw decodes to at least this fraction of the bot’s
 * remaining `trade.quantity`, treat the leg as fully closed. A near-zero slack (1e-12) left users stuck:
 * chain/Jupiter amounts are often slightly below the bot’s notion of qty (decimals, rounding, wallet cap),
 * so ~99.8% sold still left an open leg, an empty wallet (“no tokens left”), and exit rules re-queued sells.
 */
const MAINNET_CLOSE_FULL_MIN_SELL_FRACTION = 0.995;

/** Map exact-in raw amount from Jupiter build to a fraction of `trade.quantity` for bot accounting (wallet-capped sells). */
function mainnetSellFractionFromInputRaw(
    trade: PaperTrade,
    pending: PendingMainnetSell,
    inputAmountRaw?: string | null
): { sellFraction: number; minCloseFraction: number } {
    const defaultPartial = {
        sellFraction: Math.min(1, Math.max(0, pending.sellFraction)),
        minCloseFraction: 0.05,
    };
    const defaultFull = { sellFraction: 1, minCloseFraction: 0.05 };

    const rawOpt = typeof inputAmountRaw === "string" ? inputAmountRaw.trim() : "";
    if (!rawOpt || !(trade.quantity > 0)) {
        return pending.exitKind === "close_full" ? defaultFull : defaultPartial;
    }
    let rawB: bigint;
    try {
        rawB = BigInt(rawOpt);
    } catch {
        return pending.exitKind === "close_full" ? defaultFull : defaultPartial;
    }
    if (rawB <= 0n) {
        return pending.exitKind === "close_full" ? defaultFull : defaultPartial;
    }
    const decRaw = trade.tokenDecimals ?? 6;
    const dec = Number.isFinite(decRaw) ? Math.max(0, Math.min(18, Math.floor(decRaw))) : 6;
    const actualUi = Number(rawB) / 10 ** dec;
    if (!Number.isFinite(actualUi) || actualUi <= 0) {
        return pending.exitKind === "close_full" ? defaultFull : defaultPartial;
    }
    const fracOfRemaining = Math.min(1, actualUi / trade.quantity);
    if (pending.exitKind === "close_full") {
        return {
            sellFraction: fracOfRemaining,
            minCloseFraction: fracOfRemaining < 0.05 ? 0 : 0.05,
        };
    }
    const capped = Math.min(pending.sellFraction, fracOfRemaining);
    return {
        sellFraction: capped,
        minCloseFraction: capped < 0.05 ? 0 : 0.05,
    };
}

/** Exit evaluation uses each leg's frozen snapshot when present; otherwise live bot config (legacy trades). */
function exitRulesForTrade(trade: PaperTrade, live: BotConfig): TradeSettingsAtOpen {
    if (trade.settingsAtOpen) {
        return trade.settingsAtOpen;
    }
    return tradeSettingsAtOpenFromConfig(live);
}

function englishOrdinal(n: number): string {
    const i = Math.floor(n);
    const j = i % 10;
    const k = i % 100;
    if (j === 1 && k !== 11) return `${i}st`;
    if (j === 2 && k !== 12) return `${i}nd`;
    if (j === 3 && k !== 13) return `${i}rd`;
    return `${i}th`;
}

/** Rich copy for mainnet Jupiter FIFO partial logs (which TP/dip step and full ladder). */
function pendingPartialTriggerLabel(p: PendingMainnetSell): string {
    if (p.exitKind !== "partial") return p.exitKind;
    const pm = p.partialMode ?? "tp_step";
    if (pm === "tp_step") return `upward TP +${p.stepPercent}% (total PnL vs bet at mark)`;
    if (pm === "dip_step") return `peak drawdown ${p.stepPercent}% off high`;
    return `MFE retracement ${p.stepPercent}% of entry→peak move`;
}

function describeQueuedMainnetPartialExit(
    decision: Extract<ExitDecision, { kind: "partial" }>,
    trade: PaperTrade,
    config: BotConfig
): string {
    const settings = exitRulesForTrade(trade, config);
    const fracPct = Math.round(decision.requestedFraction * 1000) / 10;
    const sellFrag =
        Number.isFinite(fracPct) && fracPct > 0
            ? `~${fracPct}% of remaining leg`
            : `${(decision.requestedFraction * 100).toFixed(1)}% of remaining leg`;

    if (decision.mode === "tp_step") {
        const tpSteps = settings.takeProfitStepsPercent;
        const stepVal = Number(decision.advanceTpHit ?? decision.stepPercent);
        const idx = tpSteps.findIndex((s) => Number(s) === stepVal);
        const ord = idx >= 0 ? englishOrdinal(idx + 1) : null;
        const headline =
            ord != null
                ? `${ord} take-profit at +${stepVal}% total PnL (${sellFrag})`
                : `take-profit at +${stepVal}% total PnL (${sellFrag})`;
        if (tpSteps.length === 0) return headline;
        const schedule = tpSteps.map((s, i) => `${englishOrdinal(i + 1)} +${s}%`).join(", ");
        return `${headline}. TP schedule: ${schedule}.`;
    }

    if (decision.mode === "dip_step") {
        const dipSteps = settings.dipStepsPercent;
        const stepVal = Number(decision.advanceDipHit ?? decision.stepPercent);
        const idx = dipSteps.findIndex((s) => Number(s) === stepVal);
        const ord = idx >= 0 ? englishOrdinal(idx + 1) : null;
        const headline =
            ord != null
                ? `${ord} peak-drawdown sell at ${stepVal}% off peak (${sellFrag})`
                : `peak-drawdown sell at ${stepVal}% off peak (${sellFrag})`;
        if (dipSteps.length === 0) return headline;
        const schedule = dipSteps.map((s, i) => `${englishOrdinal(i + 1)} ${s}%`).join(", ");
        return `${headline}. Dip schedule: ${schedule}.`;
    }

    const retrSteps = settings.dipRetracementStepsPercent;
    const stepVal = Number(decision.advanceDipRetraceHit ?? decision.stepPercent);
    const idx = retrSteps.findIndex((s) => Number(s) === stepVal);
    const ord = idx >= 0 ? englishOrdinal(idx + 1) : null;
    const headline =
        ord != null
            ? `${ord} retracement sell at ${stepVal}% giveback of peak−entry move (${sellFrag})`
            : `retracement sell at ${stepVal}% giveback (${sellFrag})`;
    if (retrSteps.length === 0) return headline;
    const schedule = retrSteps.map((s, i) => `${englishOrdinal(i + 1)} ${s}%`).join(", ");
    return `${headline}. Retrace schedule: ${schedule}.`;
}

type BotLog = {
    time: string;
    level: "info" | "warn" | "error";
    message: string;
};

export type BotState = {
    status: BotStatus;
    mode: "paper";
    config: BotConfig;
    /** ISO timestamp of last auto momentum open (paper or mainnet); used with `tradeCooldownSeconds`. */
    lastMomentumTradeOpenedAt?: string | null;
    /** All open paper legs (same or different symbols). */
    activeTrades: PaperTrade[];
    /** First open leg — kept in sync with activeTrades[0] for older UI/clients. */
    activeTrade: PaperTrade | null;
    lastScanTokens: TokenSignal[];
    tradeHistory: PaperTrade[];
    logs: BotLog[];
    lastScanAt: string | null;
    nextScanAt: string | null;
    lastScanTimeframe: TimeframeKey;
    /**
     * Auto mode only: user sets an auto-entry token here before the bot will open a position.
     * Cleared after a successful auto entry, when cleared from UI, when auto mode is turned off, or on stop.
     */
    autoEntryTarget: { symbol: string; contractAddress?: string } | null;
};

const MAX_CONCURRENT_OPEN_TRADES = 2;

function scanTokenDedupeKey(t: TokenSignal): string {
    const mint = String(t.metadata?.contractAddress ?? "").trim().toLowerCase();
    if (mint) return `mint:${mint}`;
    return `sym:${String(t.symbol ?? "")}`;
}

/**
 * Keep user-pasted Dex tokens in the scan list across auto refreshes. When the same pair appears in a fresh scan,
 * use the fresh row but retain `addedByUserAddress` so it stays prioritized ahead of the rest of the board.
 */
function mergeUserPinnedWithScanTokens(pinned: TokenSignal[], fromScan: TokenSignal[]): TokenSignal[] {
    const scanByKey = new Map(fromScan.map((x) => [scanTokenDedupeKey(x), x]));
    const mergedPinned: TokenSignal[] = [];
    const usedPinnedKeys = new Set<string>();
    for (const p of pinned) {
        const k = scanTokenDedupeKey(p);
        if (usedPinnedKeys.has(k)) continue;
        usedPinnedKeys.add(k);
        const fresh = scanByKey.get(k);
        if (fresh) {
            mergedPinned.push({
                ...fresh,
                metadata: { ...fresh.metadata, addedByUserAddress: true },
            });
        } else {
            mergedPinned.push(p);
        }
    }
    const mergedKeys = new Set(mergedPinned.map(scanTokenDedupeKey));
    const rest = fromScan.filter((t) => !mergedKeys.has(scanTokenDedupeKey(t)));
    return [...mergedPinned, ...rest];
}

function migrateOpenTradesFromParsed(parsed: {
    activeTrades?: PaperTrade[];
    activeTrade?: PaperTrade | null;
}): PaperTrade[] {
    if (Array.isArray(parsed.activeTrades) && parsed.activeTrades.length > 0) {
        return parsed.activeTrades.filter((t) => t && t.status === "open");
    }
    if (parsed.activeTrade && parsed.activeTrade.status === "open") {
        return [parsed.activeTrade];
    }
    return [];
}

const MIN_DIP_RETRACE_MOVE_PERCENT_CHOICES = [5, 10, 20, 30, 50, 80, 100] as const;

/** Whole percents for min (peak−entry)/entry×100 before arming downward retracement; snaps to UI choices. */
function snapMinDipRetracementMfeBasisPercent(raw: unknown): number {
    let v = Number(raw);
    if (!Number.isFinite(v) || v < 0) {
        v = 5;
    }
    if (v > 0 && v < 1) {
        v = Math.min(100, Math.max(5, Math.round(v * 100)));
    }
    v = Math.max(0, Math.min(100, v));
    return [...MIN_DIP_RETRACE_MOVE_PERCENT_CHOICES].reduce((best, candidate) =>
        Math.abs(candidate - v) <= Math.abs(best - v) ? candidate : best
    );
}

/** Max affordable loss (UI). Only these exact values are accepted; anything else → 5%. */
const STOP_LOSS_PERCENT_UI_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20] as const;

function normalizeStopLossPercent(raw: unknown): number {
    const v = Number(raw);
    if (!Number.isFinite(v)) {
        return 5;
    }
    for (const choice of STOP_LOSS_PERCENT_UI_CHOICES) {
        if (Math.abs(v - choice) < 1e-6) {
            return choice;
        }
    }
    return 5;
}

const DEFAULT_CONFIG: BotConfig = {
    marketSource: "binance",
    autoMode: false,
    liquidityCheckRequired: false,
    scanLimit: 20,
    liquidityGuard: "both",
    minFiveMinuteFlowUsdt: 30_000,
    minMarketCapUsd: 1_000_000,
    maxMarketCapUsd: 0,
    dexMinPairAgeMinutes: DEFAULT_DEX_MIN_PAIR_AGE_MINUTES,
    minEntryChartTimeframes: ["5m"],
    positionSizeUsdt: 5,
    takeProfitStepsPercent: [1.5, 3, 4.5, 6],
    takeProfitStepSellFraction: 0.25,
    takeProfitStepSellFractions: [],
    /** Peak drawdown % off high — matches Run Bot “Take profit (downward)” Balanced preset. */
    dipStepsPercent: [10, 15, 20, 25, 30, 40],
    dipStepSellFractions: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    /** MFE retracement (advanced); UI presets keep this empty and use dipSteps only. */
    dipRetracementStepsPercent: [],
    dipRetracementSellFractions: [],
    /** Min (peak−entry)/entry×100 (whole percent, e.g. 5 = 5%) before downward retracement rules apply. */
    minDipRetracementMfeBasisPercent: 5,
    stopLossPercent: 5,
    maxHoldMinutes: 30,
    watchWalletAddress: DEFAULT_WATCH_WALLET_ADDRESS,
    watchWalletAddressW2: "",
    maxSlippagePercent: 2,
    executionMode: "paper",
    autoSignMainnet: false,
    autoSignBetUsdt: 0.2,
    tradeCooldownSeconds: 0,
};

/** USDT bet presets: $0.05…$1.00 in 5¢ steps, then $2…$10 (keep in sync with UI `betAmountOptions.js`). */
const POSITION_SIZE_USDT_CHOICES: readonly number[] = (() => {
    const out: number[] = [];
    for (let i = 1; i <= 20; i += 1) {
        out.push(Number((i * 0.05).toFixed(2)));
    }
    for (let x = 2; x <= 10; x += 1) {
        out.push(x);
    }
    return out;
})();

function normalizePositionSizeUsdt(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        return DEFAULT_CONFIG.positionSizeUsdt;
    }
    let best = POSITION_SIZE_USDT_CHOICES[0]!;
    let bestDist = Math.abs(best - n);
    for (const v of POSITION_SIZE_USDT_CHOICES) {
        const d = Math.abs(v - n);
        if (d < bestDist) {
            best = v;
            bestDist = d;
        }
    }
    return best;
}

/** Snap auto-sign Jupiter buy size to the same USDT presets as Bet Amount (default $0.20). */
export function normalizeAutoSignBetUsdt(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        return 0.2;
    }
    let best = POSITION_SIZE_USDT_CHOICES[0]!;
    let bestDist = Math.abs(best - n);
    for (const v of POSITION_SIZE_USDT_CHOICES) {
        const d = Math.abs(v - n);
        if (d < bestDist) {
            best = v;
            bestDist = d;
        }
    }
    return best;
}

/** UI presets: 0.5% … 10% in 0.5% steps (matches `maxSlippageOptions.js`). */
const MAX_SLIPPAGE_PERCENT_CHOICES: readonly number[] = (() => {
    const out: number[] = [];
    for (let i = 1; i <= 20; i += 1) {
        out.push(Number((i * 0.5).toFixed(1)));
    }
    return out;
})();

function normalizeMaxSlippagePercent(raw: unknown): number {
    const n = Number(raw);
    if (!Number.isFinite(n) || n <= 0) {
        return DEFAULT_CONFIG.maxSlippagePercent;
    }
    let best = MAX_SLIPPAGE_PERCENT_CHOICES[0]!;
    let bestDist = Math.abs(best - n);
    for (const v of MAX_SLIPPAGE_PERCENT_CHOICES) {
        const d = Math.abs(v - n);
        if (d < bestDist) {
            best = v;
            bestDist = d;
        }
    }
    return best;
}

const TRADE_COOLDOWN_SECONDS_CHOICES = [
    0, 30, 60, 120, 180, 300, 600, 900, 1800, 3600,
] as const;

function normalizeTradeCooldownSeconds(raw: unknown): number {
    const n = Math.round(Number(raw));
    if (!Number.isFinite(n) || n <= 0) {
        return 0;
    }
    let best: number = TRADE_COOLDOWN_SECONDS_CHOICES[1]!;
    let bestDist = Math.abs(best - n);
    for (const v of TRADE_COOLDOWN_SECONDS_CHOICES) {
        if (v === 0) continue;
        const d = Math.abs(v - n);
        if (d < bestDist) {
            best = v;
            bestDist = d;
        }
    }
    return best;
}

const botStore = createBotStore();
const PAPER_FEE_RATE = 0.001;

/** Mainnet buy: seed `totalFeesUsdt` from RPC `meta.fee` (USDT), not `PAPER_FEE_RATE` on notional. */
const MAINNET_TX_NETWORK_FEE_USDT_DECIMALS = 6;

function mainnetBuyInitialFeesUsdt(buyNetworkFeeUsdt: number | null | undefined): number {
    const n = Number(buyNetworkFeeUsdt);
    if (Number.isFinite(n) && n >= 0) {
        return Number(new Decimal(n).toFixed(MAINNET_TX_NETWORK_FEE_USDT_DECIMALS));
    }
    return 0;
}

/** Roll Solana `meta.fee` (USDT) into trade totals — clip rows also store `networkFeeUsdt` for history breakdown. */
function addMainnetSellNetworkFeeToTradeTotal(trade: PaperTrade, net: number | null | undefined): void {
    if (net == null || !Number.isFinite(net) || net <= 0) return;
    trade.totalFeesUsdt = Number(
        new Decimal(trade.totalFeesUsdt ?? 0).plus(net).toFixed(MAINNET_TX_NETWORK_FEE_USDT_DECIMALS)
    );
}

function defaultState(): BotState {
    return {
        status: "stopped",
        mode: "paper",
        config: { ...DEFAULT_CONFIG },
        activeTrades: [],
        activeTrade: null,
        lastScanTokens: [],
        tradeHistory: [],
        logs: [],
        lastScanAt: null,
        nextScanAt: null,
        lastScanTimeframe: "24h",
        lastMomentumTradeOpenedAt: null,
        autoEntryTarget: null,
    };
}

function loadPersistedState(): BotState {
    const parsed = botStore.loadState();
    if (!parsed) return defaultState();

    try {
        const mergedConfig = {
            ...DEFAULT_CONFIG,
            ...parsed.config,
        };
        mergedConfig.positionSizeUsdt = normalizePositionSizeUsdt(
            Number(mergedConfig.positionSizeUsdt) || DEFAULT_CONFIG.positionSizeUsdt
        );
        mergedConfig.minDipRetracementMfeBasisPercent = snapMinDipRetracementMfeBasisPercent(
            mergedConfig.minDipRetracementMfeBasisPercent
        );
        mergedConfig.stopLossPercent = normalizeStopLossPercent(mergedConfig.stopLossPercent);
        mergedConfig.maxSlippagePercent = normalizeMaxSlippagePercent(
            (mergedConfig as { maxSlippagePercent?: unknown }).maxSlippagePercent ?? DEFAULT_CONFIG.maxSlippagePercent
        );
        mergedConfig.minMarketCapUsd = normalizeMinMarketCapUsd(mergedConfig.minMarketCapUsd);
        mergedConfig.maxMarketCapUsd = normalizeMaxMarketCapUsd(
            (mergedConfig as { maxMarketCapUsd?: unknown }).maxMarketCapUsd ?? DEFAULT_CONFIG.maxMarketCapUsd
        );
        mergedConfig.liquidityGuard = normalizeLiquidityGuard(mergedConfig.liquidityGuard);
        mergedConfig.dexMinPairAgeMinutes = normalizeDexMinPairAgeMinutes(mergedConfig.dexMinPairAgeMinutes);
        mergedConfig.minEntryChartTimeframes = normalizeBotMinEntryChartTimeframes(
            (mergedConfig as { minEntryChartTimeframes?: unknown }).minEntryChartTimeframes
        );
        mergedConfig.watchWalletAddress =
            normalizeWatchWalletAddress((mergedConfig as { watchWalletAddress?: unknown }).watchWalletAddress) ||
            DEFAULT_WATCH_WALLET_ADDRESS;
        mergedConfig.watchWalletAddressW2 = normalizeWatchWalletAddress(
            (mergedConfig as { watchWalletAddressW2?: unknown }).watchWalletAddressW2
        );
        mergedConfig.autoSignMainnet = Boolean(
            (mergedConfig as { autoSignMainnet?: unknown }).autoSignMainnet
        );
        mergedConfig.autoSignBetUsdt = normalizeAutoSignBetUsdt(
            (mergedConfig as { autoSignBetUsdt?: unknown }).autoSignBetUsdt ?? DEFAULT_CONFIG.autoSignBetUsdt
        );
        mergedConfig.tradeCooldownSeconds = normalizeTradeCooldownSeconds(
            (mergedConfig as { tradeCooldownSeconds?: unknown }).tradeCooldownSeconds
        );
        delete (mergedConfig as Record<string, unknown>).timeframe;
        delete (mergedConfig as Record<string, unknown>).scanIntervalSeconds;

        const activeTrades = migrateOpenTradesFromParsed(parsed);
        const lastMom = (parsed as { lastMomentumTradeOpenedAt?: string | null }).lastMomentumTradeOpenedAt ?? null;
        return {
            ...defaultState(),
            ...parsed,
            status: "stopped",
            mode: "paper",
            config: mergedConfig,
            activeTrades,
            activeTrade: activeTrades[0] ?? null,
            tradeHistory: parsed.tradeHistory ?? [],
            logs: parsed.logs ?? [],
            nextScanAt: null,
            lastScanTimeframe: parsed.lastScanTimeframe ?? "24h",
            lastMomentumTradeOpenedAt: lastMom,
            autoEntryTarget: normalizeAutoEntryTarget(
                (parsed as { autoEntryTarget?: unknown }).autoEntryTarget
            ),
        };
    } catch {
        return defaultState();
    }
}

function normalizeAutoEntryTarget(raw: unknown): { symbol: string; contractAddress?: string } | null {
    if (raw == null || typeof raw !== "object") return null;
    const o = raw as Record<string, unknown>;
    const symbol = String(o.symbol ?? "").trim();
    if (!symbol) return null;
    const contractAddress = String(o.contractAddress ?? "").trim();
    return {
        symbol,
        ...(contractAddress ? { contractAddress } : {}),
    };
}

class PaperMomentumBot {
    private state: BotState = loadPersistedState();

    private timer: NodeJS.Timeout | null = null;
    private dexPaperPollTimer: NodeJS.Timeout | null = null;
    private scanning = false;
    private autoSignSellBusy = false;

    private static readonly DEX_PAPER_POLL_MS = 8_000;

    constructor() {
        marketStream.onBookTicker((update) => this.handleBookTicker(update));
        for (const t of this.state.activeTrades) {
            this.ensureTradeDefaults(t);
        }
        if (this.state.activeTrades.some((x) => x.dexPaperPriceRef?.chainId && x.dexPaperPriceRef.pairAddress)) {
            this.startDexPaperPricePoll();
        } else {
            for (const t of this.state.activeTrades) {
                if (t.symbol && !t.dexPaperPriceRef) {
                    marketStream.ensureSymbolSubscribed(t.symbol);
                }
            }
        }
    }

    private syncActiveTradePointer(): void {
        this.state.activeTrade = this.state.activeTrades[0] ?? null;
    }

    private cloneTradeShallow(trade: PaperTrade): PaperTrade {
        return {
            ...trade,
            partialFills: trade.partialFills?.map((p) => ({ ...p })),
            pendingMainnetSells: trade.pendingMainnetSells?.map((p) => ({ ...p })),
            settingsAtOpen: trade.settingsAtOpen
                ? (JSON.parse(JSON.stringify(trade.settingsAtOpen)) as TradeSettingsAtOpen)
                : undefined,
        };
    }

    private setTradeMainnetSellQueue(trade: PaperTrade, queue: PendingMainnetSell[]): void {
        trade.pendingMainnetSells = queue.length > 0 ? queue.map((p) => ({ ...p })) : undefined;
        trade.pendingMainnetSell = queue[0] ?? undefined;
    }

    /** Exit snapshot treats queued (unsigned) mainnet sells as if step hits were applied, so further TP/dip steps can queue. */
    private buildExitSnapshotWithQueuedMainnetSells(trade: PaperTrade): ExitDecisionTradeSnapshot {
        const queued = normalizePendingMainnetSells(trade);
        const tp = [...trade.takeProfitStepsHit];
        const dip = [...trade.dipStepsHit];
        const dret = [...trade.dipRetracementStepsHit];
        for (const p of queued) {
            if (p.exitKind !== "partial") continue;
            if (p.advanceTpHit != null && !tp.some((h) => Number(h) === Number(p.advanceTpHit))) {
                tp.push(p.advanceTpHit);
            }
            if (p.advanceDipHit != null && !dip.some((h) => Number(h) === Number(p.advanceDipHit))) {
                dip.push(p.advanceDipHit);
            }
            if (
                p.advanceDipRetraceHit != null &&
                !dret.some((h) => Number(h) === Number(p.advanceDipRetraceHit))
            ) {
                dret.push(p.advanceDipRetraceHit);
            }
        }
        return {
            pnlPercent: trade.pnlPercent,
            entryPrice: trade.entryPrice,
            peakPrice: trade.peakPrice,
            currentPrice: trade.currentPrice,
            takeProfitStepsHit: tp.sort((a, b) => a - b),
            dipStepsHit: dip.sort((a, b) => a - b),
            dipRetracementStepsHit: dret.sort((a, b) => a - b),
            openedAt: trade.openedAt,
            maxHoldMinutesAtEntry: trade.maxHoldMinutesAtEntry,
        };
    }

    getState(): BotState {
        const activeTrades = this.state.activeTrades.map((t) => this.cloneTradeShallow(t));
        return {
            ...this.state,
            config: { ...this.state.config },
            activeTrades,
            activeTrade: activeTrades[0] ? this.cloneTradeShallow(activeTrades[0]) : null,
            lastScanTokens: this.state.lastScanTokens.map((token) => ({ ...token })),
            tradeHistory: this.state.tradeHistory.map((t) => this.cloneTradeShallow(t)),
            logs: [...this.state.logs],
            autoEntryTarget: this.state.autoEntryTarget
                ? { ...this.state.autoEntryTarget }
                : null,
        };
    }

    start(): BotState {
        if (this.state.status === "running") {
            this.log("warn", "Paper bot is already running.");
            return this.getState();
        }

        this.state.status = "running";
        this.log("info", "Paper bot started. Live trading is disabled.");
        if (this.state.config.marketSource === "dexscreener") {
            this.log(
                "info",
                "Using DexScreener public API for candidate list and pair prices; all fills are simulated (paper)."
            );
        } else if (this.state.config.marketSource !== "binance") {
            this.log(
                "warn",
                `marketSource=${this.state.config.marketSource} is selected; scanner and live prices still use Binance until that venue is integrated.`
            );
        }
        if (this.state.activeTrades.some((t) => t.dexPaperPriceRef?.chainId)) {
            this.startDexPaperPricePoll();
        }
        this.persistState();
        if (this.state.config.autoMode) {
            void this.scanOnce();
            this.scheduleNextScan();
        } else {
            this.state.nextScanAt = null;
            this.log("info", "Auto mode is off. Use Scan Now for manual entries.");
        }
        return this.getState();
    }

    stop(options?: { closeActiveTrade?: boolean }): BotState {
        if (options?.closeActiveTrade && this.state.activeTrades.length > 0) {
            this.log("info", "Closing open trade(s) before stop (mainnet → pending Jupiter sell).");
            const snapshot = [...this.state.activeTrades];
            for (const t of snapshot) {
                if (t.executionChannel === "mainnet") {
                    if (normalizePendingMainnetSells(t).length === 0) {
                        this.setTradeMainnetSellQueue(t, [
                            {
                                createdAt: new Date().toISOString(),
                                sellFraction: 1,
                                markPriceUsd: t.currentPrice,
                                exitKind: "close_full",
                                closeReason: "manual",
                            },
                        ]);
                    }
                } else {
                    this.closeTradeForTrade(t, t.currentPrice, "manual", { suppressAutoRescan: true });
                }
            }
            this.persistState();
        }

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.state.status = "stopped";
        this.state.nextScanAt = null;
        this.state.autoEntryTarget = null;
        this.log("info", "Paper bot stopped.");
        this.persistState();
        return this.getState();
    }

    closeActiveTrade(reason: ExitReason = "manual", tradeId?: string): BotState {
        const id = typeof tradeId === "string" ? tradeId.trim() : "";
        const trade = id
            ? this.state.activeTrades.find((t) => t.id === id)
            : this.state.activeTrades[0];
        if (!trade) {
            this.log("warn", "No open paper trade to close.");
            return this.getState();
        }

        if (trade.executionChannel === "mainnet") {
            this.setTradeMainnetSellQueue(trade, [
                {
                    createdAt: new Date().toISOString(),
                    sellFraction: 1,
                    markPriceUsd: trade.currentPrice,
                    exitKind: "close_full",
                    closeReason: reason,
                },
            ]);
            this.persistState();
            this.log("info", `Mainnet ${trade.symbol}: queued full exit — sign Jupiter sell in Run Bot.`);
            return this.getState();
        }

        this.closeTradeForTrade(trade, trade.currentPrice, reason);
        return this.getState();
    }

    /**
     * After a successful on-chain buy, register an open mainnet leg (same exit rules as paper; sells via Jupiter).
     * Entry / bet / qty come from the client (typically tx inference). Optional Dex ref only enables live **mark** price polling — does not change entry.
     */
    registerMainnetOpenTrade(payload: {
        symbol: string;
        baseAsset: string;
        entryPriceUsd: number;
        quantityTokens: number;
        positionSizeUsdt: number;
        outputMint: string;
        tokenDecimals: number;
        txSignature?: string;
        /** From `solanaSignatureNetworkFeeUsdt`; when missing and no tx yet, fees stay 0 until buy is linked. */
        buyNetworkFeeUsdt?: number | null;
        dexPaperPriceRef?: { chainId: string; pairAddress: string };
        chartUrl?: string;
        entryMode?: "auto" | "manual";
    }): BotState {
        if (this.state.activeTrades.length >= MAX_CONCURRENT_OPEN_TRADES) {
            const msg = "Already at the maximum of 2 open trades.";
            this.log("warn", msg);
            throw new Error(msg);
        }
        const sym = String(payload.symbol ?? "").trim();
        if (this.state.activeTrades.some((t) => t.symbol === sym)) {
            const msg = `Already have an open leg on ${sym}.`;
            this.log("warn", msg);
            throw new Error(msg);
        }
        const entry = Number(payload.entryPriceUsd);
        const qty = Number(payload.quantityTokens);
        const bet = Number(payload.positionSizeUsdt);
        const dec = Math.floor(Number(payload.tokenDecimals));
        const mint = String(payload.outputMint ?? "").trim();
        if (!sym || !Number.isFinite(entry) || entry <= 0 || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(bet)) {
            const msg = "Invalid symbol, entry price, token quantity, or USDT bet.";
            this.log("warn", `registerMainnetOpenTrade: ${msg}`);
            throw new Error(msg);
        }
        if (!mint || !Number.isFinite(dec) || dec < 0 || dec > 18) {
            const msg = "Invalid output mint or token decimals (0–18).";
            this.log("warn", `registerMainnetOpenTrade: ${msg}`);
            throw new Error(msg);
        }

        const dexPaperPriceRef = payload.dexPaperPriceRef;
        const chartUrl = payload.chartUrl;

        const cfg = this.state.config;
        const newTrade: PaperTrade = {
            id: `${sym}-mn-${Date.now()}`,
            status: "open",
            symbol: sym,
            baseAsset: String(payload.baseAsset ?? sym).trim() || sym,
            entryPrice: entry,
            quantity: qty,
            positionSizeUsdt: bet,
            openedAt: new Date().toISOString(),
            currentPrice: entry,
            pnlPercent: 0,
            pnlUsdt: 0,
            unrealizedPnlUsdt: 0,
            realizedPnlUsdt: 0,
            peakPrice: entry,
            takeProfitStepsHit: [],
            dipStepsHit: [],
            dipRetracementStepsHit: [],
            entryMode: payload.entryMode === "auto" ? "auto" : "manual",
            entryTimeframe: this.state.lastScanTimeframe ?? BOT_SCAN_TIMEFRAME,
            entryGainPercent: null,
            entryFiveMinuteChangePercent: null,
            entryReason: payload.txSignature
                ? payload.entryMode === "auto"
                    ? "Mainnet Jupiter buy (auto-sign)"
                    : "Mainnet Jupiter buy (recorded)"
                : "Mainnet buy (manual backfill)",
            totalFeesUsdt: mainnetBuyInitialFeesUsdt(payload.buyNetworkFeeUsdt),
            maxHoldMinutesAtEntry: cfg.maxHoldMinutes,
            dexPaperPriceRef,
            chartUrl,
            partialFills: [],
            settingsAtOpen: tradeSettingsAtOpenFromConfig(cfg),
            executionChannel: "mainnet",
            solanaOutputMint: mint,
            tokenDecimals: dec,
            mainnetBuyTxSignature: payload.txSignature,
            pendingMainnetSell: null,
            pendingMainnetSells: undefined,
        };
        this.state.activeTrades.push(newTrade);
        this.syncActiveTradePointer();
        if (newTrade.dexPaperPriceRef?.chainId && !this.dexPaperPollTimer) {
            this.startDexPaperPricePoll();
        }
        this.persistState();
        this.log("info", `Mainnet BUY recorded ${sym} @ entry ${entry} (${qty} tok).`);
        return this.getState();
    }

    /**
     * Attach a confirmed Jupiter buy tx to an open mainnet leg that has no `mainnetBuyTxSignature` yet (e.g. stacked leg).
     * Entry/qty/bet are taken from on-chain inference; mint must match the leg.
     */
    attachMainnetBuyToOpenTrade(
        tradeId: string,
        txSignature: string,
        inferred: InferredMainnetBuy,
        buyNetworkFeeUsdt?: number | null
    ): BotState {
        const id = typeof tradeId === "string" ? tradeId.trim() : "";
        const sig = typeof txSignature === "string" ? txSignature.trim() : "";
        if (!id || !sig) {
            throw new Error("tradeId and txSignature are required.");
        }
        const trade = this.state.activeTrades.find((t) => t.id === id);
        if (!trade || trade.executionChannel !== "mainnet") {
            throw new Error("Not a mainnet open trade.");
        }
        if (trade.mainnetBuyTxSignature) {
            throw new Error("This leg already has an on-chain buy signature.");
        }
        if (normalizePendingMainnetSells(trade).length > 0) {
            throw new Error("Complete or clear pending sells before confirming a buy.");
        }
        const legMint = trade.solanaOutputMint?.trim().toLowerCase() ?? "";
        const infMint = inferred.outputMint.trim().toLowerCase();
        if (!legMint || legMint !== infMint) {
            throw new Error("Buy transaction mint does not match this leg.");
        }
        const entry = Number(inferred.entryPriceUsd);
        const qty = Number(inferred.quantityTokens);
        const bet = Number(inferred.positionSizeUsdt);
        const dec = Math.floor(Number(inferred.tokenDecimals));
        if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(qty) || qty <= 0 || !Number.isFinite(bet)) {
            throw new Error("Could not read valid entry, quantity, or bet from the transaction.");
        }
        trade.mainnetBuyTxSignature = sig;
        trade.entryPrice = entry;
        trade.quantity = qty;
        trade.positionSizeUsdt = bet;
        if (dec >= 0 && dec <= 18) {
            trade.tokenDecimals = dec;
        }
        trade.currentPrice = entry;
        trade.peakPrice = Math.max(trade.peakPrice, entry);
        trade.totalFeesUsdt = mainnetBuyInitialFeesUsdt(buyNetworkFeeUsdt);
        const baseReason = trade.entryReason ?? "Mainnet leg";
        trade.entryReason = `${baseReason} · On-chain buy confirmed`.slice(0, 500);
        this.updatePnlForTrade(trade, trade.currentPrice);
        this.persistState();
        this.log("info", `Mainnet buy tx linked for ${trade.symbol} (${id}).`);
        return this.getState();
    }

    /**
     * Replace last partial clip PnL/proceeds (mark-based) with USDT/USDC actually received on-chain when inference succeeds.
     */
    private reconcileLastMainnetPartialProceedsFromChain(
        trade: PaperTrade,
        chainProceedsUsd: number,
        tokenSoldOnChain: number
    ): void {
        const fills = trade.partialFills;
        if (!fills?.length || !Number.isFinite(chainProceedsUsd) || chainProceedsUsd <= 0) return;
        const last = fills[fills.length - 1];
        if (!last || !Number.isFinite(last.quantitySold) || last.quantitySold <= 0) return;

        const prevMarkPx = Number(last.price);
        if (!(Number.isFinite(Number(last.signalMarkUsd)) && Number(last.signalMarkUsd) > 0)) {
            if (Number.isFinite(prevMarkPx) && prevMarkPx > 0) {
                last.signalMarkUsd = prevMarkPx;
            }
        }

        if (Number.isFinite(tokenSoldOnChain) && tokenSoldOnChain > 0) {
            const ratio = tokenSoldOnChain / last.quantitySold;
            if (ratio < 0.85 || ratio > 1.15) {
                this.log(
                    "warn",
                    `Mainnet sell tx token amount vs bot clip (${tokenSoldOnChain} vs ${last.quantitySold}); skipping chain proceeds patch.`
                );
                return;
            }
        }

        const oldRealized = Number(last.realizedUsdt);
        const entry = trade.entryPrice;
        const newRealized = Number(
            new Decimal(chainProceedsUsd).minus(new Decimal(entry).mul(last.quantitySold)).toFixed(4)
        );

        last.proceedsUsdt = Number(new Decimal(chainProceedsUsd).toFixed(6));
        last.realizedUsdt = newRealized;
        const betForClip = Number(trade.positionSizeUsdt);
        last.clipPnlPercentOfBet =
            Number.isFinite(betForClip) && betForClip > 0
                ? Number(((newRealized / betForClip) * 100).toFixed(4))
                : undefined;
        const fillPx = Number(new Decimal(chainProceedsUsd).div(last.quantitySold).toFixed(12));
        last.price = fillPx;
        const sig = Number(last.signalMarkUsd);
        if (Number.isFinite(sig) && sig > 0 && Number.isFinite(fillPx) && fillPx > 0) {
            const slipPct = Math.abs(sig - fillPx) / sig * 100;
            if (slipPct >= 1) {
                this.log(
                    "warn",
                    `${trade.symbol} P-SELL: on-chain fill ${fillPx.toExponential(4)} vs mark-at-queue ${sig.toExponential(4)} (~${slipPct.toFixed(1)}% apart). TP/dip used mark; clip PnL uses fill.`
                );
            }
        }

        trade.realizedPnlUsdt = Number(
            new Decimal(trade.realizedPnlUsdt).minus(oldRealized).plus(newRealized).toFixed(4)
        );

        const isClosed = trade.status === "closed" || (trade.quantity ?? 0) <= 1e-12;
        if (isClosed) {
            trade.unrealizedPnlUsdt = 0;
            trade.pnlUsdt = Number(new Decimal(trade.realizedPnlUsdt).toFixed(4));
            const bet = trade.positionSizeUsdt;
            trade.pnlPercent = Number(
                new Decimal(trade.realizedPnlUsdt).div(Number.isFinite(bet) && bet > 0 ? bet : 1).mul(100).toFixed(4)
            );
        }
    }

    /** Call after Phantom confirms a pending mainnet sell tx. */
    async applyMainnetSellExecuted(
        tradeId: string,
        opts?: { txSignature?: string; networkFeeUsdt?: number | null; inputAmountRaw?: string }
    ): Promise<BotState> {
        const id = typeof tradeId === "string" ? tradeId.trim() : "";
        const trade = id ? this.state.activeTrades.find((t) => t.id === id) : undefined;
        if (!trade || trade.executionChannel !== "mainnet") {
            this.log("warn", "applyMainnetSellExecuted: not a mainnet open trade.");
            return this.getState();
        }
        const q0 = normalizePendingMainnetSells(trade);
        if (q0.length === 0) {
            this.log("warn", "applyMainnetSellExecuted: no pending sell for that trade.");
            return this.getState();
        }
        const pending = q0[0];
        const tail = q0.slice(1);
        const px = pending.markPriceUsd;

        const { sellFraction, minCloseFraction } = mainnetSellFractionFromInputRaw(
            trade,
            pending,
            opts?.inputAmountRaw
        );

        if (pending.exitKind === "close_full" && sellFraction < MAINNET_CLOSE_FULL_MIN_SELL_FRACTION) {
            this.log(
                "info",
                `Mainnet close_full applied ${(Math.min(1, sellFraction) * 100).toFixed(4)}% of leg qty (chain/wallet amount vs bot quantity); position stays open with remainder.`
            );
        }

        if (pending.exitKind === "close_full" && sellFraction >= MAINNET_CLOSE_FULL_MIN_SELL_FRACTION) {
            if (sellFraction < 1 - 1e-9) {
                this.log(
                    "info",
                    `Mainnet close_full: treating as flat (${(sellFraction * 100).toFixed(2)}% of bot qty ≥ ${(MAINNET_CLOSE_FULL_MIN_SELL_FRACTION * 100).toFixed(1)}% threshold — rounding / chain vs app qty).`
                );
            }
            addMainnetSellNetworkFeeToTradeTotal(trade, opts?.networkFeeUsdt);
            this.closeTradeForTrade(trade, px, pending.closeReason ?? "manual");
            if (tail.length > 0) {
                this.log(
                    "warn",
                    `Discarded ${tail.length} queued mainnet sell(s) after full close (${trade.symbol}).`
                );
            }
            this.persistState();
            return this.getState();
        }

        const legId = trade.id;
        const pm = pending.partialMode ?? "tp_step";
        this.takePartialProfit(trade, px, sellFraction, pm, pending.stepPercent ?? 0, {
            minCloseFraction,
            signalMarkUsd: pending.markPriceUsd,
        });

        const openLeg = this.state.activeTrades.find((t) => t.id === legId);
        if (openLeg) {
            this.setTradeMainnetSellQueue(openLeg, tail);
        } else if (tail.length > 0) {
            this.log(
                "warn",
                `Discarded ${tail.length} queued mainnet sell(s) — leg closed by this partial (${legId}).`
            );
        }

        const patchLastPartialMeta = (fills: PaperPartialFill[] | undefined) => {
            if (!fills?.length) return;
            const sig = opts?.txSignature?.trim();
            const net = opts?.networkFeeUsdt;
            if (!sig && (net == null || !Number.isFinite(net))) return;
            const last = fills[fills.length - 1]!;
            if (sig) last.sellTxSignature = sig;
            if (net != null && Number.isFinite(net)) {
                last.networkFeeUsdt = Number(new Decimal(net).toFixed(MAINNET_TX_NETWORK_FEE_USDT_DECIMALS));
            }
        };

        if (openLeg) {
            patchLastPartialMeta(openLeg.partialFills);
            addMainnetSellNetworkFeeToTradeTotal(openLeg, opts?.networkFeeUsdt);
        } else {
            const hist = this.state.tradeHistory[0];
            if (hist?.id === legId) {
                patchLastPartialMeta(hist.partialFills);
                addMainnetSellNetworkFeeToTradeTotal(hist, opts?.networkFeeUsdt);
            }
        }

        const sig = opts?.txSignature?.trim();
        const target: PaperTrade | undefined =
            openLeg ??
            (this.state.tradeHistory[0]?.id === legId ? this.state.tradeHistory[0] : undefined);
        if (target && sig && target.solanaOutputMint) {
            const infer = await inferMainnetSellStableFromTx(sig, target.solanaOutputMint.trim());
            if (infer.ok) {
                this.reconcileLastMainnetPartialProceedsFromChain(
                    target,
                    infer.inferred.stableReceivedUi,
                    infer.inferred.tokenSoldUi
                );
            } else {
                this.log("warn", `Could not align P-SELL with chain (mark price kept): ${infer.error}`);
            }
        }

        if (!openLeg) {
            this.persistState();
            const histLeg =
                this.state.tradeHistory.find((x) => x.id === legId) ?? this.state.tradeHistory[0];
            if (histLeg?.id === legId) {
                const settled = histLeg.partialFills?.[histLeg.partialFills.length - 1];
                const betH = Number(histLeg.positionSizeUsdt);
                const clipPctH =
                    settled?.clipPnlPercentOfBet ??
                    (Number.isFinite(betH) && betH > 0 && settled
                        ? Number(((settled.realizedUsdt / betH) * 100).toFixed(4))
                        : null);
                const clipPctStrH =
                    clipPctH != null && Number.isFinite(clipPctH) ? `${clipPctH.toFixed(2)}%` : "n/a";
                const qtyH =
                    settled && Number.isFinite(settled.quantitySold)
                        ? settled.quantitySold.toPrecision(6)
                        : "?";
                const pxH =
                    settled && Number.isFinite(settled.price) ? settled.price.toExponential(4) : "?";
                this.log(
                    "info",
                    `Mainnet P-SELL settled ${histLeg.symbol} (${legId}) [leg closed]: ${pendingPartialTriggerLabel(pending)} · ` +
                        `sold ~${qtyH} tokens @ ~${pxH} · clip PnL $${settled?.realizedUsdt ?? "?"} (${clipPctStrH} of $${betH} bet) · ` +
                        `final leg PnL $${Number(histLeg.pnlUsdt).toFixed(4)} (${Number(histLeg.pnlPercent).toFixed(2)}%).`
                );
            }
            return this.getState();
        }
        const t = openLeg;
        if (pending.advanceTpHit != null) {
            t.takeProfitStepsHit = [...t.takeProfitStepsHit, pending.advanceTpHit].sort((a, b) => a - b);
        }
        if (pending.advanceDipHit != null) {
            t.dipStepsHit = [...t.dipStepsHit, pending.advanceDipHit].sort((a, b) => a - b);
        }
        if (pending.advanceDipRetraceHit != null) {
            t.dipRetracementStepsHit = [...t.dipRetracementStepsHit, pending.advanceDipRetraceHit].sort(
                (a, b) => a - b
            );
        }
        this.updatePnlForTrade(t, t.currentPrice);
        this.persistState();
        const settled = t.partialFills?.[t.partialFills.length - 1];
        const betU = Number(t.positionSizeUsdt);
        const clipPct =
            settled?.clipPnlPercentOfBet ??
            (Number.isFinite(betU) && betU > 0 && settled
                ? Number(((settled.realizedUsdt / betU) * 100).toFixed(4))
                : null);
        const clipPctStr = clipPct != null && Number.isFinite(clipPct) ? `${clipPct.toFixed(2)}%` : "n/a";
        const qtyStr =
            settled && Number.isFinite(settled.quantitySold) ? settled.quantitySold.toPrecision(6) : "?";
        const pxStr = settled && Number.isFinite(settled.price) ? settled.price.toExponential(4) : "?";
        this.log(
            "info",
            `Mainnet P-SELL settled ${t.symbol} (${legId}): ${pendingPartialTriggerLabel(pending)} · ` +
                `sold ~${qtyStr} tokens @ ~${pxStr} · clip PnL $${settled?.realizedUsdt ?? "?"} (${clipPctStr} of $${betU} bet) · ` +
                `leg net $${Number(t.pnlUsdt).toFixed(4)} (${Number(t.pnlPercent).toFixed(2)}% = realized + open @ mark).`
        );
        return this.getState();
    }

    /** Remove the first queued mainnet sell (e.g. expired quote) so the next FIFO item or rules can proceed. */
    clearPendingMainnetSell(tradeId: string): BotState {
        const id = typeof tradeId === "string" ? tradeId.trim() : "";
        const trade = id ? this.state.activeTrades.find((t) => t.id === id) : undefined;
        const queue = trade ? normalizePendingMainnetSells(trade) : [];
        if (!trade || queue.length === 0) return this.getState();
        this.setTradeMainnetSellQueue(trade, queue.slice(1));
        this.persistState();
        this.log(
            "info",
            `Removed head of mainnet sell queue for ${trade.symbol} (${queue.length - 1} remaining).`
        );
        return this.getState();
    }

    /**
     * Clears all pending mainnet sells and closes the leg at the current mark **without** reading chain balances.
     * Use when the dashboard is stuck (e.g. `time_stop` keeps re-queuing after you are already flat on-chain, or Phantom
     * is not connected for Mark flat). Paper PnL may not match Solscan — confirm only if you accept that risk.
     */
    forceDismissMainnetStuckLeg(tradeId: string): BotState {
        const id = typeof tradeId === "string" ? tradeId.trim() : "";
        const trade = id ? this.state.activeTrades.find((t) => t.id === id) : undefined;
        if (!trade || trade.executionChannel !== "mainnet") {
            throw new Error("Not a mainnet open trade for that id.");
        }
        const q = normalizePendingMainnetSells(trade);
        const reason: ExitReason = q[0]?.closeReason ?? "manual";
        this.setTradeMainnetSellQueue(trade, []);
        const px = trade.currentPrice;
        this.closeTradeForTrade(trade, px, reason);
        this.log(
            "warn",
            `Dismissed stuck mainnet leg ${trade.symbol} (${id}) at mark ${px} (reason=${reason}). Verify PnL vs chain if needed.`
        );
        return this.getState();
    }

    /**
     * Wallet shows 0 balance for this leg's mint but the dashboard still has an open leg / pending sell
     * (e.g. sell confirmed on-chain but `mainnet-sell-done` never ran). Clears the queue and closes the leg at mark
     * so exit rules stop re-queuing sells. Chain-accurate PnL may still need a tx review.
     */
    async reconcileMainnetOpenLegIfWalletEmpty(tradeId: string, ownerWalletPubkey: string): Promise<BotState> {
        const id = typeof tradeId === "string" ? tradeId.trim() : "";
        const owner = typeof ownerWalletPubkey === "string" ? ownerWalletPubkey.trim() : "";
        const trade = id ? this.state.activeTrades.find((t) => t.id === id) : undefined;
        if (!trade || trade.executionChannel !== "mainnet") {
            throw new Error("Not a mainnet open trade for that id.");
        }
        const mint = trade.solanaOutputMint?.trim() ?? "";
        if (!mint) {
            throw new Error("Trade is missing solanaOutputMint.");
        }
        if (!owner) {
            throw new Error("userPublicKey is required.");
        }
        const bal = await fetchSplTokenRawBalanceForOwner(owner, mint);
        if (!bal.ok) {
            throw new Error(`Could not read wallet token balance: ${bal.error}`);
        }
        if (bal.raw > 0n) {
            throw new Error(
                "This wallet still holds that token. Use Sign sell, or connect the wallet that already sold."
            );
        }
        const q = normalizePendingMainnetSells(trade);
        const reason: ExitReason = q[0]?.closeReason ?? "manual";
        this.setTradeMainnetSellQueue(trade, []);
        const px = trade.currentPrice;
        this.closeTradeForTrade(trade, px, reason);
        this.log(
            "warn",
            `Reconciled ${trade.symbol} (${id}): 0 on-chain balance for mint; closed leg at mark ${px}. Verify PnL vs Solscan if the prior sell was not synced.`
        );
        return this.getState();
    }

    /**
     * Manual only: open a second leg on the same token as the single open trade.
     * Mirrors `executionChannel` of the open leg (paper vs mainnet). Optional body matches /api/bot/config for bet size + frozen exit snapshot.
     */
    async stackManualTrade(clientPatch?: BotConfigPatch): Promise<BotState> {
        if (this.state.activeTrades.length !== 1) {
            const msg =
                "Manual stack needs exactly one open leg. Close a leg or open the first trade first.";
            this.log("warn", msg);
            throw new Error(msg);
        }
        const defined = clientPatch
            ? Object.fromEntries(Object.entries(clientPatch).filter(([, v]) => v !== undefined))
            : {};
        const legConfig =
            Object.keys(defined).length > 0
                ? this.resolveLegConfigFromPatch(defined as BotConfigPatch)
                : this.state.config;

        const first = this.state.activeTrades[0];
        const tf = this.state.lastScanTimeframe ?? BOT_SCAN_TIMEFRAME;

        let token = this.findScanTokenForStackLeg(first, this.state.lastScanTokens);
        if (!token) {
            const fresh = await this.scanCandidates();
            token = this.findScanTokenForStackLeg(first, fresh);
        }

        /** Token often absent from top-N scan (e.g. Dragoncoin); resolve from saved pair or mint via Dex API. */
        if (!token && first.dexPaperPriceRef?.chainId && first.dexPaperPriceRef?.pairAddress) {
            const r = await tokenSignalFromDexPairForStack(
                first.dexPaperPriceRef.chainId,
                first.dexPaperPriceRef.pairAddress,
                tf
            );
            if (r.ok) {
                token = r.token;
                this.log("info", `Stack: resolved ${first.symbol} from saved Dex pair (outside scan list).`);
            } else {
                this.log("warn", `Stack: could not load saved Dex pair: ${r.error}`);
            }
        }

        if (!token && first.solanaOutputMint?.trim()) {
            const useDexResolve =
                this.state.config.marketSource === "dexscreener" || first.executionChannel === "mainnet";
            if (useDexResolve) {
                const r = await resolveDexTokenForStack("solana", first.solanaOutputMint.trim(), tf);
                if (r.ok) {
                    token = r.token;
                    this.log("info", `Stack: resolved ${first.symbol} from SPL mint (outside scan list).`);
                } else {
                    this.log("warn", `Stack: mint resolve failed: ${r.error}`);
                }
            }
        }

        if (!token) {
            const msg = `${first.symbol}: could not load a Dex quote for a second leg. Save the leg with SPL mint + DexScreener pair (Run Bot form), ensure bot market source is Dex or this is a mainnet leg, then try again.`;
            this.log("warn", msg);
            throw new Error(msg);
        }

        this.openStackedManualTradeFromToken(token, first, legConfig);
        return this.getState();
    }

    /** Match scanner row to an open leg: display symbol, SPL mint, or Dex pair (mainnet backfill often uses a label ≠ DS_* symbol). */
    private findScanTokenForStackLeg(first: PaperTrade, candidates: TokenSignal[]): TokenSignal | undefined {
        const sym = first.symbol;
        const bySymbol = candidates.find((t) => t.symbol === sym);
        if (bySymbol) return bySymbol;

        const mint = first.solanaOutputMint?.trim();
        if (mint) {
            const m = mint.toLowerCase();
            const hit = candidates.find((t) => String(t.metadata?.contractAddress ?? "").toLowerCase() === m);
            if (hit) return hit;
        }

        const ref = first.dexPaperPriceRef;
        const wantPair = ref?.pairAddress ? normalizeDexScreenerPairId(ref.pairAddress).toLowerCase() : "";
        const wantChain = String(ref?.chainId ?? "").toLowerCase();
        if (wantPair) {
            return candidates.find((t) => {
                const p = normalizeDexScreenerPairId(String(t.metadata?.dexPairAddress ?? "")).toLowerCase();
                const ch = String(t.metadata?.dexChainId ?? "").toLowerCase();
                if (p !== wantPair) return false;
                if (wantChain && ch && ch !== wantChain) return false;
                return true;
            });
        }

        return undefined;
    }

    async scanOnce(): Promise<BotState> {
        if (this.scanning) return this.getState();
        this.scanning = true;

        try {
            if (this.state.activeTrades.length > 0) {
                try {
                    const hasDexLeg = this.state.activeTrades.some((t) => t.dexPaperPriceRef?.chainId);
                    if (hasDexLeg) {
                        await this.refreshDexPaperPrice();
                    } else {
                        const tokens = await this.scanCandidates();
                        for (const t of [...this.state.activeTrades]) {
                            const activeToken = tokens.find((token) => token.symbol === t.symbol);
                            this.updateActiveTradeForLeg(t, activeToken);
                        }
                    }
                    await this.tryAutoSignPendingMainnetSells();
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.log("error", `Scan failed: ${message}`);
                    this.updateActiveTradeFromStream();
                }
                this.persistState();
                return this.getState();
            }

            const tokens = await this.scanCandidates();
            await this.openBestMomentumTrade(tokens);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log("error", `Scan failed: ${message}`);
        } finally {
            this.scanning = false;
        }

        return this.getState();
    }

    async previewScan(options?: { limit?: number; timeframe?: TimeframeKey }): Promise<BotState> {
        if (this.scanning) return this.getState();
        this.scanning = true;

        try {
            await this.scanCandidates(options);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log("error", `Preview scan failed: ${message}`);
        } finally {
            this.scanning = false;
        }

        return this.getState();
    }

    /**
     * Fetch one token by mint/contract from DexScreener and prepend it to `lastScanTokens` (deduped by symbol).
     * Only when `marketSource` is `dexscreener`.
     */
    async addDexTokenByAddress(options: {
        tokenAddress: string;
        chainId?: string;
        timeframe?: TimeframeKey;
    }): Promise<BotState> {
        if (this.state.config.marketSource !== "dexscreener") {
            throw new Error("Add by address is only available when market source is DexScreener (Configs).");
        }

        const tf = options.timeframe ?? BOT_SCAN_TIMEFRAME;
        const guards: EntryGuardOptions = {
            liquidityGuard: this.state.config.liquidityGuard,
            minFiveMinuteFlowUsdt: this.state.config.minFiveMinuteFlowUsdt,
            liquidityCheckRequired: this.state.config.liquidityCheckRequired,
            minMarketCapUsd: this.state.config.minMarketCapUsd,
            maxMarketCapUsd: this.state.config.maxMarketCapUsd,
            dexMinPairAgeMinutes: this.state.config.dexMinPairAgeMinutes,
            minEntryChartTimeframes: this.state.config.minEntryChartTimeframes,
        };

        const resolved = await resolveDexTokenFromAddress(
            options.chainId ?? "solana",
            options.tokenAddress,
            tf,
            guards
        );
        if (!resolved.ok) {
            throw new Error(resolved.error);
        }

        const token: TokenSignal = {
            ...resolved.token,
            metadata: { ...resolved.token.metadata, addedByUserAddress: true },
        };
        this.state.lastScanTokens = [token, ...this.state.lastScanTokens.filter((t) => t.symbol !== token.symbol)];
        this.state.lastScanAt = new Date().toISOString();
        this.state.lastScanTimeframe = tf;
        this.persistState();
        this.log("info", `Added token by address (${token.baseAsset}): ${token.symbol}`);
        return this.getState();
    }

    async startTrade(symbol: string, clientPatch?: BotConfigPatch): Promise<BotState> {
        if (!symbol) {
            this.log("warn", "No token symbol provided for manual trade start.");
            return this.getState();
        }

        const defined = clientPatch
            ? Object.fromEntries(Object.entries(clientPatch).filter(([, v]) => v !== undefined))
            : {};
        const legConfig =
            Object.keys(defined).length > 0
                ? this.resolveLegConfigFromPatch(defined as BotConfigPatch)
                : this.state.config;

        if (this.state.activeTrades.length >= MAX_CONCURRENT_OPEN_TRADES) {
            this.log(
                "warn",
                "Already at the maximum of 2 open paper trades. Close a leg before opening another."
            );
            return this.getState();
        }

        if (this.state.activeTrades.some((t) => t.symbol === symbol)) {
            this.log(
                "warn",
                `Already have an open leg on ${symbol}. Use manual "Trigger new trade" for a second leg on the same token, or choose a different token in the scan table.`
            );
            return this.getState();
        }

        const cached = this.state.lastScanTokens.find((token) => token.symbol === symbol);
        const token =
            cached ??
            (await this.scanCandidates()).find((candidate) => candidate.symbol === symbol);

        if (!token) {
            this.log("warn", `${symbol} is not available in the latest scan results.`);
            return this.getState();
        }

        this.openTradeFromToken(token, "manual", legConfig);
        return this.getState();
    }

    extendActiveTradeHold(extendByMinutes: number, tradeId?: string): BotState {
        const id = typeof tradeId === "string" ? tradeId.trim() : "";
        const trade = id
            ? this.state.activeTrades.find((t) => t.id === id)
            : this.state.activeTrades[0];
        if (!trade) {
            this.log("warn", "No open paper trade to extend.");
            return this.getState();
        }

        const safeExtend = Math.max(1, Math.min(240, Number(extendByMinutes) || 0));
        const rules = exitRulesForTrade(trade, this.state.config);
        trade.maxHoldMinutesAtEntry = Math.max(
            1,
            Math.min(1440, (trade.maxHoldMinutesAtEntry ?? rules.maxHoldMinutes) + safeExtend)
        );
        this.log(
            "info",
            `Extended ${trade.symbol} (${trade.id}) hold by ${safeExtend} min. New max hold: ${trade.maxHoldMinutesAtEntry} min.`
        );
        this.persistState();
        return this.getState();
    }

    setAutoMode(enabled: boolean): BotState {
        this.state.config.autoMode = enabled;

        if (!enabled) {
            if (this.timer) {
                clearTimeout(this.timer);
                this.timer = null;
            }
            this.state.nextScanAt = null;
            this.state.autoEntryTarget = null;
            this.log("info", "Auto mode disabled. Bot will only scan when Scan Now is clicked.");
            this.persistState();
            return this.getState();
        }

        this.log("info", "Auto mode enabled.");
        if (this.state.status === "running" && !this.timer) {
            void this.scanOnce();
            this.scheduleNextScan();
        } else {
            this.persistState();
        }

        return this.getState();
    }

    setAutoEntryTarget(body: {
        clear?: boolean;
        symbol?: string;
        contractAddress?: string;
    }): BotState {
        if (body.clear === true) {
            this.state.autoEntryTarget = null;
            this.log("info", "Auto entry: cleared selected token.");
            this.persistState();
            return this.getState();
        }
        const symbol = String(body.symbol ?? "").trim();
        if (!symbol) {
            this.log("warn", "Auto entry: symbol required.");
            return this.getState();
        }
        const contractAddress = String(body.contractAddress ?? "").trim();
        this.state.autoEntryTarget = {
            symbol,
            ...(contractAddress ? { contractAddress } : {}),
        };
        this.log(
            "info",
            `Auto entry: ${symbol}. Only this token will be opened when momentum and gates pass.`
        );
        this.persistState();
        return this.getState();
    }

    /** Full validation/clamps for a merged bot config (persisted config or per-leg snapshot input). */
    private normalizeMergedConfig(nextConfig: BotConfig): BotConfig {
        const n: BotConfig = { ...nextConfig };

        n.scanLimit = Math.max(1, Math.min(20, Number(n.scanLimit) || 20));
        n.liquidityCheckRequired = Boolean(n.liquidityCheckRequired);
        n.marketSource = normalizeMarketSource(n.marketSource);
        n.liquidityGuard = normalizeLiquidityGuard(n.liquidityGuard);
        const allowedFlowThresholds = new Set([
            100, 200, 500, 1_000, 10_000, 30_000, 60_000, 100_000, 200_000, 300_000, 500_000, 800_000, 1_000_000,
            1_000_001,
        ]);
        const requestedFlow = Number(n.minFiveMinuteFlowUsdt);
        n.minFiveMinuteFlowUsdt = allowedFlowThresholds.has(requestedFlow)
            ? requestedFlow
            : DEFAULT_CONFIG.minFiveMinuteFlowUsdt;
        n.minMarketCapUsd = normalizeMinMarketCapUsd(n.minMarketCapUsd);
        n.maxMarketCapUsd = normalizeMaxMarketCapUsd(n.maxMarketCapUsd);
        n.dexMinPairAgeMinutes = normalizeDexMinPairAgeMinutes(n.dexMinPairAgeMinutes);
        n.minEntryChartTimeframes = normalizeBotMinEntryChartTimeframes(n.minEntryChartTimeframes);
        n.positionSizeUsdt = normalizePositionSizeUsdt(
            Number(n.positionSizeUsdt) || DEFAULT_CONFIG.positionSizeUsdt
        );
        n.stopLossPercent = normalizeStopLossPercent(n.stopLossPercent);
        n.maxSlippagePercent = normalizeMaxSlippagePercent(
            Number(n.maxSlippagePercent) || DEFAULT_CONFIG.maxSlippagePercent
        );
        n.autoSignBetUsdt = normalizeAutoSignBetUsdt(n.autoSignBetUsdt);
        n.maxHoldMinutes = Math.max(1, Math.min(480, Number(n.maxHoldMinutes) || 30));
        n.takeProfitStepSellFraction = Math.max(
            0.05,
            Math.min(1, Number(n.takeProfitStepSellFraction) || 0.25)
        );
        n.takeProfitStepsPercent = this.normalizeTakeProfitStepsPercent(
            n.takeProfitStepsPercent,
            DEFAULT_CONFIG.takeProfitStepsPercent
        );
        n.takeProfitStepSellFractions = this.normalizeTakeProfitStepSellFractions(
            n.takeProfitStepsPercent,
            Array.isArray(n.takeProfitStepSellFractions) ? n.takeProfitStepSellFractions : []
        );
        const dipPeak = this.normalizeDipFromPeakLadder(n.dipStepsPercent, n.dipStepSellFractions);
        n.dipStepsPercent = dipPeak.steps;
        n.dipStepSellFractions = dipPeak.fractions;
        const retracement = this.normalizeDipRetracementArrays(
            n.dipRetracementStepsPercent,
            n.dipRetracementSellFractions
        );
        n.dipRetracementStepsPercent = retracement.steps;
        n.dipRetracementSellFractions = retracement.fractions;
        n.minDipRetracementMfeBasisPercent = snapMinDipRetracementMfeBasisPercent(
            n.minDipRetracementMfeBasisPercent
        );
        n.watchWalletAddress =
            normalizeWatchWalletAddress(n.watchWalletAddress) || DEFAULT_WATCH_WALLET_ADDRESS;
        n.watchWalletAddressW2 = normalizeWatchWalletAddress(n.watchWalletAddressW2);
        n.executionMode = n.executionMode === "live" ? "live" : "paper";
        n.autoSignMainnet = Boolean(n.autoSignMainnet);
        n.tradeCooldownSeconds = normalizeTradeCooldownSeconds(n.tradeCooldownSeconds);

        delete (n as Record<string, unknown>).timeframe;
        delete (n as Record<string, unknown>).scanIntervalSeconds;

        return n;
    }

    /** Merge a validated config patch onto live config for a new leg snapshot (built via `buildBotConfigPatch` on the server). */
    private resolveLegConfigFromPatch(patch: BotConfigPatch): BotConfig {
        const definedPatch = Object.fromEntries(
            Object.entries(patch).filter(([, value]) => value !== undefined)
        ) as BotConfigPatch;
        const merged: BotConfig = { ...this.state.config, ...definedPatch };
        return this.normalizeMergedConfig(merged);
    }

    updateConfig(patch: BotConfigPatch): BotState {
        const definedPatch = Object.fromEntries(
            Object.entries(patch).filter(([, value]) => value !== undefined)
        ) as BotConfigPatch;
        const merged: BotConfig = {
            ...this.state.config,
            ...definedPatch,
        };

        this.state.config = this.normalizeMergedConfig(merged);
        if (!this.state.config.autoMode) {
            this.state.autoEntryTarget = null;
        }

        if (this.state.status === "running") {
            if (this.timer) {
                clearTimeout(this.timer);
                this.timer = null;
            }
            if (this.state.config.autoMode) {
                this.scheduleNextScan();
            } else {
                this.state.nextScanAt = null;
            }
        }

        this.log("info", "Strategy configuration updated.");
        this.persistState();
        return this.getState();
    }

    /** Delay between auto scans: trade cooldown when > 0, else {@link AUTO_SCAN_FALLBACK_INTERVAL_SEC}s. */
    private autoScanDelayMs(): number {
        const cd = this.state.config.tradeCooldownSeconds ?? 0;
        const sec = cd > 0 ? cd : AUTO_SCAN_FALLBACK_INTERVAL_SEC;
        return Math.max(10, Math.min(3600, sec)) * 1000;
    }

    private scheduleNextScan(): void {
        if (this.state.status !== "running" || !this.state.config.autoMode) return;

        const delayMs = this.autoScanDelayMs();
        this.state.nextScanAt = new Date(Date.now() + delayMs).toISOString();
        this.persistState();
        this.timer = setTimeout(() => {
            void this.scanOnce().finally(() => this.scheduleNextScan());
        }, delayMs);
    }

    /** After a position closes, look for a new entry soon instead of waiting a full interval. */
    private queueRescanAfterClose(): void {
        if (this.state.status !== "running" || !this.state.config.autoMode) return;

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        this.state.nextScanAt = null;
        this.persistState();

        setTimeout(() => {
            void this.scanOnce().finally(() => {
                if (this.state.status === "running" && this.state.config.autoMode) {
                    this.scheduleNextScan();
                }
            });
        }, 0);
    }

    private async scanCandidates(options?: { limit?: number; timeframe?: TimeframeKey }): Promise<TokenSignal[]> {
        const previewLimit = Number(options?.limit);
        const safeLimit = Number.isFinite(previewLimit)
            ? Math.max(1, Math.min(20, previewLimit))
            : this.state.config.scanLimit;
        const safeTimeframe = options?.timeframe ?? BOT_SCAN_TIMEFRAME;
        const guards = {
            liquidityGuard: this.state.config.liquidityGuard,
            minFiveMinuteFlowUsdt: this.state.config.minFiveMinuteFlowUsdt,
            liquidityCheckRequired: this.state.config.liquidityCheckRequired,
            minMarketCapUsd: this.state.config.minMarketCapUsd,
            maxMarketCapUsd: this.state.config.maxMarketCapUsd,
            dexMinPairAgeMinutes: this.state.config.dexMinPairAgeMinutes,
            minEntryChartTimeframes: this.state.config.minEntryChartTimeframes,
        };
        const result =
            this.state.config.marketSource === "dexscreener"
                ? await scanTopSignalsDexscreener(safeLimit, safeTimeframe, guards)
                : await scanTopSignals(safeLimit, safeTimeframe, guards);
        this.state.lastScanAt = new Date().toISOString();
        const fromScan = result.tokens;
        const pinned =
            this.state.config.marketSource === "dexscreener"
                ? this.state.lastScanTokens.filter((t) => t.metadata?.addedByUserAddress === true)
                : [];
        this.state.lastScanTokens =
            pinned.length > 0
                ? mergeUserPinnedWithScanTokens(pinned, fromScan)
                : fromScan;
        this.state.lastScanTimeframe = safeTimeframe;
        this.persistState();
        return this.state.lastScanTokens;
    }

    /** Auto-entry liquidity / factor gates (5m micro-trend, optional 5m flow + MC from guard). */
    private tokenMatchesAutoArm(
        t: TokenSignal,
        arm: { symbol: string; contractAddress?: string }
    ): boolean {
        const wantMint = String(arm.contractAddress ?? "").trim().toLowerCase();
        const gotMint = String(t.metadata?.contractAddress ?? "").trim().toLowerCase();
        if (wantMint && gotMint) return gotMint === wantMint;
        return t.symbol === arm.symbol;
    }

    private tokenPassesAutoLiquidityGates(token: TokenSignal): boolean {
        const factorStatus = new Map(
            token.factors.map((factor) => [factor.name.toLowerCase(), factor.status])
        );
        const microTrendOk = factorStatus.get("5m micro trend") === "good";
        const flow5mOk = factorStatus.get("5m flow") === "good";
        const mcOk = factorStatus.get("market cap") === "good";
        const liqReq = this.state.config.liquidityCheckRequired;
        const guard = normalizeLiquidityGuard(this.state.config.liquidityGuard);
        const needFlow = liqReq && (guard === "both" || guard === "volume");
        const needMc = liqReq && (guard === "both" || guard === "mc");
        return microTrendOk && (!needFlow || flow5mOk) && (!needMc || mcOk);
    }

    private async openBestMomentumTrade(tokens: TokenSignal[]): Promise<void> {
        if (this.state.activeTrades.length > 0) return;

        const cfg = this.state.config;
        const cd = cfg.tradeCooldownSeconds ?? 0;
        if (cd > 0 && this.state.lastMomentumTradeOpenedAt) {
            const elapsed =
                (Date.now() - new Date(this.state.lastMomentumTradeOpenedAt).getTime()) / 1000;
            if (elapsed < cd) {
                this.log(
                    "info",
                    `Trade cooldown: ~${Math.ceil(cd - elapsed)}s remaining before next auto entry.`
                );
                return;
            }
        }

        let pool = tokens;
        if (cfg.autoMode) {
            const arm = this.state.autoEntryTarget;
            if (!arm?.symbol?.trim()) {
                this.log(
                    "info",
                    "Auto mode: no auto token — in the UI select a scanned row, then click Auto (bot must be running)."
                );
                return;
            }
            pool = tokens.filter((t) => this.tokenMatchesAutoArm(t, arm));
            if (pool.length === 0) {
                this.log(
                    "warn",
                    `Auto mode: auto token ${arm.symbol} is not in this scan — refresh the scan or set Auto again.`
                );
                return;
            }
        }

        let nMomentum = 0;
        let nAfterCharts = 0;
        let nPassAll = 0;
        for (const token of pool) {
            if (!token.momentumEntry) continue;
            nMomentum++;
            if (
                !tokenPassesMinEntryCharts(token, {
                    minEntryChartTimeframes: cfg.minEntryChartTimeframes,
                })
            ) {
                continue;
            }
            nAfterCharts++;
            if (this.tokenPassesAutoLiquidityGates(token)) nPassAll++;
        }

        const candidate = pool.find((token) => {
            if (!token.momentumEntry) return false;
            if (
                !tokenPassesMinEntryCharts(token, {
                    minEntryChartTimeframes: cfg.minEntryChartTimeframes,
                })
            ) {
                return false;
            }
            return this.tokenPassesAutoLiquidityGates(token);
        });

        if (!candidate) {
            this.log(
                "info",
                `No auto entry this scan: ${pool.length} token(s) in filtered list — ${nMomentum} with momentumEntry, ${nAfterCharts} pass min entry charts, ${nPassAll} pass trend/flow/MC gates.`
            );
            this.log(
                "info",
                "No momentum entry found. Gates require all Min entry charts >0%, strong 5m micro-trend, minimum 5m flow, and (when MC check is on) minimum market cap."
            );
            return;
        }

        const autoSignActive = Boolean(cfg.autoSignMainnet && cfg.executionMode === "live");

        if (autoSignActive) {
            const chain = String(candidate.metadata?.dexChainId ?? "").toLowerCase();
            const mint = String(candidate.metadata?.contractAddress ?? "").trim();
            if (chain === "solana" && mint) {
                const kp = loadAutoSignKeypairFromEnv();
                if (!kp) {
                    this.log(
                        "error",
                        "Auto-sign mainnet is on but SOLANA_AUTO_SIGN_SECRET_KEY is missing or invalid (expect JSON byte array). Skipping entry."
                    );
                    return;
                }
                const ok = await this.tryAutoMainnetBuyAndRegister(candidate, mint, kp);
                if (ok) {
                    this.state.lastMomentumTradeOpenedAt = new Date().toISOString();
                    this.state.autoEntryTarget = null;
                    this.persistState();
                }
                return;
            }
            this.log(
                "warn",
                `Auto-sign live: ${candidate.symbol} is not a Solana pair in scan metadata; skipping auto entry.`
            );
            return;
        }

        this.openTradeFromToken(candidate, "auto");
        this.state.lastMomentumTradeOpenedAt = new Date().toISOString();
        this.state.autoEntryTarget = null;
        this.persistState();
    }

    private async tryAutoMainnetBuyAndRegister(
        candidate: TokenSignal,
        outputMint: string,
        keypair: Keypair
    ): Promise<boolean> {
        if (this.state.activeTrades.length >= MAX_CONCURRENT_OPEN_TRADES) return false;
        if (this.state.activeTrades.some((t) => t.symbol === candidate.symbol)) return false;

        const cfg = this.state.config;
        const bet = Math.max(0.01, cfg.autoSignBetUsdt);
        const connection = getSolanaConnection();

        this.log(
            "info",
            `Auto-sign: Jupiter buy ~$${bet} ${candidate.symbol} (mint ${outputMint.slice(0, 4)}…).`
        );

        const buy = await autoSignJupiterBuyUsd({
            outputMint,
            amountUsd: bet,
            startMaxSlippagePercent: cfg.maxSlippagePercent,
            keypair,
            connection,
        });

        if (!buy.ok) {
            this.log(
                "error",
                `Auto-sign BUY failed | symbol=${candidate.symbol} mint=${outputMint} | ${buy.error}`
            );
            return false;
        }

        const infer = await inferMainnetBuyFromTxSignature(buy.signature);
        if (!infer.ok) {
            this.log(
                "error",
                `Auto-sign BUY tx landed but inferMainnetBuy failed | symbol=${candidate.symbol} sig=${buy.signature} | ${infer.error}`
            );
            return false;
        }

        const dexPaperPriceRef =
            candidate.metadata?.dexPairAddress && candidate.metadata?.dexChainId
                ? {
                      chainId: candidate.metadata.dexChainId,
                      pairAddress: candidate.metadata.dexPairAddress,
                  }
                : undefined;

        let buyNetworkFeeUsdt: number | null = null;
        try {
            buyNetworkFeeUsdt = await solanaSignatureNetworkFeeUsdt(buy.signature);
        } catch {
            buyNetworkFeeUsdt = null;
        }

        try {
            this.registerMainnetOpenTrade({
                symbol: candidate.symbol,
                baseAsset: candidate.baseAsset,
                entryPriceUsd: infer.inferred.entryPriceUsd,
                quantityTokens: infer.inferred.quantityTokens,
                positionSizeUsdt: infer.inferred.positionSizeUsdt,
                outputMint: infer.inferred.outputMint,
                tokenDecimals: infer.inferred.tokenDecimals,
                txSignature: buy.signature,
                buyNetworkFeeUsdt,
                dexPaperPriceRef,
                chartUrl: candidate.links?.binance,
                entryMode: "auto",
            });
        } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            this.log("error", `Auto-sign: could not register open leg: ${msg}`);
            return false;
        }

        if (dexPaperPriceRef?.chainId && !this.dexPaperPollTimer) {
            this.startDexPaperPricePoll();
        }
        return true;
    }

    private async tryAutoSignPendingMainnetSells(): Promise<void> {
        const cfg = this.state.config;
        if (!cfg.autoSignMainnet || cfg.executionMode !== "live") return;
        if (this.autoSignSellBusy) return;
        const kp = loadAutoSignKeypairFromEnv();
        if (!kp) return;

        const trade = this.state.activeTrades.find(
            (t) => t.executionChannel === "mainnet" && normalizePendingMainnetSells(t).length > 0
        );
        if (!trade) return;

        this.autoSignSellBusy = true;
        try {
            const connection = getSolanaConnection();
            const walletPk = kp.publicKey.toBase58();
            const mint = trade.solanaOutputMint?.trim() ?? "";
            const dec = trade.tokenDecimals;
            if (!mint || dec == null || !Number.isFinite(dec)) {
                return;
            }
            const queue = normalizePendingMainnetSells(trade);
            const pending = queue[0]!;
            const frac =
                pending.exitKind === "close_full" ? 1 : Math.min(1, Math.max(0.05, pending.sellFraction));
            const qtyUi = new Decimal(trade.quantity).mul(frac).toNumber();
            const amountRawStr = tokenUiAmountToRawExactIn(qtyUi, dec);
            let computedRaw: bigint;
            try {
                computedRaw = BigInt(amountRawStr);
            } catch {
                this.log("warn", "Auto-sign sell: invalid computed raw amount.");
                return;
            }
            if (computedRaw <= 0n) return;

            const walletBal = await fetchSplTokenRawBalanceForOwner(walletPk, mint);
            if (!walletBal.ok) {
                this.log("warn", `Auto-sign sell: balance RPC error: ${walletBal.error}`);
                return;
            }
            if (walletBal.raw <= 0n) {
                this.log("warn", `Auto-sign sell: signer wallet has 0 of ${trade.symbol} — use Reconcile or Close leg if needed.`);
                return;
            }

            let amountRaw = computedRaw;
            if (amountRaw > walletBal.raw) {
                amountRaw = walletBal.raw;
            }

            const sell = await autoSignJupiterSellRaw({
                inputMint: mint,
                amountRaw: amountRaw.toString(),
                startMaxSlippagePercent: cfg.maxSlippagePercent,
                keypair: kp,
                connection,
            });
            if (!sell.ok) {
                this.log(
                    "error",
                    `Auto-sign SELL failed | tradeId=${trade.id} symbol=${trade.symbol} mint=${mint} amountRaw=${amountRaw.toString()} | ${sell.error}`
                );
                return;
            }
            await this.applyMainnetSellExecuted(trade.id, {
                txSignature: sell.signature,
                inputAmountRaw: amountRaw.toString(),
            });
        } finally {
            this.autoSignSellBusy = false;
        }
    }

    /**
     * Fire-and-forget auto-sign for the FIFO Jupiter sell queue.
     * Must not be only on `scanOnce` — price polls / WS can queue sells minutes before the next scan.
     */
    private kickAutoSignPendingMainnetSells(): void {
        void this.tryAutoSignPendingMainnetSells().catch((e) => {
            const msg = e instanceof Error ? e.message : String(e);
            this.log("error", `Auto-sign pending sells failed: ${msg}`);
        });
    }

    private openTradeFromToken(token: TokenSignal, mode: "auto" | "manual", legConfig?: BotConfig): void {
        if (this.state.activeTrades.length >= MAX_CONCURRENT_OPEN_TRADES) return;
        if (this.state.activeTrades.some((t) => t.symbol === token.symbol)) return;

        const cfg = legConfig ?? this.state.config;
        const entryPrice = token.ask;
        const quantity = new Decimal(cfg.positionSizeUsdt).div(entryPrice).toNumber();

        const dexRef =
            token.metadata?.dexPairAddress && token.metadata?.dexChainId
                ? { chainId: token.metadata.dexChainId, pairAddress: token.metadata.dexPairAddress }
                : undefined;

        if (dexRef?.chainId?.toLowerCase() === "solana") {
            const pre = new TradeEngine(undefined, {
                defaultMaxSlippagePercent: cfg.maxSlippagePercent,
            }).quotePaperBuyFromToken(token, cfg.positionSizeUsdt);
            if (!pre.ok) {
                this.log("warn", `Solana paper trade precheck failed: ${pre.reason}`);
                return;
            }
        }

        const newTrade: PaperTrade = {
            id: `${token.symbol}-${Date.now()}`,
            status: "open",
            symbol: token.symbol,
            baseAsset: token.baseAsset,
            entryPrice,
            quantity,
            positionSizeUsdt: cfg.positionSizeUsdt,
            openedAt: new Date().toISOString(),
            currentPrice: entryPrice,
            pnlPercent: 0,
            pnlUsdt: 0,
            unrealizedPnlUsdt: 0,
            realizedPnlUsdt: 0,
            peakPrice: entryPrice,
            takeProfitStepsHit: [],
            dipStepsHit: [],
            dipRetracementStepsHit: [],
            entryMode: mode,
            entryTimeframe: this.state.lastScanTimeframe ?? BOT_SCAN_TIMEFRAME,
            entryGainPercent: token.gainPercent ?? null,
            entryFiveMinuteChangePercent: token.fiveMinuteChangePercent ?? null,
            entryReason: token.momentumReason,
            totalFeesUsdt: Number(new Decimal(cfg.positionSizeUsdt).mul(PAPER_FEE_RATE).toFixed(4)),
            maxHoldMinutesAtEntry: cfg.maxHoldMinutes,
            dexPaperPriceRef: dexRef,
            chartUrl: token.links?.binance,
            partialFills: [],
            settingsAtOpen: tradeSettingsAtOpenFromConfig(cfg),
        };
        this.state.activeTrades.push(newTrade);
        this.syncActiveTradePointer();
        if (dexRef) {
            if (!this.dexPaperPollTimer) {
                this.startDexPaperPricePoll();
            }
        } else {
            marketStream.ensureSymbolSubscribed(token.symbol);
        }
        this.persistState();

        const reasonPrefix = mode === "manual" ? "Manual BUY" : "Paper BUY";
        this.log(
            "info",
            `${reasonPrefix} ${token.symbol} at ${entryPrice} using $${cfg.positionSizeUsdt}. 5m move: ${
                token.fiveMinutePriceAgo ?? "n/a"
            } -> ${token.currentFiveMinutePrice ?? "n/a"} (${token.fiveMinuteChangePercent?.toFixed(2) ?? "n/a"}%). ${
                token.momentumReason
            }`
        );
    }

    /** Second open leg, same symbol, manual only — `legConfig` is normalized snapshot (UI + server merge). */
    private openStackedManualTradeFromToken(token: TokenSignal, firstLeg: PaperTrade, legConfig: BotConfig): void {
        if (this.state.activeTrades.length !== 1) return;
        if (this.state.activeTrades[0]?.id !== firstLeg.id) return;
        const sameSymbol = token.symbol === firstLeg.symbol;
        const mint = firstLeg.solanaOutputMint?.trim().toLowerCase();
        const sameMint =
            Boolean(mint) && String(token.metadata?.contractAddress ?? "").toLowerCase() === mint;
        const pairAddr = firstLeg.dexPaperPriceRef?.pairAddress?.trim();
        const samePair =
            pairAddr != null &&
            pairAddr.length > 0 &&
            normalizeDexScreenerPairId(String(token.metadata?.dexPairAddress ?? "")) ===
                normalizeDexScreenerPairId(pairAddr);
        if (!sameSymbol && !sameMint && !samePair) return;
        const isMainnetStack = firstLeg.executionChannel === "mainnet";
        const stackMintEarly =
            firstLeg.solanaOutputMint?.trim() || String(token.metadata?.contractAddress ?? "").trim();
        if (isMainnetStack && !stackMintEarly) {
            this.log(
                "warn",
                `Stack: ${firstLeg.symbol} is mainnet but SPL mint is missing on the open leg; cannot mirror mainnet for leg 2.`
            );
            return;
        }
        const entryPrice = token.ask;
        const quantity = new Decimal(legConfig.positionSizeUsdt).div(entryPrice).toNumber();

        let dexRef =
            token.metadata?.dexPairAddress && token.metadata?.dexChainId
                ? { chainId: token.metadata.dexChainId, pairAddress: token.metadata.dexPairAddress }
                : undefined;
        if (!dexRef && firstLeg.dexPaperPriceRef) {
            dexRef = { ...firstLeg.dexPaperPriceRef };
        }

        if (dexRef?.chainId?.toLowerCase() === "solana") {
            const pre = new TradeEngine(undefined, {
                defaultMaxSlippagePercent: legConfig.maxSlippagePercent,
            }).quotePaperBuyFromToken(token, legConfig.positionSizeUsdt);
            if (!pre.ok) {
                this.log("warn", `Solana paper stack precheck failed: ${pre.reason}`);
                return;
            }
        }

        const stackMint =
            firstLeg.solanaOutputMint?.trim() || String(token.metadata?.contractAddress ?? "").trim();
        const stackDecimals = firstLeg.tokenDecimals;
        const stackReason = `Manual second leg (same token) at updated quote. ${token.momentumReason ?? ""}`.trim();
        const mainnetStackNote =
            " Second leg is mainnet: run your Jupiter buy, then record the tx (Missed buy) so entry matches chain.";
        const newTrade: PaperTrade = {
            id: `${token.symbol}-${Date.now()}-stack`,
            status: "open",
            symbol: token.symbol,
            baseAsset: token.baseAsset,
            entryPrice,
            quantity,
            positionSizeUsdt: legConfig.positionSizeUsdt,
            openedAt: new Date().toISOString(),
            currentPrice: entryPrice,
            pnlPercent: 0,
            pnlUsdt: 0,
            unrealizedPnlUsdt: 0,
            realizedPnlUsdt: 0,
            peakPrice: entryPrice,
            takeProfitStepsHit: [],
            dipStepsHit: [],
            dipRetracementStepsHit: [],
            entryMode: "manual",
            entryTimeframe: this.state.lastScanTimeframe ?? BOT_SCAN_TIMEFRAME,
            entryGainPercent: token.gainPercent ?? null,
            entryFiveMinuteChangePercent: token.fiveMinuteChangePercent ?? null,
            entryReason: isMainnetStack ? `${stackReason}${mainnetStackNote}` : stackReason,
            totalFeesUsdt: isMainnetStack
                ? 0
                : Number(new Decimal(legConfig.positionSizeUsdt).mul(PAPER_FEE_RATE).toFixed(4)),
            maxHoldMinutesAtEntry: legConfig.maxHoldMinutes,
            dexPaperPriceRef: dexRef,
            chartUrl: token.links?.binance ?? firstLeg.chartUrl,
            partialFills: [],
            settingsAtOpen: tradeSettingsAtOpenFromConfig(legConfig),
            ...(isMainnetStack && stackMint
                ? {
                      executionChannel: "mainnet" as const,
                      solanaOutputMint: stackMint,
                      tokenDecimals:
                          stackDecimals != null && Number.isFinite(stackDecimals)
                              ? Math.max(0, Math.min(18, Math.floor(stackDecimals)))
                              : 6,
                      mainnetBuyTxSignature: undefined,
                      pendingMainnetSell: null,
                      pendingMainnetSells: undefined,
                  }
                : {}),
        };
        this.state.activeTrades.push(newTrade);
        this.syncActiveTradePointer();
        if (dexRef && !this.dexPaperPollTimer) {
            this.startDexPaperPricePoll();
        } else if (!dexRef) {
            marketStream.ensureSymbolSubscribed(token.symbol);
        }
        this.persistState();
        this.log(
            "info",
            `${isMainnetStack ? "Manual STACK BUY (mainnet)" : "Manual STACK BUY"} ${token.symbol} at ${entryPrice} (leg 2). Bet $${legConfig.positionSizeUsdt}.`
        );
    }

    private updateActiveTradeForLeg(trade: PaperTrade, activeToken: TokenSignal | undefined): void {
        if (!this.state.activeTrades.some((t) => t.id === trade.id)) return;

        if (!activeToken) {
            this.log(
                "warn",
                `${trade.symbol} not found in scan window. Holding until exit rule triggers.`
            );
            this.evaluateExitForTrade(trade, trade.currentPrice);
            return;
        }

        this.updatePnlForTrade(trade, activeToken.bid);
        this.evaluateExitForTrade(trade, activeToken.bid);
    }

    private updateActiveTradeFromStream(): void {
        for (const trade of [...this.state.activeTrades]) {
            if (!this.state.activeTrades.some((t) => t.id === trade.id)) continue;

            if (trade.dexPaperPriceRef) {
                this.log(
                    "warn",
                    `${trade.symbol} is priced via DexScreener polling; Binance book not available.`
                );
                this.evaluateExitForTrade(trade, trade.currentPrice);
                continue;
            }

            const book = marketStream.getBook(trade.symbol);

            if (!book) {
                this.log(
                    "warn",
                    `${trade.symbol} has no WebSocket price yet. Waiting for streamed price update.`
                );
                this.evaluateExitForTrade(trade, trade.currentPrice);
                continue;
            }

            this.updatePnlForTrade(trade, book.bid);
            this.evaluateExitForTrade(trade, book.bid);
        }
    }

    private handleBookTicker(update: BookTickerUpdate): void {
        for (const trade of this.state.activeTrades) {
            if (update.symbol !== trade.symbol) continue;
            if (trade.dexPaperPriceRef) continue;

            this.updatePnlForTrade(trade, update.bid);
            this.evaluateExitForTrade(trade, update.bid);
        }
    }

    private updatePnlForTrade(trade: PaperTrade, currentPrice: number): void {
        if (!this.state.activeTrades.some((t) => t.id === trade.id)) return;
        this.ensureTradeDefaults(trade);

        const entry = new Decimal(trade.entryPrice);
        const current = new Decimal(currentPrice);
        const unrealizedPnlUsdt = current.minus(entry).mul(trade.quantity);
        const totalPnlUsdt = new Decimal(trade.realizedPnlUsdt).plus(unrealizedPnlUsdt);
        const pnlPercent = totalPnlUsdt.div(trade.positionSizeUsdt).mul(100);

        if (currentPrice > trade.peakPrice) {
            trade.peakPrice = currentPrice;
        }

        trade.currentPrice = currentPrice;
        trade.unrealizedPnlUsdt = Number(unrealizedPnlUsdt.toFixed(4));
        trade.pnlPercent = Number(pnlPercent.toFixed(4));
        trade.pnlUsdt = Number(totalPnlUsdt.toFixed(4));
        this.persistState();
    }

    /** Append partial exits to FIFO; stop-loss / full exit replaces the whole queue. */
    private queueMainnetExitAppendOrReplace(trade: PaperTrade, decision: ExitDecision, markPrice: number): void {
        if (decision.kind === "none") return;

        if (decision.kind === "close_full") {
            const pending: PendingMainnetSell = {
                createdAt: new Date().toISOString(),
                sellFraction: 1,
                markPriceUsd: markPrice,
                exitKind: "close_full",
                closeReason: decision.reason as ExitReason,
            };
            this.setTradeMainnetSellQueue(trade, [pending]);
            this.persistState();
            this.log(
                "info",
                `Mainnet ${trade.symbol}: queued Jupiter full exit (reason=${decision.reason}, sell 100% of leg) — sign in Run Bot or auto-sign if enabled.`
            );
            this.kickAutoSignPendingMainnetSells();
            return;
        }

        const newPending: PendingMainnetSell = {
            createdAt: new Date().toISOString(),
            sellFraction: decision.requestedFraction,
            markPriceUsd: markPrice,
            exitKind: "partial",
            partialMode: decision.mode,
            stepPercent: decision.stepPercent,
            advanceTpHit: decision.advanceTpHit,
            advanceDipHit: decision.advanceDipHit,
            advanceDipRetraceHit: decision.advanceDipRetraceHit,
        };

        const queue = normalizePendingMainnetSells(trade);
        if (queue.some((p) => pendingMainnetPartialDuplicate(p, newPending))) {
            return;
        }
        queue.push(newPending);
        this.setTradeMainnetSellQueue(trade, queue);
        this.persistState();
        const detail = describeQueuedMainnetPartialExit(decision, trade, this.state.config);
        this.log(
            "info",
            `Mainnet ${trade.symbol}: queued Jupiter partial — ${detail} (${queue.length} pending, FIFO) — sign in Run Bot or auto-sign if enabled.`
        );
        this.kickAutoSignPendingMainnetSells();
    }

    private applyPaperExitDecision(trade: PaperTrade, decision: ExitDecision, currentPrice: number): void {
        if (decision.kind === "none") return;
        if (decision.kind === "close_full") {
            this.closeTradeForTrade(trade, currentPrice, decision.reason as ExitReason);
            return;
        }

        const legId = trade.id;
        this.takePartialProfit(
            trade,
            currentPrice,
            decision.requestedFraction,
            decision.mode,
            decision.stepPercent
        );
        if (!this.state.activeTrades.some((t) => t.id === legId)) return;

        const t = this.state.activeTrades.find((x) => x.id === legId)!;
        if (decision.advanceTpHit != null) {
            t.takeProfitStepsHit = [...t.takeProfitStepsHit, decision.advanceTpHit].sort((a, b) => a - b);
        }
        if (decision.advanceDipHit != null) {
            t.dipStepsHit = [...t.dipStepsHit, decision.advanceDipHit].sort((a, b) => a - b);
        }
        if (decision.advanceDipRetraceHit != null) {
            t.dipRetracementStepsHit = [...t.dipRetracementStepsHit, decision.advanceDipRetraceHit].sort(
                (a, b) => a - b
            );
        }
        this.persistState();
    }

    private evaluateExitForTrade(trade: PaperTrade, currentPrice: number): void {
        if (!this.state.activeTrades.some((t) => t.id === trade.id)) return;
        this.ensureTradeDefaults(trade);

        const rulesSettings = exitRulesForTrade(trade, this.state.config);
        const rules = exitRulesFromTradeSettings(rulesSettings);
        const ageMinutes = (Date.now() - new Date(trade.openedAt).getTime()) / 60_000;

        if (trade.executionChannel === "mainnet") {
            const head = normalizePendingMainnetSells(trade)[0];
            if (head?.exitKind === "close_full") {
                return;
            }
            const snap = this.buildExitSnapshotWithQueuedMainnetSells(trade);
            const decision = decideExit(snap, currentPrice, rules, this.state.config.maxHoldMinutes, ageMinutes);
            this.queueMainnetExitAppendOrReplace(trade, decision, currentPrice);
            return;
        }

        const snap: ExitDecisionTradeSnapshot = {
            pnlPercent: trade.pnlPercent,
            entryPrice: trade.entryPrice,
            peakPrice: trade.peakPrice,
            currentPrice: trade.currentPrice,
            takeProfitStepsHit: trade.takeProfitStepsHit,
            dipStepsHit: trade.dipStepsHit,
            dipRetracementStepsHit: trade.dipRetracementStepsHit,
            openedAt: trade.openedAt,
            maxHoldMinutesAtEntry: trade.maxHoldMinutesAtEntry,
        };
        const decision = decideExit(snap, currentPrice, rules, this.state.config.maxHoldMinutes, ageMinutes);
        this.applyPaperExitDecision(trade, decision, currentPrice);
    }

    private takePartialProfit(
        trade: PaperTrade,
        exitPrice: number,
        requestedFraction: number,
        mode: "tp_step" | "dip_step" | "dip_retrace",
        stepPercent: number,
        options?: { minCloseFraction?: number; signalMarkUsd?: number }
    ): void {
        if (!this.state.activeTrades.some((t) => t.id === trade.id)) return;

        const minF = options?.minCloseFraction ?? 0.05;
        const closePercent = Math.min(1, Math.max(minF, requestedFraction));
        const quantityToClose = trade.quantity * closePercent;
        if (quantityToClose <= 0) return;

        const realized = new Decimal(exitPrice)
            .minus(trade.entryPrice)
            .mul(quantityToClose);
        const sellNotional = new Decimal(exitPrice).mul(quantityToClose);
        const sellFee = sellNotional.mul(PAPER_FEE_RATE);
        trade.realizedPnlUsdt = Number(
            new Decimal(trade.realizedPnlUsdt).plus(realized).toFixed(4)
        );
        trade.totalFeesUsdt = Number(
            new Decimal(trade.totalFeesUsdt ?? 0).plus(sellFee).toFixed(4)
        );
        trade.quantity = Number(new Decimal(trade.quantity).minus(quantityToClose).toFixed(12));
        trade.peakPrice = Math.max(trade.peakPrice, exitPrice);
        if (!trade.partialFills) trade.partialFills = [];
        const sm = options?.signalMarkUsd;
        const ru = Number(realized.toFixed(4));
        const betClip = Number(trade.positionSizeUsdt);
        const clipPctBet =
            Number.isFinite(betClip) && betClip > 0 ? Number(((ru / betClip) * 100).toFixed(4)) : undefined;
        trade.partialFills.push({
            time: new Date().toISOString(),
            price: exitPrice,
            fractionOfRemaining: closePercent,
            quantitySold: quantityToClose,
            realizedUsdt: ru,
            proceedsUsdt: Number(sellNotional.minus(sellFee).toFixed(4)),
            feesUsdt: Number(sellFee.toFixed(4)),
            ...(Number.isFinite(sm) && sm != null && sm > 0 ? { signalMarkUsd: sm } : {}),
            ...(clipPctBet != null && Number.isFinite(clipPctBet) ? { clipPnlPercentOfBet: clipPctBet } : {}),
            mode,
            stepPercent,
        });
        this.updatePnlForTrade(trade, exitPrice);

        if (trade.quantity <= 0) {
            this.closeTradeForTrade(
                trade,
                exitPrice,
                mode === "dip_retrace" ? "dip_retrace" : "take_profit"
            );
        }
    }

    private startDexPaperPricePoll(): void {
        if (this.dexPaperPollTimer) return;
        const trade = this.state.activeTrades.find(
            (t) => t.dexPaperPriceRef?.chainId && t.dexPaperPriceRef.pairAddress
        );
        if (!trade?.dexPaperPriceRef?.chainId || !trade.dexPaperPriceRef.pairAddress) return;

        void this.refreshDexPaperPrice();
        this.dexPaperPollTimer = setInterval(() => {
            void this.refreshDexPaperPrice();
        }, PaperMomentumBot.DEX_PAPER_POLL_MS);
    }

    private stopDexPaperPricePoll(): void {
        if (this.dexPaperPollTimer) {
            clearInterval(this.dexPaperPollTimer);
            this.dexPaperPollTimer = null;
        }
    }

    private async refreshDexPaperPrice(): Promise<void> {
        const dexLegs = this.state.activeTrades.filter(
            (t) => t.dexPaperPriceRef?.chainId && t.dexPaperPriceRef.pairAddress
        );
        if (dexLegs.length === 0) return;

        const uniqueRefs = new Map<
            string,
            { chainId: string; pairAddress: string }
        >();
        for (const t of dexLegs) {
            const r = t.dexPaperPriceRef!;
            const key = `${String(r.chainId).toLowerCase()}\0${r.pairAddress}`;
            if (!uniqueRefs.has(key)) {
                uniqueRefs.set(key, { chainId: r.chainId, pairAddress: r.pairAddress });
            }
        }

        for (const ref of uniqueRefs.values()) {
            const px = await fetchDexPairPriceUsd(ref.chainId, ref.pairAddress);
            if (px != null && px > 0) {
                const markBid = dexPaperBidUsd(px);
                for (const t of [...this.state.activeTrades]) {
                    if (
                        t.dexPaperPriceRef?.chainId === ref.chainId &&
                        t.dexPaperPriceRef.pairAddress === ref.pairAddress
                    ) {
                        this.updatePnlForTrade(t, markBid);
                        this.evaluateExitForTrade(t, markBid);
                    }
                }
            } else {
                this.log(
                    "warn",
                    "DexScreener price fetch failed for one pair during poll; using last price for those legs' exit checks."
                );
                for (const t of [...this.state.activeTrades]) {
                    if (
                        t.dexPaperPriceRef?.chainId === ref.chainId &&
                        t.dexPaperPriceRef.pairAddress === ref.pairAddress
                    ) {
                        this.evaluateExitForTrade(t, t.currentPrice);
                    }
                }
            }
        }

        this.kickAutoSignPendingMainnetSells();
    }

    private closeTradeForTrade(
        trade: PaperTrade,
        exitPrice: number,
        reason: ExitReason,
        options?: { suppressAutoRescan?: boolean }
    ): void {
        const idx = this.state.activeTrades.findIndex((t) => t.id === trade.id);
        if (idx < 0) return;

        const t = this.state.activeTrades[idx];

        if (t.quantity > 0) {
            const remainingQuantity = t.quantity;
            const remainingRealized = new Decimal(exitPrice).minus(t.entryPrice).mul(remainingQuantity);
            const finalSellNotional = new Decimal(exitPrice).mul(remainingQuantity);
            const finalSellFee = finalSellNotional.mul(PAPER_FEE_RATE);
            t.realizedPnlUsdt = Number(new Decimal(t.realizedPnlUsdt).plus(remainingRealized).toFixed(4));
            t.totalFeesUsdt = Number(new Decimal(t.totalFeesUsdt ?? 0).plus(finalSellFee).toFixed(4));
            t.quantity = 0;
        }
        this.updatePnlForTrade(t, exitPrice);

        const closedTrade: PaperTrade = {
            ...t,
            status: "closed",
            exitPrice,
            closedAt: new Date().toISOString(),
            exitReason: reason,
        };

        this.state.tradeHistory = [closedTrade, ...this.state.tradeHistory].slice(0, 50);
        this.state.activeTrades.splice(idx, 1);
        this.syncActiveTradePointer();

        const stillDex = this.state.activeTrades.some((x) => x.dexPaperPriceRef?.chainId);
        if (!stillDex) {
            this.stopDexPaperPricePoll();
        } else if (!this.dexPaperPollTimer) {
            this.startDexPaperPricePoll();
        }

        this.persistState();
        this.log(
            reason === "take_profit" || reason === "dip_retrace" ? "info" : "warn",
            `Paper SELL ${closedTrade.symbol} (${closedTrade.id}) at ${exitPrice}. Reason=${reason}, PnL=${closedTrade.pnlPercent.toFixed(2)}%.`
        );

        if (!options?.suppressAutoRescan && this.state.activeTrades.length === 0) {
            this.queueRescanAfterClose();
        }
    }

    private log(level: BotLog["level"], message: string): void {
        this.state.logs = [
            { time: new Date().toISOString(), level, message },
            ...this.state.logs,
        ].slice(0, 100);
        this.persistState();
    }

    /** Persisted JSON may store step hits as strings; `includes(2)` vs `"2"` would re-fire TP forever. */
    private coerceNumericSortedUniqueHits(values: unknown[] | undefined): number[] {
        if (!Array.isArray(values)) return [];
        return Array.from(
            new Set(values.map((item) => Number(item)).filter((n) => Number.isFinite(n)))
        ).sort((a, b) => a - b);
    }

    private ensureTradeDefaults(trade: PaperTrade): void {
        if (!Array.isArray(trade.takeProfitStepsHit)) trade.takeProfitStepsHit = [];
        if (!Array.isArray(trade.dipStepsHit)) trade.dipStepsHit = [];
        if (!Array.isArray(trade.dipRetracementStepsHit)) trade.dipRetracementStepsHit = [];
        trade.takeProfitStepsHit = this.coerceNumericSortedUniqueHits(trade.takeProfitStepsHit);
        trade.dipStepsHit = this.coerceNumericSortedUniqueHits(trade.dipStepsHit);
        trade.dipRetracementStepsHit = this.coerceNumericSortedUniqueHits(trade.dipRetracementStepsHit);
        if (!Array.isArray(trade.partialFills)) trade.partialFills = [];
        if (!Number.isFinite(trade.totalFeesUsdt)) {
            trade.totalFeesUsdt =
                trade.executionChannel === "mainnet"
                    ? 0
                    : Number(new Decimal(trade.positionSizeUsdt ?? 0).mul(PAPER_FEE_RATE).toFixed(4));
        }
        if (!Number.isFinite(trade.maxHoldMinutesAtEntry)) {
            trade.maxHoldMinutesAtEntry =
                trade.settingsAtOpen?.maxHoldMinutes ?? this.state.config.maxHoldMinutes;
        }
        if (!Number.isFinite(trade.unrealizedPnlUsdt)) {
            const entry = new Decimal(trade.entryPrice);
            const current = new Decimal(trade.currentPrice);
            trade.unrealizedPnlUsdt = Number(
                current.minus(entry).mul(trade.quantity).toFixed(4)
            );
        }
        if (trade.pendingMainnetSell && (!trade.pendingMainnetSells || trade.pendingMainnetSells.length === 0)) {
            trade.pendingMainnetSells = [{ ...trade.pendingMainnetSell }];
        }
        const pq = trade.pendingMainnetSells?.filter(Boolean) ?? [];
        if (pq.length > 0) {
            trade.pendingMainnetSells = pq;
            trade.pendingMainnetSell = pq[0];
        } else {
            trade.pendingMainnetSells = undefined;
            trade.pendingMainnetSell = undefined;
        }
    }

    /**
     * Peak drawdown ladder: % off peak `(peak−price)/peak×100`. Empty steps = off (persisted explicitly).
     * `undefined` input falls back to defaults (new / legacy keys missing).
     */
    /** Peak drawdown ladder: any positive step count ≤100% per step; per-step sell fractions in (0,1]. UI preset `linear_10` = 10…100% off peak with 10%…100% of remaining per step. */
    private normalizeDipFromPeakLadder(
        stepsIn: number[] | undefined,
        fractionsIn: number[] | undefined
    ): { steps: number[]; fractions: number[] } {
        if (!Array.isArray(stepsIn)) {
            return {
                steps: [...DEFAULT_CONFIG.dipStepsPercent],
                fractions: [...DEFAULT_CONFIG.dipStepSellFractions],
            };
        }
        if (stepsIn.length === 0) {
            return { steps: [], fractions: [] };
        }
        const steps = Array.from(
            new Set(
                stepsIn
                    .map((value) => Number(value))
                    .filter((value) => Number.isFinite(value) && value > 0 && value <= 100)
            )
        ).sort((a, b) => a - b);
        if (steps.length === 0) {
            return { steps: [], fractions: [] };
        }
        const rawFrac = Array.isArray(fractionsIn)
            ? fractionsIn
                  .map((value) => Number(value))
                  .filter((value) => Number.isFinite(value) && value > 0 && value <= 1)
            : [];
        const fractions: number[] = [];
        for (let index = 0; index < steps.length; index += 1) {
            const fallbackFrac = DEFAULT_CONFIG.dipStepSellFractions[index] ?? 0.25;
            const value = rawFrac[index];
            fractions.push(
                Number.isFinite(value) && value > 0
                    ? Math.min(1, Math.max(0.05, value))
                    : Math.min(1, Math.max(0.05, fallbackFrac))
            );
        }
        return { steps, fractions };
    }

    /** Empty steps = retracement dip off. */
    private normalizeDipRetracementArrays(
        stepsIn: number[] | undefined,
        fractionsIn: number[] | undefined
    ): { steps: number[]; fractions: number[] } {
        if (!Array.isArray(stepsIn) || stepsIn.length === 0) {
            return { steps: [], fractions: [] };
        }
        const steps = Array.from(
            new Set(
                stepsIn
                    .map((value) => Number(value))
                    .filter((value) => Number.isFinite(value) && value > 0 && value <= 500)
            )
        ).sort((a, b) => a - b);

        const rawFrac = Array.isArray(fractionsIn)
            ? fractionsIn
                  .map((value) => Number(value))
                  .filter((value) => Number.isFinite(value) && value > 0 && value <= 1)
            : [];
        const fractions: number[] = [];
        for (let index = 0; index < steps.length; index += 1) {
            const fallbackFrac = DEFAULT_CONFIG.dipRetracementSellFractions[index] ?? 0.25;
            const value = rawFrac[index];
            fractions.push(
                Number.isFinite(value) && value > 0
                    ? Math.min(1, Math.max(0.05, value))
                    : Math.min(1, Math.max(0.05, fallbackFrac))
            );
        }
        return { steps, fractions };
    }

    /** Per-step sell fractions must match TP step count or are cleared (uniform fraction used). */
    private normalizeTakeProfitStepSellFractions(steps: number[], values: number[]): number[] {
        if (steps.length === 0 || !Array.isArray(values) || values.length === 0) {
            return [];
        }
        if (values.length !== steps.length) {
            return [];
        }
        return values.map((value) =>
            Number.isFinite(value) ? Math.min(1, Math.max(0.05, Number(value))) : 0.25
        );
    }

    /** Empty array = user turned staged take-profit off (no sells on fixed PnL steps). */
    private normalizeTakeProfitStepsPercent(values: number[] | undefined, fallback: number[]): number[] {
        if (!Array.isArray(values)) return [...fallback];
        if (values.length === 0) return [];
        const cleaned = Array.from(
            new Set(
                values
                    .map((value) => Number(value))
                    .filter((value) => Number.isFinite(value) && value > 0 && value <= 100)
            )
        ).sort((a, b) => a - b);
        return cleaned.length > 0 ? cleaned : [...fallback];
    }

    private normalizePercentArray(values: number[] | undefined, fallback: number[]): number[] {
        if (!Array.isArray(values) || values.length === 0) return [...fallback];
        return values
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0 && value <= 100)
            .sort((a, b) => a - b);
    }

    private normalizeFractionArray(values: number[] | undefined, fallback: number[]): number[] {
        if (!Array.isArray(values) || values.length === 0) return [...fallback];
        return values
            .map((value) => Number(value))
            .filter((value) => Number.isFinite(value) && value > 0 && value <= 1);
    }

    private persistState(): void {
        botStore.persistState(this.getState());
    }
}

export const paperBot = new PaperMomentumBot();
