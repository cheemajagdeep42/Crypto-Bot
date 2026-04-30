import {
    DEFAULT_MIN_MARKET_CAP_USD,
    formatMinMarketCapThresholdLabel,
    normalizeLiquidityGuard,
    SCAN_GAINER_MAX_5M_PULLBACK_PERCENT,
    tokenPassesGainerScanFilter,
    type EntryGuardOptions,
    type LiquidityGuardMode,
    type ScanResult,
    type SignalFactor,
    type TimeframeKey,
    type TokenSignal,
} from "./scanner";
import { getCoinMarketCapUrl } from "./tokenMetadata";

const BOOSTS_URL = "https://api.dexscreener.com/token-boosts/latest/v1";
/** Returns an array of pairs for the token (see DexScreener GET /tokens/v1/{chainId}/{tokenAddresses}). */
const TOKENS_V1 = "https://api.dexscreener.com/tokens/v1";
const PAIRS_BASE = "https://api.dexscreener.com/latest/dex/pairs";

type DexBoost = { chainId: string; tokenAddress: string; url?: string };

type DexPair = {
    chainId: string;
    pairAddress: string;
    url: string;
    baseToken: { address: string; name: string; symbol: string };
    quoteToken: { address: string; name: string; symbol: string };
    priceUsd?: string;
    volume?: { m5?: number; h1?: number; h6?: number; h24?: number };
    priceChange?: { m5?: number; h1?: number; h6?: number; h24?: number };
    liquidity?: { usd?: number };
    txns?: { m5?: { buys: number; sells: number }; h1?: { buys: number; sells: number }; h24?: { buys: number; sells: number } };
    marketCap?: number;
    fdv?: number;
};

async function fetchJson<T>(url: string): Promise<T | null> {
    try {
        const res = await fetch(url, { headers: { Accept: "application/json" } });
        if (!res.ok) return null;
        return (await res.json()) as T;
    } catch {
        return null;
    }
}

function timeframeGainPct(tf: TimeframeKey, pc: DexPair["priceChange"]): number {
    if (!pc) return 0;
    const keys: (keyof NonNullable<DexPair["priceChange"]>)[] =
        tf === "5m" || tf === "10m" || tf === "15m"
            ? ["m5", "h1", "h24"]
            : tf === "30m" || tf === "1h" || tf === "2h" || tf === "3h"
              ? ["h1", "h6", "h24"]
              : ["h24", "h6", "h1"];
    for (const k of keys) {
        const v = pc[k];
        if (typeof v === "number" && !Number.isNaN(v)) return v;
    }
    return 0;
}

function timeframeVolumeUsd(tf: TimeframeKey, vol: DexPair["volume"]): number {
    if (!vol) return 0;
    if (tf === "5m" || tf === "10m" || tf === "15m") return vol.m5 ?? vol.h1 ?? vol.h24 ?? 0;
    if (tf === "30m" || tf === "1h" || tf === "2h" || tf === "3h") return vol.h1 ?? vol.h6 ?? vol.h24 ?? 0;
    return vol.h24 ?? vol.h6 ?? vol.h1 ?? 0;
}

/** ~30m: linear 30/60 of h1 when present; else compound six m5 periods. */
function dexGainLoss30mApprox(pc: DexPair["priceChange"]): number | null {
    const h1 = pc?.h1;
    if (typeof h1 === "number" && Number.isFinite(h1)) {
        return Number(((h1 * 30) / 60).toFixed(4));
    }
    const m5 = pc?.m5;
    if (typeof m5 === "number" && Number.isFinite(m5)) {
        const r = (1 + m5 / 100) ** 6 - 1;
        return Number((r * 100).toFixed(4));
    }
    return null;
}

/** DexScreener has no m10; compound two m5 moves, else ~10m slice of h1. */
function dexGainLoss10mApprox(pc: DexPair["priceChange"]): number | null {
    const m5 = pc?.m5;
    if (typeof m5 === "number" && Number.isFinite(m5)) {
        const r = (1 + m5 / 100) ** 2 - 1;
        return Number((r * 100).toFixed(4));
    }
    const h1 = pc?.h1;
    if (typeof h1 === "number" && Number.isFinite(h1)) {
        return Number((h1 / 6).toFixed(4));
    }
    return null;
}

/**
 * Min 5m volume gate: if Dex reports a positive m5 USD volume, require that to meet the threshold.
 * Only when m5 is missing/zero do we fall back to window quote volume (Dex often omits m5 on some pairs).
 * Previously we used (m5 >= min OR window >= min), which let ~$1k m5 pairs through when window vol was high.
 */
function dexMeetsMinFiveMinuteFlowUsd(m5volUsd: number, windowQuoteVolumeUsd: number, minUsdt: number): boolean {
    const hasM5 = Number.isFinite(m5volUsd) && m5volUsd > 0;
    if (hasM5) {
        return m5volUsd >= minUsdt;
    }
    const qv =
        typeof windowQuoteVolumeUsd === "number" && Number.isFinite(windowQuoteVolumeUsd)
            ? windowQuoteVolumeUsd
            : 0;
    return qv >= minUsdt;
}

export function evaluateDexMinFlowByGuard(
    m5volUsd: number,
    windowQuoteVolumeUsd: number,
    minUsdt: number,
    options?: EntryGuardOptions
): boolean {
    const liquidityRequired = Boolean(options?.liquidityCheckRequired);
    const guard = normalizeLiquidityGuard(options?.liquidityGuard);
    const needFlow = liquidityRequired && (guard === "both" || guard === "volume");
    if (!needFlow) return true;
    return dexMeetsMinFiveMinuteFlowUsd(m5volUsd, windowQuoteVolumeUsd, minUsdt);
}

/**
 * Scan-list volume filter.
 * Apply min volume only when guard mode requires volume (both | volume).
 * For MC-only or guard off, do not filter list by volume.
 */
function dexMeetsMinQuoteFlow(t: TokenSignal, minUsdt: number, options?: EntryGuardOptions): boolean {
    const m5 = t.fiveMinuteQuoteVolumeUsdt;
    const m5volUsd = m5 != null && Number.isFinite(m5) ? m5 : 0;
    const qv = typeof t.quoteVolume === "number" && Number.isFinite(t.quoteVolume) ? t.quoteVolume : 0;
    return evaluateDexMinFlowByGuard(m5volUsd, qv, minUsdt, options);
}

/**
 * Binance gainer filter requires positive 10m & 30m — Dex approximations are often null (missing m5/h1 on pair).
 * Keep strict path when data exists; otherwise allow rows with positive window gain and tolerable 5m pullback.
 */
function tokenPassesDexscreenerScanFilter(t: TokenSignal): boolean {
    if (tokenPassesGainerScanFilter(t)) return true;
    const five = t.fiveMinuteChangePercent;
    if (five != null && Number.isFinite(five) && five <= -SCAN_GAINER_MAX_5M_PULLBACK_PERCENT) {
        return false;
    }
    return t.gainPercent > 0;
}

function timeframeTxnCount(tf: TimeframeKey, txns: DexPair["txns"]): number {
    if (!txns) return 0;
    const slice =
        tf === "5m" || tf === "10m" || tf === "15m"
            ? txns.m5
            : tf === "30m" || tf === "1h" || tf === "2h" || tf === "3h"
              ? txns.h1
              : txns.h24;
    if (!slice) return 0;
    return slice.buys + slice.sells;
}

/** Half-spread each side for paper Dex fills (0.06 => ±0.03% from mid). */
export const DEX_PAPER_SPREAD_PERCENT = 0.06;

export function dexPaperBidUsd(midUsd: number): number {
    if (!Number.isFinite(midUsd) || midUsd <= 0) return midUsd;
    return midUsd * (1 - DEX_PAPER_SPREAD_PERCENT / 200);
}

export function dexPaperAskUsd(midUsd: number): number {
    if (!Number.isFinite(midUsd) || midUsd <= 0) return midUsd;
    return midUsd * (1 + DEX_PAPER_SPREAD_PERCENT / 200);
}

function pairToTokenSignal(pair: DexPair, timeframe: TimeframeKey, timeframeLabel: string, options?: EntryGuardOptions): TokenSignal | null {
    const priceUsd = Number(pair.priceUsd);
    if (!Number.isFinite(priceUsd) || priceUsd <= 0) return null;

    const liq = pair.liquidity?.usd ?? 0;

    const baseSym = String(pair.baseToken.symbol ?? "UNK").replace(/\s+/g, "").slice(0, 12);
    const sym = `DS_${baseSym}_${pair.pairAddress.slice(0, 6)}`;

    const gainPercent = timeframeGainPct(timeframe, pair.priceChange);
    const quoteVolume = timeframeVolumeUsd(timeframe, pair.volume);
    const trades = timeframeTxnCount(timeframe, pair.txns);
    const bid = dexPaperBidUsd(priceUsd);
    const ask = dexPaperAskUsd(priceUsd);

    const m5chg = pair.priceChange?.m5 ?? null;
    const m5vol = pair.volume?.m5 ?? 0;
    const liquidityRequired = Boolean(options?.liquidityCheckRequired);
    const minFlow = Number(options?.minFiveMinuteFlowUsdt ?? 30_000);
    const minMcUsd = Number(options?.minMarketCapUsd ?? DEFAULT_MIN_MARKET_CAP_USD);
    const cap = Number(pair.marketCap ?? pair.fdv ?? 0);
    const liquidityGuard: LiquidityGuardMode = normalizeLiquidityGuard(options?.liquidityGuard);
    const needFlow = liquidityRequired && (liquidityGuard === "both" || liquidityGuard === "volume");
    const needMc = liquidityRequired && (liquidityGuard === "both" || liquidityGuard === "mc");
    const capPassesMc = Number.isFinite(cap) && cap > 0 && cap >= minMcUsd;
    const mcOk = !needMc || capPassesMc;
    const flowPasses = needFlow
        ? dexMeetsMinFiveMinuteFlowUsd(m5vol, quoteVolume, minFlow)
        : m5vol >= minFlow || quoteVolume >= minFlow;
    const flowGood = !needFlow || flowPasses;

    // Scanner guard must filter the list itself (not only momentumEntry), per UI mode:
    // MC-only => enforce MC, Volume-only => enforce flow, both => enforce both.
    if (needMc && !capPassesMc) return null;
    if (needFlow && !flowPasses) return null;

    const microGood = (m5chg !== null && m5chg >= -1) || gainPercent >= 0;

    const factors: SignalFactor[] = [
        {
            name: "Dex window",
            status: gainPercent > 0 ? "good" : gainPercent > -2 ? "warn" : "bad",
            value: `${gainPercent.toFixed(2)}%`,
            note: `Approx. move from DexScreener for ${timeframeLabel} (paper / not Binance candles).`,
        },
        {
            name: "5m micro trend",
            status: microGood ? "good" : "warn",
            value: m5chg !== null ? `${m5chg.toFixed(2)}% (m5)` : "n/a",
            note: "Synthetic gate from DexScreener m5 price change.",
        },
        {
            name: "5m flow",
            status: !liquidityRequired
                ? flowPasses
                    ? "good"
                    : "warn"
                : needFlow
                  ? flowPasses
                      ? "good"
                      : "bad"
                  : flowPasses
                    ? "good"
                    : "warn",
            value: `$${Math.round(m5vol).toLocaleString()}`,
            note: !liquidityRequired
                ? "MC check off — m5 volume for reference."
                : needFlow
                  ? `Required (guard: ${liquidityGuard}). DexScreener m5 vs ~$${minFlow.toLocaleString()}.`
                  : `Not required for entry (MC-only guard). ~$${minFlow.toLocaleString()} for reference.`,
        },
        {
            name: "Liquidity",
            status: liq >= 50_000 ? "good" : liq >= 15_000 ? "warn" : "bad",
            value: `$${Math.round(liq).toLocaleString()}`,
            note: "Pair liquidity.usd from DexScreener.",
        },
        {
            name: "Market cap",
            status: !liquidityRequired
                ? cap > 0
                    ? "good"
                    : "warn"
                : needMc
                  ? capPassesMc
                      ? "good"
                      : "bad"
                  : capPassesMc
                    ? "good"
                    : "warn",
            value: cap > 0 && Number.isFinite(cap) ? `$${Math.round(cap).toLocaleString()}` : "Unknown",
            note: !liquidityRequired
                ? `MC check off; would require ≥ ${formatMinMarketCapThresholdLabel(minMcUsd)} if enabled.`
                : needMc
                  ? `Required (guard: ${liquidityGuard}). ≥ ${formatMinMarketCapThresholdLabel(minMcUsd)} (marketCap / fdv).`
                  : `Not required (volume-only guard). ≥ ${formatMinMarketCapThresholdLabel(minMcUsd)} for reference.`,
        },
    ];

    const score = factors.reduce((acc, f) => acc + (f.status === "good" ? 2 : f.status === "warn" ? 1 : 0), 0);
    const microTrendOk = factors.find((f) => f.name === "5m micro trend")?.status === "good";
    const flow5Ok = factors.find((f) => f.name === "5m flow")?.status === "good";
    const momentumEntry = Boolean(microTrendOk && flow5Ok && mcOk && gainPercent > -3);

    return {
        symbol: sym,
        baseAsset: baseSym,
        lastPrice: priceUsd,
        bid,
        ask,
        gainPercent,
        gainLoss10mPercent: dexGainLoss10mApprox(pair.priceChange),
        gainLoss30mPercent: dexGainLoss30mApprox(pair.priceChange),
        fiveMinuteQuoteVolumeUsdt: m5vol > 0 ? m5vol : null,
        quoteVolume,
        trades,
        spreadPercent: DEX_PAPER_SPREAD_PERCENT,
        pullbackPercent: null,
        fiveMinuteChangePercent: m5chg,
        fiveMinutePriceAgo: m5chg !== null ? priceUsd / (1 + m5chg / 100) : null,
        currentFiveMinutePrice: priceUsd,
        momentumEntry,
        momentumReason: `DexScreener paper: ${pair.baseToken.name} on ${pair.chainId} — ${gainPercent.toFixed(2)}% (${timeframeLabel}), liq $${Math.round(liq).toLocaleString()}.`,
        signal: momentumEntry && gainPercent > 0 ? "good_buy" : gainPercent > 0 ? "watch" : "bad_buy",
        score,
        confidence: momentumEntry ? "medium" : "low",
        links: {
            coinMarketCap: getCoinMarketCapUrl(baseSym),
            binance: pair.url,
        },
        metadata: {
            contractAddress: pair.baseToken.address,
            chain: pair.chainId,
            marketCapUsd: cap > 0 && Number.isFinite(cap) ? cap : undefined,
            dexPairAddress: pair.pairAddress,
            dexChainId: pair.chainId,
            dexUrl: pair.url,
        },
        factors,
    };
}

async function bestPairForToken(chainId: string, tokenAddress: string): Promise<DexPair | null> {
    const data = await fetchJson<DexPair[]>(`${TOKENS_V1}/${chainId}/${tokenAddress}`);
    const pairs = Array.isArray(data) ? data : [];
    if (!pairs.length) return null;

    const normalized = tokenAddress.toLowerCase();
    const matching = pairs.filter((p) => p.baseToken?.address?.toLowerCase() === normalized);
    const pool = matching.length > 0 ? matching : pairs;

    const sorted = [...pool].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
    return sorted[0] ?? null;
}

export async function fetchDexPairPriceUsd(chainId: string, pairAddress: string): Promise<number | null> {
    const data = await fetchJson<{ pair?: DexPair; pairs?: DexPair[] }>(
        `${PAIRS_BASE}/${chainId}/${pairAddress}`
    );
    const pair = data?.pair ?? data?.pairs?.[0];
    const px = Number(pair?.priceUsd);
    return Number.isFinite(px) && px > 0 ? px : null;
}

function normalizeBoostsPayload(raw: unknown): DexBoost[] {
    if (Array.isArray(raw)) return raw as DexBoost[];
    if (raw && typeof raw === "object" && Array.isArray((raw as { data?: DexBoost[] }).data)) {
        return (raw as { data: DexBoost[] }).data;
    }
    return [];
}

export async function scanTopSignalsDexscreener(
    limit = 20,
    timeframe: TimeframeKey = "24h",
    options?: EntryGuardOptions
): Promise<ScanResult> {
    const timeframeLabel = timeframe;
    const boosts = normalizeBoostsPayload(await fetchJson<unknown>(BOOSTS_URL));
    if (!boosts.length) {
        return {
            updatedAt: new Date().toISOString(),
            limit: Math.max(1, Math.min(20, limit)),
            timeframe,
            timeframeLabel,
            tokens: [],
        };
    }

    const seen = new Set<string>();
    const jobs: { chainId: string; tokenAddress: string }[] = [];
    for (const b of boosts) {
        if (!b.chainId || !b.tokenAddress) continue;
        const key = `${b.chainId}:${b.tokenAddress}`;
        if (seen.has(key)) continue;
        seen.add(key);
        jobs.push({ chainId: b.chainId, tokenAddress: b.tokenAddress });
        if (jobs.length >= 80) break;
    }

    const pairs: DexPair[] = [];
    for (const job of jobs) {
        const p = await bestPairForToken(job.chainId, job.tokenAddress);
        if (p) pairs.push(p);
    }

    const safeLimit = Math.max(1, Math.min(20, limit));
    const min5m = Number(options?.minFiveMinuteFlowUsdt ?? 30_000);
    const tokens: TokenSignal[] = pairs
        .map((p) => pairToTokenSignal(p, timeframe, timeframeLabel, options))
        .filter((t): t is TokenSignal => t !== null)
        .filter((t) => dexMeetsMinQuoteFlow(t, min5m, options))
        .filter(tokenPassesDexscreenerScanFilter)
        .sort((a, b) => b.gainPercent - a.gainPercent)
        .slice(0, safeLimit);

    return {
        updatedAt: new Date().toISOString(),
        limit: safeLimit,
        timeframe,
        timeframeLabel,
        tokens,
    };
}
