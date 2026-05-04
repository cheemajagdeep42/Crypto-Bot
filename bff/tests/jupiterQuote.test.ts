import { afterEach, describe, expect, it, vi } from "vitest";
import {
    normalizeJupiterQuotePreview,
    usdcRawAmountFromUsd,
} from "../src/trading/jupiterQuote";

describe("usdcRawAmountFromUsd", () => {
    it("converts USD to 6-decimal raw string (USDT/USDC SPL)", () => {
        expect(usdcRawAmountFromUsd(1)).toBe("1000000");
        expect(usdcRawAmountFromUsd(0.05)).toBe("50000");
    });
});

describe("normalizeJupiterQuotePreview", () => {
    it("builds preview with approx tokens", () => {
        const raw = {
            inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            outputMint: "So11111111111111111111111111111111111111112",
            inAmount: "1000000",
            outAmount: "6000000",
            otherAmountThreshold: "5900000",
            slippageBps: 200,
            priceImpactPct: "0.12",
            swapMode: "ExactIn",
            routePlan: [{}, {}],
        };
        const r = normalizeJupiterQuotePreview(raw, {
            slippageBps: 200,
            outputDecimals: 6,
            spendUsd: 1,
        });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.preview.routeHops).toBe(2);
            expect(r.preview.approxOutTokens).toBe(6);
            expect(r.preview.priceImpactPct).toBe("0.12");
            expect(r.preview.approxUsdPerToken).toBeCloseTo(1 / 6, 10);
            expect(r.preview.worstUsdPerToken).toBeCloseTo(1 / 5.9, 10);
        }
    });
});

describe("fetchJupiterV6Quote (mocked)", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("returns error on non-OK HTTP", async () => {
        vi.stubGlobal(
            "fetch",
            vi.fn(async () => ({
                ok: false,
                status: 400,
                text: async () => JSON.stringify({ error: "bad route" }),
            }))
        );
        const { fetchJupiterV6Quote } = await import("../src/trading/jupiterQuote");
        const out = await fetchJupiterV6Quote({
            inputMint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
            outputMint: "So11111111111111111111111111111111111111112",
            amount: "1000000",
            slippageBps: 100,
        });
        expect(out.ok).toBe(false);
        if (!out.ok) expect(out.error).toContain("bad");
    });
});
