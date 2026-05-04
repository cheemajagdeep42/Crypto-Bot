import { describe, expect, it } from "vitest";
import { dexPaperTokenDisplayLabel, normalizeDexScreenerPairId } from "../src/dexscreenerScan";

/** Minimal pair shape for label helper (full `DexPair` is internal to dexscreenerScan). */
function pairWithBase(base: { address: string; symbol: string; name: string }) {
    return {
        chainId: "solana",
        pairAddress: "abc123",
        url: "https://dexscreener.com",
        baseToken: base,
        quoteToken: { address: "q", name: "SOL", symbol: "SOL" },
        priceUsd: "1",
    };
}

describe("dexPaperTokenDisplayLabel", () => {
    it("uses symbol only when name matches or is empty", () => {
        expect(dexPaperTokenDisplayLabel(pairWithBase({ address: "a", symbol: "EVA", name: "EVA" }) as never)).toBe(
            "EVA"
        );
        expect(dexPaperTokenDisplayLabel(pairWithBase({ address: "a", symbol: "EVA", name: "" }) as never)).toBe("EVA");
    });

    it("prefixes symbol when name differs (avoids looking like two tokens)", () => {
        expect(
            dexPaperTokenDisplayLabel(
                pairWithBase({ address: "a", symbol: "EVA", name: "ELON VS ALTMAN" }) as never
            )
        ).toBe("EVA (ELON VS ALTMAN)");
    });
});

describe("normalizeDexScreenerPairId", () => {
    const id = "dvekmbaqzymqmktcssaiovkr3oicawt8fj5sjlphuhba";

    it("returns bare pair id unchanged", () => {
        expect(normalizeDexScreenerPairId(`  ${id}  `)).toBe(id);
    });

    it("strips DexScreener page URL to pair id", () => {
        expect(normalizeDexScreenerPairId(`https://dexscreener.com/solana/${id}`)).toBe(id);
        expect(normalizeDexScreenerPairId(`dexscreener.com/solana/${id}`)).toBe(id);
    });
});
