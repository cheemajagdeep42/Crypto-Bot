import { describe, expect, it } from "vitest";
import { slippageBpsFromMaxSlippagePercent } from "../src/trading/slippage";

describe("slippageBpsFromMaxSlippagePercent", () => {
    it("maps percent to bps (2% → 200)", () => {
        expect(slippageBpsFromMaxSlippagePercent(2)).toBe(200);
    });
    it("clamps to 50–1000 bps", () => {
        expect(slippageBpsFromMaxSlippagePercent(0.5)).toBe(50);
        expect(slippageBpsFromMaxSlippagePercent(10)).toBe(1000);
    });
});
