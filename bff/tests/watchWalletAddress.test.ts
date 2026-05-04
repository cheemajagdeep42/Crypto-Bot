import { describe, expect, it } from "vitest";
import { normalizeWatchWalletAddress } from "../src/watchWalletAddress";

describe("normalizeWatchWalletAddress", () => {
    it("returns empty for non-string or blank", () => {
        expect(normalizeWatchWalletAddress(null)).toBe("");
        expect(normalizeWatchWalletAddress(undefined)).toBe("");
        expect(normalizeWatchWalletAddress("  ")).toBe("");
    });

    it("returns canonical base58 for a valid mainnet address", () => {
        const a = "So11111111111111111111111111111111111111112";
        expect(normalizeWatchWalletAddress(`  ${a}  `)).toBe(a);
    });

    it("returns empty for invalid base58", () => {
        expect(normalizeWatchWalletAddress("not-a-key")).toBe("");
        expect(normalizeWatchWalletAddress("!!!")).toBe("");
    });
});
