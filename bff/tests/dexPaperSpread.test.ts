import { describe, expect, it } from "vitest";
import { DEX_PAPER_SPREAD_PERCENT, dexPaperAskUsd, dexPaperBidUsd } from "../src/dexscreenerScan";

describe("dexPaperBidUsd / dexPaperAskUsd", () => {
    it("symmetric half-spread around mid", () => {
        const mid = 1;
        const bid = dexPaperBidUsd(mid);
        const ask = dexPaperAskUsd(mid);
        expect(bid).toBeLessThan(mid);
        expect(ask).toBeGreaterThan(mid);
        expect(ask - mid).toBeCloseTo(mid - bid, 10);
    });

    it("matches legacy formula for typical Dex mid", () => {
        const priceUsd = 0.00006335;
        const legacyBid = priceUsd * (1 - DEX_PAPER_SPREAD_PERCENT / 200);
        const legacyAsk = priceUsd * (1 + DEX_PAPER_SPREAD_PERCENT / 200);
        expect(dexPaperBidUsd(priceUsd)).toBeCloseTo(legacyBid, 12);
        expect(dexPaperAskUsd(priceUsd)).toBeCloseTo(legacyAsk, 12);
    });
});
