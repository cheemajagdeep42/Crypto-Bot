import { describe, expect, it } from "vitest";
import { buildBotConfigPatch } from "../src/botConfigPatch";

describe("buildBotConfigPatch", () => {
    it("does not default missing fields (prevents cross-section overwrite)", () => {
        const patch = buildBotConfigPatch({ positionSizeUsdt: 25 });
        expect(patch).toEqual({ positionSizeUsdt: 25 });
        expect("liquidityGuard" in patch).toBe(false);
        expect("timeframe" in patch).toBe(false);
    });

    it("keeps valid upward TP arrays (e.g. 2x up to 20%)", () => {
        const patch = buildBotConfigPatch({
            takeProfitStepsPercent: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
            takeProfitStepSellFractions: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]
        });
        expect(patch.takeProfitStepsPercent).toEqual([2, 4, 6, 8, 10, 12, 14, 16, 18, 20]);
        expect(patch.takeProfitStepSellFractions).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1]);
    });

    it("ignores invalid numeric arrays instead of corrupting config", () => {
        const patch = buildBotConfigPatch({
            dipStepsPercent: ["bad", "x"],
            dipStepSellFractions: [0.25, "nope"]
        } as unknown as Record<string, unknown>);
        expect(patch.dipStepsPercent).toEqual([]);
        expect(patch.dipStepSellFractions).toEqual([0.25]);
    });
});

