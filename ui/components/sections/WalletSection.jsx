"use client";

import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, ExternalLink, Info, Loader2 } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { AccordionSection } from "../common/AccordionSection";
import { Pagination } from "../common/Pagination";
import { formatAud, formatGainLossPercent, formatMoney } from "../../lib/formatters";
import { toast } from "../../lib/toast";
import { fetchWalletOnChainSnapshot } from "../../lib/api/dashboardApi";
import {
  computeOtherInvestmentPnl,
  loadOtherInvestmentPriceInputs,
  saveOtherInvestmentPriceInputs
} from "../../lib/otherInvestmentPriceInputs";
import { otherInvestments } from "../../data/otherInvestments";

const priceInputClass =
  "h-8 w-full min-w-[4.5rem] max-w-[6.5rem] rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-xs text-[var(--text)] tabular-nums";

const RANGE_OPTIONS = [
  { id: "1D", label: "1D" },
  { id: "2D", label: "2D" },
  { id: "3D", label: "3D" },
  { id: "7D", label: "7D" },
  { id: "30D", label: "30D" },
  { id: "net", label: "Net" }
];

const WALLET_SOURCE_STORAGE = "wallet-dashboard-source";
/** SPL / paper leg rows per page (SOL + USDT always shown above). */
const WALLET_TOKEN_ROWS_PAGE_SIZE = 10;

const USDT_SPL_MINT_FULL = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";

const WALLET_TOKEN_BALANCES_HELP_CHAIN =
  `Mainnet SPL Tether USDT mint: ${USDT_SPL_MINT_FULL} (UI may show Es9v…wNYB). ` +
  `SOL and USDT rows are always shown; extra SPL token rows are paginated (${WALLET_TOKEN_ROWS_PAGE_SIZE} per page, with SOL + USDT on every page). ` +
  "PnL (USDT) and PnL (%age) are filled when the mint matches an open or closed leg in the bot; otherwise they stay empty — check Phantom or Solscan for true performance. " +
  "Balances load when you open Wallet or change the account above (no background polling) to limit RPC usage. " +
  "Holdings and USD estimates use the BFF’s Solana RPC and DexScreener; if you see 403, 429, timeouts, or empty data, set SOLANA_RPC_URL on the BFF to a dedicated mainnet HTTPS URL (e.g. Alchemy, Helius, QuickNode).";

const WALLET_TOKEN_BALANCES_HELP_PAPER =
  "SOL and USDT on-chain balances are not loaded in Paper mode — pick Solana W1, W2, or Phantom (connected) under Account. " +
  `Open paper legs are listed here (${WALLET_TOKEN_ROWS_PAGE_SIZE} per page). ` +
  "PnL (USDT) and PnL (%age) are vs each leg’s USDT bet and include simulated partial sells. " +
  "Opening Wallet or changing account refetches on-chain data when not in Paper mode.";

/** @typedef {"solana-w1" | "solana-w2" | "solana-connected" | "paper"} WalletDashboardSource */

function closedTradesInRange(trades, rangeId) {
  const closed = (trades ?? []).filter((t) => t?.status === "closed" && t?.closedAt);
  if (rangeId === "net") return closed;
  const days = { "1D": 1, "2D": 2, "3D": 3, "7D": 7, "30D": 30 }[rangeId] ?? 30;
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  return closed.filter((t) => {
    const ts = new Date(t.closedAt).getTime();
    return Number.isFinite(ts) && ts >= cutoff;
  });
}

function shortAddress(addr) {
  const s = String(addr ?? "").trim();
  if (s.length < 12) return s || "—";
  return `${s.slice(0, 4)}…${s.slice(-4)}`;
}

function formatSolAmount(n) {
  if (!Number.isFinite(n)) return "—";
  if (n === 0) return "0";
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/** SPL balance cell; supports legacy API field `usdcBalance`. */
function formatSplStableBalance(snapshot) {
  if (!snapshot) return "—";
  const n = Number(snapshot.usdtBalance ?? snapshot.usdcBalance);
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function splStableValueUsd(snapshot) {
  if (!snapshot) return null;
  const n = Number(snapshot.usdtValueUsd ?? snapshot.usdcValueUsd);
  return Number.isFinite(n) ? n : null;
}

function normalizeMintId(s) {
  return String(s ?? "").trim();
}

/** Open leg with this SPL mint (same object as Run Bot / Active Trade). */
function findOpenLegByMint(openLegs, mint) {
  const m = normalizeMintId(mint);
  if (!m) return null;
  const list = Array.isArray(openLegs) ? openLegs : [];
  return list.find((leg) => normalizeMintId(leg.solanaOutputMint) === m) ?? null;
}

/** Most recently closed bot trade for this mint (realized PnL when nothing open). */
function findLastClosedTradeByMint(history, mint) {
  const m = normalizeMintId(mint);
  if (!m) return null;
  const closed = (history ?? []).filter(
    (t) => t?.status === "closed" && normalizeMintId(t.solanaOutputMint) === m
  );
  if (closed.length === 0) return null;
  return closed.reduce((best, t) => {
    const tb = new Date(t.closedAt ?? 0).getTime();
    const bb = new Date(best.closedAt ?? 0).getTime();
    return tb >= bb ? t : best;
  });
}

function readStoredSource() {
  if (typeof window === "undefined") return "solana-w1";
  try {
    const v = window.sessionStorage.getItem(WALLET_SOURCE_STORAGE);
    if (v === "solana-w1" || v === "solana-w2" || v === "solana-connected" || v === "paper") return v;
  } catch {
    /* ignore */
  }
  return "solana-w1";
}

function formatInvestDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? String(iso) : d.toLocaleDateString(undefined, { dateStyle: "medium" });
}

export function WalletSection({
  tradeHistory = [],
  activeTrade = null,
  activeTrades = null,
  watchWalletAddressW1 = "",
  watchWalletAddressW2 = ""
}) {
  const { publicKey, connected } = useWallet();
  const [cryptoAccordionOpen, setCryptoAccordionOpen] = useState(true);
  const [otherInvestmentsOpen, setOtherInvestmentsOpen] = useState(false);
  const [range, setRange] = useState("30D");
  /** @type {[WalletDashboardSource, (v: WalletDashboardSource) => void]} */
  const [source, setSource] = useState("solana-w1");
  const [snapshot, setSnapshot] = useState(null);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [otherPriceInputs, setOtherPriceInputs] = useState(
    /** @type {Record<string, { buy?: string; current?: string }>} */ ({})
  );
  const [tokenBalancePage, setTokenBalancePage] = useState(1);

  useEffect(() => {
    setSource(readStoredSource());
  }, []);

  useEffect(() => {
    setOtherPriceInputs(loadOtherInvestmentPriceInputs());
  }, []);

  const patchOtherPriceInput = useCallback((id, field, value) => {
    setOtherPriceInputs((prev) => {
      const next = {
        ...prev,
        [id]: { ...prev[id], [field]: value }
      };
      saveOtherInvestmentPriceInputs(next);
      return next;
    });
  }, []);

  const setSourcePersist = useCallback((next) => {
    setSource(next);
    try {
      window.sessionStorage.setItem(WALLET_SOURCE_STORAGE, next);
    } catch {
      /* ignore */
    }
  }, []);

  const chainKey = source === "solana-w2" ? "w2" : "w1";
  const activeChainAddress =
    source === "solana-connected"
      ? publicKey?.toBase58() ?? ""
      : source === "solana-w2"
        ? watchWalletAddressW2
        : watchWalletAddressW1;
  const isPaper = source === "paper";
  const useSnapshotAddressOverride = source === "solana-connected" && Boolean(activeChainAddress?.trim());

  const stats = useMemo(() => {
    const slice = closedTradesInRange(tradeHistory, range);
    const total = slice.length;
    const wins = slice.filter((t) => Number(t?.pnlUsdt) > 0).length;
    const netPnl = slice.reduce((sum, t) => sum + (Number(t?.pnlUsdt) || 0), 0);
    const winRate = total > 0 ? (wins / total) * 100 : null;
    return { total, wins, netPnl, winRate };
  }, [tradeHistory, range]);

  const paperOpenLegs = useMemo(() => {
    if (Array.isArray(activeTrades) && activeTrades.length > 0) return activeTrades;
    return activeTrade ? [activeTrade] : [];
  }, [activeTrades, activeTrade]);

  const chainKnownList = useMemo(() => {
    if (isPaper || !snapshot || snapshot.error != null || !Array.isArray(snapshot.knownTokens)) return [];
    return snapshot.knownTokens;
  }, [isPaper, snapshot]);

  const walletExtraRowCount = isPaper ? paperOpenLegs.length : chainKnownList.length;
  const walletTokenTotalPages = Math.max(1, Math.ceil(walletExtraRowCount / WALLET_TOKEN_ROWS_PAGE_SIZE));
  const walletTokenSafePage = Math.min(Math.max(1, tokenBalancePage), walletTokenTotalPages);
  const walletTokenPageStart = (walletTokenSafePage - 1) * WALLET_TOKEN_ROWS_PAGE_SIZE;

  const paginatedChainTokens = useMemo(
    () => chainKnownList.slice(walletTokenPageStart, walletTokenPageStart + WALLET_TOKEN_ROWS_PAGE_SIZE),
    [chainKnownList, walletTokenPageStart]
  );

  const paginatedPaperLegs = useMemo(
    () => paperOpenLegs.slice(walletTokenPageStart, walletTokenPageStart + WALLET_TOKEN_ROWS_PAGE_SIZE),
    [paperOpenLegs, walletTokenPageStart]
  );

  const loadSnapshot = useCallback(async () => {
    if (isPaper) {
      setSnapshot(null);
      return;
    }
    if (source === "solana-connected" && !connected) {
      setSnapshot({
        error: "phantom_not_connected",
        address: "",
        key: chainKey
      });
      return;
    }
    if (!activeChainAddress?.trim()) {
      setSnapshot({
        error: source === "solana-connected" ? "phantom_not_connected" : "no_watch_wallet",
        address: "",
        key: chainKey
      });
      return;
    }
    setSnapshotLoading(true);
    try {
      const body = await fetchWalletOnChainSnapshot(chainKey, {
        ...(useSnapshotAddressOverride ? { overrideAddress: activeChainAddress.trim() } : {})
      });
      setSnapshot(body);
    } catch {
      setSnapshot({ error: "request_failed", address: activeChainAddress, key: chainKey });
    } finally {
      setSnapshotLoading(false);
    }
  }, [
    isPaper,
    activeChainAddress,
    chainKey,
    source,
    connected,
    useSnapshotAddressOverride
  ]);

  useEffect(() => {
    void loadSnapshot();
  }, [loadSnapshot]);

  useEffect(() => {
    setTokenBalancePage(1);
  }, [source, isPaper, activeChainAddress]);

  useEffect(() => {
    setTokenBalancePage((p) => Math.min(Math.max(1, p), walletTokenTotalPages));
  }, [walletTokenTotalPages]);

  const handleCopyAddress = async () => {
    const text = activeChainAddress?.trim();
    if (!text) {
      toast.error(isPaper ? "Switch to a Solana wallet to copy an address" : "No address configured for this wallet");
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Address copied");
    } catch {
      toast.error("Could not copy");
    }
  };

  const copyHeaderButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="h-8 w-8 shrink-0 border-[var(--border)] p-0 text-[var(--text-muted)] hover:text-[var(--text)]"
      onClick={handleCopyAddress}
      disabled={isPaper || !activeChainAddress?.trim()}
      aria-label="Copy wallet address"
      title={isPaper ? "Select a Solana account above" : "Copy this wallet’s Solana address"}
    >
      <Copy className="mx-auto h-4 w-4" />
    </Button>
  );

  const onChainTotal =
    snapshot && snapshot.error == null && Number.isFinite(Number(snapshot.totalUsd))
      ? Number(snapshot.totalUsd)
      : null;
  const snapshotErr = snapshot?.error;
  const showChainTable = !isPaper;
  const snapshotStableUsd =
    showChainTable && snapshot && snapshot.error == null ? splStableValueUsd(snapshot) : undefined;

  const chainSnapshotKeyMismatch = Boolean(
    snapshot && snapshot.key != null && String(snapshot.key) !== String(chainKey)
  );
  /** First load or switched W1/W2 before new snapshot arrives. */
  const showChainWalletLoader = Boolean(
    showChainTable &&
      activeChainAddress?.trim() &&
      snapshotLoading &&
      (!snapshot || chainSnapshotKeyMismatch)
  );
  /** Background refresh (same wallet): keep showing last snapshot. */
  const showChainWalletRefreshing = Boolean(
    showChainTable &&
      activeChainAddress?.trim() &&
      snapshotLoading &&
      snapshot &&
      !chainSnapshotKeyMismatch &&
      snapshot.error == null
  );

  return (
    <Card className="border-[var(--border)] bg-[var(--panel)]">
      <CardContent className="space-y-4 p-4 md:p-5">
        <AccordionSection
          title="Crypto Wallet"
          isOpen={cryptoAccordionOpen}
          onToggle={() => setCryptoAccordionOpen((o) => !o)}
          headerClassName="min-h-[56px] gap-3 px-4 py-3"
          titleClassName="text-base font-semibold"
          iconClassName="h-6 w-6"
          contentClassName="border-t border-[var(--border)] px-4 pb-4 pt-4"
          containerClassName="rounded-lg border border-[var(--border)] bg-[var(--panel)] font-mono text-sm"
          headerRight={copyHeaderButton}
          headerRightWhenCollapsed={copyHeaderButton}
        >
          <div className="space-y-6">
            <div className="min-w-0">
              {isPaper ? (
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  <span className="font-medium text-[var(--text)]">Paper account</span> — simulated strategy only (no
                  Solana address). Open positions and closed-trade stats live here; not your Trojan/mainnet balances.
                </p>
              ) : source === "solana-w2" && !watchWalletAddressW2?.trim() ? (
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  Solana W2 has no address yet. Set <code className="text-[var(--text)]">watchWalletAddressW2</code> via{" "}
                  <code className="text-[var(--text)]">POST /api/bot/config</code> when you have a second wallet.
                </p>
              ) : source === "solana-connected" && !connected ? (
                <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                  <span className="font-medium text-[var(--text)]">Phantom</span> — connect a wallet (e.g. from Run Bot)
                  to load balances for the address you sign with. This is separate from watch W1/W2 in bot config.
                </p>
              ) : (
                <p className="text-xs text-[var(--text-muted)]">
                  {source === "solana-w1"
                    ? "Solana W1"
                    : source === "solana-w2"
                      ? "Solana W2"
                      : "Phantom (connected)"}{" "}
                  (mainnet read-only):{" "}
                  <span className="text-[var(--text)]">{shortAddress(activeChainAddress)}</span>
                  {snapshotLoading ? <span className="ml-2 opacity-70">Updating…</span> : null}
                </p>
              )}
            </div>

            <label className="grid max-w-md gap-1.5 text-xs text-[var(--text-muted)]">
              <span className="font-medium uppercase tracking-wide text-[var(--text-muted)]">Account</span>
              <select
                className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--text)]"
                value={source}
                onChange={(e) => setSourcePersist(/** @type {WalletDashboardSource} */ (e.target.value))}
              >
                <option value="paper">Paper trading (simulated)</option>
                <option value="solana-w1">Solana W1 (on-chain)</option>
                <option value="solana-w2">Solana W2 (on-chain)</option>
                <option value="solana-connected">Phantom — connected wallet</option>
              </select>
              <span className="text-[10px] leading-relaxed">
                Paper is the bot&apos;s simulated book. W1/W2 use addresses from bot config.{" "}
                <span className="font-medium text-[var(--text)]">Phantom — connected wallet</span> shows SPL for the same
                address you sign Jupiter swaps with (includes buys not registered in Active trades).
              </span>
            </label>

            {isPaper ? (
              <div className="flex flex-wrap items-center gap-1 text-xs text-[var(--text-muted)] md:text-sm">
                <span className="text-[var(--text-muted)]">[</span>
                {RANGE_OPTIONS.map((opt, i) => (
                  <span key={opt.id} className="inline-flex items-center">
                    {i > 0 ? <span className="px-0.5 text-[var(--border)]">|</span> : null}
                    <button
                      type="button"
                      className={`rounded px-1.5 py-0.5 transition ${
                        range === opt.id
                          ? "bg-[var(--brand-soft)] font-medium text-[var(--text)]"
                          : "text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}
                      onClick={() => setRange(opt.id)}
                    >
                      {opt.label}
                    </button>
                  </span>
                ))}
                <span className="text-[var(--text-muted)]">]</span>
                <span className="ml-2 hidden text-[10px] sm:inline">Applies to paper stats only</span>
              </div>
            ) : (
              <p className="text-[10px] text-[var(--text-muted)]">
                Time range below is hidden for Solana views — it only applies in Paper. On-chain totals are live (within
                RPC limits).
              </p>
            )}

            {isPaper ? (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  Paper strategy summary
                </h3>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2">
                    <p className="text-[10px] uppercase text-[var(--text-muted)]">Current balance</p>
                    <p className="mt-1 text-[var(--text)]">—</p>
                    <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                      Not a chain balance — pick Solana W1/W2
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2">
                    <p className="text-[10px] uppercase text-[var(--text-muted)]">Net PnL (paper)</p>
                    <p
                      className={`mt-1 ${
                        stats.netPnl > 0
                          ? "text-emerald-600"
                          : stats.netPnl < 0
                            ? "text-[#e50914]"
                            : "text-[var(--text)]"
                      }`}
                    >
                      {formatMoney(stats.netPnl)}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">Closed paper trades · {range}</p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2">
                    <p className="text-[10px] uppercase text-[var(--text-muted)]">Total trades</p>
                    <p className="mt-1 text-[var(--text)]">{stats.total}</p>
                    <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">Closed in range</p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2">
                    <p className="text-[10px] uppercase text-[var(--text-muted)]">Win rate</p>
                    <p className="mt-1 text-[var(--text)]">
                      {stats.winRate != null ? `${stats.winRate.toFixed(1)}%` : "—"}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">Closed with PnL &gt; 0</p>
                  </div>
                </div>
              </section>
            ) : (
              <section className="space-y-2">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                  On-chain summary (mainnet)
                </h3>
                <div className="grid gap-3 md:grid-cols-2">
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2">
                    <p className="text-[10px] uppercase text-[var(--text-muted)]">Holdings (est.)</p>
                    <p className="mt-1 text-[var(--text)]">
                      {showChainWalletLoader ? (
                        <span className="inline-flex items-center gap-2 text-[var(--text-muted)]">
                          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#E50914]" aria-hidden />
                          Loading…
                        </span>
                      ) : activeChainAddress?.trim() && onChainTotal != null ? (
                        formatMoney(onChainTotal)
                      ) : (
                        "—"
                      )}
                    </p>
                    <p className="mt-0.5 text-[10px] text-[var(--text-muted)]">
                      SOL spot via Binance; USDT SPL; extra rows = SPL mints from bot trades (Dex price × balance)
                    </p>
                  </div>
                  <div className="rounded-lg border border-[var(--border)] bg-[var(--panel-muted)] px-3 py-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
                    Paper PnL and win rate are on the <span className="font-medium text-[var(--text)]">Paper</span>{" "}
                    account. This column is only mainnet holdings for {source === "solana-w1" ? "W1" : "W2"}.
                  </div>
                </div>
                {activeChainAddress?.trim() && snapshotErr && snapshotErr !== "phantom_not_connected" ? (
                  <p className="text-xs text-[#e50914]">On-chain refresh: {String(snapshotErr)}</p>
                ) : null}
                {snapshotErr === "phantom_not_connected" ? (
                  <p className="text-xs text-amber-700 dark:text-amber-400">
                    Connect Phantom to load this view — or switch to Solana W1/W2.
                  </p>
                ) : null}
              </section>
            )}

            {isPaper && (
              <p className="text-[10px] text-[var(--text-muted)]">
                Tip: negative Net PnL here is from <span className="font-medium text-[var(--text)]">simulated</span>{" "}
                closes in the selected window — not your Solana wallet PnL.
              </p>
            )}

            <section className="space-y-2">
              <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-[var(--text-muted)]">
                Token balances
                <span
                  className="inline-flex shrink-0 text-[var(--text-muted)] hover:text-[var(--text)]"
                  title={isPaper ? WALLET_TOKEN_BALANCES_HELP_PAPER : WALLET_TOKEN_BALANCES_HELP_CHAIN}
                >
                  <Info className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">Token balances table — full details</span>
                </span>
                {showChainWalletRefreshing ? (
                  <Loader2
                    className="h-4 w-4 shrink-0 animate-spin text-[#E50914]"
                    aria-label="Refreshing on-chain data"
                  />
                ) : null}
              </h3>
              <div className="rounded-lg border border-[var(--border)]">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-left text-xs md:text-sm">
                    <thead className="border-b border-[var(--border)] bg-[var(--panel-muted)] text-[var(--text-muted)]">
                      <tr>
                        <th className="px-3 py-2 font-medium">Asset</th>
                        <th className="px-3 py-2 font-medium">Balance</th>
                        <th className="px-3 py-2 font-medium">Balance in USD</th>
                        <th
                          className="px-3 py-2 font-medium"
                          title="Paper open: live vs bet. Bot-known SPL: same PnL as Active Trade when mint matches; else last closed trade realized."
                        >
                          PnL (USDT)
                        </th>
                        <th
                          className="px-3 py-2 font-medium"
                          title="Same sources as PnL (USDT): open leg vs bet, or last closed trade for that mint."
                        >
                          PnL (%age)
                        </th>
                        <th className="px-3 py-2 font-medium">Purpose</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border)]">
                      {showChainWalletLoader ? (
                        <tr>
                          <td className="py-8 px-3" colSpan={6}>
                            <div className="flex flex-col items-center justify-center gap-2 text-[var(--text-muted)]">
                              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#E50914]" aria-hidden />
                              <span className="text-xs">Loading on-chain balances…</span>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                      {!showChainWalletLoader ? (
                        <>
                          <tr>
                            <td className="px-3 py-2.5 text-[var(--text)]">SOL</td>
                            <td className="px-3 py-2.5 text-[var(--text)]">
                              {showChainTable && snapshot && snapshot.error == null
                                ? formatSolAmount(snapshot.solBalance)
                                : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-[var(--text)]">
                              {showChainTable && snapshot && snapshot.error == null && snapshot.solPriceUsd != null
                                ? formatMoney(snapshot.solValueUsd)
                                : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-[var(--text-muted)]">—</td>
                            <td className="px-3 py-2.5 text-[var(--text-muted)]">—</td>
                            <td className="px-3 py-2.5 text-[var(--text-muted)]">
                              {isPaper ? "— (paper view)" : "Gas / trading"}
                            </td>
                          </tr>
                          <tr>
                            <td className="px-3 py-2.5 text-[var(--text)]">USDT</td>
                            <td className="px-3 py-2.5 text-[var(--text)]">
                              {showChainTable && snapshot && snapshot.error == null
                                ? formatSplStableBalance(snapshot)
                                : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-[var(--text)]">
                              {snapshotStableUsd != null ? formatMoney(snapshotStableUsd) : "—"}
                            </td>
                            <td className="px-3 py-2.5 text-[var(--text-muted)]">—</td>
                            <td className="px-3 py-2.5 text-[var(--text-muted)]">—</td>
                            <td className="px-3 py-2.5 text-[var(--text-muted)]">
                              {isPaper ? "— (paper view)" : "Main balance"}
                            </td>
                          </tr>
                          {!isPaper && snapshot && snapshot.error == null && paginatedChainTokens.length > 0
                            ? paginatedChainTokens.map((t) => {
                          const openLeg = findOpenLegByMint(paperOpenLegs, t.mint);
                          const closedLeg = openLeg ? null : findLastClosedTradeByMint(tradeHistory, t.mint);
                          const openPnlClass =
                            openLeg &&
                            Number.isFinite(Number(openLeg.pnlUsdt)) &&
                            Number(openLeg.pnlUsdt) >= 0
                              ? "text-emerald-600"
                              : "text-[#e50914]";
                          const closedPnlClass =
                            closedLeg &&
                            Number.isFinite(Number(closedLeg.pnlUsdt)) &&
                            Number(closedLeg.pnlUsdt) >= 0
                              ? "text-emerald-600"
                              : "text-[#e50914]";
                          return (
                            <tr key={t.mint} className="bg-[var(--brand-soft)]/25">
                              <td className="px-3 py-2.5 text-[var(--text)]">
                                <span className="font-medium">{t.symbol}</span>
                                <a
                                  className="ml-1.5 text-[10px] text-[var(--text-muted)] underline-offset-2 hover:underline"
                                  href={`https://solscan.io/token/${encodeURIComponent(t.mint)}`}
                                  target="_blank"
                                  rel="noreferrer"
                                  title={t.mint}
                                >
                                  SPL
                                </a>
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text)]">
                                {Number.isFinite(t.balanceUi)
                                  ? t.balanceUi.toLocaleString(undefined, { maximumFractionDigits: 8 })
                                  : "—"}
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text)]">
                                {t.valueUsd != null && Number.isFinite(t.valueUsd) ? formatMoney(t.valueUsd) : "—"}
                              </td>
                              <td className={`px-3 py-2.5 text-[11px] tabular-nums ${openLeg ? openPnlClass : closedLeg ? closedPnlClass : "text-[var(--text-muted)]"}`}>
                                {openLeg &&
                                Number.isFinite(Number(openLeg.pnlPercent)) &&
                                Number.isFinite(Number(openLeg.pnlUsdt)) ? (
                                  <span className="font-medium" title="Open leg — same as Active Trade">
                                    {formatMoney(openLeg.pnlUsdt)}
                                  </span>
                                ) : closedLeg &&
                                  Number.isFinite(Number(closedLeg.pnlPercent)) &&
                                  Number.isFinite(Number(closedLeg.pnlUsdt)) ? (
                                  <span
                                    className="font-medium"
                                    title="Most recent closed bot trade for this mint (realized)"
                                  >
                                    {formatMoney(closedLeg.pnlUsdt)}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className={`px-3 py-2.5 text-[11px] tabular-nums ${openLeg ? openPnlClass : closedLeg ? closedPnlClass : "text-[var(--text-muted)]"}`}>
                                {openLeg &&
                                Number.isFinite(Number(openLeg.pnlPercent)) &&
                                Number.isFinite(Number(openLeg.pnlUsdt)) ? (
                                  <span className="font-medium" title="Open leg — same as Active Trade">
                                    {formatGainLossPercent(openLeg.pnlPercent)}
                                  </span>
                                ) : closedLeg &&
                                  Number.isFinite(Number(closedLeg.pnlPercent)) &&
                                  Number.isFinite(Number(closedLeg.pnlUsdt)) ? (
                                  <span
                                    className="font-medium"
                                    title="Realized — most recent closed bot trade for this mint"
                                  >
                                    {formatGainLossPercent(closedLeg.pnlPercent)}
                                  </span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-[10px] text-[var(--text-muted)]">
                                {openLeg || closedLeg ? "On-chain · bot trade mint" : "On-chain · wallet (not in bot)"}
                              </td>
                            </tr>
                          );
                              })
                            : null}
                          {isPaper && paperOpenLegs.length > 0
                            ? paginatedPaperLegs.map((leg, idx) => {
                          const legValueUsd =
                            Number.isFinite(leg.quantity) && Number.isFinite(leg.currentPrice)
                              ? leg.quantity * leg.currentPrice
                              : null;
                          const legPnlClass =
                            Number.isFinite(Number(leg.pnlUsdt)) && Number(leg.pnlUsdt) >= 0
                              ? "text-emerald-600"
                              : "text-[#e50914]";
                          const legOrdinal = walletTokenPageStart + idx + 1;
                          return (
                            <tr key={leg.id} className="bg-[var(--brand-soft)]/40">
                              <td className="px-3 py-2.5 font-medium text-[var(--text)]">
                                {leg.baseAsset}
                                {paperOpenLegs.length > 1 ? (
                                  <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">
                                    · leg {legOrdinal}
                                  </span>
                                ) : null}
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text)]">
                                {Number.isFinite(leg.quantity)
                                  ? leg.quantity.toLocaleString(undefined, { maximumFractionDigits: 6 })
                                  : "—"}
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text)]">
                                {legValueUsd != null ? formatMoney(legValueUsd) : "—"}
                              </td>
                              <td className={`px-3 py-2.5 tabular-nums ${legPnlClass}`}>
                                {Number.isFinite(Number(leg.pnlPercent)) && Number.isFinite(Number(leg.pnlUsdt)) ? (
                                  <span className="font-medium">{formatMoney(leg.pnlUsdt)}</span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className={`px-3 py-2.5 tabular-nums ${legPnlClass}`}>
                                {Number.isFinite(Number(leg.pnlPercent)) && Number.isFinite(Number(leg.pnlUsdt)) ? (
                                  <span className="font-medium">{formatGainLossPercent(leg.pnlPercent)}</span>
                                ) : (
                                  "—"
                                )}
                              </td>
                              <td className="px-3 py-2.5 text-[var(--text)]">Open paper position</td>
                            </tr>
                          );
                              })
                            : null}
                        </>
                      ) : null}
                    </tbody>
                  </table>
                </div>
                <Pagination
                  page={walletTokenSafePage}
                  totalPages={walletTokenTotalPages}
                  onPageChange={setTokenBalancePage}
                />
              </div>
              <div className="flex items-start gap-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
                <span
                  className="mt-0.5 inline-flex shrink-0 text-[var(--text-muted)] hover:text-[var(--text)]"
                  title={isPaper ? WALLET_TOKEN_BALANCES_HELP_PAPER : WALLET_TOKEN_BALANCES_HELP_CHAIN}
                >
                  <Info className="h-3.5 w-3.5" aria-hidden />
                  <span className="sr-only">About token balances and PnL</span>
                </span>
                <p className="min-w-0 flex-1">
                  {isPaper
                    ? `SOL/USDT are on-chain only — switch to Solana W1/W2 or Phantom. Open paper legs: ${WALLET_TOKEN_ROWS_PAGE_SIZE} per page. PnL vs each leg’s bet (incl. partial sells). Hover the info icon for details.`
                    : `Mainnet SPL USDT (Es9v…wNYB · full mint in tooltip). Extra SPL: ${WALLET_TOKEN_ROWS_PAGE_SIZE} per page; SOL + USDT every page. PnL only when mint matches a bot leg; else Phantom/Solscan. SOLANA_RPC_URL if RPC errors. Hover the info icon for details.`}
                </p>
              </div>
            </section>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Other Investments"
          isOpen={otherInvestmentsOpen}
          onToggle={() => setOtherInvestmentsOpen((o) => !o)}
          headerClassName="min-h-[56px] gap-3 px-4 py-3"
          titleClassName="text-base font-semibold"
          iconClassName="h-6 w-6"
          contentClassName="border-t border-[var(--border)] px-4 pb-4 pt-3"
          containerClassName="rounded-lg border border-[var(--border)] bg-[var(--panel)] font-mono text-sm"
        >
          <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
            <table className="w-full min-w-[1060px] text-left text-xs md:text-sm">
              <thead className="border-b border-[var(--border)] bg-[var(--panel-muted)] text-[var(--text-muted)]">
                <tr>
                  <th className="px-3 py-2 font-medium">Investment type</th>
                  <th className="px-3 py-2 font-medium">Name</th>
                  <th className="px-3 py-2 font-medium">Source</th>
                  <th className="px-3 py-2 font-medium">Buy (AUD/unit)</th>
                  <th className="px-3 py-2 font-medium">Current (AUD/unit)</th>
                  <th className="px-3 py-2 font-medium">Total invested (AUD)</th>
                  <th className="px-3 py-2 font-medium">PnL (AUD)</th>
                  <th className="px-3 py-2 font-medium" title="Return vs total invested (AUD).">
                    PnL (%age)
                  </th>
                  <th className="px-3 py-2 font-medium">Date invested</th>
                  <th className="px-3 py-2 font-medium">Chart</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border)]">
                {otherInvestments.length === 0 ? (
                  <tr>
                    <td className="px-3 py-4 text-[var(--text-muted)]" colSpan={10}>
                      No rows yet. Add holdings in{" "}
                      <code className="text-[var(--text)]">ui/data/otherInvestments.js</code> (or share your list and we
                      can wire it).
                    </td>
                  </tr>
                ) : (
                  otherInvestments.map((row) => {
                    const draft = otherPriceInputs[row.id] ?? {};
                    const buyDisplay =
                      "buy" in draft
                        ? (draft.buy ?? "")
                        : row.buyPriceAud != null && Number.isFinite(Number(row.buyPriceAud))
                          ? String(row.buyPriceAud)
                          : "";
                    const currentDisplay = "current" in draft ? (draft.current ?? "") : "";
                    const calcPnl = computeOtherInvestmentPnl(row, buyDisplay, currentDisplay);
                    const manualPnl = row.pnl;
                    const displayPnl = calcPnl != null ? calcPnl : manualPnl;
                    const pnlIsCalc = calcPnl != null;
                    const investedN = Number(row.totalInvested);
                    const displayPnlPct =
                      displayPnl != null && Number.isFinite(investedN) && investedN > 0
                        ? (Number(displayPnl) / investedN) * 100
                        : null;
                    const pnlPctClass =
                      displayPnlPct == null
                        ? "text-[var(--text-muted)]"
                        : displayPnlPct > 0
                          ? "text-emerald-600"
                          : displayPnlPct < 0
                            ? "text-[#e50914]"
                            : "text-[var(--text)]";
                    return (
                    <tr key={row.id}>
                      <td className="px-3 py-2.5 text-[var(--text)]">{row.investmentType}</td>
                      <td className="px-3 py-2.5 text-[var(--text)]">{row.name}</td>
                      <td className="px-3 py-2.5">
                        {row.sourceUrl ? (
                          <a
                            href={row.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[var(--text)] underline decoration-[var(--border)] underline-offset-2 hover:decoration-[var(--text)]"
                          >
                            {row.sourceLabel ?? "Source"}
                            <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                          </a>
                        ) : (
                          <span className="text-[var(--text-muted)]">{row.sourceLabel ?? "—"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <input
                          type="text"
                          inputMode="decimal"
                          className={priceInputClass}
                          placeholder="Buy"
                          aria-label={`${row.name} average buy price AUD per unit`}
                          value={buyDisplay}
                          onChange={(e) => patchOtherPriceInput(row.id, "buy", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2.5 align-middle">
                        <input
                          type="text"
                          inputMode="decimal"
                          className={priceInputClass}
                          placeholder="Now"
                          aria-label={`${row.name} current price AUD per unit`}
                          value={currentDisplay}
                          onChange={(e) => patchOtherPriceInput(row.id, "current", e.target.value)}
                        />
                      </td>
                      <td className="px-3 py-2.5 text-[var(--text)]">{formatAud(row.totalInvested)}</td>
                      <td
                        className={`px-3 py-2.5 align-top ${
                          displayPnl == null
                            ? "text-[var(--text-muted)]"
                            : displayPnl > 0
                              ? "text-emerald-600"
                              : displayPnl < 0
                                ? "text-[#e50914]"
                                : "text-[var(--text)]"
                        }`}
                      >
                        {displayPnl == null ? (
                          "—"
                        ) : (
                          <span className="inline-flex flex-col items-end gap-0.5">
                            <span>{formatAud(displayPnl)}</span>
                            {pnlIsCalc ? (
                              <span className="text-[10px] font-normal text-[var(--text-muted)]">from prices</span>
                            ) : null}
                          </span>
                        )}
                      </td>
                      <td className={`px-3 py-2.5 align-top tabular-nums ${pnlPctClass}`}>
                        {displayPnlPct == null || !Number.isFinite(displayPnlPct) ? (
                          "—"
                        ) : (
                          <span className="font-medium">{formatGainLossPercent(displayPnlPct)}</span>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--text-muted)]">{formatInvestDate(row.dateInvested)}</td>
                      <td className="px-3 py-2.5">
                        {row.chartUrl ? (
                          <a
                            href={row.chartUrl}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 text-[var(--text)] underline decoration-[var(--border)] underline-offset-2 hover:decoration-[var(--text)]"
                          >
                            Chart
                            <ExternalLink className="h-3.5 w-3.5 shrink-0 opacity-70" aria-hidden />
                          </a>
                        ) : (
                          "—"
                        )}
                      </td>
                    </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-muted)]">
            Manual tracker — not synced to brokers. Enter <span className="font-medium text-[var(--text)]">buy</span>{" "}
            and <span className="font-medium text-[var(--text)]">current</span> price per unit (AUD); PnL (AUD) and PnL
            (%age) use (current ÷ buy − 1) × total invested and return vs cost basis. Inputs are saved in this browser.
            Optional default buy can be set in{" "}
            <code className="text-[var(--text)]">otherInvestments.js</code> as <code className="text-[var(--text)]">buyPriceAud</code>.
            If both prices are blank, a numeric <code className="text-[var(--text)]">pnl</code> in the file is shown instead.
          </p>
        </AccordionSection>
      </CardContent>
    </Card>
  );
}
