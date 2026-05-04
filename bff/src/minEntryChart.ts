/**
 * Min Entry Chart gates: every selected timeframe must be strictly positive (>0%)
 * for a token to appear in the scanner list (Dex + Binance).
 * `2m` — Binance: last two 1m candle closes; Dex: ~slice of m5/h1 (API has no m2).
 */
export const MIN_ENTRY_CHART_TIMEFRAME_OPTIONS = ["2m", "5m", "10m", "15m", "30m", "1h", "24h"] as const;

export type MinEntryChartTimeframe = (typeof MIN_ENTRY_CHART_TIMEFRAME_OPTIONS)[number];

const OPTION_SET = new Set<string>(MIN_ENTRY_CHART_TIMEFRAME_OPTIONS);

/**
 * Normalize UI/API selection. `undefined` / invalid → default `["5m"]`.
 * Explicit `[]` → no min-entry gates (e.g. manual stack helpers on Dex).
 */
export function normalizeMinEntryChartTimeframes(raw: unknown): MinEntryChartTimeframe[] {
    const fallback: MinEntryChartTimeframe[] = ["5m"];
    if (raw == null) return fallback;
    if (!Array.isArray(raw)) return fallback;
    const want = new Set<string>();
    for (const x of raw) {
        const s = String(x).trim();
        if (OPTION_SET.has(s)) want.add(s);
    }
    const ordered = MIN_ENTRY_CHART_TIMEFRAME_OPTIONS.filter((tf) => want.has(tf));
    if (ordered.length > 0) return ordered;
    return raw.length === 0 ? [] : fallback;
}

/** Persisted bot config: never leave min-entry unset — at least `5m`. */
export function normalizeBotMinEntryChartTimeframes(raw: unknown): MinEntryChartTimeframe[] {
    const v = normalizeMinEntryChartTimeframes(raw);
    return v.length > 0 ? v : ["5m"];
}

export function minEntryFactorName(tf: MinEntryChartTimeframe): string {
    return `Min entry (${tf})`;
}
