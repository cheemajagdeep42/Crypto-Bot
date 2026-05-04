import { describe, expect, it } from "vitest";
import { looksLikeSolanaPubkey } from "../src/trading/jupiterSwap";

describe("looksLikeSolanaPubkey", () => {
    it("accepts typical Solana addresses", () => {
        expect(looksLikeSolanaPubkey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v")).toBe(true);
        expect(looksLikeSolanaPubkey("So11111111111111111111111111111111111111112")).toBe(true);
        expect(looksLikeSolanaPubkey(" So11111111111111111111111111111111111111112 ")).toBe(true); // trimmed
    });

    it("rejects empty and invalid", () => {
        expect(looksLikeSolanaPubkey("")).toBe(false);
        expect(looksLikeSolanaPubkey("0xabc")).toBe(false);
        expect(looksLikeSolanaPubkey("short")).toBe(false);
    });
});
