import Decimal from "decimal.js";
import { scanTopSignals, TokenSignal } from "./scanner";

type BotStatus = "stopped" | "running";
type TradeStatus = "open" | "closed";
type ExitReason = "take_profit" | "stop_loss" | "time_stop" | "manual";

type BotConfig = {
    scanLimit: number;
    timeframe: "30m" | "1h";
    positionSizeUsdt: number;
    takeProfitPercent: number;
    stopLossPercent: number;
    maxHoldMinutes: number;
    scanIntervalSeconds: number;
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
    exitPrice?: number;
    closedAt?: string;
    exitReason?: ExitReason;
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
    tradeHistory: PaperTrade[];
    logs: BotLog[];
    lastScanAt: string | null;
    nextScanAt: string | null;
};

const DEFAULT_CONFIG: BotConfig = {
    scanLimit: 20,
    timeframe: "1h",
    positionSizeUsdt: 100,
    takeProfitPercent: 2.5,
    stopLossPercent: 1.5,
    maxHoldMinutes: 30,
    scanIntervalSeconds: 60,
};

class PaperMomentumBot {
    private state: BotState = {
        status: "stopped",
        mode: "paper",
        config: DEFAULT_CONFIG,
        activeTrade: null,
        tradeHistory: [],
        logs: [],
        lastScanAt: null,
        nextScanAt: null,
    };

    private timer: NodeJS.Timeout | null = null;
    private scanning = false;

    getState(): BotState {
        return {
            ...this.state,
            config: { ...this.state.config },
            activeTrade: this.state.activeTrade ? { ...this.state.activeTrade } : null,
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
        void this.scanOnce();
        this.scheduleNextScan();
        return this.getState();
    }

    stop(): BotState {
        if (this.timer) {
            clearTimeout(this.timer);
            this.timer = null;
        }

        this.state.status = "stopped";
        this.state.nextScanAt = null;
        this.log("info", "Paper bot stopped.");
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
            const result = await scanTopSignals(
                this.state.config.scanLimit,
                this.state.config.timeframe
            );
            this.state.lastScanAt = new Date().toISOString();

            if (this.state.activeTrade) {
                const active = result.tokens.find(
                    (token) => token.symbol === this.state.activeTrade?.symbol
                );
                this.updateActiveTrade(active);
            } else {
                this.openBestMomentumTrade(result.tokens);
            }
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            this.log("error", `Scan failed: ${message}`);
        } finally {
            this.scanning = false;
        }

        return this.getState();
    }

    private scheduleNextScan(): void {
        if (this.state.status !== "running") return;

        const delayMs = this.state.config.scanIntervalSeconds * 1000;
        this.state.nextScanAt = new Date(Date.now() + delayMs).toISOString();
        this.timer = setTimeout(() => {
            void this.scanOnce().finally(() => this.scheduleNextScan());
        }, delayMs);
    }

    private openBestMomentumTrade(tokens: TokenSignal[]): void {
        const candidate = tokens.find((token) => token.momentumEntry);

        if (!candidate) {
            this.log("info", "No momentum entry found. Waiting for next scan.");
            return;
        }

        const entryPrice = candidate.ask;
        const quantity = new Decimal(this.state.config.positionSizeUsdt)
            .div(entryPrice)
            .toNumber();

        this.state.activeTrade = {
            id: `${candidate.symbol}-${Date.now()}`,
            status: "open",
            symbol: candidate.symbol,
            baseAsset: candidate.baseAsset,
            entryPrice,
            quantity,
            positionSizeUsdt: this.state.config.positionSizeUsdt,
            openedAt: new Date().toISOString(),
            currentPrice: entryPrice,
            pnlPercent: 0,
            pnlUsdt: 0,
        };

        this.log(
            "info",
            `Paper BUY ${candidate.symbol} at ${entryPrice} using $${this.state.config.positionSizeUsdt}. ${candidate.momentumReason}`
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

    private updatePnl(currentPrice: number): void {
        const trade = this.state.activeTrade;
        if (!trade) return;

        const entry = new Decimal(trade.entryPrice);
        const current = new Decimal(currentPrice);
        const pnlPercent = current.minus(entry).div(entry).mul(100);
        const pnlUsdt = new Decimal(trade.positionSizeUsdt).mul(pnlPercent).div(100);

        trade.currentPrice = currentPrice;
        trade.pnlPercent = Number(pnlPercent.toFixed(4));
        trade.pnlUsdt = Number(pnlUsdt.toFixed(4));
    }

    private evaluateExit(currentPrice: number): void {
        const trade = this.state.activeTrade;
        if (!trade) return;

        const ageMinutes = (Date.now() - new Date(trade.openedAt).getTime()) / 60_000;

        if (trade.pnlPercent >= this.state.config.takeProfitPercent) {
            this.closeTrade(currentPrice, "take_profit");
            return;
        }

        if (trade.pnlPercent <= -this.state.config.stopLossPercent) {
            this.closeTrade(currentPrice, "stop_loss");
            return;
        }

        if (ageMinutes >= this.state.config.maxHoldMinutes) {
            this.closeTrade(currentPrice, "time_stop");
        }
    }

    private closeTrade(exitPrice: number, reason: ExitReason): void {
        const trade = this.state.activeTrade;
        if (!trade) return;

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
        this.log(
            reason === "take_profit" ? "info" : "warn",
            `Paper SELL ${closedTrade.symbol} at ${exitPrice}. Reason=${reason}, PnL=${closedTrade.pnlPercent.toFixed(2)}%.`
        );
    }

    private log(level: BotLog["level"], message: string): void {
        this.state.logs = [
            { time: new Date().toISOString(), level, message },
            ...this.state.logs,
        ].slice(0, 100);
    }
}

export const paperBot = new PaperMomentumBot();
