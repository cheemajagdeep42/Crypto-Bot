/** @param {unknown} err */
function formatTxErr(err) {
  if (err == null) return "unknown";
  try {
    return typeof err === "object" ? JSON.stringify(err) : String(err);
  } catch {
    return String(err);
  }
}

/**
 * Poll until the transaction is found and `meta.err` is absent.
 * `Connection.confirmTransaction` is not enough: failed transactions still land in a block with `meta.err` set.
 *
 * @param {import("@solana/web3.js").Connection} connection
 * @param {string} signature
 * @param {{ commitment?: import("@solana/web3.js").Commitment; timeoutMs?: number; intervalMs?: number }} [options]
 */
export async function waitForConfirmedTransactionSuccess(connection, signature, options = {}) {
  const commitment = options.commitment ?? "confirmed";
  const timeoutMs = options.timeoutMs ?? 120_000;
  const intervalMs = options.intervalMs ?? 500;
  const sig = typeof signature === "string" ? signature.trim() : "";
  if (!sig) {
    throw new Error("waitForConfirmedTransactionSuccess: missing signature");
  }

  const solscan = `https://solscan.io/tx/${encodeURIComponent(sig)}`;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const tx = await connection.getTransaction(sig, {
      commitment,
      maxSupportedTransactionVersion: 0,
    });

    if (tx) {
      if (tx.meta?.err) {
        const e = new Error(
          `Transaction failed on-chain: ${formatTxErr(tx.meta.err)}. Details: ${solscan}`
        );
        e.solanaTxSignature = sig;
        e.solscanUrl = solscan;
        throw e;
      }
      return tx;
    }

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  const e = new Error(
    `Timed out waiting for transaction confirmation (signature ${sig.slice(0, 8)}…). Check ${solscan}`
  );
  e.solanaTxSignature = sig;
  e.solscanUrl = solscan;
  throw e;
}
