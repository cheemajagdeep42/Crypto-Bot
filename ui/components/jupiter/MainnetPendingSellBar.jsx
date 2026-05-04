"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { CircleHelp, Loader2 } from "lucide-react";
import { useState } from "react";
import {
  ApiRequestError,
  applyMainnetSellDone,
  dismissMainnetStuckLegBot,
  fetchJupiterSellTx,
  reconcileMainnetFlatBot
} from "../../lib/api/dashboardApi";
import { pendingMainnetSellsList } from "../../lib/mainnetPendingQueue";
import {
  enrichSolanaSendError,
  isInsufficientLamportsError,
  isJupiterSlippageExceededError
} from "../../lib/solanaTransactionErrors";
import { waitForConfirmedTransactionSuccess } from "../../lib/solanaTransactionSuccess";
import { toast, toastError } from "../../lib/toast";
import { useBotStore } from "../../stores/useBotStore";
import { Button } from "../ui/button";

function b64ToUint8Array(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

const MAINNET_SELL_HELP =
  "Queue is FIFO — sign the top row first. Sign sell uses the leg’s SPL mint on-chain (not the display name). Close leg in app ends the open bet in the dashboard (verifies 0 balance when RPC works, or force-close in the dialog) — there is no button that only hides the alert while the leg stays open.";

function pendingMainnetSellLabel(p) {
  if (!p) return "";
  if (p.exitKind === "close_full") {
    return p.closeReason === "manual" ? "Full exit (manual)" : `Full exit (${p.closeReason ?? "rule"})`;
  }
  const m = p.partialMode ?? "tp_step";
  return `Partial sell (${m} @ ${p.stepPercent ?? "—"}%)`;
}

/**
 * Pending mainnet sell controls for a single open leg — FIFO queue under that leg’s table row.
 */
export function MainnetPendingSellForLeg({ row, maxSlippagePercent = 2 }) {
  const queue = pendingMainnetSellsList(row);
  const tradeId = row?.id;
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  const [signing, setSigning] = useState(false);
  const [settling, setSettling] = useState(false);
  const [err, setErr] = useState(null);
  const [sig, setSig] = useState(null);
  const [closingLeg, setClosingLeg] = useState(false);

  const refresh = () => void useBotStore.getState().loadBotState();
  const busy = signing || settling || closingLeg;

  function shortMint(m) {
    const s = typeof m === "string" ? m.trim() : "";
    if (s.length <= 12) return s || "—";
    return `${s.slice(0, 4)}…${s.slice(-4)}`;
  }

  const onSign = async () => {
    if (!tradeId) return;
    setErr(null);
    setSig(null);
    if (!publicKey || !signTransaction) {
      const msg = "Connect Phantom with Select Wallet next to this button, then tap Sign sell again.";
      setErr(msg);
      toast.error(msg);
      return;
    }
    setSigning(true);
    setSettling(false);
    let signature = null;
    /** Exact-in token amount (raw) used in the built Jupiter tx; pass to sell-done for wallet-capped 100% sells. */
    let sellInputAmountRaw = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (attempt > 0) {
          toast.info("Jupiter quote may be stale — fetching a fresh swap tx and retrying once…");
        }
        const body = await fetchJupiterSellTx({
          tradeId,
          userPublicKey: publicKey.toBase58(),
          maxSlippagePercent
        });
        if (typeof body?.amountRaw === "string" && body.amountRaw.trim().length > 0) {
          sellInputAmountRaw = body.amountRaw.trim();
        }
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
        const src = e instanceof ApiRequestError ? e : enriched;
        const isZeroBal = src instanceof ApiRequestError && src.body?.zeroTokenBalance === true;
        const retrySlip =
          attempt === 0 &&
          !isZeroBal &&
          !(e instanceof ApiRequestError) &&
          isJupiterSlippageExceededError(enriched.message);
        if (retrySlip) {
          continue;
        }
        setErr(
          isZeroBal
            ? `${enriched.message}\n\nUse “Close leg in app” if you are already flat — it verifies balance when RPC works, or you can force-close in the dialog.`
            : enriched.message
        );
        const toastTitle = isZeroBal
          ? "Nothing to sell on-chain"
          : isInsufficientLamportsError(enriched.message)
            ? "Need more SOL (fees / rent)"
            : "Sign sell failed";
        toastError(enriched, toastTitle);
        setSigning(false);
        return;
      }
    }

    if (!signature) {
      setSigning(false);
      return;
    }

    setSigning(false);
    setSettling(true);

    try {
      await waitForConfirmedTransactionSuccess(connection, signature);
      await applyMainnetSellDone(tradeId, signature, {
        ...(sellInputAmountRaw ? { inputAmountRaw: sellInputAmountRaw } : {})
      });
      refresh();
      toast.success("Sell applied — bot state updated.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      const onChainRejected = /failed on-chain|Timed out waiting for transaction/i.test(msg);
      toastError(
        e,
        onChainRejected
          ? "Sell did not confirm successfully on-chain — dashboard unchanged."
          : "On-chain ok but bot update failed — check Solscan; use Close leg in app if state is stuck."
      );
    } finally {
      setSettling(false);
    }
  };

  /** Prefer on-chain verify (same SPL mint as the leg, not the display name); fall back to force-close when RPC fails or wallet not connected. */
  const onCloseLegInApp = async () => {
    if (!tradeId) return;
    setErr(null);
    setClosingLeg(true);
    try {
      if (publicKey) {
        try {
          await reconcileMainnetFlatBot(tradeId, publicKey.toBase58());
          refresh();
          toast.success("Leg closed — wallet had 0 of this SPL mint. Check PnL vs Solscan if needed.");
          return;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const force = window.confirm(
            "Could not verify your wallet on-chain (RPC/network, or you may still hold this token).\n\n" +
              "Force-close this leg in the app only? This updates dashboard state and clears the sell queue — it does not send a Solana transaction.\n\n" +
              "OK = force close · Cancel = stay"
          );
          if (!force) {
            setErr(msg);
            toastError(e, "On-chain check failed");
            return;
          }
        }
      } else {
        const force = window.confirm(
          "No wallet connected — the app cannot check your SPL balance for this leg.\n\n" +
            "Force-close in the app only (no chain check)? OK = yes · Cancel = connect Phantom and try again"
        );
        if (!force) {
          return;
        }
      }
      await dismissMainnetStuckLegBot(tradeId);
      refresh();
      toast.success("Leg closed in dashboard. Verify PnL on Solscan if needed.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      toastError(e, "Could not close leg");
    } finally {
      setClosingLeg(false);
    }
  };

  if (!queue.length || !tradeId) return null;

  return (
    <div
      className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel)]"
      role="status"
    >
      <div className="flex items-center gap-1.5 border-b border-[var(--border)]/80 bg-[var(--panel-muted)]/80 px-2 py-1">
        <span className="text-xs font-medium text-[var(--text)]">
          Pending mainnet sell
          {queue.length > 1 ? (
            <span className="font-normal text-[var(--text-muted)]"> · {queue.length} queued (sign top first)</span>
          ) : null}
        </span>
        <span className="inline-flex text-[var(--text-muted)]" title={MAINNET_SELL_HELP}>
          <CircleHelp className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </span>
      </div>
      <div className="max-h-[min(420px,55vh)] divide-y divide-[var(--border)]/50 overflow-auto overscroll-contain">
        {queue.map((p, idx) => {
          const isHead = idx === 0;
          return (
            <div
              key={`${tradeId}-${idx}-${p.createdAt ?? idx}`}
              className={`px-2 py-2 ${!isHead ? "bg-[var(--panel-muted)]/25" : ""}`}
            >
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                <div className="min-w-0 text-xs leading-snug">
                  <p className="font-medium text-[var(--text)]">
                    {!isHead ? (
                      <span className="mr-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                        Next · {idx + 1}/{queue.length}
                      </span>
                    ) : null}
                    {row.symbol}{" "}
                    <span className="font-normal text-[var(--text-muted)]">· {pendingMainnetSellLabel(p)}</span>
                  </p>
                  <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
                    Mark ~{typeof p?.markPriceUsd === "number" ? p.markPriceUsd.toFixed(6) : "—"} · Sell{" "}
                    {p?.exitKind === "close_full" ? "100%" : `${Math.round((p?.sellFraction ?? 0) * 100)}%`}
                  </p>
                  {row?.solanaOutputMint ? (
                    <p
                      className="mt-0.5 font-mono text-[10px] text-[var(--text-muted)]"
                      title={`Jupiter/RPC use this SPL mint address, not the name “${row.symbol ?? ""}”. Full mint: ${row.solanaOutputMint}`}
                    >
                      Mint {shortMint(row.solanaOutputMint)}
                    </p>
                  ) : null}
                  {isHead && settling ? (
                    <p className="mt-1 text-[11px] text-[var(--text-muted)]">Confirming on-chain and syncing…</p>
                  ) : null}
                  {!isHead ? (
                    <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-400">
                      Waiting — sign and confirm the alert above first.
                    </p>
                  ) : null}
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {isHead ? (
                    <>
                      <WalletMultiButton />
                      <Button
                        type="button"
                        size="sm"
                        className="h-8 rounded-md px-3 text-xs"
                        disabled={busy}
                        title={
                          connected
                            ? "Build Jupiter tx for the first queued sell"
                            : "Connect Phantom first (use Select Wallet), then click Sign sell"
                        }
                        onClick={() => void onSign()}
                      >
                        {signing ? (
                          <Loader2 className="mr-1.5 inline h-4 w-4 shrink-0 animate-spin" aria-hidden />
                        ) : null}
                        {settling ? "Syncing…" : "Sign sell"}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-8 rounded-md border-amber-600/50 px-3 text-xs text-amber-800 dark:border-amber-500/50 dark:text-amber-300"
                        disabled={busy}
                        onClick={() => void onCloseLegInApp()}
                        title="Closes the leg in the app: tries RPC check that Phantom has 0 of this leg’s SPL mint, then clears queue. If RPC fails, you can force-close in the dialog (no tx sent)."
                      >
                        {closingLeg ? "Working…" : "Close leg in app"}
                      </Button>
                    </>
                  ) : (
                    <Button type="button" size="sm" variant="outline" className="h-8 cursor-not-allowed px-3 text-xs" disabled>
                      Sign sell
                    </Button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      {err ? (
        <p className="max-h-56 overflow-y-auto whitespace-pre-wrap break-words border-t border-[var(--border)]/50 px-2 py-1.5 text-xs text-[#e50914]">
          {err}
        </p>
      ) : null}
      {sig ? (
        <div className="border-t border-[var(--border)]/50 px-2 py-1.5 text-[11px] text-[var(--text-muted)]">
          <p>
            Last Tx:{" "}
            <a
              className="text-[var(--text)] underline underline-offset-2"
              href={`https://solscan.io/tx/${sig}`}
              target="_blank"
              rel="noreferrer"
              title={sig}
            >
              Solscan tx
            </a>
          </p>
        </div>
      ) : null}
    </div>
  );
}

/**
 * @deprecated Prefer {@link MainnetPendingSellForLeg} under each table row. Kept for any legacy layout.
 */
export function MainnetPendingSellBar({ legs, maxSlippagePercent = 2 }) {
  if (!Array.isArray(legs) || legs.length === 0) return null;
  return (
    <div className="mb-3 space-y-2">
      {legs.map((row) => (
        <MainnetPendingSellForLeg key={row.id} row={row} maxSlippagePercent={maxSlippagePercent} />
      ))}
    </div>
  );
}
