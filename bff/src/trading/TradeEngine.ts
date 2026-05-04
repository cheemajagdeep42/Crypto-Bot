import type { TokenSignal } from "../scanner";
import { JUPITER_DEFAULT_INPUT_MINT } from "./jupiterQuote";
import { PaperExecutionAdapter } from "./paperExecutionAdapter";
import { slippageBpsFromMaxSlippagePercent } from "./slippage";
import type {
    DexTradeIntent,
    ExecutionAdapter,
    PaperExecutionReceipt,
    PaperQuote,
    TradeEngineEvent,
    TradeEngineOptions,
} from "./types";
import { tokenSignalToSolanaIntent } from "./types";

const DEFAULT_PAPER_FEE = 0.001;
/** Fallback when neither per-call nor `defaultMaxSlippagePercent` is set (0.5%). */
const DEFAULT_SLIPPAGE_BPS = 50;

/**
 * Solana-first trade orchestration. Paper path is fully local; live Jupiter plugs in later
 * via a second `ExecutionAdapter` implementation without changing callers.
 */
export class TradeEngine {
    private readonly adapter: ExecutionAdapter;
    private readonly paperFeeRate: number;
    private readonly onEvent?: (event: TradeEngineEvent) => void;
    private readonly defaultMaxSlippagePercent?: number;

    constructor(adapter: ExecutionAdapter = new PaperExecutionAdapter(), options?: TradeEngineOptions) {
        this.adapter = adapter;
        this.paperFeeRate = options?.paperFeeRate ?? DEFAULT_PAPER_FEE;
        this.onEvent = options?.onEvent;
        this.defaultMaxSlippagePercent = options?.defaultMaxSlippagePercent;
    }

    private emit(event: TradeEngineEvent): void {
        this.onEvent?.(event);
    }

    private resolveSlippageBps(opts?: { slippageBps?: number }): number {
        if (opts?.slippageBps != null && Number.isFinite(opts.slippageBps)) {
            return opts.slippageBps;
        }
        if (this.defaultMaxSlippagePercent != null && Number.isFinite(this.defaultMaxSlippagePercent)) {
            return slippageBpsFromMaxSlippagePercent(this.defaultMaxSlippagePercent);
        }
        return DEFAULT_SLIPPAGE_BPS;
    }

    /** Quote-only (no receipt); use for pre-flight UI or risk checks. */
    quotePaperBuyFromToken(
        token: TokenSignal,
        amountUsd: number,
        opts?: { slippageBps?: number; inputMint?: string }
    ): { ok: true; quote: PaperQuote } | { ok: false; reason: string } {
        const inputMint = opts?.inputMint ?? JUPITER_DEFAULT_INPUT_MINT;
        const slippageBps = this.resolveSlippageBps(opts);
        const built = tokenSignalToSolanaIntent(token, amountUsd, slippageBps, inputMint);
        if (!built.ok) {
            this.emit({ type: "validation_failed", reason: built.reason });
            return built;
        }
        const quote = this.adapter.quotePaperBuy(built.intent);
        this.emit({ type: "paper_quote", quote });
        return { ok: true, quote };
    }

    /**
     * Full paper open: validate Solana mint + price → quote → execute with fee.
     * Does not persist or manage open positions (that stays in `paperBot` until migrated).
     */
    executePaperBuyFromToken(
        token: TokenSignal,
        amountUsd: number,
        opts?: { slippageBps?: number; inputMint?: string }
    ): { ok: true; receipt: PaperExecutionReceipt } | { ok: false; reason: string } {
        const q = this.quotePaperBuyFromToken(token, amountUsd, opts);
        if (!q.ok) return q;
        const receipt = this.adapter.executePaperBuy(q.quote, this.paperFeeRate);
        this.emit({ type: "paper_executed", receipt });
        return { ok: true, receipt };
    }

    /** Direct path when caller already built a Jupiter-shaped intent. */
    executePaperBuyIntent(intent: DexTradeIntent): PaperExecutionReceipt {
        const quote = this.adapter.quotePaperBuy(intent);
        this.emit({ type: "paper_quote", quote });
        const receipt = this.adapter.executePaperBuy(quote, this.paperFeeRate);
        this.emit({ type: "paper_executed", receipt });
        return receipt;
    }
}
