/**
 * Lightweight DEX pair heuristics before treating a DexScreener row as tradable.
 * Not a guarantee — reduces obvious rugs / honeypots / sniper-only launches.
 *
 * Pair age default is **30 minutes** (configurable from bot UI via `EntryGuardOptions.dexMinPairAgeMinutes`).
 *
 * Env overrides (optional, apply when no scan override for age):
 * - `BFF_DEX_MIN_LIQUIDITY_USD` (default 10_000)
 * - `BFF_DEX_MIN_M5_BUYS` (default 10)
 * - `BFF_DEX_MIN_PAIR_AGE_MS` (default 1_800_000 = 30 minutes)
 * - `BFF_DEX_REQUIRE_M5_SELLS` (`0` to skip “sells must be > 0”; default on)
 */

export type DexPairSafetyFields = {
    liquidity?: { usd?: number };
    txns?: { m5?: { buys?: number; sells?: number } };
    pairCreatedAt?: number;
};

/** Optional per-scan overrides (from saved bot config). */
export type DexSafetyScanOverrides = {
    minPairAgeMs?: number;
};

function readPositiveIntEnv(name: string, fallback: number): number {
    const raw = process.env[name]?.trim();
    if (!raw) return fallback;
    const n = Number.parseInt(raw, 10);
    return Number.isFinite(n) && n > 0 ? n : fallback;
}

function requireM5Sells(): boolean {
    const v = process.env.BFF_DEX_REQUIRE_M5_SELLS?.trim().toLowerCase();
    if (v === "0" || v === "false" || v === "off") return false;
    return true;
}

const DEFAULT_MIN_PAIR_AGE_MS = 30 * 60 * 1000;

export function dexSafetyThresholds(overrides?: DexSafetyScanOverrides): {
    minLiquidityUsd: number;
    minM5Buys: number;
    minPairAgeMs: number;
    requireM5SellsGtZero: boolean;
} {
    const minPairAgeMs =
        typeof overrides?.minPairAgeMs === "number" &&
        Number.isFinite(overrides.minPairAgeMs) &&
        overrides.minPairAgeMs >= 60_000
            ? overrides.minPairAgeMs
            : readPositiveIntEnv("BFF_DEX_MIN_PAIR_AGE_MS", DEFAULT_MIN_PAIR_AGE_MS);

    return {
        minLiquidityUsd: readPositiveIntEnv("BFF_DEX_MIN_LIQUIDITY_USD", 10_000),
        minM5Buys: readPositiveIntEnv("BFF_DEX_MIN_M5_BUYS", 10),
        minPairAgeMs,
        requireM5SellsGtZero: requireM5Sells(),
    };
}

export function dexPairPassesSafetyHeuristics(
    pair: DexPairSafetyFields,
    overrides?: DexSafetyScanOverrides
): { ok: true } | { ok: false; reason: string } {
    const t = dexSafetyThresholds(overrides);
    const liqUsd = pair.liquidity?.usd ?? 0;
    if (!Number.isFinite(liqUsd) || liqUsd < t.minLiquidityUsd) {
        return {
            ok: false,
            reason: `liquidity $${Math.round(liqUsd)} < $${t.minLiquidityUsd}`,
        };
    }

    const buys5m = pair.txns?.m5?.buys ?? 0;
    if (!Number.isFinite(buys5m) || buys5m < t.minM5Buys) {
        return { ok: false, reason: `m5 buys ${buys5m} < ${t.minM5Buys}` };
    }

    const sells5m = pair.txns?.m5?.sells ?? 0;
    if (t.requireM5SellsGtZero && sells5m === 0) {
        return { ok: false, reason: "m5 sells 0 (possible honeypot)" };
    }

    const created = pair.pairCreatedAt;
    if (typeof created !== "number" || !Number.isFinite(created) || created <= 0) {
        return { ok: false, reason: "missing pairCreatedAt (cannot verify age)" };
    }
    const ageMs = Date.now() - created;
    if (ageMs < t.minPairAgeMs) {
        return { ok: false, reason: `pair age ${Math.round(ageMs / 1000)}s < ${Math.round(t.minPairAgeMs / 1000)}s` };
    }

    return { ok: true };
}
