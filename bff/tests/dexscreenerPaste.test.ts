import { describe, expect, it } from "vitest";
import { parseDexscreenerPasteInput } from "../src/dexscreenerScan";

describe("parseDexscreenerPasteInput", () => {
    it("passes through bare mint with default chain", () => {
        const mint = "So11111111111111111111111111111111111111112";
        expect(parseDexscreenerPasteInput(mint, "solana")).toEqual({ chainId: "solana", id: mint });
    });

    it("parses full dexscreener https URL", () => {
        expect(
            parseDexscreenerPasteInput(
                "https://dexscreener.com/solana/GbZb56KxWqYwKqYwKqYwKqYwKqYwKqYwKqYwKqYwKqY",
                "solana"
            )
        ).toEqual({
            chainId: "solana",
            id: "GbZb56KxWqYwKqYwKqYwKqYwKqYwKqYwKqYwKqYwKqY",
        });
    });

    it("parses URL without scheme", () => {
        expect(parseDexscreenerPasteInput("dexscreener.com/ethereum/0xabc123", "solana")).toEqual({
            chainId: "ethereum",
            id: "0xabc123",
        });
    });

    it("uses default chain when not a dex URL", () => {
        expect(parseDexscreenerPasteInput("  HJgF...  ", "solana")).toEqual({ chainId: "solana", id: "HJgF..." });
    });
});
