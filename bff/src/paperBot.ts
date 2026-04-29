import Decimal from "decimal.js";
import { BookTickerUpdate, marketStream } from "./marketStream";
import { scanTopSignals, TimeframeKey, TokenSignal } from "./scanner";
import { createBotStore } from "./storage";

type BotStatus = "stopped" | "running";
type TradeStatus = "open" | "closed";
type ExitReason =
    | "take_profit"
    | "stop_loss"
    | "time_stop"
    | "manual"
    | "break_even"
    | "red_dip";

type BotConfig = {
    autoMode: boolean;
    liquidityCheckRequired: boolean;
    scanLimit: number;
    timeframe: "30m" | "1h";
    liquidityGuard: "both";
    minFiveMinuteFlowUsdt: number;
    positionSizeUsdt: number;
    takeProfitStepsPercent: number[];
    takeProfitStepSellFraction: number;
    dipStepsPercent: number[];
    dipStepSellFractions: number[];
    breakEvenBufferPercent: number;
    stopLossPercent: number;
    maxHoldMinutes: number;
    scanIntervalSeconds: number;
};
type BotConfigPatch = Partial<BotConfig>;

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
    realizedPnlUsdt: number;
    peakPrice: number;
    takeProfitStepsHit: number[];
    dipStepsHit: number[];
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

const DEFAULT_CONFIG: BotConfig = {
    autoMode: false,
    liquidityCheckRequired: false,
    scanLimit: 20,
    timeframe: "1h",
    liquidityGuard: "both",
    minFiveMinuteFlowUsdt: 30_000,
    positionSizeUsdt: 5,
    takeProfitStepsPercent: [1.5, 3, 4.5, 6],
    takeProfitStepSellFraction: 0.25,
    dipStepsPercent: [10, 20, 30],
    dipStepSellFractions: [0.25, 0.5, 1],
    breakEvenBufferPercent: 0.25,
    stopLossPercent: 1.5,
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
    private scanning = false;

    constructor() {
        marketStream.onBookTicker((update) => this.handleBookTicker(update));
        if (this.state.activeTrade?.symbol) {
            marketStream.ensureSymbolSubscribed(this.state.activeTrade.symbol);
            this.ensureTradeDefaults(this.state.activeTrade);
        }
    }

    getState(): BotState {
        return {
            ...this.state,
            config: { ...this.state.config },
            activeTrade: this.state.activeTrade ? { ...this.state.activeTrade } : null,
            lastScanTokens: this.state.lastScanTokens.map((token) => ({ ...token })),
            tradeHistory: this.state.tradeHistory.map((trade) => ({ ...trade })),
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
                    const tokens = await this.scanCandidates();
                    const sym = this.state.activeTrade.symbol;
                    const activeToken = tokens.find((token) => token.symbol === sym);
                    this.updateActiveTrade(activeToken);
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
        const nextConfig: BotConfig = {
            ...this.state.config,
            ...patch,
        };

        nextConfig.scanLimit = Math.max(1, Math.min(20, Number(nextConfig.scanLimit) || 20));
        nextConfig.liquidityCheckRequired = Boolean(nextConfig.liquidityCheckRequired);
        nextConfig.timeframe = nextConfig.timeframe === "30m" ? "30m" : "1h";
        nextConfig.liquidityGuard = "both";
        const allowedFlowThresholds = new Set([
            10_000, 30_000, 60_000, 100_000, 200_000, 300_000, 500_000, 800_000, 1_000_000, 1_000_001,
        ]);
        const requestedFlow = Number(nextConfig.minFiveMinuteFlowUsdt);
        nextConfig.minFiveMinuteFlowUsdt = allowedFlowThresholds.has(requestedFlow)
            ? requestedFlow
            : DEFAULT_CONFIG.minFiveMinuteFlowUsdt;
        nextConfig.positionSizeUsdt = Math.max(
            5,
            Math.min(50, Number(nextConfig.positionSizeUsdt) || DEFAULT_CONFIG.positionSizeUsdt)
        );
        nextConfig.breakEvenBufferPercent = Math.max(
            0,
            Math.min(5, Number(nextConfig.breakEvenBufferPercent) || 0)
        );
        nextConfig.stopLossPercent = Math.max(0.2, Math.min(10, Number(nextConfig.stopLossPercent) || 1.5));
        nextConfig.maxHoldMinutes = Math.max(1, Math.min(480, Number(nextConfig.maxHoldMinutes) || 30));
        nextConfig.scanIntervalSeconds = Math.max(
            10,
            Math.min(3600, Number(nextConfig.scanIntervalSeconds) || 120)
        );
        nextConfig.takeProfitStepSellFraction = Math.max(
            0.05,
            Math.min(1, Number(nextConfig.takeProfitStepSellFraction) || 0.25)
        );
        nextConfig.takeProfitStepsPercent = this.normalizePercentArray(
            nextConfig.takeProfitStepsPercent,
            DEFAULT_CONFIG.takeProfitStepsPercent
        );
        nextConfig.dipStepsPercent = this.normalizePercentArray(
            nextConfig.dipStepsPercent,
            DEFAULT_CONFIG.dipStepsPercent
        );
        nextConfig.dipStepSellFractions = this.normalizeFractionArray(
            nextConfig.dipStepSellFractions,
            DEFAULT_CONFIG.dipStepSellFractions
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
        const result = await scanTopSignals(
            safeLimit,
            safeTimeframe,
            {
                liquidityGuard: this.state.config.liquidityGuard,
                minFiveMinuteFlowUsdt: this.state.config.minFiveMinuteFlowUsdt,
                liquidityCheckRequired: this.state.config.liquidityCheckRequired,
            }
        );
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
            return microTrendOk && flow5mOk;
        });

        if (!candidate) {
            this.log(
                "info",
                "No momentum entry found. 5m gates require a strong micro-trend and minimum 5m flow."
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
            realizedPnlUsdt: 0,
            peakPrice: entryPrice,
            takeProfitStepsHit: [],
            dipStepsHit: [],
            entryMode: mode,
            entryTimeframe: this.state.lastScanTimeframe ?? this.state.config.timeframe,
            entryGainPercent: token.gainPercent ?? null,
            entryFiveMinuteChangePercent: token.fiveMinuteChangePercent ?? null,
            entryReason: token.momentumReason,
            totalFeesUsdt: Number(
                new Decimal(this.state.config.positionSizeUsdt).mul(PAPER_FEE_RATE).toFixed(4)
            ),
            maxHoldMinutesAtEntry: this.state.config.maxHoldMinutes,
        };
        marketStream.ensureSymbolSubscribed(token.symbol);
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
        trade.pnlPercent = Number(pnlPercent.toFixed(4));
        trade.pnlUsdt = Number(totalPnlUsdt.toFixed(4));
        this.persistState();
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

        for (const step of this.state.config.takeProfitStepsPercent) {
            if (trade.pnlPercent >= step && !trade.takeProfitStepsHit.includes(step)) {
                this.takePartialProfit(currentPrice, this.state.config.takeProfitStepSellFraction, "tp_step", step);
                trade.takeProfitStepsHit = [...trade.takeProfitStepsHit, step].sort((a, b) => a - b);
                this.persistState();
                return;
            }
        }

        if (trade.takeProfitStepsHit.length > 0) {
            const entry = new Decimal(trade.entryPrice);
            const breakEvenStop = entry.mul(
                new Decimal(1).plus(new Decimal(this.state.config.breakEvenBufferPercent).div(100))
            );

            if (new Decimal(currentPrice).lte(breakEvenStop)) {
                this.closeTrade(currentPrice, "break_even");
                return;
            }

            const drawdownPercent =
                ((trade.peakPrice - trade.currentPrice) / Math.max(trade.peakPrice, Number.EPSILON)) * 100;

            for (let index = 0; index < this.state.config.dipStepsPercent.length; index += 1) {
                const dipStep = this.state.config.dipStepsPercent[index];
                if (drawdownPercent < dipStep || trade.dipStepsHit.includes(dipStep)) continue;

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

        const maxHoldForTrade = trade.maxHoldMinutesAtEntry ?? this.state.config.maxHoldMinutes;
        if (ageMinutes >= maxHoldForTrade) {
            this.closeTrade(currentPrice, "time_stop");
        }
    }

    private takePartialProfit(
        exitPrice: number,
        requestedFraction: number,
        mode: "tp_step" | "dip_step",
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
        this.updatePnl(exitPrice);

        const modeText = mode === "tp_step" ? "TP STEP" : "DIP STEP";
        this.log(
            "info",
            `Paper PARTIAL SELL ${trade.symbol} at ${exitPrice}. ${modeText} ${stepPercent.toFixed(
                2
            )}% hit, closed ${(closePercent * 100).toFixed(0)}%, realized $${realized.toFixed(4)}.`
        );

        if (trade.quantity <= 0) {
            this.closeTrade(exitPrice, "take_profit");
        }
    }

    private closeTrade(
        exitPrice: number,
        reason: ExitReason,
        options?: { suppressAutoRescan?: boolean }
    ): void {
        const trade = this.state.activeTrade;
        if (!trade) return;

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
            reason === "take_profit" ? "info" : "warn",
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

    private ensureTradeDefaults(trade: PaperTrade): void {
        if (!Array.isArray(trade.takeProfitStepsHit)) trade.takeProfitStepsHit = [];
        if (!Array.isArray(trade.dipStepsHit)) trade.dipStepsHit = [];
        if (!Number.isFinite(trade.totalFeesUsdt)) {
            trade.totalFeesUsdt = Number(
                new Decimal(trade.positionSizeUsdt ?? 0).mul(PAPER_FEE_RATE).toFixed(4)
            );
        }
        if (!Number.isFinite(trade.maxHoldMinutesAtEntry)) {
            trade.maxHoldMinutesAtEntry = this.state.config.maxHoldMinutes;
        }
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
