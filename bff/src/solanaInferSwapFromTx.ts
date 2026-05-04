/**
 * Best-effort inference of a Jupiter-style spot buy (stable → token) from a confirmed tx signature.
 * Uses pre/post token balances; works for typical USDT/USDC ExactIn swaps when `SOLANA_RPC_URL` is set.
 */
import { Connection } from "@solana/web3.js";
import { USDT_MINT_MAINNET } from "./solanaOnChainSnapshot";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";

const USDC_MINT_MAINNET = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

const STABLE_SPEND_MINTS = new Set([USDT_MINT_MAINNET, USDC_MINT_MAINNET]);

const BINANCE_SOL_USDT = "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";
const SPOT_FETCH_MS = 10_000;

async function fetchSolUsdSpot(): Promise<number | null> {
    const ac = new AbortController();
    const t = setTimeout(() => ac.abort(), SPOT_FETCH_MS);
    try {
        const res = await fetch(BINANCE_SOL_USDT, { signal: ac.signal, headers: { Accept: "application/json" } });
        if (!res.ok) return null;
        const body = (await res.json()) as { price?: string };
        const n = Number(body.price);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
        return null;
    } finally {
        clearTimeout(t);
    }
}

export type InferredMainnetBuy = {
    outputMint: string;
    tokenDecimals: number;
    quantityTokens: number;
    positionSizeUsdt: number;
    entryPriceUsd: number;
    spendMint: string;
    feePayer: string | null;
    /** Short note if inference used a fallback. */
    note?: string;
};

function rpcConnection(): Connection {
    const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC;
    return new Connection(rpcUrl, "confirmed");
}

function uiFromBalance(b: {
    uiTokenAmount?: { amount?: string; decimals?: number; uiAmount?: number | null };
}): { ui: number; decimals: number } {
    const dec = Math.max(0, Math.min(18, Math.floor(Number(b.uiTokenAmount?.decimals ?? 0))));
    if (b.uiTokenAmount?.uiAmount != null && Number.isFinite(Number(b.uiTokenAmount.uiAmount))) {
        return { ui: Number(b.uiTokenAmount.uiAmount), decimals: dec };
    }
    const raw = String(b.uiTokenAmount?.amount ?? "0");
    try {
        const bi = BigInt(raw);
        const scale = 10 ** dec;
        return { ui: Number(bi) / scale, decimals: dec };
    } catch {
        return { ui: 0, decimals: dec };
    }
}

type DeltaRow = { owner: string; mint: string; delta: number; decimals: number };

type LooseTokenBal = {
    accountIndex: number;
    mint: string;
    owner?: string;
    uiTokenAmount?: { amount?: string; decimals?: number; uiAmount?: number | null };
};

function collectTokenDeltas(meta: {
    preTokenBalances?: LooseTokenBal[] | null;
    postTokenBalances?: LooseTokenBal[] | null;
}): DeltaRow[] {
    const preByIdx = new Map<number, LooseTokenBal>();
    const postByIdx = new Map<number, LooseTokenBal>();
    for (const b of meta.preTokenBalances ?? []) {
        preByIdx.set(b.accountIndex, b);
    }
    for (const b of meta.postTokenBalances ?? []) {
        postByIdx.set(b.accountIndex, b);
    }
    const indices = new Set<number>([...preByIdx.keys(), ...postByIdx.keys()]);
    const byOwnerMint = new Map<string, DeltaRow>();

    for (const idx of indices) {
        const pre = preByIdx.get(idx);
        const post = postByIdx.get(idx);
        const mint = String(post?.mint ?? pre?.mint ?? "");
        const owner = String(post?.owner ?? pre?.owner ?? "");
        if (!mint || !owner) continue;

        const preUi = pre ? uiFromBalance(pre).ui : 0;
        const postUi = post ? uiFromBalance(post).ui : 0;
        const decimals = post ? uiFromBalance(post).decimals : pre ? uiFromBalance(pre).decimals : 6;
        const delta = postUi - preUi;
        if (!Number.isFinite(delta) || Math.abs(delta) < 1e-12) continue;

        const key = `${owner}\0${mint}`;
        const prev = byOwnerMint.get(key);
        if (prev) {
            prev.delta += delta;
        } else {
            byOwnerMint.set(key, { owner, mint, delta, decimals });
        }
    }
    return [...byOwnerMint.values()];
}

function feePayerFromParsed(parsed: {
    transaction: {
        message: {
            staticAccountKeys?: readonly { toBase58(): string }[];
            accountKeys?: readonly { pubkey: { toBase58(): string } }[];
        };
    };
}): string | null {
    const msg = parsed.transaction.message;
    const staticKeys = msg.staticAccountKeys;
    if (staticKeys && staticKeys.length > 0) {
        return staticKeys[0].toBase58();
    }
    const legacy = msg.accountKeys;
    if (legacy && legacy.length > 0) {
        return legacy[0].pubkey.toBase58();
    }
    return null;
}

/**
 * @returns Inferred fill or error message (not thrown).
 */
export async function inferMainnetBuyFromTxSignature(signature: string): Promise<
    { ok: true; inferred: InferredMainnetBuy } | { ok: false; error: string }
> {
    const sig = String(signature ?? "").trim();
    if (!sig || sig.length < 32) {
        return { ok: false, error: "Invalid transaction signature." };
    }

    let parsed: Awaited<ReturnType<Connection["getParsedTransaction"]>>;
    try {
        const conn = rpcConnection();
        parsed = await conn.getParsedTransaction(sig, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }

    if (!parsed) {
        return { ok: false, error: "Transaction not found (wrong cluster or signature?)." };
    }
    if (parsed.meta?.err) {
        return { ok: false, error: "Transaction failed on-chain; cannot infer a buy." };
    }

    const meta = parsed.meta;
    if (!meta) {
        return { ok: false, error: "Transaction has no meta." };
    }

    const rows = collectTokenDeltas({
        preTokenBalances: meta.preTokenBalances ?? undefined,
        postTokenBalances: meta.postTokenBalances ?? undefined,
    });
    if (rows.length === 0) {
        return { ok: false, error: "No token balance changes found (not a typical SPL swap?)." };
    }

    const feePayer = feePayerFromParsed(parsed as Parameters<typeof feePayerFromParsed>[0]);

    const stableSpent = rows.filter((r) => STABLE_SPEND_MINTS.has(r.mint) && r.delta < -1e-9);
    const tokenReceived = rows.filter(
        (r) =>
            !STABLE_SPEND_MINTS.has(r.mint) &&
            r.mint !== WSOL_MINT &&
            r.delta > 1e-9 &&
            (feePayer == null || r.owner === feePayer)
    );

    /** If filtering by fee payer removed everything, fall back to any non-stable credit. */
    const credits =
        tokenReceived.length > 0
            ? tokenReceived
            : rows.filter((r) => !STABLE_SPEND_MINTS.has(r.mint) && r.mint !== WSOL_MINT && r.delta > 1e-9);

    if (credits.length === 0) {
        return { ok: false, error: "No token received in this transaction (check signature / cluster)." };
    }

    const recvRow = credits.reduce((a, b) => (a.delta >= b.delta ? a : b));
    const quantityTokens = recvRow.delta;
    if (quantityTokens <= 0) {
        return { ok: false, error: "Inferred token quantity is not positive." };
    }

    let positionSizeUsdt: number;
    let spendMint: string;
    let note: string | undefined;

    if (stableSpent.length > 0) {
        const spendRow = stableSpent.reduce((a, b) => (Math.abs(a.delta) >= Math.abs(b.delta) ? a : b));
        positionSizeUsdt = Math.abs(spendRow.delta);
        spendMint = spendRow.mint;
        if (spendRow.mint === USDC_MINT_MAINNET) {
            note = "Spend side was USDC; notional is stored as USDT-sized for the bot.";
        }
    } else {
        const wsolPayer = rows.filter(
            (r) => r.mint === WSOL_MINT && r.delta < -1e-9 && feePayer != null && r.owner === feePayer
        );
        const wsolAny = rows.filter((r) => r.mint === WSOL_MINT && r.delta < -1e-9);
        const wsolPool = wsolPayer.length > 0 ? wsolPayer : wsolAny;
        if (wsolPool.length === 0) {
            return {
                ok: false,
                error:
                    "Could not find USDT/USDC or WSOL spend with a token receive. Use manual entry or another tx.",
            };
        }
        const spendRow = wsolPool.reduce((a, b) => (Math.abs(a.delta) >= Math.abs(b.delta) ? a : b));
        const solPx = await fetchSolUsdSpot();
        if (solPx == null) {
            return { ok: false, error: "Could not load SOL/USDT spot to value WSOL spend." };
        }
        const solSpent = Math.abs(spendRow.delta);
        positionSizeUsdt = solSpent * solPx;
        spendMint = WSOL_MINT;
        note = `Spend was WSOL (${solSpent.toFixed(6)} SOL); USD notional ≈ SOL×Binance spot ($${solPx.toFixed(2)}).`;
    }

    if (!Number.isFinite(positionSizeUsdt) || positionSizeUsdt <= 0) {
        return { ok: false, error: "Inferred spend notional is not positive." };
    }

    const entryPriceUsd = positionSizeUsdt / quantityTokens;
    if (feePayer && recvRow.owner !== feePayer && tokenReceived.length === 0) {
        note = (note ? note + " " : "") + "Receiver owner may differ from fee payer; verify quantity.";
    }

    return {
        ok: true,
        inferred: {
            outputMint: recvRow.mint,
            tokenDecimals: recvRow.decimals,
            quantityTokens,
            positionSizeUsdt,
            entryPriceUsd,
            spendMint,
            feePayer,
            note,
        },
    };
}

export type InferredMainnetSellStable = {
    /** USDT + USDC credits to the fee payer, summed as USD notional. */
    stableReceivedUi: number;
    /** Primary stable mint (largest credit) for display. */
    stableMint: string;
    /** Absolute token amount sold (output mint / pool token leg). */
    tokenSoldUi: number;
};

/**
 * Best-effort USDT/USDC received from a Jupiter-style sell (token → stable) for the fee payer.
 */
export async function inferMainnetSellStableFromTx(
    signature: string,
    tokenMintSold: string
): Promise<{ ok: true; inferred: InferredMainnetSellStable } | { ok: false; error: string }> {
    const sig = String(signature ?? "").trim();
    const mintSold = String(tokenMintSold ?? "").trim();
    if (!sig || sig.length < 32) {
        return { ok: false, error: "Invalid transaction signature." };
    }
    if (!mintSold) {
        return { ok: false, error: "Token mint is required to validate a sell." };
    }

    let parsed: Awaited<ReturnType<Connection["getParsedTransaction"]>>;
    try {
        const conn = rpcConnection();
        parsed = await conn.getParsedTransaction(sig, {
            maxSupportedTransactionVersion: 0,
            commitment: "confirmed",
        });
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }

    if (!parsed) {
        return { ok: false, error: "Transaction not found (wrong cluster or signature?)." };
    }
    if (parsed.meta?.err) {
        return { ok: false, error: "Transaction failed on-chain; cannot infer proceeds." };
    }

    const meta = parsed.meta;
    if (!meta) {
        return { ok: false, error: "Transaction has no meta." };
    }

    const rows = collectTokenDeltas({
        preTokenBalances: meta.preTokenBalances ?? undefined,
        postTokenBalances: meta.postTokenBalances ?? undefined,
    });
    if (rows.length === 0) {
        return { ok: false, error: "No token balance changes found." };
    }

    const feePayer = feePayerFromParsed(parsed as Parameters<typeof feePayerFromParsed>[0]);

    const stableCredits = rows.filter(
        (r) => STABLE_SPEND_MINTS.has(r.mint) && r.delta > 1e-12 && (feePayer == null || r.owner === feePayer)
    );
    const stableCreditsLoose =
        stableCredits.length > 0
            ? stableCredits
            : rows.filter((r) => STABLE_SPEND_MINTS.has(r.mint) && r.delta > 1e-12);

    let stableReceivedUi = 0;
    let stableMint = USDT_MINT_MAINNET;
    for (const r of stableCreditsLoose) {
        if (r.delta > stableReceivedUi) {
            stableMint = r.mint;
        }
        stableReceivedUi += r.delta;
    }

    const tokenDebits = rows.filter(
        (r) => r.mint === mintSold && r.delta < -1e-12 && (feePayer == null || r.owner === feePayer)
    );
    const tokenDebitsLoose =
        tokenDebits.length > 0
            ? tokenDebits
            : rows.filter((r) => r.mint === mintSold && r.delta < -1e-12);

    let tokenSoldUi = 0;
    for (const r of tokenDebitsLoose) {
        tokenSoldUi += Math.abs(r.delta);
    }

    if (!Number.isFinite(stableReceivedUi) || stableReceivedUi <= 0) {
        return { ok: false, error: "Could not find USDT/USDC received for the fee payer in this tx." };
    }

    return {
        ok: true,
        inferred: {
            stableReceivedUi,
            stableMint,
            tokenSoldUi,
        },
    };
}
