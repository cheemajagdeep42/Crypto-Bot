import { describe, expect, it } from "vitest";
import { buildJupiterSlippageLadderPercent } from "../src/trading/slippageLadder";

describe("buildJupiterSlippageLadderPercent", () => {
    it("starts at snapped 2% and steps by 0.5% through 10%", () => {
        const ladder = buildJupiterSlippageLadderPercent(2);
        expect(ladder[0]).toBe(2);
        expect(ladder[ladder.length - 1]).toBe(10);
        expect(ladder.length).toBe(17);
    });

    it("starts at 5% when config asks 5%", () => {
        const ladder = buildJupiterSlippageLadderPercent(5);
        expect(ladder[0]).toBe(5);
        expect(ladder.includes(10)).toBe(true);
    });
});
