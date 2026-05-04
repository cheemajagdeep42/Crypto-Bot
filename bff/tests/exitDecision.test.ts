import { describe, expect, it } from "vitest";
import { decideExit, type ExitDecisionTradeSnapshot, type ExitRules } from "../src/trading/exitDecision";

const baseRules: ExitRules = {
    stopLossPercent: 5,
    takeProfitStepsPercent: [2, 5],
    takeProfitStepSellFraction: 0.5,
    takeProfitStepSellFractions: [0.5, 0.5],
    dipStepsPercent: [10],
    dipStepSellFractions: [1],
    dipRetracementStepsPercent: [],
    dipRetracementSellFractions: [],
    minDipRetracementMfeBasisPercent: 5,
    maxHoldMinutes: 60,
};

function snap(over: Partial<ExitDecisionTradeSnapshot>): ExitDecisionTradeSnapshot {
    return {
        pnlPercent: 0,
        entryPrice: 1,
        peakPrice: 1,
        currentPrice: 1,
        takeProfitStepsHit: [],
        dipStepsHit: [],
        dipRetracementStepsHit: [],
        openedAt: new Date().toISOString(),
        ...over,
    };
}

describe("decideExit", () => {
    it("stop loss full exit", () => {
        const d = decideExit(
            snap({ pnlPercent: -6, entryPrice: 1, peakPrice: 1.1, currentPrice: 0.94 }),
            0.94,
            baseRules,
            60,
            1
        );
        expect(d).toEqual({ kind: "close_full", reason: "stop_loss" });
    });

    it("take profit partial first step", () => {
        const d = decideExit(
            snap({ pnlPercent: 2.1, entryPrice: 1, peakPrice: 1.03, currentPrice: 1.03 }),
            1.03,
            baseRules,
            60,
            1
        );
        expect(d.kind).toBe("partial");
        if (d.kind === "partial") {
            expect(d.mode).toBe("tp_step");
            expect(d.stepPercent).toBe(2);
            expect(d.advanceTpHit).toBe(2);
        }
    });

    it("time stop", () => {
        const opened = new Date(Date.now() - 61 * 60_000).toISOString();
        const d = decideExit(
            snap({ pnlPercent: 0, entryPrice: 1, peakPrice: 1, currentPrice: 1, openedAt: opened }),
            1,
            baseRules,
            60,
            61
        );
        expect(d).toEqual({ kind: "close_full", reason: "time_stop" });
    });

    it("peak drawdown partial after upward TP clip (off peak %)", () => {
        const rules: ExitRules = {
            ...baseRules,
            dipStepSellFractions: [0.5],
        };
        const d = decideExit(
            snap({
                pnlPercent: 1,
                entryPrice: 1,
                peakPrice: 1.2,
                currentPrice: 1.07,
                takeProfitStepsHit: [2],
                dipStepsHit: [],
            }),
            1.07,
            rules,
            60,
            1
        );
        expect(d.kind).toBe("partial");
        if (d.kind === "partial") {
            expect(d.mode).toBe("dip_step");
            expect(d.stepPercent).toBe(10);
            expect(d.advanceDipHit).toBe(10);
        }
    });
});
