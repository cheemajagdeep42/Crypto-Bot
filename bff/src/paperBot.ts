import Decimal from "decimal.js";
import { dexPaperBidUsd, fetchDexPairPriceUsd, scanTopSignalsDexscreener } from "./dexscreenerScan";
import { BookTickerUpdate, marketStream } from "./marketStream";
import {
    normalizeLiquidityGuard,
    normalizeMinMarketCapUsd,
    scanTopSignals,
    TimeframeKey,
    TokenSignal,
    type LiquidityGuardMode,
} from "./scanner";
import { createBotStore } from "./storage";

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

type BotConfig = {
    marketSource: MarketSource;
    autoMode: boolean;
    liquidityCheckRequired: boolean;
    scanLimit: number;
    timeframe: "30m" | "1h";
    liquidityGuard: LiquidityGuardMode;
    minFiveMinuteFlowUsdt: number;
    /** Minimum market cap (USD) when MC check is on. */
    minMarketCapUsd: number;
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
    scanIntervalSeconds: number;
};
export type BotConfigPatch = Partial<BotConfig>;

/** Bot + scanner settings frozen when a paper trade opens (for UI / audit). */
export type TradeSettingsAtOpen = {
    marketSource: MarketSource;
    autoMode: boolean;
    liquidityCheckRequired: boolean;
    scanLimit: number;
    timeframe: BotConfig["timeframe"];
    liquidityGuard: LiquidityGuardMode;
    minFiveMinuteFlowUsdt: number;
    minMarketCapUsd: number;
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
    scanIntervalSeconds: number;
};

function tradeSettingsAtOpenFromConfig(config: BotConfig): TradeSettingsAtOpen {
    return {
        marketSource: config.marketSource,
        autoMode: config.autoMode,
        liquidityCheckRequired: config.liquidityCheckRequired,
        scanLimit: config.scanLimit,
        timeframe: config.timeframe,
        liquidityGuard: config.liquidityGuard,
        minFiveMinuteFlowUsdt: config.minFiveMinuteFlowUsdt,
        minMarketCapUsd: config.minMarketCapUsd,
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
        scanIntervalSeconds: config.scanIntervalSeconds,
    };
}

type PaperPartialFill = {
    time: string;
    price: number;
    /** Fraction of the position still open before this clip (e.g. 0.25 = sold 25% of remaining). */
    fractionOfRemaining: number;
    quantitySold: number;
    realizedUsdt: number;
    mode: "tp_step" | "dip_step" | "dip_retrace";
    stepPercent: number;
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
};

type BotLog = {
    time: string;
    level: "info" | "warn" | "error";
    message: string;
};

export type BotState = {
    status: BotStatus;
    mode: "paper";
    config: BotConfig;
    activeTrade: PaperTrade | null;
    lastScanTokens: TokenSignal[];
    tradeHistory: PaperTrade[];
    logs: BotLog[];
    lastScanAt: string | null;
    nextScanAt: string | null;
    lastScanTimeframe: TimeframeKey;
};

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
    timeframe: "1h",
    liquidityGuard: "both",
    minFiveMinuteFlowUsdt: 30_000,
    minMarketCapUsd: 1_000_000,
    positionSizeUsdt: 5,
    takeProfitStepsPercent: [1.5, 3, 4.5, 6],
    takeProfitStepSellFraction: 0.25,
    takeProfitStepSellFractions: [],
    dipStepsPercent: [10, 20, 30],
    dipStepSellFractions: [0.25, 0.5, 1],
    dipRetracementStepsPercent: [50, 60, 70, 80, 90, 100],
    dipRetracementSellFractions: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
    /** Min (peak−entry)/entry×100 (whole percent, e.g. 5 = 5%) before downward retracement rules apply. */
    minDipRetracementMfeBasisPercent: 5,
    stopLossPercent: 5,
    maxHoldMinutes: 30,
    scanIntervalSeconds: 120,
};

const botStore = createBotStore();
const PAPER_FEE_RATE = 0.001;

function defaultState(): BotState {
    return {
        status: "stopped",
        mode: "paper",
        config: { ...DEFAULT_CONFIG },
        activeTrade: null,
        lastScanTokens: [],
        tradeHistory: [],
        logs: [],
        lastScanAt: null,
        nextScanAt: null,
        lastScanTimeframe: "24h",
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
        mergedConfig.positionSizeUsdt = Math.max(
            5,
            Math.min(50, Number(mergedConfig.positionSizeUsdt) || DEFAULT_CONFIG.positionSizeUsdt)
        );
        mergedConfig.minDipRetracementMfeBasisPercent = snapMinDipRetracementMfeBasisPercent(
            mergedConfig.minDipRetracementMfeBasisPercent
        );
        mergedConfig.stopLossPercent = normalizeStopLossPercent(mergedConfig.stopLossPercent);
        mergedConfig.minMarketCapUsd = normalizeMinMarketCapUsd(mergedConfig.minMarketCapUsd);
        mergedConfig.liquidityGuard = normalizeLiquidityGuard(mergedConfig.liquidityGuard);

        return {
            ...defaultState(),
            ...parsed,
            status: "stopped",
            mode: "paper",
            config: mergedConfig,
            activeTrade: parsed.activeTrade ?? null,
            tradeHistory: parsed.tradeHistory ?? [],
            logs: parsed.logs ?? [],
            nextScanAt: null,
            lastScanTimeframe: parsed.lastScanTimeframe ?? "24h",
        };
    } catch {
        return defaultState();
    }
}

class PaperMomentumBot {
    private state: BotState = loadPersistedState();

    private timer: NodeJS.Timeout | null = null;
    private dexPaperPollTimer: NodeJS.Timeout | null = null;
    private scanning = false;

    private static readonly DEX_PAPER_POLL_MS = 8_000;

    constructor() {
        marketStream.onBookTicker((update) => this.handleBookTicker(update));
        const trade = this.state.activeTrade;
        if (trade) {
            this.ensureTradeDefaults(trade);
            if (trade.dexPaperPriceRef?.chainId && trade.dexPaperPriceRef?.pairAddress) {
                this.startDexPaperPricePoll();
            } else if (trade.symbol) {
                marketStream.ensureSymbolSubscribed(trade.symbol);
            }
        }
    }

    private cloneTradeShallow(trade: PaperTrade): PaperTrade {
        return {
            ...trade,
            partialFills: trade.partialFills?.map((p) => ({ ...p })),
            settingsAtOpen: trade.settingsAtOpen
                ? (JSON.parse(JSON.stringify(trade.settingsAtOpen)) as TradeSettingsAtOpen)
                : undefined,
        };
    }

    getState(): BotState {
        return {
            ...this.state,
            config: { ...this.state.config },
            activeTrade: this.state.activeTrade ? this.cloneTradeShallow(this.state.activeTrade) : null,
            lastScanTokens: this.state.lastScanTokens.map((token) => ({ ...token })),
            tradeHistory: this.state.tradeHistory.map((t) => this.cloneTradeShallow(t)),
            logs: [...this.state.logs],
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
        if (this.state.activeTrade?.dexPaperPriceRef) {
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
        if (options?.closeActiveTrade && this.state.activeTrade) {
            this.log("info", "Closing active paper trade before stop.");
            this.closeTrade(this.state.activeTrade.currentPrice, "manual", { suppressAutoRescan: true });
        }

        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.state.status = "stopped";
        this.state.nextScanAt = null;
        this.log("info", "Paper bot stopped.");
        this.persistState();
        return this.getState();
    }

    closeActiveTrade(reason: ExitReason = "manual"): BotState {
        if (!this.state.activeTrade) {
            this.log("warn", "No open paper trade to close.");
            return this.getState();
        }

        this.closeTrade(this.state.activeTrade.currentPrice, reason);
        return this.getState();
    }

    async scanOnce(): Promise<BotState> {
        if (this.scanning) return this.getState();
        this.scanning = true;

        try {
            if (this.state.activeTrade) {
                try {
                    if (this.state.activeTrade.dexPaperPriceRef?.chainId) {
                        const ref = this.state.activeTrade.dexPaperPriceRef;
                        const px = await fetchDexPairPriceUsd(ref.chainId, ref.pairAddress);
                        if (px != null && px > 0) {
                            const markBid = dexPaperBidUsd(px);
                            this.updatePnl(markBid);
                            this.evaluateExit(markBid);
                        } else {
                            this.log(
                                "warn",
                                "DexScreener price fetch failed during scan; using last price for exit checks."
                            );
                            this.evaluateExit(this.state.activeTrade.currentPrice);
                        }
                    } else {
                        const tokens = await this.scanCandidates();
                        const sym = this.state.activeTrade.symbol;
                        const activeToken = tokens.find((token) => token.symbol === sym);
                        this.updateActiveTrade(activeToken);
                    }
                } catch (error) {
                    const message = error instanceof Error ? error.message : String(error);
                    this.log("error", `Scan failed: ${message}`);
                    this.updateActiveTradeFromStream();
                }
                this.persistState();
                return this.getState();
            }

            const tokens = await this.scanCandidates();
            this.openBestMomentumTrade(tokens);
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

    async startTrade(symbol: string): Promise<BotState> {
        if (this.state.activeTrade) {
            this.log("warn", "Cannot open a manual trade while another trade is active.");
            return this.getState();
        }

        if (!symbol) {
            this.log("warn", "No token symbol provided for manual trade start.");
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

        this.openTradeFromToken(token, "manual");
        return this.getState();
    }

    extendActiveTradeHold(extendByMinutes: number): BotState {
        const trade = this.state.activeTrade;
        if (!trade) {
            this.log("warn", "No open paper trade to extend.");
            return this.getState();
        }

        const safeExtend = Math.max(1, Math.min(240, Number(extendByMinutes) || 0));
        trade.maxHoldMinutesAtEntry = Math.max(1, Math.min(1440, (trade.maxHoldMinutesAtEntry ?? this.state.config.maxHoldMinutes) + safeExtend));
        this.log("info", `Extended ${trade.symbol} hold timer by ${safeExtend} minute(s). New max hold: ${trade.maxHoldMinutesAtEntry} min.`);
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

    updateConfig(patch: BotConfigPatch): BotState {
        const definedPatch = Object.fromEntries(
            Object.entries(patch).filter(([, value]) => value !== undefined)
        ) as BotConfigPatch;
        const nextConfig: BotConfig = {
            ...this.state.config,
            ...definedPatch,
        };

        nextConfig.scanLimit = Math.max(1, Math.min(20, Number(nextConfig.scanLimit) || 20));
        nextConfig.liquidityCheckRequired = Boolean(nextConfig.liquidityCheckRequired);
        nextConfig.marketSource = normalizeMarketSource(nextConfig.marketSource);
        nextConfig.timeframe = nextConfig.timeframe === "30m" ? "30m" : "1h";
        nextConfig.liquidityGuard = normalizeLiquidityGuard(nextConfig.liquidityGuard);
        const allowedFlowThresholds = new Set([
            10_000, 30_000, 60_000, 100_000, 200_000, 300_000, 500_000, 800_000, 1_000_000, 1_000_001,
        ]);
        const requestedFlow = Number(nextConfig.minFiveMinuteFlowUsdt);
        nextConfig.minFiveMinuteFlowUsdt = allowedFlowThresholds.has(requestedFlow)
            ? requestedFlow
            : DEFAULT_CONFIG.minFiveMinuteFlowUsdt;
        nextConfig.minMarketCapUsd = normalizeMinMarketCapUsd(nextConfig.minMarketCapUsd);
        nextConfig.positionSizeUsdt = Math.max(
            5,
            Math.min(50, Number(nextConfig.positionSizeUsdt) || DEFAULT_CONFIG.positionSizeUsdt)
        );
        nextConfig.stopLossPercent = normalizeStopLossPercent(nextConfig.stopLossPercent);
        nextConfig.maxHoldMinutes = Math.max(1, Math.min(480, Number(nextConfig.maxHoldMinutes) || 30));
        nextConfig.scanIntervalSeconds = Math.max(
            10,
            Math.min(3600, Number(nextConfig.scanIntervalSeconds) || 120)
        );
        nextConfig.takeProfitStepSellFraction = Math.max(
            0.05,
            Math.min(1, Number(nextConfig.takeProfitStepSellFraction) || 0.25)
        );
        nextConfig.takeProfitStepsPercent = this.normalizeTakeProfitStepsPercent(
            nextConfig.takeProfitStepsPercent,
            DEFAULT_CONFIG.takeProfitStepsPercent
        );
        nextConfig.takeProfitStepSellFractions = this.normalizeTakeProfitStepSellFractions(
            nextConfig.takeProfitStepsPercent,
            Array.isArray(nextConfig.takeProfitStepSellFractions)
                ? nextConfig.takeProfitStepSellFractions
                : []
        );
        nextConfig.dipStepsPercent = this.normalizePercentArray(
            nextConfig.dipStepsPercent,
            DEFAULT_CONFIG.dipStepsPercent
        );
        nextConfig.dipStepSellFractions = this.normalizeFractionArray(
            nextConfig.dipStepSellFractions,
            DEFAULT_CONFIG.dipStepSellFractions
        );
        const retracement = this.normalizeDipRetracementArrays(
            nextConfig.dipRetracementStepsPercent,
            nextConfig.dipRetracementSellFractions
        );
        nextConfig.dipRetracementStepsPercent = retracement.steps;
        nextConfig.dipRetracementSellFractions = retracement.fractions;
        nextConfig.minDipRetracementMfeBasisPercent = snapMinDipRetracementMfeBasisPercent(
            nextConfig.minDipRetracementMfeBasisPercent
        );

        this.state.config = nextConfig;

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

    private scheduleNextScan(): void {
        if (this.state.status !== "running" || !this.state.config.autoMode) return;

        const delayMs = this.state.config.scanIntervalSeconds * 1000;
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
        const safeTimeframe = options?.timeframe ?? this.state.config.timeframe;
        const guards = {
            liquidityGuard: this.state.config.liquidityGuard,
            minFiveMinuteFlowUsdt: this.state.config.minFiveMinuteFlowUsdt,
            liquidityCheckRequired: this.state.config.liquidityCheckRequired,
            minMarketCapUsd: this.state.config.minMarketCapUsd,
        };
        const result =
            this.state.config.marketSource === "dexscreener"
                ? await scanTopSignalsDexscreener(safeLimit, safeTimeframe, guards)
                : await scanTopSignals(safeLimit, safeTimeframe, guards);
        this.state.lastScanAt = new Date().toISOString();
        this.state.lastScanTokens = result.tokens;
        this.state.lastScanTimeframe = safeTimeframe;
        this.persistState();
        return result.tokens;
    }

    private openBestMomentumTrade(tokens: TokenSignal[]): void {
        const candidate = tokens.find((token) => {
            if (!token.momentumEntry) return false;
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
        });

        if (!candidate) {
            this.log(
                "info",
                "No momentum entry found. Gates require strong 5m micro-trend, minimum 5m flow, and (when MC check is on) minimum market cap."
            );
            return;
        }

        this.openTradeFromToken(candidate, "auto");
    }

    private openTradeFromToken(token: TokenSignal, mode: "auto" | "manual"): void {
        if (this.state.activeTrade) return;

        const entryPrice = token.ask;
        const quantity = new Decimal(this.state.config.positionSizeUsdt)
            .div(entryPrice)
            .toNumber();

        const dexRef =
            token.metadata?.dexPairAddress && token.metadata?.dexChainId
                ? { chainId: token.metadata.dexChainId, pairAddress: token.metadata.dexPairAddress }
                : undefined;

        this.state.activeTrade = {
            id: `${token.symbol}-${Date.now()}`,
            status: "open",
            symbol: token.symbol,
            baseAsset: token.baseAsset,
            entryPrice,
            quantity,
            positionSizeUsdt: this.state.config.positionSizeUsdt,
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
            entryTimeframe: this.state.lastScanTimeframe ?? this.state.config.timeframe,
            entryGainPercent: token.gainPercent ?? null,
            entryFiveMinuteChangePercent: token.fiveMinuteChangePercent ?? null,
            entryReason: token.momentumReason,
            totalFeesUsdt: Number(
                new Decimal(this.state.config.positionSizeUsdt).mul(PAPER_FEE_RATE).toFixed(4)
            ),
            maxHoldMinutesAtEntry: this.state.config.maxHoldMinutes,
            dexPaperPriceRef: dexRef,
            chartUrl: token.links?.binance,
            partialFills: [],
            settingsAtOpen: tradeSettingsAtOpenFromConfig(this.state.config),
        };
        if (dexRef) {
            this.startDexPaperPricePoll();
        } else {
            marketStream.ensureSymbolSubscribed(token.symbol);
        }
        this.persistState();

        const reasonPrefix = mode === "manual" ? "Manual BUY" : "Paper BUY";
        this.log(
            "info",
            `${reasonPrefix} ${token.symbol} at ${entryPrice} using $${
                this.state.config.positionSizeUsdt
            }. 5m move: ${token.fiveMinutePriceAgo ?? "n/a"} -> ${
                token.currentFiveMinutePrice ?? "n/a"
            } (${token.fiveMinuteChangePercent?.toFixed(2) ?? "n/a"}%). ${token.momentumReason}`
        );
    }

    private updateActiveTrade(activeToken: TokenSignal | undefined): void {
        const trade = this.state.activeTrade;
        if (!trade) return;

        if (!activeToken) {
            this.log("warn", `${trade.symbol} not found in scan window. Holding until exit rule triggers.`);
            this.evaluateExit(trade.currentPrice);
            return;
        }

        this.updatePnl(activeToken.bid);
        this.evaluateExit(activeToken.bid);
    }

    private updateActiveTradeFromStream(): void {
        const trade = this.state.activeTrade;
        if (!trade) return;

        if (trade.dexPaperPriceRef) {
            this.log(
                "warn",
                `${trade.symbol} is priced via DexScreener polling; Binance book not available.`
            );
            this.evaluateExit(trade.currentPrice);
            return;
        }

        const book = marketStream.getBook(trade.symbol);

        if (!book) {
            this.log("warn", `${trade.symbol} has no WebSocket price yet. Waiting for streamed price update.`);
            this.evaluateExit(trade.currentPrice);
            return;
        }

        this.updatePnl(book.bid);
        this.evaluateExit(book.bid);
    }

    private handleBookTicker(update: BookTickerUpdate): void {
        const trade = this.state.activeTrade;
        if (!trade || update.symbol !== trade.symbol) return;
        if (trade.dexPaperPriceRef) return;

        this.updatePnl(update.bid);
        this.evaluateExit(update.bid);
    }

    private updatePnl(currentPrice: number): void {
        const trade = this.state.activeTrade;
        if (!trade) return;
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

    /**
     * Retracement % of the favorable move: (peak − price) / (peak − entry) × 100.
     * Sells `dipRetracementSellFractions[i]` of **remaining** quantity when crossed (no staged TP required).
     */
    private tryDipRetracementFromEntry(currentPrice: number, trade: PaperTrade): boolean {
        const steps = this.state.config.dipRetracementStepsPercent;
        if (steps.length === 0) return false;

        const entry = trade.entryPrice;
        const peak = trade.peakPrice;
        const mfe = peak - entry;
        const minBasis = this.state.config.minDipRetracementMfeBasisPercent;
        if (
            !Number.isFinite(mfe) ||
            mfe <= 0 ||
            (mfe / Math.max(entry, Number.EPSILON)) * 100 < minBasis
        ) {
            return false;
        }

        const retracePercent = ((peak - currentPrice) / mfe) * 100;
        if (!Number.isFinite(retracePercent)) return false;

        for (let index = 0; index < steps.length; index += 1) {
            const step = steps[index];
            if (trade.dipRetracementStepsHit.some((hit) => Number(hit) === Number(step))) continue;
            if (retracePercent < step) continue;

            const sellFraction = this.state.config.dipRetracementSellFractions[index] ?? 0.25;
            if (sellFraction >= 1) {
                this.closeTrade(currentPrice, "dip_retrace");
            } else {
                this.takePartialProfit(currentPrice, sellFraction, "dip_retrace", step);
                trade.dipRetracementStepsHit = [...trade.dipRetracementStepsHit, step].sort((a, b) => a - b);
                this.persistState();
            }
            return true;
        }

        return false;
    }

    private evaluateExit(currentPrice: number): void {
        const trade = this.state.activeTrade;
        if (!trade) return;
        this.ensureTradeDefaults(trade);

        const ageMinutes = (Date.now() - new Date(trade.openedAt).getTime()) / 60_000;

        if (trade.pnlPercent <= -this.state.config.stopLossPercent) {
            this.closeTrade(currentPrice, "stop_loss");
            return;
        }

        const tpSteps = this.state.config.takeProfitStepsPercent;
        const tpFracs = this.state.config.takeProfitStepSellFractions;
        for (let index = 0; index < tpSteps.length; index += 1) {
            const step = tpSteps[index];
            const stepAlreadyHit = trade.takeProfitStepsHit.some((hit) => Number(hit) === Number(step));
            if (trade.pnlPercent >= step && !stepAlreadyHit) {
                const clipFraction =
                    tpFracs.length > index && Number.isFinite(tpFracs[index])
                        ? Math.min(1, Math.max(0.05, tpFracs[index]))
                        : this.state.config.takeProfitStepSellFraction;
                this.takePartialProfit(currentPrice, clipFraction, "tp_step", step);
                trade.takeProfitStepsHit = [...trade.takeProfitStepsHit, step].sort((a, b) => a - b);
                this.persistState();
                return;
            }
        }

        if (this.tryDipRetracementFromEntry(currentPrice, trade)) {
            return;
        }

        if (trade.takeProfitStepsHit.length > 0) {
            if (this.state.config.dipRetracementStepsPercent.length === 0) {
                const drawdownPercent =
                    ((trade.peakPrice - trade.currentPrice) / Math.max(trade.peakPrice, Number.EPSILON)) * 100;

                for (let index = 0; index < this.state.config.dipStepsPercent.length; index += 1) {
                    const dipStep = this.state.config.dipStepsPercent[index];
                    if (drawdownPercent < dipStep || trade.dipStepsHit.some((hit) => Number(hit) === Number(dipStep)))
                        continue;

                    const sellFraction = this.state.config.dipStepSellFractions[index] ?? 1;
                    if (sellFraction >= 1) {
                        this.closeTrade(currentPrice, "red_dip");
                    } else {
                        this.takePartialProfit(currentPrice, sellFraction, "dip_step", dipStep);
                        trade.dipStepsHit = [...trade.dipStepsHit, dipStep].sort((a, b) => a - b);
                        this.persistState();
                    }
                    return;
                }
            }
        }

        const maxHoldForTrade = trade.maxHoldMinutesAtEntry ?? this.state.config.maxHoldMinutes;
        if (ageMinutes >= maxHoldForTrade) {
            this.closeTrade(currentPrice, "time_stop");
        }
    }

    private takePartialProfit(
        exitPrice: number,
        requestedFraction: number,
        mode: "tp_step" | "dip_step" | "dip_retrace",
        stepPercent: number
    ): void {
        const trade = this.state.activeTrade;
        if (!trade) return;

        const closePercent = Math.min(1, Math.max(0.05, requestedFraction));
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
        trade.partialFills.push({
            time: new Date().toISOString(),
            price: exitPrice,
            fractionOfRemaining: closePercent,
            quantitySold: quantityToClose,
            realizedUsdt: Number(realized.toFixed(4)),
            mode,
            stepPercent,
        });
        this.updatePnl(exitPrice);

        if (trade.quantity <= 0) {
            this.closeTrade(exitPrice, mode === "dip_retrace" ? "dip_retrace" : "take_profit");
        }
    }

    private startDexPaperPricePoll(): void {
        this.stopDexPaperPricePoll();
        const trade = this.state.activeTrade;
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
        const trade = this.state.activeTrade;
        const ref = trade?.dexPaperPriceRef;
        if (!trade || !ref?.chainId || !ref.pairAddress) return;

        const px = await fetchDexPairPriceUsd(ref.chainId, ref.pairAddress);
        if (px == null || px <= 0) return;

        const markBid = dexPaperBidUsd(px);
        this.updatePnl(markBid);
        this.evaluateExit(markBid);
    }

    private closeTrade(
        exitPrice: number,
        reason: ExitReason,
        options?: { suppressAutoRescan?: boolean }
    ): void {
        const trade = this.state.activeTrade;
        if (!trade) return;

        this.stopDexPaperPricePoll();

        if (trade.quantity > 0) {
            const remainingQuantity = trade.quantity;
            const remainingRealized = new Decimal(exitPrice)
                .minus(trade.entryPrice)
                .mul(remainingQuantity);
            const finalSellNotional = new Decimal(exitPrice).mul(remainingQuantity);
            const finalSellFee = finalSellNotional.mul(PAPER_FEE_RATE);
            trade.realizedPnlUsdt = Number(
                new Decimal(trade.realizedPnlUsdt).plus(remainingRealized).toFixed(4)
            );
            trade.totalFeesUsdt = Number(
                new Decimal(trade.totalFeesUsdt ?? 0).plus(finalSellFee).toFixed(4)
            );
            trade.quantity = 0;
        }
        this.updatePnl(exitPrice);

        const closedTrade: PaperTrade = {
            ...trade,
            status: "closed",
            exitPrice,
            closedAt: new Date().toISOString(),
            exitReason: reason,
        };

        this.state.tradeHistory = [closedTrade, ...this.state.tradeHistory].slice(0, 50);
        this.state.activeTrade = null;
        this.persistState();
        this.log(
            reason === "take_profit" || reason === "dip_retrace" ? "info" : "warn",
            `Paper SELL ${closedTrade.symbol} at ${exitPrice}. Reason=${reason}, PnL=${closedTrade.pnlPercent.toFixed(2)}%.`
        );

        if (!options?.suppressAutoRescan) {
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
            trade.totalFeesUsdt = Number(
                new Decimal(trade.positionSizeUsdt ?? 0).mul(PAPER_FEE_RATE).toFixed(4)
            );
        }
        if (!Number.isFinite(trade.maxHoldMinutesAtEntry)) {
            trade.maxHoldMinutesAtEntry = this.state.config.maxHoldMinutes;
        }
        if (!Number.isFinite(trade.unrealizedPnlUsdt)) {
            const entry = new Decimal(trade.entryPrice);
            const current = new Decimal(trade.currentPrice);
            trade.unrealizedPnlUsdt = Number(
                current.minus(entry).mul(trade.quantity).toFixed(4)
            );
        }
    }

    /** Empty steps = retracement dip off (use legacy peak dip after TP only). */
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
