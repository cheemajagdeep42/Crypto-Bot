"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { Info, Loader2 } from "lucide-react";
import { useEffect, useState } from "react";
import { ApiRequestError, fetchJupiterSwapTx } from "../../lib/api/dashboardApi";
import { enrichSolanaSendError, isJupiterSlippageExceededError } from "../../lib/solanaTransactionErrors";
import { toast } from "../../lib/toast";
import { waitForConfirmedTransactionSuccess } from "../../lib/solanaTransactionSuccess";
import { Button } from "../ui/button";

export const LIVE_MAINNET_SWAP_HELP =
  "Live (mainnet): requests a fresh Jupiter swap for your connected wallet and asks Phantom to sign. Spend is SPL USDT (mint Es9v…wNYB), not USDC. Keep enough SOL for fees (and ATA rent if needed). If Phantom says reverted during simulation, fund USDT for at least your bet size, click Refresh, then sign again quickly — quotes expire. On-chain swaps do not open a row in Active trades — that list is for the paper bot only. Track live fills in Phantom or Solscan.";

function b64ToUint8Array(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Connect Phantom and sign/send a Jupiter-built swap (mainnet). Requires SPL USDT + SOL for fees in the wallet.
 */
export function JupiterWalletBar({
  outputMint,
  amountUsd,
  maxSlippagePercent,
  disabledReason,
  onSwapConfirmed,
  /** When false, only wallet + Sign & send (e.g. quote card already explains Live / USDT). */
  showHelp = true
}) {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState(null);
  const [sig, setSig] = useState(null);
  const [liveSwapHelpOpen, setLiveSwapHelpOpen] = useState(false);

  const mint = outputMint != null ? String(outputMint).trim() : "";
  const canTry = mint.length > 0 && !disabledReason;

  useEffect(() => {
    if (!liveSwapHelpOpen) return undefined;
    const handleDown = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest("[data-jupiter-live-help-root]")) return;
      setLiveSwapHelpOpen(false);
    };
    document.addEventListener("mousedown", handleDown);
    return () => document.removeEventListener("mousedown", handleDown);
  }, [liveSwapHelpOpen]);

  const onSign = async () => {
    setErr(null);
    setSig(null);
    if (!publicKey || !signTransaction) {
      setErr("Connect Phantom first.");
      return;
    }
    setLoading(true);
    try {
      let signature = null;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          if (attempt > 0) {
            toast.info("Jupiter quote may be stale — fetching a fresh swap tx and retrying once…");
          }
          const body = await fetchJupiterSwapTx({
            outputMint: mint,
            amountUsd,
            maxSlippagePercent,
            userPublicKey: publicKey.toBase58()
          });
          const b64 = body?.swapTransaction;
          if (typeof b64 !== "string" || !b64.length) {
            throw new Error("Server did not return swapTransaction");
          }
          const tx = VersionedTransaction.deserialize(b64ToUint8Array(b64));
          const signed = await signTransaction(tx);
          const raw = signed.serialize();
          signature = await connection.sendRawTransaction(raw, {
            skipPreflight: false,
            maxRetries: 3
          });
          setSig(signature);
          break;
        } catch (e) {
          const enriched = await enrichSolanaSendError(e, connection);
          const retrySlip =
            attempt === 0 && !(e instanceof ApiRequestError) && isJupiterSlippageExceededError(enriched.message);
          if (retrySlip) {
            continue;
          }
          setErr(enriched.message);
          return;
        }
      }
      if (!signature) {
        return;
      }
      await waitForConfirmedTransactionSuccess(connection, signature);
      try {
        await onSwapConfirmed?.(signature);
      } catch (cbErr) {
        setErr(cbErr instanceof Error ? cbErr.message : String(cbErr));
      }
    } finally {
      setLoading(false);
    }
  };

  const walletBlock = (
    <>
      {sig ? (
        <div className="w-full min-w-0 text-[10px]">
          <a
            className="text-[var(--text)] underline underline-offset-2"
            href={`https://solscan.io/tx/${sig}`}
            target="_blank"
            rel="noreferrer"
          >
            Open on Solscan
          </a>
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        <WalletMultiButton />
        <Button
          type="button"
          size="sm"
          variant="default"
          className="h-8 rounded-md px-3 text-xs"
          disabled={!canTry || loading || !connected}
          onClick={() => void onSign()}
          title={disabledReason || undefined}
        >
          {loading ? <Loader2 className="mr-1.5 inline h-4 w-4 shrink-0 animate-spin" aria-hidden /> : null}
          Sign &amp; send swap
        </Button>
      </div>
      {err ? <p className="text-xs text-[#e50914]">{err}</p> : null}
    </>
  );

  if (!showHelp) {
    return <div className="space-y-2">{walletBlock}</div>;
  }

  return (
    <div className="mt-3 space-y-2 border-t border-[var(--border)]/60 pt-3">
      <p className="flex items-start gap-1.5 text-[10px] leading-snug text-[var(--text-muted)]">
        <span className="relative inline-flex shrink-0" data-jupiter-live-help-root="true">
          <button
            type="button"
            className="inline-flex rounded text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--panel)]"
            aria-expanded={liveSwapHelpOpen}
            aria-label="Live mainnet swap details"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              setLiveSwapHelpOpen((open) => !open);
            }}
          >
            <Info className="h-3.5 w-3.5" aria-hidden />
          </button>
          {liveSwapHelpOpen ? (
            <div
              className="absolute left-0 top-full z-20 mt-1 max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-relaxed text-[var(--text)] shadow-lg"
              role="tooltip"
            >
              {LIVE_MAINNET_SWAP_HELP}
            </div>
          ) : null}
        </span>
        <span>
          <span className="font-medium text-[var(--text)]">Live (mainnet)</span> — SPL USDT (not USDC).{" "}
          <span className="text-[var(--text-muted)]">Phantom, fees, and quotes in the info panel.</span>
        </span>
      </p>
      {walletBlock}
    </div>
  );
}
