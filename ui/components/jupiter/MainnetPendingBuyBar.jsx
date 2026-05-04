"use client";

import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { VersionedTransaction } from "@solana/web3.js";
import { CircleHelp, Loader2 } from "lucide-react";
import { useState } from "react";
import { ApiRequestError, confirmMainnetStackBuy, fetchJupiterStackBuyTx } from "../../lib/api/dashboardApi";
import { toast, toastError } from "../../lib/toast";
import { useBotStore } from "../../stores/useBotStore";
import { Button } from "../ui/button";
import { formatPaperTradeTokenLabel } from "../../lib/formatters";
import { enrichSolanaSendError, isJupiterSlippageExceededError } from "../../lib/solanaTransactionErrors";
import { waitForConfirmedTransactionSuccess } from "../../lib/solanaTransactionSuccess";
import { hasPendingMainnetSells } from "../../lib/mainnetPendingQueue";

function b64ToUint8Array(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
  return out;
}

const BUY_HELP =
  "For a mainnet leg created without a wallet buy (e.g. Trigger new trade): connect Phantom, Sign & buy to swap USDT → token for this leg’s bet size. After the tx lands, the bot infers entry from chain and links the signature. Same SPL USDT + SOL for fees as Quote and Sign.";

export function mainnetLegNeedsOnChainBuy(row) {
  if (!row || row.executionChannel !== "mainnet") return false;
  if (row.mainnetBuyTxSignature) return false;
  if (hasPendingMainnetSells(row)) return false;
  const mint = String(row.solanaOutputMint ?? "").trim();
  const bet = Number(row.positionSizeUsdt);
  return Boolean(mint) && Number.isFinite(bet) && bet >= 0.01;
}

/**
 * Confirm on-chain buy for a single stacked / quote-only mainnet leg — place under that leg’s row.
 */
export function MainnetPendingBuyForLeg({ row, legIndex = null, maxSlippagePercent = 2 }) {
  const tradeId = row?.id;
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  const [signing, setSigning] = useState(false);
  const [settling, setSettling] = useState(false);
  const [err, setErr] = useState(null);
  const [sig, setSig] = useState(null);

  const refresh = () => void useBotStore.getState().loadBotState();
  const busy = signing || settling;

  const onSignBuy = async () => {
    if (!tradeId) return;
    setErr(null);
    setSig(null);
    if (!publicKey || !signTransaction) {
      const msg = "Connect Phantom first, then Sign & buy.";
      setErr(msg);
      toast.error(msg);
      return;
    }
    setSigning(true);
    setSettling(false);
    let signature = null;

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        if (attempt > 0) {
          toast.info("Jupiter quote may be stale — fetching a fresh swap tx and retrying once…");
        }
        const body = await fetchJupiterStackBuyTx({
          tradeId,
          userPublicKey: publicKey.toBase58(),
          maxSlippagePercent
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
        toastError(enriched, "Sign buy failed");
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
      await confirmMainnetStackBuy({ tradeId, txSignature: signature });
      refresh();
      toast.success("Buy confirmed — leg linked to on-chain tx.");
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setErr(msg);
      const onChainRejected = /failed on-chain|Timed out waiting for transaction/i.test(msg);
      toastError(
        e,
        onChainRejected
          ? "Buy did not confirm on-chain — leg not linked. Check Solscan, then try again if needed."
          : "On-chain ok but linking failed — check Solscan; retry if needed."
      );
    } finally {
      setSettling(false);
    }
  };

  if (!mainnetLegNeedsOnChainBuy(row) || !tradeId) return null;

  return (
    <div
      id={`mainnet-pending-buy-${tradeId}`}
      className="overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel)] scroll-mt-4"
      role="status"
    >
      <div className="flex items-center gap-1.5 border-b border-[var(--border)]/80 bg-[var(--panel-muted)]/80 px-2 py-1">
        <span className="text-xs font-medium text-[var(--text)]">Confirm on-chain buy</span>
        <span className="inline-flex text-[var(--text-muted)]" title={BUY_HELP}>
          <CircleHelp className="h-3.5 w-3.5 shrink-0" aria-hidden />
        </span>
      </div>
      <div className="flex flex-col gap-2 px-2 py-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
        <div className="min-w-0 text-xs leading-snug">
          <p className="font-medium text-[var(--text)]">
            {formatPaperTradeTokenLabel(row)}
            {legIndex != null ? (
              <span className="font-normal text-[var(--text-muted)]"> · leg {legIndex}</span>
            ) : null}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">
            Bet ~{formatMoneyUi(row.positionSizeUsdt)} USDT · Jupiter USDT → token
          </p>
          {settling ? (
            <p className="mt-1 text-[11px] text-[var(--text-muted)]">Linking tx to bot…</p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2 sm:justify-end">
          <WalletMultiButton />
          <Button
            type="button"
            size="sm"
            className="h-8 rounded-md px-3 text-xs"
            disabled={busy}
            title={
              connected
                ? "Build Jupiter buy tx and sign in Phantom"
                : "Connect Phantom first, then Sign & buy"
            }
            onClick={() => void onSignBuy()}
          >
            {signing ? (
              <Loader2 className="mr-1.5 inline h-4 w-4 shrink-0 animate-spin" aria-hidden />
            ) : null}
            {settling ? "Syncing…" : "Sign & buy"}
          </Button>
        </div>
      </div>
      {err ? <p className="border-t border-[var(--border)]/50 px-2 py-1.5 text-xs text-[#e50914]">{err}</p> : null}
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

function formatMoneyUi(n) {
  if (!Number.isFinite(Number(n))) return "—";
  return Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

/**
 * @deprecated Prefer {@link MainnetPendingBuyForLeg} under each table row.
 */
export function MainnetPendingBuyBar({ legs, legIndexById = {}, maxSlippagePercent = 2 }) {
  if (!Array.isArray(legs) || legs.length === 0) return null;
  return (
    <div className="mb-3 space-y-2">
      {legs.map((row) => (
        <MainnetPendingBuyForLeg
          key={row.id}
          row={row}
          legIndex={legIndexById[row.id] ?? null}
          maxSlippagePercent={maxSlippagePercent}
        />
      ))}
    </div>
  );
}
