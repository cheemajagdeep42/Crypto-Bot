/**
 * Server-side Solana signing for auto-mainnet mode (optional env key).
 * Never log the secret key.
 */
import bs58 from "bs58";
import {
    Connection,
    Keypair,
    SendTransactionError,
    VersionedTransaction,
} from "@solana/web3.js";
import { buildJupiterSlippageLadderPercent } from "./trading/slippageLadder";
import { jupiterSwapTxForTokenSell, jupiterSwapTxForUsdcBuy } from "./trading/jupiterSwap";

const DEFAULT_RPC = process.env.SOLANA_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";

/** JSON array of 64 bytes, e.g. `[17,234,...]` — same as many Solana key export formats. */
const ENV_SECRET = "SOLANA_AUTO_SIGN_SECRET_KEY";

export function getSolanaConnection(): Connection {
    return new Connection(DEFAULT_RPC, "confirmed");
}

function keypairFromByteArrayJson(raw: string): Keypair | null {
    try {
        const arr = JSON.parse(raw) as unknown;
        if (!Array.isArray(arr) || arr.length < 64) return null;
        const u8 = new Uint8Array(arr.map((x) => Number(x) & 0xff));
        return Keypair.fromSecretKey(u8);
    } catch {
        return null;
    }
}

/** Phantom / many wallets export base58; Solana CLI uses JSON byte array in `id.json`. */
function keypairFromBase58Secret(trimmed: string): Keypair | null {
    try {
        const decoded = bs58.decode(trimmed);
        if (decoded.length === 64) {
            return Keypair.fromSecretKey(decoded);
        }
        if (decoded.length === 32) {
            return Keypair.fromSeed(decoded);
        }
    } catch {
        /* invalid base58 */
    }
    return null;
}

export function loadAutoSignKeypairFromEnv(): Keypair | null {
    const raw = process.env[ENV_SECRET]?.trim();
    if (!raw) return null;
    if (raw.startsWith("[")) {
        try {
            const parsed = JSON.parse(raw) as unknown;
            if (Array.isArray(parsed) && parsed.length === 1 && typeof parsed[0] === "string") {
                const kp = keypairFromBase58Secret(parsed[0].trim());
                if (kp) return kp;
            }
        } catch {
            /* fall through to byte array */
        }
        return keypairFromByteArrayJson(raw);
    }
    const from58 = keypairFromBase58Secret(raw);
    if (from58) return from58;
    return keypairFromByteArrayJson(raw);
}

function looksLikeJupiterSlippageFail(text: string): boolean {
    if (/0x1771/i.test(text)) return true;
    if (/custom program error:\s*6001\b/i.test(text) && text.includes("JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4")) {
        return true;
    }
    return false;
}

/** System / ATA rent path: wallet SOL too low (not Jupiter min-out slippage). */
function looksLikeInsufficientLamports(text: string): boolean {
    return /\binsufficient lamports\b/i.test(text);
}

function tailSimulationLogs(logs: string[] | null | undefined, maxLines: number): string {
    const L = logs ?? [];
    const slice = L.length > maxLines ? L.slice(-maxLines) : L;
    return slice.join("\n");
}

function txConfirmTimeoutMs(): number {
    const raw = process.env.SOLANA_TX_CONFIRM_TIMEOUT_MS?.trim();
    const n = raw ? Number(raw) : NaN;
    if (Number.isFinite(n) && n >= 15_000 && n <= 600_000) {
        return Math.floor(n);
    }
    return 120_000;
}

/** Poll until confirmed/finalized or timeout. `confirmTransaction` often uses ~30s and fails under load. */
async function waitForSignatureConfirmed(
    connection: Connection,
    signature: string,
    timeoutMs: number
): Promise<void> {
    const deadline = Date.now() + timeoutMs;
    const intervalMs = 1500;
    while (Date.now() < deadline) {
        const { value } = await connection.getSignatureStatuses([signature], {
            searchTransactionHistory: true,
        });
        const st = value[0];
        if (st != null) {
            if (st.err) {
                throw new Error(`Transaction failed on-chain: ${JSON.stringify(st.err)}`);
            }
            const tier = st.confirmationStatus;
            if (tier === "confirmed" || tier === "finalized") {
                return;
            }
        }
        await new Promise((r) => setTimeout(r, intervalMs));
    }
    throw new Error(
        `Transaction was not confirmed in ${(timeoutMs / 1000).toFixed(2)} seconds. It is unknown if it succeeded or failed. Check signature ${signature} using the Solana Explorer or CLI tools.`
    );
}

async function signSimulateOrSend(
    connection: Connection,
    keypair: Keypair,
    swapTransactionB64: string
): Promise<{ ok: true; signature: string } | { ok: false; error: string; slippageRetry: boolean }> {
    let raw: Uint8Array;
    try {
        raw = Buffer.from(swapTransactionB64, "base64");
    } catch {
        return { ok: false, error: "Invalid swapTransaction base64", slippageRetry: false };
    }
    let vtx: VersionedTransaction;
    try {
        vtx = VersionedTransaction.deserialize(raw);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        return { ok: false, error: msg, slippageRetry: false };
    }
    vtx.sign([keypair]);

    const sim = await connection.simulateTransaction(vtx, {
        sigVerify: true,
        commitment: "processed",
    });
    if (sim.value.err) {
        const errStr = JSON.stringify(sim.value.err);
        const logTail = tailSimulationLogs(sim.value.logs, 40);
        const blob = `${errStr}\n${logTail}`;
        if (looksLikeJupiterSlippageFail(blob)) {
            const hint =
                "Jupiter slippage / minOut (simulation): output would be below quoted minimum (0x1771 or 6001). " +
                `RPC err=${errStr}. Log tail:\n${logTail.slice(0, 2500)}`;
            return { ok: false, error: hint, slippageRetry: true };
        }
        if (looksLikeInsufficientLamports(blob)) {
            const msg =
                "Not enough SOL on the signing wallet for this swap (simulation): fees, priority fee, and/or rent " +
                "(e.g. creating an associated token account) need more lamports than the wallet holds. " +
                "Add SOL to the wallet used for this tx (auto-sign keypair or Phantom) and retry — this is not Jupiter price slippage. " +
                `RPC err=${errStr}. Log tail:\n${logTail.slice(0, 2500)}`;
            return { ok: false, error: msg, slippageRetry: false };
        }
        const msg = `Simulation failed (not slippage): err=${errStr}. Log tail:\n${logTail.slice(0, 2500)}`;
        return { ok: false, error: msg, slippageRetry: false };
    }

    let signature = "";
    try {
        signature = await connection.sendRawTransaction(vtx.serialize(), {
            skipPreflight: true,
            maxRetries: 3,
        });
        try {
            await waitForSignatureConfirmed(connection, signature, txConfirmTimeoutMs());
        } catch (confirmErr) {
            const { value } = await connection.getSignatureStatuses([signature], {
                searchTransactionHistory: true,
            });
            const st = value[0];
            if (st != null && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
                return { ok: true, signature };
            }
            throw confirmErr;
        }
        return { ok: true, signature };
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (signature && /not confirmed|unknown if it succeeded/i.test(msg)) {
            const { value } = await connection.getSignatureStatuses([signature], {
                searchTransactionHistory: true,
            });
            const st = value[0];
            if (st != null && !st.err && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
                return { ok: true, signature };
            }
        }
        if (e instanceof SendTransactionError && connection) {
            try {
                const rawLogs = await e.getLogs(connection);
                const logs = Array.isArray(rawLogs) ? rawLogs.join("\n") : msg;
                if (looksLikeJupiterSlippageFail(logs)) {
                    return {
                        ok: false,
                        error:
                            "Jupiter slippage after send attempt (check logs): " +
                            logs.slice(0, 2500),
                        slippageRetry: true,
                    };
                }
                if (looksLikeInsufficientLamports(logs)) {
                    return {
                        ok: false,
                        error:
                            "Not enough SOL on the signing wallet after send attempt (check logs): " +
                            logs.slice(0, 2500),
                        slippageRetry: false,
                    };
                }
                return {
                    ok: false,
                    error: `SendTransactionError: ${msg}\nRPC log tail:\n${logs.slice(0, 2500)}`,
                    slippageRetry: false,
                };
            } catch {
                /* fall through */
            }
        }
        if (looksLikeJupiterSlippageFail(msg)) {
            return {
                ok: false,
                error: "Jupiter slippage (message match): " + msg.slice(0, 1500),
                slippageRetry: true,
            };
        }
        return { ok: false, error: msg.slice(0, 2000), slippageRetry: false };
    }
}

export async function autoSignJupiterBuyUsd(params: {
    outputMint: string;
    amountUsd: number;
    startMaxSlippagePercent: number;
    keypair: Keypair;
    connection: Connection;
    inputMint?: string;
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
    const pk = params.keypair.publicKey.toBase58();
    const ladder = buildJupiterSlippageLadderPercent(params.startMaxSlippagePercent);
    const attemptLines: string[] = [];
    let lastQuoteError = "";
    for (const pct of ladder) {
        const built = await jupiterSwapTxForUsdcBuy({
            outputMint: params.outputMint,
            amountUsd: params.amountUsd,
            maxSlippagePercent: pct,
            userPublicKey: pk,
            ...(params.inputMint ? { inputMint: params.inputMint } : {}),
        });
        if (!built.ok) {
            lastQuoteError = built.error;
            attemptLines.push(`[maxSlippage ${pct}%] Jupiter quote/swap API failed: ${built.error}`);
            continue;
        }
        const sent = await signSimulateOrSend(params.connection, params.keypair, built.swapTransaction);
        if (sent.ok) {
            return sent;
        }
        attemptLines.push(`[maxSlippage ${pct}%] ${sent.error}`);
        if (!sent.slippageRetry) {
            const timeoutish =
                /not confirmed|unknown if it succeeded|Transaction was not confirmed/i.test(sent.error);
            const insuff = looksLikeInsufficientLamports(sent.error);
            return {
                ok: false,
                error: timeoutish
                    ? `Auto-sign buy: RPC confirmation timed out (tx may still succeed — check signature on explorer).\n${attemptLines.join("\n---\n")}`
                    : insuff
                      ? `Auto-sign buy failed: not enough SOL on the signing wallet for fees/rent (not slippage). Fund SOL on SOLANA_AUTO_SIGN_SECRET_KEY’s wallet and retry.\n${attemptLines.join("\n---\n")}`
                      : `Jupiter buy aborted at ${pct}% max slippage (non-retryable).\n` +
                        attemptLines.join("\n---\n"),
            };
        }
    }
    return {
        ok: false,
        error:
            `Jupiter buy failed after trying max slippage ${ladder[0]}% → ${ladder[ladder.length - 1]}% (${ladder.length} steps).\n` +
            (lastQuoteError && attemptLines.length === 0
                ? `Last quote error: ${lastQuoteError}`
                : attemptLines.join("\n---\n")),
    };
}

export async function autoSignJupiterSellRaw(params: {
    inputMint: string;
    amountRaw: string;
    startMaxSlippagePercent: number;
    keypair: Keypair;
    connection: Connection;
    outputMint?: string;
}): Promise<{ ok: true; signature: string } | { ok: false; error: string }> {
    const pk = params.keypair.publicKey.toBase58();
    const ladder = buildJupiterSlippageLadderPercent(params.startMaxSlippagePercent);
    const attemptLines: string[] = [];
    let lastQuoteError = "";
    for (const pct of ladder) {
        const built = await jupiterSwapTxForTokenSell({
            inputMint: params.inputMint,
            amountRaw: params.amountRaw,
            maxSlippagePercent: pct,
            userPublicKey: pk,
            ...(params.outputMint ? { outputMint: params.outputMint } : {}),
        });
        if (!built.ok) {
            lastQuoteError = built.error;
            attemptLines.push(`[maxSlippage ${pct}%] Jupiter quote/swap API failed: ${built.error}`);
            continue;
        }
        const sent = await signSimulateOrSend(params.connection, params.keypair, built.swapTransaction);
        if (sent.ok) {
            return sent;
        }
        attemptLines.push(`[maxSlippage ${pct}%] ${sent.error}`);
        if (!sent.slippageRetry) {
            const timeoutish =
                /not confirmed|unknown if it succeeded|Transaction was not confirmed/i.test(sent.error);
            const insuff = looksLikeInsufficientLamports(sent.error);
            return {
                ok: false,
                error: timeoutish
                    ? `Auto-sign sell: RPC confirmation timed out (tx may still succeed — check signature on explorer).\n${attemptLines.join("\n---\n")}`
                    : insuff
                      ? `Auto-sign sell failed: not enough SOL on the signing wallet for fees/rent (not slippage). Fund SOL on SOLANA_AUTO_SIGN_SECRET_KEY’s wallet and retry.\n${attemptLines.join("\n---\n")}`
                      : `Jupiter sell aborted at ${pct}% max slippage (non-retryable).\n` +
                        attemptLines.join("\n---\n"),
            };
        }
    }
    return {
        ok: false,
        error:
            `Jupiter sell failed after trying max slippage ${ladder[0]}% → ${ladder[ladder.length - 1]}% (${ladder.length} steps).\n` +
            (lastQuoteError && attemptLines.length === 0
                ? `Last quote error: ${lastQuoteError}`
                : attemptLines.join("\n---\n")),
    };
}
