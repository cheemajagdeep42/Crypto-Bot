import Decimal from "decimal.js";
import { getCoinMarketCapUrl, getTokenMetadata } from "./tokenMetadata";

type Ticker24h = {
    symbol: string;
    priceChangePercent: string;
    quoteVolume: string;
    lastPrice: string;
    count: number;
};

type BookTicker = {
    symbol: string;
    bidPrice: string;
    askPrice: string;
};

type RollingTicker = {
    symbol: string;
    priceChangePercent: string;
    quoteVolume: string;
    lastPrice: string;
    count: number;
};

type Kline = [
    number,
    string,
    string,
    string,
    string,
    string,
    number,
    string,
    string,
    string,
    string,
    string
];

type Candidate = {
    symbol: string;
    gain: Decimal;
    volume: Decimal;
    trades: number;
    bid: Decimal;
    ask: Decimal;
    spread: Decimal;
    lastPrice: Decimal;
};

export type FactorStatus = "good" | "warn" | "bad";
export type SignalLabel = "good_buy" | "watch" | "bad_buy";

export type SignalFactor = {
    name: string;
    status: FactorStatus;
    value: string;
    note: string;
};

export type TokenSignal = {
    symbol: string;
    baseAsset: string;
    lastPrice: number;
    bid: number;
    ask: number;
    gainPercent: number;
    quoteVolume: number;
    trades: number;
    spreadPercent: number;
    pullbackPercent: number | null;
    momentumEntry: boolean;
    momentumReason: string;
    signal: SignalLabel;
    score: number;
    confidence: "high" | "medium" | "low";
    links: {
        coinMarketCap: string;
        binance: string;
    };
    metadata: {
        contractAddress?: string;
        chain?: string;
    };
    factors: SignalFactor[];
};

export type ScanResult = {
    updatedAt: string;
    limit: number;
    timeframe: TimeframeKey;
    timeframeLabel: string;
    tokens: TokenSignal[];
};

export type TimeframeKey =
    | "30m"
    | "1h"
    | "3h"
    | "6h"
    | "12h"
    | "24h"
    | "3d"
    | "1w"
    | "1mo";

type TimeframeConfig = {
    label: string;
    rollingWindow?: string;
};

const BASE_URL = process.env.BINANCE_BASE_URL ?? "https://api.binance.com";

const MIN_VOLUME_USDT = new Decimal(20_000_000);
const MIN_TRADABLE_VOLUME_USDT = new Decimal(1_000_000);
const MIN_MOMENTUM_VOLUME_USDT = new Decimal(100_000);
const MIN_GAIN = new Decimal(3);
const MAX_GAIN = new Decimal(25);
const MAX_SPREAD_PERCENT = new Decimal(0.2);

const PULLBACK_MIN_PERCENT = new Decimal(2);
const PULLBACK_MAX_PERCENT = new Decimal(5);

const TIMEFRAMES: Record<TimeframeKey, TimeframeConfig> = {
    "30m": { label: "Last 30 minutes", rollingWindow: "30m" },
    "1h": { label: "Last 1 hour", rollingWindow: "1h" },
    "3h": { label: "Last 3 hours", rollingWindow: "3h" },
    "6h": { label: "Last 6 hours", rollingWindow: "6h" },
    "12h": { label: "Last 12 hours", rollingWindow: "12h" },
    "24h": { label: "Last 24 hours", rollingWindow: "1d" },
    "3d": { label: "Last 3 days", rollingWindow: "3d" },
    "1w": { label: "Last 1 week", rollingWindow: "7d" },
    "1mo": { label: "Last 1 month" },
};

const TIMEFRAME_KEYS = new Set<string>(Object.keys(TIMEFRAMES));

export function parseTimeframe(value: string | null): TimeframeKey {
    return value && TIMEFRAME_KEYS.has(value) ? (value as TimeframeKey) : "24h";
}

async function fetchJson<T>(url: string): Promise<T> {
    const res = await fetch(url);

    if (!res.ok) {
        const text = await res.text();
        throw new Error(`HTTP ${res.status}: ${text}`);
    }

    return (await res.json()) as T;
}

async function get24hTickers(): Promise<Ticker24h[]> {
    return fetchJson<Ticker24h[]>(`${BASE_URL}/api/v3/ticker/24hr`);
}

async function getRollingTickers(symbols: string[], windowSize: string): Promise<RollingTicker[]> {
    const chunks: string[][] = [];

    for (let i = 0; i < symbols.length; i += 100) {
        chunks.push(symbols.slice(i, i + 100));
    }

    const responses = await Promise.all(
        chunks.map((chunk) => {
            const encodedSymbols = encodeURIComponent(JSON.stringify(chunk));
            return fetchJson<RollingTicker[]>(
                `${BASE_URL}/api/v3/ticker?symbols=${encodedSymbols}&windowSize=${windowSize}&type=FULL`
            );
        })
    );

    return responses.flat();
}

async function getBookTickers(): Promise<BookTicker[]> {
    return fetchJson<BookTicker[]>(`${BASE_URL}/api/v3/ticker/bookTicker`);
}

async function getKlines(
    symbol: string,
    interval: "5m" | "15m",
    limit = 50
): Promise<Kline[]> {
    return fetchJson<Kline[]>(
        `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
    );
}

async function getMonthlyTicker(symbol: string, fallback: Ticker24h): Promise<RollingTicker | null> {
    const dailyKlines = await fetchJson<Kline[]>(
        `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=1d&limit=31`
    ).catch(() => [] as Kline[]);

    if (dailyKlines.length < 2) return null;

    const firstOpen = new Decimal(dailyKlines[0][1]);
    const lastClose = new Decimal(dailyKlines[dailyKlines.length - 1][4]);
    if (firstOpen.lte(0)) return null;

    const quoteVolume = dailyKlines.reduce(
        (total, candle) => total.plus(new Decimal(candle[7])),
        new Decimal(0)
    );
    const trades = dailyKlines.reduce((total, candle) => total + Number(candle[8]), 0);
    const priceChangePercent = lastClose.minus(firstOpen).div(firstOpen).mul(100);

    return {
        symbol,
        priceChangePercent: priceChangePercent.toString(),
        quoteVolume: quoteVolume.toString(),
        lastPrice: lastClose.toString(),
        count: Number.isFinite(trades) ? trades : fallback.count,
    };
}

async function mapWithConcurrency<T, R>(
    items: T[],
    concurrency: number,
    mapper: (item: T) => Promise<R>
): Promise<R[]> {
    const results: R[] = [];
    let nextIndex = 0;

    async function worker(): Promise<void> {
        while (nextIndex < items.length) {
            const currentIndex = nextIndex;
            nextIndex += 1;
            results[currentIndex] = await mapper(items[currentIndex]);
        }
    }

    await Promise.all(
        Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
    );

    return results;
}

function spreadPercent(bid: Decimal, ask: Decimal): Decimal {
    if (bid.lte(0) || ask.lte(0)) return new Decimal(999);
    return ask.minus(bid).div(ask).mul(100);
}

function getCloses(klines: Kline[]): Decimal[] {
    return klines.map((k) => new Decimal(k[4]));
}

function isUptrend15m(closes: Decimal[]): boolean {
    if (closes.length < 11) return false;

    const last = closes[closes.length - 1];
    const fiveCandlesAgo = closes[closes.length - 6];
    const tenCandlesAgo = closes[closes.length - 11];

    return last.gt(fiveCandlesAgo) && fiveCandlesAgo.gt(tenCandlesAgo);
}

function getPullbackPercent(closes: Decimal[]): Decimal {
    const recent = closes.slice(-12);
    const high = Decimal.max(...recent);
    const current = recent[recent.length - 1];

    if (high.lte(0)) return new Decimal(999);
    return high.minus(current).div(high).mul(100);
}

function isRecovering5m(closes: Decimal[]): boolean {
    if (closes.length < 3) return false;

    const last = closes[closes.length - 1];
    const prev = closes[closes.length - 2];
    const prev2 = closes[closes.length - 3];

    return last.gt(prev) && prev.gte(prev2);
}

function toNumber(value: Decimal): number {
    return Number(value.toFixed(8));
}

function statusPoints(status: FactorStatus): number {
    if (status === "good") return 2;
    if (status === "warn") return 1;
    return 0;
}

function labelFromScore(score: number, hardFail: boolean): SignalLabel {
    if (hardFail || score <= 5) return "bad_buy";
    if (score >= 10) return "good_buy";
    return "watch";
}

function getMomentumEntry(
    candidate: Candidate,
    trendOk: boolean
): { entry: boolean; reason: string } {
    const gainOk = candidate.gain.gte(1) && candidate.gain.lte(5);
    const liquidityOk = candidate.volume.gte(MIN_MOMENTUM_VOLUME_USDT);
    const spreadOk = candidate.spread.lte(MAX_SPREAD_PERCENT);
    const entry = gainOk && liquidityOk && spreadOk && trendOk;

    if (entry) {
        return {
            entry: true,
            reason: "Momentum entry: 1-5% window gain, tradable liquidity, tight spread, and 15m trend up.",
        };
    }

    const blockers: string[] = [];
    if (!gainOk) blockers.push("window gain outside 1-5%");
    if (!liquidityOk) blockers.push("volume under $100k");
    if (!spreadOk) blockers.push("spread over 0.2%");
    if (!trendOk) blockers.push("15m trend not confirmed");

    return {
        entry: false,
        reason: `No momentum entry: ${blockers.join(", ")}.`,
    };
}

function confidenceFromScore(score: number): "high" | "medium" | "low" {
    if (score >= 10) return "high";
    if (score >= 7) return "medium";
    return "low";
}

function baseAssetFromSymbol(symbol: string): string {
    return symbol.endsWith("USDT") ? symbol.slice(0, -4) : symbol;
}

async function analyzeCandidate(candidate: Candidate, timeframeLabel: string): Promise<TokenSignal> {
    const [klines5m, klines15m] = await Promise.all([
        getKlines(candidate.symbol, "5m", 50),
        getKlines(candidate.symbol, "15m", 50),
    ]);

    const closes5m = getCloses(klines5m);
    const closes15m = getCloses(klines15m);

    const trendOk = isUptrend15m(closes15m);
    const pullback = getPullbackPercent(closes5m);
    const pullbackOk =
        pullback.gte(PULLBACK_MIN_PERCENT) && pullback.lte(PULLBACK_MAX_PERCENT);
    const pullbackTooDeep = pullback.gt(PULLBACK_MAX_PERCENT);
    const recoveryOk = isRecovering5m(closes5m);
    const momentum = getMomentumEntry(candidate, trendOk);

    const factors: SignalFactor[] = [
        {
            name: "Window gain",
            status: candidate.gain.gte(MIN_GAIN) && candidate.gain.lte(MAX_GAIN) ? "good" : "bad",
            value: `${candidate.gain.toFixed(2)}%`,
            note: `Healthy momentum for ${timeframeLabel.toLowerCase()} without being too extended.`,
        },
        {
            name: "Liquidity",
            status: candidate.volume.gte(MIN_VOLUME_USDT)
                ? "good"
                : candidate.volume.gte(MIN_TRADABLE_VOLUME_USDT)
                  ? "warn"
                  : "bad",
            value: `$${candidate.volume.toFixed(0)}`,
            note: "Over $1M is average/watchable for small sizing; higher volume usually means easier entries and exits.",
        },
        {
            name: "Spread",
            status: candidate.spread.lte(MAX_SPREAD_PERCENT.div(2))
                ? "good"
                : candidate.spread.lte(MAX_SPREAD_PERCENT)
                  ? "warn"
                  : "bad",
            value: `${candidate.spread.toFixed(3)}%`,
            note: "Tight spread reduces instant loss when entering.",
        },
        {
            name: "15m trend",
            status: trendOk ? "good" : "bad",
            value: trendOk ? "Uptrend" : "Not confirmed",
            note: "Avoid buying pullbacks when the short trend is already broken.",
        },
        {
            name: "Pullback",
            status: pullbackOk ? "good" : pullbackTooDeep ? "bad" : "warn",
            value: `${pullback.toFixed(2)}%`,
            note: "The target dip zone is 2-5% from the recent 5m high.",
        },
        {
            name: "Recovery",
            status: recoveryOk ? "good" : "warn",
            value: recoveryOk ? "Turning up" : "Still weak",
            note: "A small bounce helps avoid catching a falling candle.",
        },
    ];

    const score = factors.reduce((total, factor) => total + statusPoints(factor.status), 0);
    const hardFail =
        candidate.spread.gt(MAX_SPREAD_PERCENT) ||
        candidate.volume.lt(MIN_TRADABLE_VOLUME_USDT);
    const signal = labelFromScore(score, hardFail);

    const baseAsset = baseAssetFromSymbol(candidate.symbol);
    const metadata = getTokenMetadata(baseAsset);

    return {
        symbol: candidate.symbol,
        baseAsset,
        lastPrice: toNumber(candidate.lastPrice),
        bid: toNumber(candidate.bid),
        ask: toNumber(candidate.ask),
        gainPercent: toNumber(candidate.gain),
        quoteVolume: toNumber(candidate.volume),
        trades: candidate.trades,
        spreadPercent: toNumber(candidate.spread),
        pullbackPercent: toNumber(pullback),
        momentumEntry: momentum.entry,
        momentumReason: momentum.reason,
        signal,
        score,
        confidence: confidenceFromScore(score),
        links: {
            coinMarketCap: getCoinMarketCapUrl(baseAsset),
            binance: `https://www.binance.com/en/trade/${baseAsset}_USDT`,
        },
        metadata: {
            contractAddress: metadata.contractAddress,
            chain: metadata.chain,
        },
        factors,
    };
}

async function getTickersForTimeframe(timeframe: TimeframeKey): Promise<RollingTicker[]> {
    const baseTickers = await get24hTickers();
    const symbols = baseTickers
        .filter((ticker) => ticker.symbol.endsWith("USDT"))
        .filter((ticker) => !ticker.symbol.includes("UPUSDT") && !ticker.symbol.includes("DOWNUSDT"))
        .map((ticker) => ticker.symbol);

    if (timeframe === "24h") {
        return baseTickers;
    }

    const config = TIMEFRAMES[timeframe];

    if (config.rollingWindow) {
        return getRollingTickers(symbols, config.rollingWindow);
    }

    const liquidTickers = baseTickers
        .filter((ticker) => new Decimal(ticker.quoteVolume).gte(1_000_000))
        .filter((ticker) => symbols.includes(ticker.symbol));
    const monthlyTickers = await mapWithConcurrency(liquidTickers, 8, (ticker) =>
        getMonthlyTicker(ticker.symbol, ticker)
    );

    return monthlyTickers.filter((ticker): ticker is RollingTicker => ticker !== null);
}

export async function scanTopSignals(limit = 20, timeframe: TimeframeKey = "24h"): Promise<ScanResult> {
    const timeframeLabel = TIMEFRAMES[timeframe].label;
    const [tickers, books] = await Promise.all([
        getTickersForTimeframe(timeframe),
        getBookTickers(),
    ]);

    const bookMap = new Map<string, BookTicker>(books.map((book) => [book.symbol, book]));

    const safeLimit = Math.max(1, Math.min(limit, 20));
    const candidates = tickers
        .filter((ticker) => ticker.symbol.endsWith("USDT"))
        .filter((ticker) => !ticker.symbol.includes("UPUSDT") && !ticker.symbol.includes("DOWNUSDT"))
        .filter((ticker) => new Decimal(ticker.priceChangePercent).gt(0))
        .map((ticker): Candidate | null => {
            const book = bookMap.get(ticker.symbol);
            if (!book) return null;

            const bid = new Decimal(book.bidPrice);
            const ask = new Decimal(book.askPrice);
            if (bid.lte(0) || ask.lte(0)) return null;

            return {
                symbol: ticker.symbol,
                gain: new Decimal(ticker.priceChangePercent),
                volume: new Decimal(ticker.quoteVolume),
                trades: ticker.count,
                bid,
                ask,
                spread: spreadPercent(bid, ask),
                lastPrice: new Decimal(ticker.lastPrice),
            };
        })
        .filter((candidate): candidate is Candidate => candidate !== null)
        .sort((a, b) => b.gain.minus(a.gain).toNumber())
        .slice(0, safeLimit);

    const tokens = await Promise.all(
        candidates.map((candidate) => analyzeCandidate(candidate, timeframeLabel))
    );

    return {
        updatedAt: new Date().toISOString(),
        limit: safeLimit,
        timeframe,
        timeframeLabel,
        tokens,
    };
}
