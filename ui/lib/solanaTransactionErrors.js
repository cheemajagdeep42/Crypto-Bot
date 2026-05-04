import { SendTransactionError } from "@solana/web3.js";

/** Jupiter v6 program id (swap ix); slippage failures surface here in simulation logs. */
const JUP6 = "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4";

const JUPITER_SLIPPAGE_HINT =
  "Jupiter reported error 0x1771 (slippage exceeded) — the swap would deliver less than the quoted minimum (stale quote, slippage, or price impact). Try: Sign again for a fresh quote, raise Max slippage % in Bot settings, or (for partial sells) a smaller % of remaining on thin pools. DLMM / pump routes can move between quote and confirmation.";

const SOL_INSUFFICIENT_HINT =
  "Not enough SOL in this wallet for the transaction: network fees, priority fees, and/or rent (e.g. creating an associated token account for the swap output). Add SOL to the wallet you are signing with and try again — this is not Jupiter price slippage.";

/**
 * @param {string} message
 * @returns {boolean}
 */
export function isJupiterSlippageExceededError(message) {
  if (typeof message !== "string") return false;
  if (/0x1771/i.test(message)) return true;
  if (message.includes(JUP6) && /custom program error:\s*6001\b/i.test(message)) return true;
  return false;
}

/**
 * @param {string} message
 * @returns {boolean}
 */
export function isInsufficientLamportsError(message) {
  if (typeof message !== "string") return false;
  return /\binsufficient lamports\b/i.test(message);
}

/**
 * Enrich simulation/send failures with RPC logs and short hints (e.g. Jupiter 0x1771).
 * @param {unknown} err
 * @param {import("@solana/web3.js").Connection | undefined} connection
 * @returns {Promise<Error>}
 */
export async function enrichSolanaSendError(err, connection) {
  const base = err instanceof Error ? err : new Error(String(err));
  let message = base.message;

  if (connection && err instanceof SendTransactionError) {
    try {
      const logs = await err.getLogs(connection);
      if (Array.isArray(logs) && logs.length > 0) {
        const tail = logs.length > 25 ? logs.slice(-25) : logs;
        message = `${message}\n\n--- Simulation logs (tail) ---\n${tail.join("\n")}`;
      }
    } catch {
      /* getLogs optional */
    }
  }

  if (isJupiterSlippageExceededError(message)) {
    message = `${JUPITER_SLIPPAGE_HINT}\n\n--- Original message ---\n${message}`;
  } else if (isInsufficientLamportsError(message)) {
    message = `${SOL_INSUFFICIENT_HINT}\n\n--- Original message ---\n${message}`;
  }

  if (message === base.message) {
    return base;
  }
  const out = new Error(message);
  out.cause = err;
  return out;
}
