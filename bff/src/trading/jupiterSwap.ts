/**
 * Jupiter Swap API — build unsigned swap transaction for wallet signing.
 * @see https://dev.jup.ag/docs/api-reference/swap
 */
import Decimal from "decimal.js";
import {
    DEFAULT_JUPITER_API_BASE,
    fetchJupiterV6Quote,
    JUPITER_DEFAULT_INPUT_MINT,
    USDT_MINT_MAINNET,
    usdcRawAmountFromUsd,
} from "./jupiterQuote";
import { slippageBpsFromMaxSlippagePercent } from "./slippage";
const SWAP_TIMEOUT_MS = 25_000;

/** Exact-in token amount for Jupiter (atomic integer string). */
export function tokenUiAmountToRawExactIn(uiAmount: number, decimals: number): string {
    if (!Number.isFinite(uiAmount) || uiAmount <= 0) return "0";
    const d = Math.max(0, Math.min(18, Math.floor(decimals)));
    const raw = new Decimal(uiAmount).mul(new Decimal(10).pow(d)).floor();
    if (raw.lt(1)) return "0";
    return raw.toFixed(0);
}

/** Loose base58 pubkey check (Solana addresses). */
export function looksLikeSolanaPubkey(s: string): boolean {
    return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
}

export async function fetchJupiterV6SwapTransaction(params: {
    quoteResponse: Record<string, unknown>;
    userPublicKey: string;
}): Promise<
    { ok: true; swapTransaction: string; lastValidBlockHeight?: number } | { ok: false; error: string; status?: number }
> {
    const pk = params.userPublicKey.trim();
    if (!looksLikeSolanaPubkey(pk)) {
        return { ok: false, error: "Invalid userPublicKey" };
    }

    const baseRaw = process.env.BFF_JUPITER_QUOTE_API?.trim() || DEFAULT_JUPITER_API_BASE;
    const base = baseRaw.replace(/\/$/, "");
    const url = `${base}/swap`;

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), SWAP_TIMEOUT_MS);
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: { Accept: "application/json", "Content-Type": "application/json" },
            signal: ac.signal,
            body: JSON.stringify({
                quoteResponse: params.quoteResponse,
                userPublicKey: pk,
                wrapAndUnwrapSol: true,
                dynamicComputeUnitLimit: true,
                prioritizationFeeLamports: "auto",
            }),
        });
        clearTimeout(timer);
        const text = await res.text();
        if (!res.ok) {
            let msg = text.slice(0, 400);
            try {
                const j = JSON.parse(text) as { error?: string; message?: string };
                msg = j.error ?? j.message ?? msg;
            } catch {
                /* */
            }
            return { ok: false, error: msg || `Jupiter swap HTTP ${res.status}`, status: res.status };
        }
        const data = JSON.parse(text) as { swapTransaction?: string; lastValidBlockHeight?: number };
        const swapTransaction = data.swapTransaction;
        if (typeof swapTransaction !== "string" || !swapTransaction.length) {
            return { ok: false, error: "Jupiter swap response missing swapTransaction" };
        }
        return {
            ok: true,
            swapTransaction,
            lastValidBlockHeight:
                typeof data.lastValidBlockHeight === "number" ? data.lastValidBlockHeight : undefined,
        };
    } catch (e) {
        clearTimeout(timer);
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "This operation was aborted" || msg.includes("abort")) {
            return { ok: false, error: "Jupiter swap timed out" };
        }
        return { ok: false, error: msg };
    }
}

/** Fresh quote + swap tx (quote must be unused / recent when user signs). */
export async function jupiterSwapTxForUsdcBuy(params: {
    outputMint: string;
    amountUsd: number;
    maxSlippagePercent: number;
    userPublicKey: string;
    inputMint?: string;
}): Promise<
    | { ok: true; swapTransaction: string; lastValidBlockHeight?: number }
    | { ok: false; error: string; status?: number }
> {
    const outputMint = String(params.outputMint ?? "").trim();
    if (!outputMint) return { ok: false, error: "outputMint is required" };

    const amountUsd = Number(params.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd < 0.01 || amountUsd > 50_000) {
        return { ok: false, error: "amountUsd must be between 0.01 and 50000" };
    }

    if (!looksLikeSolanaPubkey(params.userPublicKey)) {
        return { ok: false, error: "Connect a valid Solana wallet first" };
    }

    const inputMint = (params.inputMint ?? JUPITER_DEFAULT_INPUT_MINT).trim();
    const amount = usdcRawAmountFromUsd(amountUsd);
    const slippageBps = slippageBpsFromMaxSlippagePercent(Number(params.maxSlippagePercent) || 2);

    const quoted = await fetchJupiterV6Quote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
    });
    if (!quoted.ok) return quoted;

    return fetchJupiterV6SwapTransaction({
        quoteResponse: quoted.raw,
        userPublicKey: params.userPublicKey.trim(),
    });
}

/** Sell SPL token → USDT (ExactIn token amount). */
export async function jupiterSwapTxForTokenSell(params: {
    inputMint: string;
    /** Raw atomic units of input token (ExactIn). */
    amountRaw: string;
    maxSlippagePercent: number;
    userPublicKey: string;
    outputMint?: string;
}): Promise<
    | { ok: true; swapTransaction: string; lastValidBlockHeight?: number }
    | { ok: false; error: string; status?: number }
> {
    const inputMint = String(params.inputMint ?? "").trim();
    if (!inputMint) return { ok: false, error: "inputMint is required" };

    const amountRaw = String(params.amountRaw ?? "").trim();
    if (!amountRaw || amountRaw === "0") return { ok: false, error: "amountRaw must be a positive integer string" };

    if (!looksLikeSolanaPubkey(params.userPublicKey)) {
        return { ok: false, error: "Connect a valid Solana wallet first" };
    }

    const outputMint = (params.outputMint ?? USDT_MINT_MAINNET).trim();
    const slippageBps = slippageBpsFromMaxSlippagePercent(Number(params.maxSlippagePercent) || 2);

    const quoted = await fetchJupiterV6Quote({
        inputMint,
        outputMint,
        amount: amountRaw,
        slippageBps,
    });
    if (!quoted.ok) return quoted;

    return fetchJupiterV6SwapTransaction({
        quoteResponse: quoted.raw,
        userPublicKey: params.userPublicKey.trim(),
    });
}
