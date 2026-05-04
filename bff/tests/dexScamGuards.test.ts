import { describe, expect, it, vi } from "vitest";
import {
    dexPairPassesSafetyHeuristics,
    dexSafetyThresholds,
    type DexPairSafetyFields,
} from "../src/dexScamGuards";

function basePair(over: Partial<DexPairSafetyFields> = {}): DexPairSafetyFields {
    const old = Date.now() - 45 * 60 * 1000;
    return {
        liquidity: { usd: 50_000 },
        txns: { m5: { buys: 20, sells: 8 } },
        pairCreatedAt: old,
        ...over,
    };
}

describe("dexPairPassesSafetyHeuristics", () => {
    it("accepts a healthy pair", () => {
        expect(dexPairPassesSafetyHeuristics(basePair())).toEqual({ ok: true });
    });

    it("rejects low liquidity", () => {
        const r = dexPairPassesSafetyHeuristics(basePair({ liquidity: { usd: 5000 } }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain("liquidity");
    });

    it("rejects low m5 buys", () => {
        const r = dexPairPassesSafetyHeuristics(basePair({ txns: { m5: { buys: 3, sells: 5 } } }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain("buys");
    });

    it("rejects zero m5 sells when honeypot check is on", () => {
        vi.stubEnv("BFF_DEX_REQUIRE_M5_SELLS", "1");
        const r = dexPairPassesSafetyHeuristics(basePair({ txns: { m5: { buys: 15, sells: 0 } } }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain("honeypot");
        vi.unstubAllEnvs();
    });

    it("allows zero m5 sells when honeypot check is off", () => {
        vi.stubEnv("BFF_DEX_REQUIRE_M5_SELLS", "0");
        const r = dexPairPassesSafetyHeuristics(basePair({ txns: { m5: { buys: 15, sells: 0 } } }));
        expect(r.ok).toBe(true);
        vi.unstubAllEnvs();
    });

    it("rejects very young pairs", () => {
        const r = dexPairPassesSafetyHeuristics(
            basePair({ pairCreatedAt: Date.now() - 30_000 }) // 30s old
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain("age");
    });

    it("rejects missing pairCreatedAt", () => {
        const r = dexPairPassesSafetyHeuristics(basePair({ pairCreatedAt: undefined }));
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.reason).toContain("pairCreatedAt");
    });

    it("honors minPairAgeMs override stricter than default", () => {
        const pair = basePair({ pairCreatedAt: Date.now() - 40 * 60 * 1000 }); // 40 min old
        const pass30 = dexPairPassesSafetyHeuristics(pair, { minPairAgeMs: 30 * 60 * 1000 });
        expect(pass30.ok).toBe(true);
        const fail50 = dexPairPassesSafetyHeuristics(pair, { minPairAgeMs: 50 * 60 * 1000 });
        expect(fail50.ok).toBe(false);
    });

    it("honors 2-minute scan override (matches UI dexMinPairAgeMinutes=2)", () => {
        const pair = basePair({ pairCreatedAt: Date.now() - 3 * 60 * 1000 }); // 3 min old
        const pass2 = dexPairPassesSafetyHeuristics(pair, { minPairAgeMs: 2 * 60 * 1000 });
        expect(pass2.ok).toBe(true);
        const fail2 = dexPairPassesSafetyHeuristics(
            basePair({ pairCreatedAt: Date.now() - 60 * 1000 }),
            { minPairAgeMs: 2 * 60 * 1000 }
        );
        expect(fail2.ok).toBe(false);
    });
});

describe("dexSafetyThresholds", () => {
    it("defaults min pair age to 30 minutes without env", () => {
        vi.unstubAllEnvs();
        const t = dexSafetyThresholds();
        expect(t.minPairAgeMs).toBe(30 * 60 * 1000);
    });

    it("reads env overrides", () => {
        vi.stubEnv("BFF_DEX_MIN_LIQUIDITY_USD", "25000");
        vi.stubEnv("BFF_DEX_MIN_M5_BUYS", "5");
        vi.stubEnv("BFF_DEX_MIN_PAIR_AGE_MS", "60000");
        const t = dexSafetyThresholds();
        expect(t.minLiquidityUsd).toBe(25_000);
        expect(t.minM5Buys).toBe(5);
        expect(t.minPairAgeMs).toBe(60_000);
        vi.unstubAllEnvs();
    });

    it("uses scan override for min pair age when provided", () => {
        vi.stubEnv("BFF_DEX_MIN_PAIR_AGE_MS", "60000");
        const t = dexSafetyThresholds({ minPairAgeMs: 45 * 60 * 1000 });
        expect(t.minPairAgeMs).toBe(45 * 60 * 1000);
        vi.unstubAllEnvs();
    });
});
