import { PublicKey } from "@solana/web3.js";

/** Trim and validate a Solana base58 address; empty string if invalid (never throws). */
export function normalizeWatchWalletAddress(raw: unknown): string {
    if (typeof raw !== "string") {
        return "";
    }
    const s = raw.trim();
    if (!s) {
        return "";
    }
    try {
        return new PublicKey(s).toBase58();
    } catch {
        return "";
    }
}
