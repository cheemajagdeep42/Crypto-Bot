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
    fiveMinuteChangePercent: number | null;
    fiveMinutePriceAgo: number | null;
    currentFiveMinutePrice: number | null;
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
        marketCapUsd?: number;
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
    | "5m"
    | "10m"
    | "15m"
    | "30m"
    | "1h"
    | "2h"
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

type CacheEntry<T> = {
    expiresAt: number;
    data?: T;
    promise?: Promise<T>;
};

type EntryGuardOptions = {
    liquidityGuard?: "both";
    minFiveMinuteFlowUsdt?: number;
    liquidityCheckRequired?: boolean;
};

const BASE_URL = process.env.BINANCE_BASE_URL ?? "https://api.binance.com";

const MIN_VOLUME_USDT = new Decimal(20_000_000);
const MIN_TRADABLE_VOLUME_USDT = new Decimal(1_000_000);
const MIN_MOMENTUM_VOLUME_USDT = new Decimal(100_000);
const MIN_5M_FLOW_USDT = new Decimal(30_000);
const MIN_MARKET_CAP_USD = new Decimal(1_000_000);
const MIN_GAIN = new Decimal(3);
const MAX_GAIN = new Decimal(25);
const MAX_SPREAD_PERCENT = new Decimal(0.2);

const PULLBACK_MIN_PERCENT = new Decimal(2);
const PULLBACK_MAX_PERCENT = new Decimal(5);

const TIMEFRAMES: Record<TimeframeKey, TimeframeConfig> = {
    "5m": { label: "Last 5 minutes", rollingWindow: "5m" },
    "10m": { label: "Last 10 minutes", rollingWindow: "10m" },
    "15m": { label: "Last 15 minutes", rollingWindow: "15m" },
    "30m": { label: "Last 30 minutes", rollingWindow: "30m" },
    "1h": { label: "Last 1 hour", rollingWindow: "1h" },
    "2h": { label: "Last 2 hours", rollingWindow: "2h" },
    "3h": { label: "Last 3 hours", rollingWindow: "3h" },
    "6h": { label: "Last 6 hours", rollingWindow: "6h" },
    "12h": { label: "Last 12 hours", rollingWindow: "12h" },
    "24h": { label: "Last 24 hours", rollingWindow: "1d" },
    "3d": { label: "Last 3 days", rollingWindow: "3d" },
    "1w": { label: "Last 1 week", rollingWindow: "7d" },
    "1mo": { label: "Last 1 month" },
};

const TIMEFRAME_KEYS = new Set<string>(Object.keys(TIMEFRAMES));
const responseCache = new Map<string, CacheEntry<unknown>>();
const ROLLING_PREFILTER_LIMIT = 120;

export function parseTimeframe(value: string | null): TimeframeKey {
    return value && TIMEFRAME_KEYS.has(value) ? (value as TimeframeKey) : "24h";
}

function describeBinanceError(status: number, text: string): string {
    if (status !== 418 && status !== 429) {
        return `HTTP ${status}: ${text}`;
    }

    try {
        const body = JSON.parse(text) as { msg?: string };
        const untilMatch = body.msg?.match(/until (\d+)/);
        const until = untilMatch ? new Date(Number(untilMatch[1])).toLocaleString() : null;

        return until
            ? `Binance rate limit hit. Public API is temporarily blocked until ${until}.`
            : `Binance rate limit hit. ${body.msg ?? text}`;
    } catch {
        return `Binance rate limit hit. HTTP ${status}: ${text}`;
    }
}

async function fetchJson<T>(url: string, ttlMs = 0): Promise<T> {
    const now = Date.now();
    const cached = responseCache.get(url) as CacheEntry<T> | undefined;

    if (cached?.data && cached.expiresAt > now) return cached.data;
    if (cached?.promise) return cached.promise;

    const promise = fetch(url)
        .then(async (res) => {
            if (!res.ok) {
                const text = await res.text();
                if (cached?.data) return cached.data;
                throw new Error(describeBinanceError(res.status, text));
            }

            const data = (await res.json()) as T;
            responseCache.set(url, {
                data,
                expiresAt: Date.now() + ttlMs,
            });
            return data;
        })
        .finally(() => {
            const entry = responseCache.get(url);
            if (entry?.promise) {
                responseCache.set(url, {
                    data: entry.data,
                    expiresAt: entry.expiresAt,
                });
            }
        });

    responseCache.set(url, {
        data: cached?.data,
        expiresAt: cached?.expiresAt ?? 0,
        promise,
    });

    return promise;
}

async function get24hTickers(): Promise<Ticker24h[]> {
    return fetchJson<Ticker24h[]>(`${BASE_URL}/api/v3/ticker/24hr`, 60_000);
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
                `${BASE_URL}/api/v3/ticker?symbols=${encodedSymbols}&windowSize=${windowSize}&type=FULL`,
                60_000
            );
        })
    );

    return responses.flat();
}

async function getBookTickers(): Promise<BookTicker[]> {
    return fetchJson<BookTicker[]>(`${BASE_URL}/api/v3/ticker/bookTicker`, 15_000);
}

async function getKlines(
    symbol: string,
    interval: "5m" | "15m",
    limit = 50
): Promise<Kline[]> {
    return fetchJson<Kline[]>(
        `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`,
        60_000
    );
}

async function getMonthlyTicker(symbol: string, fallback: Ticker24h): Promise<RollingTicker | null> {
    const dailyKlines = await fetchJson<Kline[]>(
        `${BASE_URL}/api/v3/klines?symbol=${symbol}&interval=1d&limit=31`,
        3_600_000
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

function isMicroUptrend5m(closes: Decimal[]): boolean {
    if (closes.length < 7) return false;

    const last = closes[closes.length - 1];
    const threeAgo = closes[closes.length - 4];
    const sixAgo = closes[closes.length - 7];

    return last.gt(threeAgo) && threeAgo.gt(sixAgo);
}

function recentDrawdownPercent(closes: Decimal[]): Decimal {
    const recent = closes.slice(-8);
    const recentHigh = Decimal.max(...recent);
    const current = recent[recent.length - 1];
    if (recentHigh.lte(0)) return new Decimal(999);
    return recentHigh.minus(current).div(recentHigh).mul(100);
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
    trendOk: boolean,
    microTrendOk: boolean,
    drawdownOk: boolean,
    flow5mOk: boolean,
    marketCapOk: boolean,
    liquidityCheckRequired: boolean
): { entry: boolean; reason: string } {
    const gainOk = candidate.gain.gte(1) && candidate.gain.lte(5);
    const liquidityOk = candidate.volume.gte(MIN_MOMENTUM_VOLUME_USDT);
    const spreadOk = candidate.spread.lte(MAX_SPREAD_PERCENT);
    const liquidityChecksOk = !liquidityCheckRequired || (flow5mOk && marketCapOk);
    const entry =
        gainOk &&
        liquidityOk &&
        spreadOk &&
        trendOk &&
        microTrendOk &&
        drawdownOk &&
        liquidityChecksOk;

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
    if (!microTrendOk) blockers.push("5m micro-trend still weak");
    if (!drawdownOk) blockers.push("recent drawdown too deep");
    if (liquidityCheckRequired && !flow5mOk) blockers.push("5m quote flow below configured minimum");
    if (liquidityCheckRequired && !marketCapOk) blockers.push("market cap under $1M or unknown");

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

async function analyzeCandidate(
    candidate: Candidate,
    timeframeLabel: string,
    options?: EntryGuardOptions
): Promise<TokenSignal> {
    const [klines5m, klines15m] = await Promise.all([
        getKlines(candidate.symbol, "5m", 50),
        getKlines(candidate.symbol, "15m", 50),
    ]);

    const closes5m = getCloses(klines5m);
    const closes15m = getCloses(klines15m);

    const trendOk = isUptrend15m(closes15m);
    const microTrendOk = isMicroUptrend5m(closes5m);
    const drawdown = recentDrawdownPercent(closes5m);
    const drawdownOk = drawdown.lte(2.2);
    const fiveMinutePriceAgo = closes5m.length >= 2 ? closes5m[closes5m.length - 2] : null;
    const currentFiveMinutePrice = closes5m.length >= 1 ? closes5m[closes5m.length - 1] : null;
    const fiveMinuteChangePercent =
        fiveMinutePriceAgo && fiveMinutePriceAgo.gt(0) && currentFiveMinutePrice
            ? currentFiveMinutePrice.minus(fiveMinutePriceAgo).div(fiveMinutePriceAgo).mul(100)
            : null;
    const latest5mQuoteVolume = new Decimal(klines5m[klines5m.length - 1]?.[7] ?? "0");
    const min5mFlowThreshold = new Decimal(options?.minFiveMinuteFlowUsdt ?? MIN_5M_FLOW_USDT);
    const liquidityCheckRequired = options?.liquidityCheckRequired ?? false;
    const flow5mOk = latest5mQuoteVolume.gte(min5mFlowThreshold);
    const pullback = getPullbackPercent(closes5m);
    const pullbackOk =
        pullback.gte(PULLBACK_MIN_PERCENT) && pullback.lte(PULLBACK_MAX_PERCENT);
    const pullbackTooDeep = pullback.gt(PULLBACK_MAX_PERCENT);
    const recoveryOk = isRecovering5m(closes5m);
    const baseAsset = baseAssetFromSymbol(candidate.symbol);
    const metadata = getTokenMetadata(baseAsset);
    const marketCapUsd = new Decimal(metadata.marketCapUsd ?? 0);
    const marketCapOk = marketCapUsd.gte(MIN_MARKET_CAP_USD);
    const momentum = getMomentumEntry(
        candidate,
        trendOk,
        microTrendOk,
        drawdownOk,
        flow5mOk,
        marketCapOk,
        liquidityCheckRequired
    );

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
        {
            name: "5m micro trend",
            status: microTrendOk ? "good" : "bad",
            value: microTrendOk ? "Higher highs/lows" : "Short downtrend",
            note: "Require the last 5m structure to slope up before entering.",
        },
        {
            name: "Recent drawdown",
            status: drawdownOk ? "good" : "bad",
            value: `${drawdown.toFixed(2)}%`,
            note: "Avoid entries when price is still far below the recent 5m local high.",
        },
        {
            name: "5m flow",
            status: flow5mOk ? "good" : liquidityCheckRequired ? "bad" : "warn",
            value: `$${latest5mQuoteVolume.toFixed(0)}`,
            note: liquidityCheckRequired
                ? `Must be at least $${min5mFlowThreshold.toFixed(0)} quote volume in the latest 5m candle.`
                : `Liquidity check is off. Current 5m flow shown for reference (target $${min5mFlowThreshold.toFixed(
                      0
                  )}).`,
        },
        {
            name: "Market cap",
            status: marketCapOk ? "good" : liquidityCheckRequired ? "bad" : "warn",
            value: marketCapUsd.gt(0) ? `$${marketCapUsd.toFixed(0)}` : "Unknown",
            note: liquidityCheckRequired
                ? "Must be at least $1M market cap from token metadata."
                : "Liquidity check is off. Market cap shown for reference.",
        },
    ];

    const score = factors.reduce((total, factor) => total + statusPoints(factor.status), 0);
    const hardFail =
        candidate.spread.gt(MAX_SPREAD_PERCENT) ||
        candidate.volume.lt(MIN_TRADABLE_VOLUME_USDT);
    const signal = labelFromScore(score, hardFail);

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
        fiveMinuteChangePercent: fiveMinuteChangePercent ? toNumber(fiveMinuteChangePercent) : null,
        fiveMinutePriceAgo: fiveMinutePriceAgo ? toNumber(fiveMinutePriceAgo) : null,
        currentFiveMinutePrice: currentFiveMinutePrice ? toNumber(currentFiveMinutePrice) : null,
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
            marketCapUsd: metadata.marketCapUsd,
        },
        factors,
    };
}

async function getTickersForTimeframe(timeframe: TimeframeKey): Promise<RollingTicker[]> {
    const baseTickers = await get24hTickers();
    const tradableUsdtTickers = baseTickers
        .filter((ticker) => ticker.symbol.endsWith("USDT"))
        .filter((ticker) => !ticker.symbol.includes("UPUSDT") && !ticker.symbol.includes("DOWNUSDT"))
        .filter((ticker) => new Decimal(ticker.quoteVolume).gte(100_000));
    const symbols = tradableUsdtTickers.map((ticker) => ticker.symbol);

    if (timeframe === "24h") {
        return baseTickers;
    }

    const config = TIMEFRAMES[timeframe];

    if (config.rollingWindow) {
        const rollingSymbols = tradableUsdtTickers
            .sort((a, b) => new Decimal(b.quoteVolume).minus(a.quoteVolume).toNumber())
            .slice(0, ROLLING_PREFILTER_LIMIT)
            .map((ticker) => ticker.symbol);

        return getRollingTickers(rollingSymbols, config.rollingWindow);
    }

    const liquidTickers = baseTickers
        .filter((ticker) => new Decimal(ticker.quoteVolume).gte(1_000_000))
        .filter((ticker) => symbols.includes(ticker.symbol));
    const monthlyTickers = await mapWithConcurrency(liquidTickers, 8, (ticker) =>
        getMonthlyTicker(ticker.symbol, ticker)
    );

    return monthlyTickers.filter((ticker): ticker is RollingTicker => ticker !== null);
}

export async function scanTopSignals(
    limit = 20,
    timeframe: TimeframeKey = "24h",
    options?: EntryGuardOptions
): Promise<ScanResult> {
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
        .sort((a, b) => {
            const movementDelta = b.gain.abs().minus(a.gain.abs()).toNumber();
            if (movementDelta !== 0) return movementDelta;
            return b.gain.minus(a.gain).toNumber();
        })
        .slice(0, safeLimit);

    const tokens = await Promise.all(
        candidates.map((candidate) => analyzeCandidate(candidate, timeframeLabel, options))
    );

    return {
        updatedAt: new Date().toISOString(),
        limit: safeLimit,
        timeframe,
        timeframeLabel,
        tokens,
    };
}

export async function scanTopTrending(limit = 20, timeframe: TimeframeKey = "24h"): Promise<ScanResult> {
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

    const tokens = candidates.map((candidate) => {
        const baseAsset = baseAssetFromSymbol(candidate.symbol);
        const metadata = getTokenMetadata(baseAsset);

        const factors: SignalFactor[] = [
            {
                name: "Window gain",
                status: candidate.gain.gte(MIN_GAIN) && candidate.gain.lte(MAX_GAIN) ? "good" : "warn",
                value: `${candidate.gain.toFixed(2)}%`,
                note: `Performance in ${timeframeLabel.toLowerCase()} window.`,
            },
            {
                name: "Liquidity",
                status: candidate.volume.gte(MIN_VOLUME_USDT)
                    ? "good"
                    : candidate.volume.gte(MIN_TRADABLE_VOLUME_USDT)
                      ? "warn"
                      : "bad",
                value: `$${candidate.volume.toFixed(0)}`,
                note: "Higher quote volume generally means better tradability.",
            },
            {
                name: "Spread",
                status: candidate.spread.lte(MAX_SPREAD_PERCENT.div(2))
                    ? "good"
                    : candidate.spread.lte(MAX_SPREAD_PERCENT)
                      ? "warn"
                      : "bad",
                value: `${candidate.spread.toFixed(3)}%`,
                note: "Tighter spread lowers entry and exit friction.",
            },
            {
                name: "Activity",
                status: candidate.trades >= 20_000 ? "good" : candidate.trades >= 5_000 ? "warn" : "bad",
                value: `${candidate.trades.toLocaleString()} trades`,
                note: "Trade count helps distinguish active movers from thin spikes.",
            },
        ];

        const score = factors.reduce((total, factor) => total + statusPoints(factor.status), 0);
        const hardFail =
            candidate.spread.gt(MAX_SPREAD_PERCENT) ||
            candidate.volume.lt(MIN_TRADABLE_VOLUME_USDT);

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
            pullbackPercent: null,
            fiveMinuteChangePercent: null,
            fiveMinutePriceAgo: null,
            currentFiveMinutePrice: null,
            momentumEntry: false,
            momentumReason: "Trending board mode. Entry timing is handled by the bot scanner.",
            signal: labelFromScore(score, hardFail),
            score,
            confidence: confidenceFromScore(score),
            links: {
                coinMarketCap: getCoinMarketCapUrl(baseAsset),
                binance: `https://www.binance.com/en/trade/${baseAsset}_USDT`,
            },
            metadata: {
                contractAddress: metadata.contractAddress,
                chain: metadata.chain,
                marketCapUsd: metadata.marketCapUsd,
            },
            factors,
        };
    });

    return {
        updatedAt: new Date().toISOString(),
        limit: safeLimit,
        timeframe,
        timeframeLabel,
        tokens,
    };
}
