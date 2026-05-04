"use client";

import { CircleHelp } from "lucide-react";
import { useEffect, useState } from "react";
import { inferMainnetBuyFromTx, registerMainnetOpenBot } from "../../lib/api/dashboardApi";
import { toast, toastError } from "../../lib/toast";
import { useBotStore } from "../../stores/useBotStore";
import { Button } from "../ui/button";

const RECORD_MISS_HELP =
  "Paste a Solscan transaction signature, then Fetch from chain (BFF uses SOLANA_RPC_URL). Entry price = USDT notional ÷ tokens received from that swap. After save, unrealized PnL uses (DexScreener bid − entry) × quantity when you set a DexScreener pair address (same live mark path as paper Dex legs).";

const inputClass =
  "h-8 w-full rounded-md border border-[var(--input-border)] bg-[var(--input-bg)] px-2.5 text-sm text-[var(--input-fg)]";

const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const WSOL_MINT = "So11111111111111111111111111111111111111112";

function spendAssetLabel(spendMint) {
  const m = String(spendMint ?? "");
  if (m === USDT_MINT) return "USDT";
  if (m === USDC_MINT) return "USDC";
  if (m === WSOL_MINT) return "SOL (WSOL)";
  return "spend";
}

/**
 * Backfill a mainnet buy not auto-recorded: paste Solscan tx signature → fetch → save.
 * Optional Dex pair for live marks; expand "Manual" if chain parse fails.
 */
export function ManualMainnetRecordForm({ prefillToken = null, id: formId = undefined }) {
  const [txSignature, setTxSignature] = useState("");
  const [inferBusy, setInferBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [inferNote, setInferNote] = useState(null);
  /** Set after successful fetch; drives Save. */
  const [inferred, setInferred] = useState(null);
  const [symbol, setSymbol] = useState("");
  const [dexPairAddress, setDexPairAddress] = useState("");
  const [showManual, setShowManual] = useState(false);

  const [outputMint, setOutputMint] = useState("");
  const [tokenDecimals, setTokenDecimals] = useState("6");
  const [quantityTokens, setQuantityTokens] = useState("");
  const [entryPriceUsd, setEntryPriceUsd] = useState("");
  const [positionSizeUsdt, setPositionSizeUsdt] = useState("");

  useEffect(() => {
    if (!prefillToken?.symbol) return;
    if (!symbol.trim()) setSymbol(String(prefillToken.symbol));
    const pair = prefillToken.metadata?.dexPairAddress;
    if (pair && !dexPairAddress.trim()) setDexPairAddress(String(pair));
  }, [prefillToken?.symbol, prefillToken?.metadata?.dexPairAddress]);

  const onInferFromTx = async () => {
    const sig = txSignature.trim();
    if (!sig) {
      toast.error("Paste the transaction signature first.");
      return;
    }
    setInferBusy(true);
    setInferNote(null);
    try {
      const body = await inferMainnetBuyFromTx({ signature: sig });
      const inf = body?.inferred;
      if (!inf) throw new Error("No inference returned");
      setInferred({
        outputMint: String(inf.outputMint ?? ""),
        spendMint: String(inf.spendMint ?? ""),
        tokenDecimals: Number(inf.tokenDecimals ?? 6),
        quantityTokens: Number(inf.quantityTokens),
        entryPriceUsd: Number(inf.entryPriceUsd),
        positionSizeUsdt: Number(inf.positionSizeUsdt)
      });
      const short = String(inf.outputMint ?? "").slice(0, 6);
      setSymbol((s) => (s.trim() ? s : short ? `IMP-${short}` : "IMPORT"));
      if (inf.note) setInferNote(inf.note);
      toast.success("Fetched from chain — adjust label or Dex pair, then save.");
    } catch (err) {
      setInferred(null);
      toastError(err, "Could not parse transaction");
    } finally {
      setInferBusy(false);
    }
  };

  const onSubmit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      if (showManual) {
        const sym = symbol.trim();
        if (!sym || !outputMint.trim()) {
          toast.error("Symbol and mint are required.");
          return;
        }
        await registerMainnetOpenBot({
          symbol: sym,
          baseAsset: sym,
          outputMint: outputMint.trim(),
          tokenDecimals: Number(tokenDecimals),
          quantityTokens: Number(quantityTokens),
          entryPriceUsd: Number(entryPriceUsd),
          positionSizeUsdt: Number(positionSizeUsdt),
          ...(txSignature.trim() ? { txSignature: txSignature.trim() } : {}),
          ...(dexPairAddress.trim()
            ? { dexChainId: "solana", dexPairAddress: dexPairAddress.trim() }
            : {})
        });
      } else {
        if (!inferred) {
          toast.error("Fetch from chain first, or use manual entry.");
          return;
        }
        const sym = symbol.trim();
        if (!sym) {
          toast.error("Set a display symbol.");
          return;
        }
        await registerMainnetOpenBot({
          symbol: sym,
          baseAsset: sym,
          outputMint: inferred.outputMint,
          tokenDecimals: inferred.tokenDecimals,
          quantityTokens: inferred.quantityTokens,
          entryPriceUsd: inferred.entryPriceUsd,
          positionSizeUsdt: inferred.positionSizeUsdt,
          ...(txSignature.trim() ? { txSignature: txSignature.trim() } : {}),
          ...(dexPairAddress.trim()
            ? { dexChainId: "solana", dexPairAddress: dexPairAddress.trim() }
            : {})
        });
      }
      await useBotStore.getState().loadBotState();
      toast.success("Mainnet position recorded.");
      setInferred(null);
      setInferNote(null);
    } catch (err) {
      toastError(err, "Could not record position");
    } finally {
      setBusy(false);
    }
  };

  const canSaveNormal = Boolean(inferred && symbol.trim());
  const canSaveManual =
    showManual &&
    symbol.trim() &&
    outputMint.trim() &&
    Number.isFinite(Number(quantityTokens)) &&
    Number(quantityTokens) > 0 &&
    Number.isFinite(Number(entryPriceUsd)) &&
    Number(entryPriceUsd) > 0 &&
    Number.isFinite(Number(positionSizeUsdt)) &&
    Number(positionSizeUsdt) > 0;

  return (
    <form
      id={formId}
      onSubmit={(ev) => void onSubmit(ev)}
      className="mt-3 space-y-3 rounded-lg border border-[var(--border)] bg-[var(--panel-muted)]/40 p-3"
    >
      <div className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
        <p className="min-w-0 flex-1 leading-snug">
          <span className="font-medium text-[var(--text)]">Missed mainnet buy</span>
          {" — "}
          Paste a{" "}
          <a
            className="text-[var(--text)] underline underline-offset-2"
            href="https://solscan.io/"
            target="_blank"
            rel="noreferrer"
          >
            Solscan
          </a>{" "}
          tx signature, <strong className="font-medium text-[var(--text)]">Fetch from chain</strong>, then save.
        </p>
        <span className="shrink-0 pt-0.5 text-[var(--text-muted)]" title={RECORD_MISS_HELP}>
          <CircleHelp className="h-4 w-4" aria-label="Full instructions" />
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          className={`${inputClass} font-mono text-xs sm:min-w-0 sm:flex-1`}
          value={txSignature}
          onChange={(ev) => setTxSignature(ev.target.value)}
          placeholder="Transaction signature (base58)"
        />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-8 shrink-0 px-3 text-sm"
          disabled={inferBusy}
          onClick={() => void onInferFromTx()}
        >
          {inferBusy ? "Fetching…" : "Fetch from chain"}
        </Button>
      </div>

      {inferNote ? <p className="text-xs text-amber-700 dark:text-amber-400">{inferNote}</p> : null}

      {inferred && !showManual ? (
        <div className="rounded-md border border-[var(--border)]/60 bg-[var(--panel)] p-2.5 text-xs text-[var(--text-muted)]">
          <p className="text-sm font-medium text-[var(--text)]">Swap from chain (cost basis)</p>
          <p className="mt-1 text-[var(--text)]">
            Spent{" "}
            <span className="font-semibold tabular-nums">
              {Number(inferred.positionSizeUsdt).toLocaleString(undefined, { maximumFractionDigits: 6 })}{" "}
              {spendAssetLabel(inferred.spendMint) === "SOL (WSOL)"
                ? "notional (USDT-sized, from WSOL×spot)"
                : spendAssetLabel(inferred.spendMint)}
            </span>
            {" → "}
            <span className="font-semibold tabular-nums">
              {Number(inferred.quantityTokens).toLocaleString(undefined, { maximumFractionDigits: 8 })} tokens
            </span>
          </p>
          <p className="mt-0.5">
            Entry <span className="tabular-nums">${inferred.entryPriceUsd.toFixed(8)}</span> / token · decimals{" "}
            {inferred.tokenDecimals}
          </p>
          <p className="mt-1 break-all font-mono text-[11px] opacity-90">Mint {inferred.outputMint}</p>
          <p
            className="mt-1 border-t border-[var(--border)]/50 pt-1.5 text-[11px] text-[var(--text-muted)]"
            title="Without a pair, mark stays at entry (0% unrealized)."
          >
            Add a <strong className="font-medium text-[var(--text)]">DexScreener pair</strong> below for live bid and PnL.
          </p>
        </div>
      ) : null}

      <label className="block text-xs font-medium text-[var(--text-muted)]">
        Display symbol (bot list)
        <input
          className={`${inputClass} mt-1`}
          value={symbol}
          onChange={(ev) => setSymbol(ev.target.value)}
          placeholder="e.g. DRAGON or leave IMP-… after fetch"
          required
        />
      </label>

      <label className="block text-xs font-medium text-[var(--text-muted)]">
        DexScreener pair (live bid, PnL, exits)
        <input
          className={`${inputClass} mt-1 font-mono text-xs`}
          value={dexPairAddress}
          onChange={(ev) => setDexPairAddress(ev.target.value)}
          placeholder="Pair id or full dexscreener.com/.../solana/... URL (Solana)"
        />
      </label>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          className="h-8 text-sm"
          disabled={busy || (!showManual && !canSaveNormal) || (showManual && !canSaveManual)}
        >
          {busy ? "Saving…" : "Save mainnet position"}
        </Button>
        <button
          type="button"
          className="text-xs text-[var(--text-muted)] underline underline-offset-2 hover:text-[var(--text)]"
          onClick={() => {
            setShowManual((v) => {
              const next = !v;
              if (next && inferred) {
                setOutputMint(inferred.outputMint);
                setTokenDecimals(String(inferred.tokenDecimals));
                setQuantityTokens(String(inferred.quantityTokens));
                setEntryPriceUsd(String(inferred.entryPriceUsd));
                setPositionSizeUsdt(String(inferred.positionSizeUsdt));
              }
              return next;
            });
          }}
        >
          {showManual ? "Use signature fetch instead" : "Manual entry (no / failed parse)"}
        </button>
      </div>

      {showManual ? (
        <div className="grid gap-2 border-t border-[var(--border)]/60 pt-3 sm:grid-cols-2">
          <label className="block text-xs font-medium text-[var(--text-muted)] sm:col-span-2">
            Token mint
            <input
              className={`${inputClass} mt-1 font-mono text-xs`}
              value={outputMint}
              onChange={(ev) => setOutputMint(ev.target.value)}
            />
          </label>
          <label className="block text-xs font-medium text-[var(--text-muted)]">
            Decimals
            <input
              className={`${inputClass} mt-1 tabular-nums`}
              value={tokenDecimals}
              onChange={(ev) => setTokenDecimals(ev.target.value)}
              inputMode="numeric"
            />
          </label>
          <label className="block text-xs font-medium text-[var(--text-muted)]">
            Quantity (tokens)
            <input
              className={`${inputClass} mt-1 tabular-nums`}
              value={quantityTokens}
              onChange={(ev) => setQuantityTokens(ev.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="block text-xs font-medium text-[var(--text-muted)]">
            Entry USD / token
            <input
              className={`${inputClass} mt-1 tabular-nums`}
              value={entryPriceUsd}
              onChange={(ev) => setEntryPriceUsd(ev.target.value)}
              inputMode="decimal"
            />
          </label>
          <label className="block text-xs font-medium text-[var(--text-muted)]">
            USDT bet
            <input
              className={`${inputClass} mt-1 tabular-nums`}
              value={positionSizeUsdt}
              onChange={(ev) => setPositionSizeUsdt(ev.target.value)}
              inputMode="decimal"
            />
          </label>
        </div>
      ) : null}
    </form>
  );
}
