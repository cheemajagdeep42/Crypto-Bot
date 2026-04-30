import { describe, expect, it } from "vitest";
import { evaluateDexMinFlowByGuard } from "../src/dexscreenerScan";

describe("Dex guard flow behavior", () => {
    it("MC-only does not filter by volume", () => {
        const ok = evaluateDexMinFlowByGuard(1000, 2000, 10_000, {
            liquidityCheckRequired: true,
            liquidityGuard: "mc",
            minFiveMinuteFlowUsdt: 10_000
        });
        expect(ok).toBe(true);
    });

    it("Volume-only enforces 5m threshold when m5 is present", () => {
        const ok = evaluateDexMinFlowByGuard(1022, 50_000, 10_000, {
            liquidityCheckRequired: true,
            liquidityGuard: "volume",
            minFiveMinuteFlowUsdt: 10_000
        });
        expect(ok).toBe(false);
    });

    it("Volume-only falls back to window volume when m5 is missing", () => {
        const ok = evaluateDexMinFlowByGuard(0, 12_000, 10_000, {
            liquidityCheckRequired: true,
            liquidityGuard: "volume",
            minFiveMinuteFlowUsdt: 10_000
        });
        expect(ok).toBe(true);
    });

    it("Both requires flow too", () => {
        const ok = evaluateDexMinFlowByGuard(5_000, 40_000, 10_000, {
            liquidityCheckRequired: true,
            liquidityGuard: "both",
            minFiveMinuteFlowUsdt: 10_000
        });
        expect(ok).toBe(false);
    });
});

