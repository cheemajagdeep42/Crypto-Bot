import type { TokenSignal } from "../scanner";

/** Execution surface for Solana (Jupiter live later). */
export type SolanaChainTag = "solana";

export type TradeEngineMode = "paper" | "live";

/** Bridge between scanner metadata and swap execution (Jupiter-shaped). */
export type DexTradeIntent = {
    chain: SolanaChainTag;
    /** Spend side mint (e.g. USDC or SOL). */
    inputMint: string;
    /** Token mint from DexScreener / scan metadata. */
    outputMint: string;
    /** Notional in USD terms for paper sizing (matches current bot USDT sizing). */
    amountUsd: number;
    slippageBps: number;
    /** Human / audit labels */
    symbol: string;
    baseAsset: string;
    referencePriceUsd: number;
};

export type PaperQuote = {
    intent: DexTradeIntent;
    /** Worst-case execution price after slippage (USD per 1 whole token, paper model). */
    worstPriceUsd: number;
    /** Token quantity received at worst price before optional fee on notional. */
    outputAmount: number;
    /** Same mints as intent; echoed for receipts. */
    inputMint: string;
    outputMint: string;
};

export type PaperExecutionReceipt = {
    quote: PaperQuote;
    /** Entry price used for position tracking (mid or ask-side paper; we use worstPrice for conservatism). */
    filledPriceUsd: number;
    filledQuantity: number;
    feeUsd: number;
    executedAt: string;
};

export type TradeEngineEvent =
    | { type: "paper_quote"; quote: PaperQuote }
    | { type: "paper_executed"; receipt: PaperExecutionReceipt }
    | { type: "validation_failed"; reason: string };

export type ExecutionAdapter = {
    readonly mode: TradeEngineMode;
    quotePaperBuy(intent: DexTradeIntent): PaperQuote;
    executePaperBuy(quote: PaperQuote, feeRate: number): PaperExecutionReceipt;
};

export type TradeEngineOptions = {
    /** Paper fee on notional (same order of magnitude as `paperBot` PAPER_FEE_RATE). */
    paperFeeRate?: number;
    onEvent?: (event: TradeEngineEvent) => void;
    /**
     * When `quotePaperBuyFromToken` / `executePaperBuyFromToken` omit `slippageBps`, use this
     * (same field as Run Bot "Max slippage %"). Paper + live adapters should respect it.
     */
    defaultMaxSlippagePercent?: number;
};

/** Narrow `TokenSignal` to Solana + mint + price for paper/live pipeline. */
export function tokenSignalToSolanaIntent(
    token: TokenSignal,
    amountUsd: number,
    slippageBps: number,
    inputMint: string
): { ok: true; intent: DexTradeIntent } | { ok: false; reason: string } {
    const chain = String(token.metadata?.chain ?? "").toLowerCase();
    if (chain !== "solana") {
        return { ok: false, reason: `Expected Solana pair (chain=${token.metadata?.chain ?? "n/a"}).` };
    }
    const outputMint = String(token.metadata?.contractAddress ?? "").trim();
    if (!outputMint) {
        return { ok: false, reason: "Missing base token mint (metadata.contractAddress)." };
    }
    const ref = Number(token.ask);
    if (!Number.isFinite(ref) || ref <= 0) {
        return { ok: false, reason: "Invalid reference ask price for paper fill." };
    }
    const intent: DexTradeIntent = {
        chain: "solana",
        inputMint,
        outputMint,
        amountUsd,
        slippageBps,
        symbol: token.symbol,
        baseAsset: token.baseAsset,
        referencePriceUsd: ref,
    };
    return { ok: true, intent };
}
