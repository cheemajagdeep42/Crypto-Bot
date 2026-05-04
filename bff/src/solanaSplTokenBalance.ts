/**
 * Read SPL token balance (raw amount, sum of all ATAs) for Jupiter exact-in caps.
 */
import { Connection, PublicKey } from "@solana/web3.js";

const DEFAULT_RPC = "https://api.mainnet-beta.solana.com";
const SPL_TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
const SPL_TOKEN_2022_PROGRAM_ID = new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb");

function rpcConnection(): Connection {
    return new Connection(process.env.SOLANA_RPC_URL?.trim() || DEFAULT_RPC, "confirmed");
}

type ParsedRow = {
    account?: {
        data?: { parsed?: { info?: { mint?: string; tokenAmount?: { amount?: string } } } };
    };
};

function sumRawForMint(rows: readonly ParsedRow[], mintBase58: string): bigint {
    let sum = 0n;
    const want = mintBase58.trim();
    for (const row of rows) {
        const mint = row.account?.data?.parsed?.info?.mint;
        if (typeof mint !== "string" || mint.trim() !== want) continue;
        const amt = row.account?.data?.parsed?.info?.tokenAmount?.amount;
        if (typeof amt !== "string") continue;
        try {
            sum += BigInt(amt);
        } catch {
            /* skip bad row */
        }
    }
    return sum;
}

/** Total raw token units across legacy + Token-2022 accounts for `mint` owned by `owner`. */
export async function fetchSplTokenRawBalanceForOwner(
    owner: string,
    mint: string
): Promise<{ ok: true; raw: bigint } | { ok: false; error: string }> {
    let ownerPk: PublicKey;
    let mintPk: PublicKey;
    try {
        ownerPk = new PublicKey(owner.trim());
        mintPk = new PublicKey(mint.trim());
    } catch {
        return { ok: false, error: "Invalid wallet or mint address." };
    }
    const mintStr = mintPk.toBase58();
    const conn = rpcConnection();
    try {
        const [legacy, t22] = await Promise.all([
            conn.getParsedTokenAccountsByOwner(ownerPk, { programId: SPL_TOKEN_PROGRAM_ID }),
            conn
                .getParsedTokenAccountsByOwner(ownerPk, { programId: SPL_TOKEN_2022_PROGRAM_ID })
                .catch((): { value: ParsedRow[] } => ({ value: [] })),
        ]);
        const raw =
            sumRawForMint(legacy.value as ParsedRow[], mintStr) +
            sumRawForMint(t22.value as ParsedRow[], mintStr);
        return { ok: true, raw };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg };
    }
}
