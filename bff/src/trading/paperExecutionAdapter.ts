import Decimal from "decimal.js";
import type { DexTradeIntent, ExecutionAdapter, PaperExecutionReceipt, PaperQuote, TradeEngineMode } from "./types";

/** Conservative paper fill: price moves against buyer by slippage bps. */
export function worstCaseBuyPriceUsd(referencePriceUsd: number, slippageBps: number): number {
    const ref = new Decimal(referencePriceUsd);
    const slip = new Decimal(slippageBps).div(10_000);
    const mult = new Decimal(1).plus(slip);
    return ref.mul(mult).toNumber();
}

export function paperQuantityFromUsd(notionalUsd: number, priceUsdPerToken: number): number {
    const n = new Decimal(notionalUsd);
    const p = new Decimal(priceUsdPerToken);
    if (p.lte(0)) return 0;
    return n.div(p).toNumber();
}

export class PaperExecutionAdapter implements ExecutionAdapter {
    readonly mode: TradeEngineMode = "paper";

    quotePaperBuy(intent: DexTradeIntent): PaperQuote {
        const worstPriceUsd = worstCaseBuyPriceUsd(intent.referencePriceUsd, intent.slippageBps);
        const outputAmount = paperQuantityFromUsd(intent.amountUsd, worstPriceUsd);
        return {
            intent,
            worstPriceUsd,
            outputAmount,
            inputMint: intent.inputMint,
            outputMint: intent.outputMint,
        };
    }

    executePaperBuy(quote: PaperQuote, feeRate: number): PaperExecutionReceipt {
        const feeUsd = new Decimal(quote.intent.amountUsd).mul(feeRate).toNumber();
        const executedAt = new Date().toISOString();
        return {
            quote,
            filledPriceUsd: quote.worstPriceUsd,
            filledQuantity: quote.outputAmount,
            feeUsd,
            executedAt,
        };
    }
}
