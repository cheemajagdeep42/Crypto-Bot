import { describe, expect, it } from "vitest";
import { buildBotConfigPatch } from "../src/botConfigPatch";

describe("buildBotConfigPatch", () => {
    it("does not default missing fields (prevents cross-section overwrite)", () => {
        const patch = buildBotConfigPatch({ positionSizeUsdt: 25 });
        expect(patch).toEqual({ positionSizeUsdt: 25 });
        expect("liquidityGuard" in patch).toBe(false);
        expect("timeframe" in patch).toBe(false);
    });

    it("passes maxSlippagePercent through", () => {
        expect(buildBotConfigPatch({ maxSlippagePercent: 2.5 })).toEqual({ maxSlippagePercent: 2.5 });
    });

    it("passes executionMode when paper or live", () => {
        expect(buildBotConfigPatch({ executionMode: "live" })).toEqual({ executionMode: "live" });
        expect(buildBotConfigPatch({ executionMode: "paper" })).toEqual({ executionMode: "paper" });
        expect(buildBotConfigPatch({ executionMode: "invalid" } as Record<string, unknown>)).toEqual({});
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

    it("passes dexMinPairAgeMinutes through", () => {
        const patch = buildBotConfigPatch({ dexMinPairAgeMinutes: 60 });
        expect(patch).toEqual({ dexMinPairAgeMinutes: 60 });
    });

    it("passes dexMinPairAgeMinutes 2 through (UI minimum option)", () => {
        const patch = buildBotConfigPatch({ dexMinPairAgeMinutes: 2 });
        expect(patch).toEqual({ dexMinPairAgeMinutes: 2 });
    });

    it("normalizes minEntryChartTimeframes (order, invalid dropped; empty → default 5m)", () => {
        expect(
            buildBotConfigPatch({
                minEntryChartTimeframes: ["24h", "bogus", "5m", "10m"],
            })
        ).toEqual({ minEntryChartTimeframes: ["5m", "10m", "24h"] });
        expect(
            buildBotConfigPatch({
                minEntryChartTimeframes: ["5m", "2m"],
            })
        ).toEqual({ minEntryChartTimeframes: ["2m", "5m"] });
        expect(buildBotConfigPatch({ minEntryChartTimeframes: [] })).toEqual({
            minEntryChartTimeframes: ["5m"],
        });
    });

    it("normalizes watchWalletAddress when present", () => {
        const valid = "So11111111111111111111111111111111111111112";
        expect(buildBotConfigPatch({ watchWalletAddress: ` ${valid} ` })).toEqual({ watchWalletAddress: valid });
        expect(buildBotConfigPatch({ watchWalletAddress: "bad" })).toEqual({ watchWalletAddress: "" });
    });

    it("normalizes watchWalletAddressW2 when present (may be empty)", () => {
        const valid = "So11111111111111111111111111111111111111112";
        expect(buildBotConfigPatch({ watchWalletAddressW2: ` ${valid} ` })).toEqual({ watchWalletAddressW2: valid });
        expect(buildBotConfigPatch({ watchWalletAddressW2: "bad" })).toEqual({ watchWalletAddressW2: "" });
    });

    it("passes autoSignMainnet and tradeCooldownSeconds", () => {
        expect(buildBotConfigPatch({ autoSignMainnet: true })).toEqual({ autoSignMainnet: true });
        expect(buildBotConfigPatch({ autoSignMainnet: false })).toEqual({ autoSignMainnet: false });
        expect(buildBotConfigPatch({ tradeCooldownSeconds: 300 })).toEqual({ tradeCooldownSeconds: 300 });
    });
});

