import { describe, expect, it } from "vitest";
import { inferMainnetBuyFromTxSignature } from "../src/solanaInferSwapFromTx";

describe("inferMainnetBuyFromTxSignature", () => {
    it("rejects empty signature", async () => {
        const r = await inferMainnetBuyFromTxSignature("");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.error).toMatch(/invalid/i);
    });

    it("rejects nonsense signature without long RPC wait", async () => {
        const r = await inferMainnetBuyFromTxSignature("abc");
        expect(r.ok).toBe(false);
    });
});
