import { describe, expect, it, vi } from "vitest";
import type { TokenSignal } from "../src/scanner";
import { PaperExecutionAdapter, paperQuantityFromUsd, TradeEngine, worstCaseBuyPriceUsd } from "../src/trading";
import { tokenSignalToSolanaIntent } from "../src/trading/types";

describe("worstCaseBuyPriceUsd", () => {
    it("raises price by slippage bps", () => {
        expect(worstCaseBuyPriceUsd(100, 0)).toBe(100);
        expect(worstCaseBuyPriceUsd(100, 100)).toBeCloseTo(101, 10);
        expect(worstCaseBuyPriceUsd(2, 50)).toBeCloseTo(2.01, 10);
    });
});

describe("paperQuantityFromUsd", () => {
    it("divides notional by price", () => {
        expect(paperQuantityFromUsd(100, 2)).toBe(50);
        expect(paperQuantityFromUsd(10, 0)).toBe(0);
    });
});

describe("PaperExecutionAdapter", () => {
    it("round-trips quote + execute with fee", () => {
        const adapter = new PaperExecutionAdapter();
        const intent = {
            chain: "solana" as const,
            inputMint: "USDC",
            outputMint: "MINT",
            amountUsd: 100,
            slippageBps: 100,
            symbol: "DS_X_0xabc",
            baseAsset: "X",
            referencePriceUsd: 1,
        };
        const quote = adapter.quotePaperBuy(intent);
        expect(quote.worstPriceUsd).toBeCloseTo(1.01, 8);
        expect(quote.outputAmount).toBeCloseTo(100 / 1.01, 6);
        const receipt = adapter.executePaperBuy(quote, 0.001);
        expect(receipt.feeUsd).toBeCloseTo(0.1, 6);
        expect(receipt.filledQuantity).toBe(quote.outputAmount);
    });
});

describe("tokenSignalToSolanaIntent", () => {
    it("rejects non-solana", () => {
        const token = { metadata: { chain: "ethereum", contractAddress: "0xabc" } } as unknown as TokenSignal;
        const r = tokenSignalToSolanaIntent(token, 50, 25, "USDC");
        expect(r.ok).toBe(false);
    });

    it("accepts solana with mint and ask", () => {
        const token = {
            symbol: "DS_T_abc123",
            baseAsset: "T",
            ask: 0.5,
            metadata: { chain: "solana", contractAddress: "So11111111111111111111111111111111111111112" },
        } as TokenSignal;
        const r = tokenSignalToSolanaIntent(token, 50, 25, "USDC");
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.intent.outputMint).toContain("So111");
            expect(r.intent.amountUsd).toBe(50);
        }
    });
});

describe("TradeEngine", () => {
    it("emits quote then executed on paper buy", () => {
        const events: string[] = [];
        const engine = new TradeEngine(new PaperExecutionAdapter(), {
            paperFeeRate: 0.001,
            onEvent: (e) => events.push(e.type),
        });
        const token = {
            symbol: "DS_T_abc",
            baseAsset: "T",
            ask: 1,
            metadata: { chain: "solana", contractAddress: "Mint111111111111111111111111111111111111111" },
        } as TokenSignal;
        const out = engine.executePaperBuyFromToken(token, 25);
        expect(out.ok).toBe(true);
        expect(events).toEqual(["paper_quote", "paper_executed"]);
    });

    it("surfaces validation failures", () => {
        const onEvent = vi.fn();
        const engine = new TradeEngine(undefined, { onEvent });
        const token = { symbol: "x", baseAsset: "x", ask: 1, metadata: { chain: "base" } } as TokenSignal;
        const out = engine.quotePaperBuyFromToken(token, 10);
        expect(out.ok).toBe(false);
        expect(onEvent).toHaveBeenCalledWith(
            expect.objectContaining({ type: "validation_failed" })
        );
    });

    it("uses defaultMaxSlippagePercent when slippageBps not passed", () => {
        const engine = new TradeEngine(new PaperExecutionAdapter(), {
            defaultMaxSlippagePercent: 2,
        });
        const token = {
            symbol: "DS_T_abc",
            baseAsset: "T",
            ask: 1,
            metadata: { chain: "solana", contractAddress: "So11111111111111111111111111111111111111112" },
        } as TokenSignal;
        const out = engine.quotePaperBuyFromToken(token, 10);
        expect(out.ok).toBe(true);
        if (out.ok) {
            expect(out.quote.intent.slippageBps).toBe(200);
        }
    });
});
