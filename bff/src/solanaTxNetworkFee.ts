/**
 * Approximate Solana **network** fee (priority + base) in USDT from a confirmed tx signature.
 * Does not include DEX spread / Jupiter route fees — those stay on the simulated swap fee in the bot.
 */
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const BINANCE_SOL_USDT = "https://api.binance.com/api/v3/ticker/price?symbol=SOLUSDT";
const COINGECKO_SOL_USD = "https://api.coingecko.com/api/v3/simple/price?ids=solana&vs_currencies=usd";
const FETCH_TIMEOUT_MS = 12_000;
const GET_TX_ATTEMPTS = 5;
const GET_TX_RETRY_MS = 450;

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

async function fetchSolUsdtSpot(): Promise<number | null> {
    try {
        const res = await withTimeout(fetch(BINANCE_SOL_USDT), FETCH_TIMEOUT_MS, "SOL price (Binance)");
        if (res.ok) {
            const body = (await res.json()) as { price?: string };
            const n = Number(body.price);
            if (Number.isFinite(n) && n > 0) return n;
        }
    } catch {
        /* try CoinGecko */
    }
    try {
        const res = await withTimeout(fetch(COINGECKO_SOL_USD), FETCH_TIMEOUT_MS, "SOL price (CoinGecko)");
        if (!res.ok) return null;
        const body = (await res.json()) as { solana?: { usd?: number } };
        const n = Number(body.solana?.usd);
        return Number.isFinite(n) && n > 0 ? n : null;
    } catch {
        return null;
    }
}

export async function solanaSignatureNetworkFeeUsdt(signature: string): Promise<number | null> {
    const sig = signature.trim();
    if (!sig) return null;

    const rpcUrl = process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC;
    const connection = new Connection(rpcUrl, "confirmed");

    let tx: Awaited<ReturnType<Connection["getTransaction"]>> = null;
    for (let attempt = 0; attempt < GET_TX_ATTEMPTS; attempt += 1) {
        tx = await withTimeout(
            connection.getTransaction(sig, { maxSupportedTransactionVersion: 0 }),
            FETCH_TIMEOUT_MS,
            "getTransaction"
        );
        if (tx?.meta && typeof tx.meta.fee === "number" && Number.isFinite(tx.meta.fee)) {
            break;
        }
        if (attempt < GET_TX_ATTEMPTS - 1) {
            await new Promise((r) => setTimeout(r, GET_TX_RETRY_MS));
        }
    }
    if (!tx?.meta || typeof tx.meta.fee !== "number" || !Number.isFinite(tx.meta.fee)) {
        return null;
    }

    const sol = tx.meta.fee / LAMPORTS_PER_SOL;
    const solPx = await fetchSolUsdtSpot();
    if (solPx == null || !Number.isFinite(solPx)) return null;
    /** `meta.fee` is total lamports (base + priority), same order of magnitude as explorer “Fee + Priority”. */
    return Number((sol * solPx).toFixed(6));
}
