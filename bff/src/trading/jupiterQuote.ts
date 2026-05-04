/**
 * Jupiter Swap API quote (read-only). Used for live preview before wallet signing.
 * @see https://dev.jup.ag/docs/api-reference/swap
 *
 * Env:
 * - `BFF_JUPITER_QUOTE_API` — optional base URL (no trailing slash). Default is Jupiter lite `swap/v1` host.
 */
import { slippageBpsFromMaxSlippagePercent } from "./slippage";

/** SPL USDT (Tether) on Solana mainnet-beta — default Jupiter spend side (6 decimals). */
export const USDT_MINT_MAINNET = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

/** SPL USDC on Solana mainnet-beta (6 decimals). Override `inputMint` on quote/swap to use instead of USDT. */
export const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

/** Default ExactIn spend mint for Jupiter quote + swap in this app. */
export const JUPITER_DEFAULT_INPUT_MINT = USDT_MINT_MAINNET;

/** Legacy `quote-api.jup.ag/v6` no longer resolves; lite API uses `/swap/v1/quote` and `/swap/v1/swap`. */
export const DEFAULT_JUPITER_API_BASE = "https://lite-api.jup.ag/swap/v1";
const QUOTE_TIMEOUT_MS = 20_000;

/** USDT and USDC on Solana use 6 decimals; `amountUsd` is whole dollars of spend (e.g. 5 = $5). */
export function usdcRawAmountFromUsd(amountUsd: number): string {
    const u = Number(amountUsd);
    if (!Number.isFinite(u) || u <= 0) return "0";
    const micro = Math.floor(u * 1_000_000);
    return String(Math.max(1, micro));
}

export type JupiterQuotePreview = {
    inputMint: string;
    outputMint: string;
    inAmount: string;
    outAmount: string;
    otherAmountThreshold: string;
    slippageBps: number;
    priceImpactPct: string | null;
    swapMode: string;
    routeHops: number;
    /** `outAmount / 10^outputDecimals` when decimals provided (approximate for UI). */
    approxOutTokens: number | null;
    /** Bet / spend notional in USD (matches USDT leg size for default mint). */
    spendUsd: number;
    /** Spend stable (USDT by default) per 1 whole output token from quoted `outAmount`. */
    approxUsdPerToken: number | null;
    /** Same, at `otherAmountThreshold` (slippage floor). */
    worstUsdPerToken: number | null;
};

function routePlanHopCount(routePlan: unknown): number {
    if (!Array.isArray(routePlan)) return 0;
    return routePlan.length;
}

export async function fetchJupiterV6Quote(params: {
    inputMint: string;
    outputMint: string;
    amount: string;
    slippageBps: number;
}): Promise<{ ok: true; raw: Record<string, unknown> } | { ok: false; error: string; status?: number }> {
    const baseRaw = process.env.BFF_JUPITER_QUOTE_API?.trim() || DEFAULT_JUPITER_API_BASE;
    const base = baseRaw.replace(/\/$/, "");
    const url = new URL(`${base}/quote`);
    url.searchParams.set("inputMint", params.inputMint);
    url.searchParams.set("outputMint", params.outputMint);
    url.searchParams.set("amount", params.amount);
    url.searchParams.set("slippageBps", String(params.slippageBps));
    url.searchParams.set("swapMode", "ExactIn");

    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), QUOTE_TIMEOUT_MS);
    try {
        const res = await fetch(url.toString(), {
            method: "GET",
            headers: { Accept: "application/json" },
            signal: ac.signal,
        });
        clearTimeout(timer);
        if (!res.ok) {
            const text = await res.text();
            let msg = text.slice(0, 400);
            try {
                const j = JSON.parse(text) as { error?: string; message?: string };
                msg = j.error ?? j.message ?? msg;
            } catch {
                /* keep slice */
            }
            return { ok: false, error: msg || `Jupiter HTTP ${res.status}`, status: res.status };
        }
        const raw = (await res.json()) as Record<string, unknown>;
        return { ok: true, raw };
    } catch (e) {
        clearTimeout(timer);
        const msg = e instanceof Error ? e.message : String(e);
        if (msg === "This operation was aborted" || msg.includes("abort")) {
            return { ok: false, error: "Jupiter quote timed out" };
        }
        return { ok: false, error: msg };
    }
}

export function normalizeJupiterQuotePreview(
    raw: Record<string, unknown>,
    params: { slippageBps: number; outputDecimals: number; spendUsd: number }
): { ok: true; preview: JupiterQuotePreview } | { ok: false; error: string } {
    const inputMint = String(raw.inputMint ?? "");
    const outputMint = String(raw.outputMint ?? "");
    const inAmount = String(raw.inAmount ?? "");
    const outAmount = String(raw.outAmount ?? "");
    const otherAmountThreshold = String(raw.otherAmountThreshold ?? "");
    const rawSlip = raw.slippageBps;
    const slippageBps =
        typeof rawSlip === "number" && Number.isFinite(rawSlip)
            ? rawSlip
            : Number.parseInt(String(rawSlip ?? ""), 10);
    const priceImpactPct =
        raw.priceImpactPct != null && String(raw.priceImpactPct).length > 0
            ? String(raw.priceImpactPct)
            : null;
    const swapMode = String(raw.swapMode ?? "ExactIn");

    if (!inputMint || !outputMint || !inAmount || !outAmount) {
        return { ok: false, error: "Unexpected Jupiter quote response" };
    }

    const dec = Math.max(0, Math.min(18, Math.floor(params.outputDecimals)));
    let outBn: bigint;
    try {
        outBn = BigInt(outAmount);
    } catch {
        return { ok: false, error: "Invalid outAmount from Jupiter" };
    }
    const scale = 10 ** dec;
    const approxOutTokens = Number(outBn) / scale;

    let minOutBn: bigint;
    try {
        minOutBn = BigInt(otherAmountThreshold || outAmount);
    } catch {
        minOutBn = outBn;
    }
    const approxMinOutTokens = Number(minOutBn) / scale;

    const spend = params.spendUsd;
    const approxUsdPerToken =
        Number.isFinite(approxOutTokens) && approxOutTokens > 0 && Number.isFinite(spend) && spend > 0
            ? spend / approxOutTokens
            : null;
    const worstUsdPerToken =
        Number.isFinite(approxMinOutTokens) && approxMinOutTokens > 0 && Number.isFinite(spend) && spend > 0
            ? spend / approxMinOutTokens
            : null;

    return {
        ok: true,
        preview: {
            inputMint,
            outputMint,
            inAmount,
            outAmount,
            otherAmountThreshold: otherAmountThreshold || outAmount,
            slippageBps: Number.isFinite(slippageBps) ? slippageBps : params.slippageBps,
            priceImpactPct,
            swapMode,
            routeHops: routePlanHopCount(raw.routePlan),
            approxOutTokens: Number.isFinite(approxOutTokens) ? approxOutTokens : null,
            spendUsd: params.spendUsd,
            approxUsdPerToken:
                approxUsdPerToken != null && Number.isFinite(approxUsdPerToken) ? approxUsdPerToken : null,
            worstUsdPerToken:
                worstUsdPerToken != null && Number.isFinite(worstUsdPerToken) ? worstUsdPerToken : null,
        },
    };
}

export async function jupiterQuotePreviewForUsdcBuy(params: {
    outputMint: string;
    amountUsd: number;
    maxSlippagePercent: number;
    inputMint?: string;
    /** SPL decimals for output token; default 6 (many Solana memecoins). */
    outputDecimals?: number;
}): Promise<{ ok: true; preview: JupiterQuotePreview } | { ok: false; error: string; status?: number }> {
    const outputMint = String(params.outputMint ?? "").trim();
    if (!outputMint) {
        return { ok: false, error: "outputMint is required" };
    }
    const amountUsd = Number(params.amountUsd);
    if (!Number.isFinite(amountUsd) || amountUsd < 0.01 || amountUsd > 50_000) {
        return { ok: false, error: "amountUsd must be between 0.01 and 50000" };
    }

    const inputMint = (params.inputMint ?? JUPITER_DEFAULT_INPUT_MINT).trim();
    const amount = usdcRawAmountFromUsd(amountUsd);
    const slippageBps = slippageBpsFromMaxSlippagePercent(Number(params.maxSlippagePercent) || 2);
    const outputDecimals = params.outputDecimals ?? 6;

    const fetched = await fetchJupiterV6Quote({
        inputMint,
        outputMint,
        amount,
        slippageBps,
    });
    if (!fetched.ok) return fetched;

    const norm = normalizeJupiterQuotePreview(fetched.raw, {
        slippageBps,
        outputDecimals,
        spendUsd: amountUsd,
    });
    if (!norm.ok) return { ok: false, error: norm.error };
    return { ok: true, preview: norm.preview };
}
