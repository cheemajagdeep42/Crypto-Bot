/**
 * Read-only mainnet balances for watch wallets. Uses `SOLANA_RPC_URL` or public mainnet (often 403 — use a provider URL).
 */
import { Connection, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";

/** Mainnet USDT (Tether SPL). */
export const USDT_MINT_MAINNET = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const BINANCE_SOL_USDT = "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";
/** Dex / Binance HTTP; keep moderate so wallet page stays responsive. */
const FETCH_TIMEOUT_MS = 12_000;

/**
 * `getParsedTokenAccountsByOwner` (×2 programs) often exceeds 12s on public RPC or busy wallets.
 * Override with SOLANA_WALLET_SNAPSHOT_TIMEOUT_MS or SOLANA_RPC_TIMEOUT_MS (milliseconds, 8000–120000).
 */
function snapshotSolanaRpcTimeoutMs(): number {
    const raw =
        process.env.SOLANA_WALLET_SNAPSHOT_TIMEOUT_MS?.trim() ??
        process.env.SOLANA_RPC_TIMEOUT_MS?.trim() ??
        "";
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 8000 && n <= 120_000) {
        return Math.floor(n);
    }
    return 45_000;
}

/** SPL Token program (legacy); batched `getParsedTokenAccountsByOwner` avoids N per-mint RPC calls. */
const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
/** SPL Token-2022 program — second batched fetch so bot-known / wallet SPL aren’t missed. */
const SPL_TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

/** Public mainnet RPC often returns JSON-RPC 403; steer operators to a keyed provider. */
function solanaRpcFailureHint(rawMessage: string): string {
    const lower = rawMessage.toLowerCase();
    if (
        lower.includes("403") ||
        lower.includes("access forbidden") ||
        (lower.includes("forbidden") && lower.includes("jsonrpc"))
    ) {
        return (
            "Solana RPC blocked this request (403 Access forbidden). The public endpoint often rejects browser or server traffic. " +
            "Set SOLANA_RPC_URL on the BFF (wallet snapshot API) and NEXT_PUBLIC_SOLANA_RPC_URL on the Next.js app " +
            "(wallet / Phantom) to your provider mainnet HTTPS URL (Helius, QuickNode, Alchemy, etc.)."
        );
    }
    if (lower.includes("429") || lower.includes("too many requests")) {
        return (
            "Solana RPC rate limited this request (429). Free tiers often cap repeated calls (e.g. getTokenAccountsByOwner). " +
            "Use a paid RPC plan, raise the wallet poll interval, or ensure the BFF uses a single batched token-accounts fetch (already the default here)."
        );
    }
    if (lower.includes("timed out")) {
        return (
            `${rawMessage} Default snapshot RPC wait is 45s; set SOLANA_WALLET_SNAPSHOT_TIMEOUT_MS=60000 on the BFF if needed. ` +
            "Use a dedicated mainnet RPC in SOLANA_RPC_URL (Alchemy/Helius/QuickNode); public endpoints often time out on large token-account scans."
        );
    }
    return rawMessage;
}

/** Mint + label from bot state (mainnet / recorded legs) for extra SPL rows in the wallet table. */
export type BotKnownTokenMeta = {
    mint: string;
    symbol: string;
};

export type KnownTokenBalance = {
    mint: string;
    symbol: string;
    balanceUi: number;
    /** DexScreener best-pool spot × balance; null if fetch failed. */
    valueUsd: number | null;
};

export type OnChainWalletSnapshot = {
    address: string;
    solBalance: number;
    usdtBalance: number;
    solPriceUsd: number | null;
    solValueUsd: number;
    usdtValueUsd: number;
    totalUsd: number;
    /** Non-zero SPL balances: bot-known mints plus other wallet-held mints (capped). */
    knownTokens?: KnownTokenBalance[];
    rpcUrl: string;
    error?: string;
};

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
    let timer: NodeJS.Timeout | null = null;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
            }),
        ]);
    } finally {
        if (timer) clearTimeout(timer);
    }
}

const DEX_TOKEN_V1 = "https://api.dexscreener.com/tokens/v1";

async function fetchMintSpotUsdSolana(mint: string): Promise<number | null> {
    const meta = await fetchMintDexMetaSolana(mint);
    return meta?.priceUsd ?? null;
}

/** Best DexScreener pool for a mint: spot USD + display symbol (for wallet-held SPL not in bot state). */
async function fetchMintDexMetaSolana(mint: string): Promise<{ priceUsd: number; symbol: string } | null> {
    const m = mint.trim();
    if (!m) return null;
    try {
        const res = await withTimeout(
            fetch(`${DEX_TOKEN_V1}/solana/${encodeURIComponent(m)}`),
            FETCH_TIMEOUT_MS,
            "DexScreener token"
        );
        if (!res.ok) return null;
        const raw = (await res.json()) as Array<{
            priceUsd?: string | number;
            liquidity?: { usd?: number };
            baseToken?: { symbol?: string };
        }>;
        const pairs = Array.isArray(raw) ? raw : [];
        if (pairs.length === 0) return null;
        const sorted = [...pairs].sort((a, b) => (b.liquidity?.usd ?? 0) - (a.liquidity?.usd ?? 0));
        const p0 = sorted[0];
        const px = Number(p0?.priceUsd);
        if (!Number.isFinite(px) || px <= 0) return null;
        const symRaw = p0?.baseToken?.symbol;
        const sym = typeof symRaw === "string" && symRaw.trim() ? symRaw.trim() : "";
        const symbol = sym || `${m.slice(0, 4)}…${m.slice(-4)}`;
        return { priceUsd: px, symbol };
    } catch {
        return null;
    }
}

async function fetchSolUsdtSpot(): Promise<number | null> {
    try {
        const res = await withTimeout(fetch(BINANCE_SOL_USDT), FETCH_TIMEOUT_MS, "SOL price");
        if (!res.ok) return null;
        const body = (await res.json()) as { price?: string };
        const n = Number(body.price);
        return Number.isFinite(n) ? n : null;
    } catch {
        return null;
    }
}

type ParsedTokenOwnerRow = {
    account?: {
        data?: {
            parsed?: {
                info?: { mint?: string; tokenAmount?: { uiAmount?: number | null } };
            };
        };
    };
};

/** Sum parsed SPL `uiAmount` per mint (multiple token accounts per mint are merged). */
function aggregateSplUiByMint(rows: ReadonlyArray<ParsedTokenOwnerRow>): Map<string, number> {
    const map = new Map<string, number>();
    for (const row of rows) {
        const mintRaw = row.account?.data?.parsed?.info?.mint;
        if (typeof mintRaw !== "string") continue;
        const mint = mintRaw.trim();
        if (!mint) continue;
        const ui = row.account?.data?.parsed?.info?.tokenAmount?.uiAmount;
        if (typeof ui !== "number" || !Number.isFinite(ui)) continue;
        map.set(mint, (map.get(mint) ?? 0) + ui);
    }
    return map;
}

function mergeSplUiMaps(into: Map<string, number>, from: Map<string, number>): void {
    for (const [mint, ui] of from) {
        into.set(mint, (into.get(mint) ?? 0) + ui);
    }
}

const MAX_BOT_KNOWN_MINTS = 24;
/** Extra SPL rows for mints held on-chain but not referenced by bot trades (e.g. ad-hoc Jupiter buys). */
const MAX_WALLET_ONLY_MINTS = 20;

function dedupeBotKnownTokens(meta: BotKnownTokenMeta[]): BotKnownTokenMeta[] {
    const map = new Map<string, string>();
    for (const row of meta) {
        const mint = String(row.mint ?? "").trim();
        if (!mint || mint === USDT_MINT_MAINNET) continue;
        const sym = String(row.symbol ?? "Token").trim() || "Token";
        if (!map.has(mint)) map.set(mint, sym);
    }
    return [...map.entries()].slice(0, MAX_BOT_KNOWN_MINTS).map(([mint, symbol]) => ({ mint, symbol }));
}

export async function fetchOnChainWalletSnapshot(
    address: string,
    options?: { botKnownTokens?: BotKnownTokenMeta[] }
): Promise<OnChainWalletSnapshot> {
    const empty = (error: string): OnChainWalletSnapshot => ({
        address,
        solBalance: 0,
        usdtBalance: 0,
        solPriceUsd: null,
        solValueUsd: 0,
        usdtValueUsd: 0,
        totalUsd: 0,
        knownTokens: [],
        rpcUrl: process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC,
        error,
    });

    const trimmed = address.trim();
    if (!trimmed) {
        return empty("no_watch_wallet");
    }

    let owner: PublicKey;
    try {
        owner = new PublicKey(trimmed);
    } catch {
        return empty("invalid_address");
    }

    const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC;
    const connection = new Connection(rpcUrl, "confirmed");
    const rpcWaitMs = snapshotSolanaRpcTimeoutMs();

    try {
        const [lamports, legacyTokenRes, token2022Res, solPriceUsd] = await withTimeout(
            Promise.all([
                connection.getBalance(owner, "confirmed"),
                connection.getParsedTokenAccountsByOwner(owner, {
                    programId: SPL_TOKEN_PROGRAM_ID,
                }),
                connection
                    .getParsedTokenAccountsByOwner(owner, {
                        programId: SPL_TOKEN_2022_PROGRAM_ID,
                    })
                    .catch((): { value: ParsedTokenOwnerRow[] } => ({ value: [] })),
                fetchSolUsdtSpot(),
            ]),
            rpcWaitMs,
            "Solana RPC"
        );

        const solBalance = lamports / LAMPORTS_PER_SOL;
        const byMint = aggregateSplUiByMint(legacyTokenRes.value);
        mergeSplUiMaps(byMint, aggregateSplUiByMint(token2022Res.value));
        const usdtBalance = byMint.get(USDT_MINT_MAINNET) ?? 0;
        const solValueUsd = solPriceUsd != null ? solBalance * solPriceUsd : 0;
        const usdtValueUsd = usdtBalance;

        const botMeta = dedupeBotKnownTokens(options?.botKnownTokens ?? []);
        let knownTokens: KnownTokenBalance[] = [];
        if (botMeta.length > 0) {
            try {
                knownTokens = await withTimeout(
                    (async () => {
                        const out: KnownTokenBalance[] = [];
                        for (const { mint, symbol } of botMeta) {
                            const balanceUi = byMint.get(mint) ?? 0;
                            if (balanceUi <= 1e-12) continue;
                            const px = await fetchMintSpotUsdSolana(mint);
                            const valueUsd = px != null ? Number((balanceUi * px).toFixed(2)) : null;
                            out.push({ mint, symbol, balanceUi, valueUsd });
                        }
                        return out;
                    })(),
                    Math.min(30_000, rpcWaitMs * 2),
                    "bot-known SPL"
                );
            } catch {
                knownTokens = [];
            }
        }

        const botMintSet = new Set(botMeta.map((b) => b.mint));
        const unknownHeld = [...byMint.entries()].filter(
            ([mint, ui]) => mint !== USDT_MINT_MAINNET && ui > 1e-9 && !botMintSet.has(mint)
        );
        unknownHeld.sort((a, b) => b[1] - a[1]);
        const walletOnlySlice = unknownHeld.slice(0, MAX_WALLET_ONLY_MINTS);
        let walletOnlyTokens: KnownTokenBalance[] = [];
        if (walletOnlySlice.length > 0) {
            try {
                walletOnlyTokens = await withTimeout(
                    (async () => {
                        const out: KnownTokenBalance[] = [];
                        for (const [mint, balanceUi] of walletOnlySlice) {
                            const meta = await fetchMintDexMetaSolana(mint);
                            const valueUsd =
                                meta != null ? Number((balanceUi * meta.priceUsd).toFixed(2)) : null;
                            out.push({
                                mint,
                                symbol: meta?.symbol ?? `${mint.slice(0, 4)}…${mint.slice(-4)}`,
                                balanceUi,
                                valueUsd,
                            });
                        }
                        return out;
                    })(),
                    Math.min(40_000, rpcWaitMs * 2),
                    "wallet-only SPL"
                );
            } catch {
                walletOnlyTokens = [];
            }
        }

        knownTokens = [...knownTokens, ...walletOnlyTokens];
        const knownUsd = knownTokens.reduce((s, t) => s + (t.valueUsd ?? 0), 0);
        const totalUsd = solValueUsd + usdtValueUsd + knownUsd;

        return {
            address: trimmed,
            solBalance,
            usdtBalance,
            solPriceUsd,
            solValueUsd,
            usdtValueUsd,
            totalUsd,
            knownTokens,
            rpcUrl,
        };
    } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return {
            ...empty(solanaRpcFailureHint(message)),
            address: trimmed,
            rpcUrl,
        };
    }
}
