import { Fragment, useEffect, useMemo, useState } from "react";
import { Info, Loader2, X } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { AccordionSection } from "../common/AccordionSection";
import { PaginatedTableContainer } from "../common/PaginatedTableContainer";
import { formatMoney, formatPaperTradeTokenLabel, formatPercent } from "../../lib/formatters";
import { useUiStore } from "../../stores/useUiStore";
import { resolveTradeCooldownLogMessage } from "../../lib/tradeCooldownLogDisplay";
import { TradeSettingsSnapshotBody } from "./RunBotSection";

const TRADE_HISTORY_ROWS_EXPANDED_SYSTEM_LOGS = 10;
const TRADE_HISTORY_ROWS_COLLAPSED_SYSTEM_LOGS = 14;
const TRADE_HISTORY_COLUMN_WIDTHS = [
  "10rem", // Time
  "8.25rem", // Token
  "5rem", // Type
  "5.625rem", // Bet (USDT)
  "6.5rem", // Price
  "5.5rem", // %age of Bucket
  "5rem", // Time Spent
  "6rem", // Fees
  "6rem", // PnL %
  "7rem", // PnL USDT
  "6.75rem", // Proceeds (USDT) — partial clips only
  "6.75rem", // Reason for Entry/Exit
  "18rem" // Description
];

/** Match paper bot sell fee for legacy partial rows without `proceedsUsdt`. */
const PARTIAL_CLIP_ASSUMED_FEE = 0.001;

/** Simulated swap fee + optional Solana network fee (USDT) for one P-SELL clip. */
function partialClipTotalFeesUsdt(pf) {
  if (pf == null) return null;
  let swapFee = null;
  if (Number.isFinite(Number(pf.feesUsdt))) {
    swapFee = Number(pf.feesUsdt);
  } else {
    const px = Number(pf.price);
    const qty = Number(pf.quantitySold);
    const notional = px * qty;
    if (Number.isFinite(notional) && notional > 0) {
      if (pf.proceedsUsdt != null && Number.isFinite(Number(pf.proceedsUsdt))) {
        const implied = notional - Number(pf.proceedsUsdt);
        swapFee =
          implied >= 0 && implied <= notional ? implied : notional * PARTIAL_CLIP_ASSUMED_FEE;
      } else {
        swapFee = notional * PARTIAL_CLIP_ASSUMED_FEE;
      }
    }
  }
  const net =
    pf.networkFeeUsdt != null && Number.isFinite(Number(pf.networkFeeUsdt))
      ? Number(pf.networkFeeUsdt)
      : 0;
  if (swapFee == null) return net > 0 ? Number(net.toFixed(6)) : null;
  return Number((swapFee + net).toFixed(6));
}

function formatHistoryFeesCell(value) {
  if (value === null || value === undefined) return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return formatMoney(n);
}

function partialClipProceedsUsdt(pf) {
  if (pf == null) return null;
  if (Number.isFinite(Number(pf.proceedsUsdt))) return Number(pf.proceedsUsdt);
  const gross = Number(pf.price) * Number(pf.quantitySold);
  if (!Number.isFinite(gross) || gross <= 0) return null;
  return Number((gross * (1 - PARTIAL_CLIP_ASSUMED_FEE)).toFixed(4));
}

function formatDateTime(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function formatTimeOnly(value) {
  if (!value) return "N/A";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "N/A";
  return date.toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
}

function levelClasses(level) {
  if (level === "error") return "bg-[#e50914]/10 text-[#e50914] border-[#e50914]/30";
  if (level === "warn") return "bg-amber-500/10 text-amber-500 border-amber-500/30";
  return "bg-emerald-500/10 text-emerald-500 border-emerald-500/30";
}

function formatDuration(start, end) {
  if (!start || !end) return "N/A";
  const startTs = new Date(start).getTime();
  const endTs = new Date(end).getTime();
  if (Number.isNaN(startTs) || Number.isNaN(endTs) || endTs < startTs) return "N/A";
  const totalSeconds = Math.floor((endTs - startTs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours <= 0 && minutes <= 0) return `${seconds}s`;
  if (hours <= 0) return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${hours}h ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

/** Plain-language sell description; `settingsAtOpen` is frozen when the trade opened (from API). */
function exitReasonDescription(reason, tradeContext, settingsAtOpen) {
  const bet = Number(tradeContext?.betUsdt);
  const betPhrase = Number.isFinite(bet) && bet > 0 ? formatMoney(bet) : "your USDT stake";
  const sl = Number(settingsAtOpen?.stopLossPercent);
  const maxHold = Number(settingsAtOpen?.maxHoldMinutes);
  const tpSteps = Array.isArray(settingsAtOpen?.takeProfitStepsPercent)
    ? settingsAtOpen.takeProfitStepsPercent.filter((n) => Number.isFinite(Number(n)))
    : [];

  const map = {
    take_profit:
      "Take-profit ladder: a staged target for total trade PnL was hit and the bot sold the remainder (or the final step closed 100% of what was left).",
    stop_loss:
      "Stop-loss: the bot closed because total trade PnL vs your original bet hit your maximum loss limit. That uses the same PnL % as the bot UI (including partial sells), not a separate price-only rule.",
    time_stop: "Time stop: the trade reached the maximum hold time you allowed at open, so the bot exited.",
    manual: "You (or the UI) requested a manual close at this price.",
    break_even: "Break-even protection: after the trade had been in profit, rules pulled the exit toward protecting gains / breakeven.",
    red_dip: "Red dip rule: a sharp pullback after momentum triggered a protective exit.",
    dip_retrace:
      "Dip / retracement rule: price gave back enough of the move from entry toward the session peak that the bot closed the rest of the position."
  };
  let base = map[reason] ?? "No exit reason description available.";
  if (reason === "break_even" && tradeContext) {
    const extra = breakEvenMetricsSentence(tradeContext);
    if (extra) base = `${base} ${extra}`;
  }

  const numericBits = [];
  if (reason === "stop_loss" && Number.isFinite(sl) && sl > 0) {
    numericBits.push(
      `Configured max loss at open: about −${sl.toFixed(2)}% total PnL vs your ${betPhrase} bet (when PnL reaches that floor, the bot sells).`
    );
  }
  if (reason === "time_stop" && Number.isFinite(maxHold) && maxHold > 0) {
    numericBits.push(`Max hold at open: ${Math.round(maxHold)} minutes.`);
  }
  if (reason === "take_profit" && tpSteps.length > 0) {
    const preview = tpSteps.slice(0, 6).map((n) => `+${Number(n).toFixed(1)}%`);
    const more = tpSteps.length > 6 ? ` (+${tpSteps.length - 6} more steps)` : "";
    numericBits.push(`Take-profit ladder at open (PnL % targets): ${preview.join(", ")}${more}.`);
  }

  if (numericBits.length === 0) return base;
  return `${base}\n\n${numericBits.join(" ")}`;
}

/** Price path at final exit: vs entry and drawdown from session peak (helps read BE rows). */
function breakEvenMetricsSentence({ entryPrice, exitPrice, peakPrice }) {
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  const peak = Number(peakPrice);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exit) || exit <= 0) return "";
  const vsEntryPct = ((exit - entry) / entry) * 100;
  const parts = [`Final price ≈ ${vsEntryPct >= 0 ? "+" : ""}${vsEntryPct.toFixed(2)}% vs entry.`];
  if (Number.isFinite(peak) && peak > 0 && peak > entry * 1.0005) {
    const offPeakPct = ((peak - exit) / peak) * 100;
    if (offPeakPct > 0.05) {
      parts.push(`About ${offPeakPct.toFixed(1)}% below trade peak (${formatMoney(peak)}).`);
    }
  }
  return parts.join(" ");
}

function displayExitReasonCell(event) {
  if (event.exitReasonLabel) return event.exitReasonLabel;
  if (event.openPosition && event.type === "buy") return "In progress";
  if (event.type === "buy" && !event.openPosition) {
    if (event.entryMode === "manual") return "Manual entry";
    if (event.entryMode === "auto") return "Scan entry";
    return "Entry";
  }
  if (!event.exitReason) return "N/A";
  const raw = String(event.exitReason);
  if (raw === "stop_loss") {
    const sl = Number(event.settingsAtOpen?.stopLossPercent);
    if (Number.isFinite(sl) && sl > 0) {
      return `Stop-loss (−${sl.toFixed(1)}% max on bet)`;
    }
    return "Stop-loss (max loss on bet)";
  }
  return raw.replace(/_/g, " ").toUpperCase();
}

function isDipReason(event) {
  const reason = String(event?.exitReason ?? "").toLowerCase();
  return reason.includes("dip");
}

/** Short label for Exit Reason column when reason is break_even. */
function formatBreakEvenExitLabel({ entryPrice, exitPrice, peakPrice }) {
  const entry = Number(entryPrice);
  const exit = Number(exitPrice);
  const peak = Number(peakPrice);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(exit) || exit <= 0) return null;
  const vsEntry = ((exit - entry) / entry) * 100;
  const bits = [`Break-even`, `${vsEntry >= 0 ? "+" : ""}${vsEntry.toFixed(1)}% vs entry`];
  if (Number.isFinite(peak) && peak > entry * 1.0005) {
    const offPeak = ((peak - exit) / peak) * 100;
    if (offPeak > 0.05) bits.push(`${offPeak.toFixed(1)}% off peak`);
  }
  return bits.join(" · ");
}

/** Opening position size in base units (same as at BUY): USDT notional / entry price. */
function initialOpenBucketQuantity(trade) {
  const entry = Number(trade?.entryPrice);
  const bet = Number(trade?.positionSizeUsdt);
  if (!Number.isFinite(entry) || entry <= 0 || !Number.isFinite(bet) || bet <= 0) return 0;
  return bet / entry;
}

function bucketPctOfInitialSold(quantitySold, initialQty) {
  if (!Number.isFinite(quantitySold) || quantitySold <= 0 || !Number.isFinite(initialQty) || initialQty <= 0) {
    return null;
  }
  return Number(((quantitySold / initialQty) * 100).toFixed(2));
}

/** Realized $ on this clip as % of original bet (position USDT) — comparable across rows. */
function clipPnlPercentOfBet(realizedUsdt, betUsdt) {
  const r = Number(realizedUsdt);
  const b = Number(betUsdt);
  if (!Number.isFinite(r) || !Number.isFinite(b) || b <= 0) return null;
  return Number(((r / b) * 100).toFixed(2));
}

function tradeGroupKey(trade) {
  const id = typeof trade?.id === "string" ? trade.id.trim() : "";
  if (id) return id;
  const symbol = String(trade?.symbol ?? "unknown");
  const openedAt = String(trade?.openedAt ?? "na");
  const closedAt = String(trade?.closedAt ?? "open");
  return `${symbol}::${openedAt}::${closedAt}`;
}

/** Latest activity time for a leg (used to sort whole trades, not individual rows). */
function anchorMsForEntity(entity) {
  const times = [];
  if (entity.sell?.time) times.push(new Date(entity.sell.time).getTime());
  if (entity.buy?.time) times.push(new Date(entity.buy.time).getTime());
  for (const p of entity.partials ?? []) {
    if (p?.time) times.push(new Date(p.time).getTime());
  }
  return times.length ? Math.max(...times) : 0;
}

function dexScreenerSearchUrl(symbol) {
  return `https://dexscreener.com/search?q=${encodeURIComponent(String(symbol ?? ""))}`;
}

/** Prefer saved pair URL from the trade (Dex `pair.url` or Binance); else `/chain/pair` from ref; last resort search. */
function chartHrefForHistoryEvent(event) {
  const raw = event.chartUrl != null ? String(event.chartUrl).trim() : "";
  if (raw) return raw;
  const ref = event.dexPaperPriceRef;
  if (ref && typeof ref.chainId === "string" && typeof ref.pairAddress === "string") {
    const chain = ref.chainId.trim().toLowerCase();
    const pair = ref.pairAddress.trim();
    if (chain && pair) {
      return `https://dexscreener.com/${encodeURIComponent(chain)}/${encodeURIComponent(pair)}`;
    }
  }
  return dexScreenerSearchUrl(event.symbol);
}

function chartLinkTitleForEvent(event) {
  const href = chartHrefForHistoryEvent(event);
  if (href.includes("binance.com")) return "Open Binance chart";
  if (href.includes("dexscreener.com")) return "Open pair on DexScreener";
  return "Open chart";
}

function TradeHistoryDescriptionCell({ event, focusRunBotActiveTrade }) {
  const [buyDetailOpen, setBuyDetailOpen] = useState(false);
  const entryText = typeof event.entryReason === "string" ? event.entryReason.trim() : "";
  const modeLine =
    event.entryMode === "manual"
      ? "Manual buy — you started this trade from the UI."
      : event.entryMode === "auto"
        ? "Automatic buy — the bot picked this from the scanner while running."
        : null;

  const whySummary = entryText || "Momentum entry based on scan factors.";

  const buyDetailBody = (
    <>
      {modeLine ? <p className="mb-2 text-[11px] text-[var(--text-muted)]">{modeLine}</p> : null}
      <p className="whitespace-pre-wrap break-words text-[11px] leading-relaxed text-[var(--text)]">
        {entryText ||
          "No scan summary is stored for this trade. Older closed trades may have been saved before this field existed."}
      </p>
    </>
  );

  const buyWhyRow = (
    <div className="flex items-start gap-1.5" onClick={(e) => e.stopPropagation()}>
      <span className="min-w-0 flex-1 text-[11px] leading-snug text-[var(--text)]">{whySummary}</span>
      <button
        type="button"
        className="mt-0.5 shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
        title={event.settingsAtOpen ? "Bot settings at trade open" : "Full entry details"}
        aria-label={event.settingsAtOpen ? "Bot settings at trade open" : "Why the bot bought — full details"}
        onClick={(e) => {
          e.stopPropagation();
          setBuyDetailOpen(true);
        }}
      >
        <Info className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  const buyDetailModal =
    buyDetailOpen ? (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
        role="presentation"
        onClick={(e) => {
          e.stopPropagation();
          setBuyDetailOpen(false);
        }}
      >
        <div
          className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
          role="dialog"
          aria-labelledby="buy-detail-title"
          aria-modal="true"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4 sm:px-6">
            <div className="min-w-0 pr-2">
              <h3 id="buy-detail-title" className="text-base font-semibold text-[var(--text)] sm:text-lg">
                {event.settingsAtOpen ? "Bot settings at trade open" : "Why the bot bought"}
              </h3>
              <p className="mt-1 text-[11px] text-[var(--text-muted)]">
                {event.settingsAtOpen ? (
                  <>
                    Snapshot for{" "}
                    <span className="font-medium text-[var(--text)]">
                      {formatPaperTradeTokenLabel({ symbol: event.symbol, baseAsset: event.baseAsset })}
                    </span>{" "}
                    (leg id <code className="text-[var(--text)]">{event.id}</code>). Changing Bot Settings later does
                    not update this trade.
                  </>
                ) : (
                  <>Entry details for this buy row (no frozen settings snapshot stored).</>
                )}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={() => setBuyDetailOpen(false)}
            >
              <X className="h-4 w-4" aria-hidden />
              Close
            </Button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
            {event.settingsAtOpen ? (
              <div className="space-y-3">
                {entryText || modeLine ? (
                  <div className="rounded-md border border-[var(--border)]/60 bg-[var(--panel-2)]/20 px-2 py-1.5">
                    <div className="text-[9px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                      Scan / entry note
                    </div>
                    <div className="mt-1 text-[11px] leading-relaxed text-[var(--text)]">
                      {modeLine ? <p className="mb-2 text-[var(--text-muted)]">{modeLine}</p> : null}
                      {entryText ? (
                        <p className="whitespace-pre-wrap break-words">{entryText}</p>
                      ) : (
                        <p className="text-[var(--text-muted)]">No scan summary line stored for this trade.</p>
                      )}
                    </div>
                  </div>
                ) : null}
                <TradeSettingsSnapshotBody settings={event.settingsAtOpen} />
              </div>
            ) : (
              buyDetailBody
            )}
          </div>
        </div>
      </div>
    ) : null;

  if (event.type === "buy") {
    return (
      <div className="space-y-2" onClick={(e) => e.stopPropagation()}>
        {event.openPosition ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[11px]">Position still open.</span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="h-7 shrink-0 px-2 text-xs"
              onClick={(e) => {
                e.stopPropagation();
                focusRunBotActiveTrade();
              }}
            >
              Details
            </Button>
          </div>
        ) : null}
        {buyWhyRow}
        {buyDetailModal}
      </div>
    );
  }

  const sellText = event.exitDescription ?? "N/A";
  return (
    <p
      className="line-clamp-3 max-w-full whitespace-pre-wrap break-words text-[11px] leading-snug text-[var(--text)]"
      title={sellText !== "N/A" ? sellText : undefined}
    >
      {sellText}
    </p>
  );
}

function TradeHistoryColGroup() {
  return (
    <colgroup>
      {TRADE_HISTORY_COLUMN_WIDTHS.map((width, idx) => (
        <col key={`trade-col-${idx}`} style={{ width }} />
      ))}
    </colgroup>
  );
}

/** Single buy/sell row in Trade History (not P-SELL child rows). */
function TradeHistoryTableMainRow({
  event,
  tradeKey,
  focusRunBotActiveTrade,
  canTogglePartials,
  isExpanded,
  isDimmedByFocus,
  rowBorderClass,
  onTogglePartials
}) {
  if (!event) return null;
  const isSell = event.type === "sell";
  const isOpenPosition = Boolean(event.openPosition);
  const showLivePnl = isSell || isOpenPosition;
  const isGain = Number(event.pnlPercent) >= 0;
  const expandedLabelTone = isExpanded ? "text-[var(--text-muted)]" : "";
  const cellPy = "py-2";
  const key = String(tradeKey ?? "");

  return (
    <tr
      className={`border-[var(--border)]/60 ${rowBorderClass} ${canTogglePartials ? "cursor-pointer hover:bg-[var(--panel-2)]/25" : ""} ${isDimmedByFocus ? "opacity-40 blur-[1px]" : ""} transition-[filter,opacity] duration-150`}
      onClick={canTogglePartials && onTogglePartials ? () => onTogglePartials(key) : undefined}
    >
      <td className={`${cellPy} px-3 ${expandedLabelTone || "text-[var(--text)]"}`}>{formatDateTime(event.time)}</td>
      <td className={`${cellPy} px-3 ${expandedLabelTone || "text-[var(--text)]"}`}>
        <a
          href={chartHrefForHistoryEvent(event)}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--text)] underline-offset-2 hover:underline"
          title={chartLinkTitleForEvent(event)}
          onClick={(e) => e.stopPropagation()}
        >
          {formatPaperTradeTokenLabel({
            symbol: event.symbol,
            baseAsset: event.baseAsset
          })}
        </a>
      </td>
      <td className={`${cellPy} px-3 text-center`}>
        <div className="flex w-full items-center justify-center gap-1 whitespace-nowrap">
          <span
            className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] leading-none font-semibold ${
              isSell
                ? "border-[#e50914]/30 bg-[#e50914]/10 uppercase text-[#e50914]"
                : isOpenPosition
                  ? "border-sky-500/30 bg-sky-500/10 uppercase text-sky-600 dark:text-sky-400"
                  : "border-emerald-500/30 bg-emerald-500/10 uppercase text-emerald-500"
            }`}
          >
            {isOpenPosition ? "buy · open" : event.type}
          </span>
        </div>
      </td>
      <td className={`${cellPy} px-3 ${expandedLabelTone || "text-[var(--text)]"}`}>
        {isSell ? (
          <span className="text-[var(--text-muted)]">—</span>
        ) : typeof event.betUsdt === "number" ? (
          formatMoney(event.betUsdt)
        ) : (
          "N/A"
        )}
      </td>
      <td className={`${cellPy} px-3 ${expandedLabelTone || "text-[var(--text)]"}`}>
        {Number.isFinite(Number(event.price)) ? formatMoney(event.price) : "N/A"}
      </td>
      <td className={`${cellPy} px-2 ${expandedLabelTone || "text-[var(--text)]"}`}>
        {event.bucketPctOfInitial != null ? `${event.bucketPctOfInitial}%` : "N/A"}
      </td>
      <td className={`${cellPy} px-3 ${expandedLabelTone || "text-[var(--text-muted)]"}`}>{event.timeSpent ?? "N/A"}</td>
      <td className={`${cellPy} px-3`}>
        {formatHistoryFeesCell(event.totalFeesUsdt)}
      </td>
      <td
        className={`${cellPy} px-3 text-left font-medium ${
          showLivePnl ? (isGain ? "text-emerald-500" : "text-[#e50914]") : "text-[var(--text-muted)]"
        }`}
      >
        {showLivePnl ? formatPercent(event.pnlPercent ?? 0) : "N/A"}
      </td>
      <td
        className={`${cellPy} px-3 text-left font-medium ${
          showLivePnl ? (isGain ? "text-emerald-500" : "text-[#e50914]") : "text-[var(--text-muted)]"
        }`}
      >
        {showLivePnl ? formatMoney(event.pnlUsdt ?? 0) : "N/A"}
      </td>
      <td className={`${cellPy} px-3 text-[var(--text-muted)]`}>
        <span title="Partial fills only">—</span>
      </td>
      <td
        className={`break-words ${cellPy} px-3 align-middle text-left text-[11px] ${
          isDipReason(event) ? "text-[#e50914]" : "text-[var(--text)]"
        } ${event.exitReasonLabel ? "normal-case" : "uppercase"}`}
      >
        {displayExitReasonCell(event)}
      </td>
      <td
        className={`break-words ${cellPy} px-3 align-middle text-[11px] leading-snug ${expandedLabelTone || "text-[var(--text)]"}`}
      >
        <TradeHistoryDescriptionCell event={event} focusRunBotActiveTrade={focusRunBotActiveTrade} />
      </td>
    </tr>
  );
}

export function HistorySection({
  logs,
  tradeHistory,
  historyLoading = false,
  activeTrade,
  activeTrades = null,
  botState = null
}) {
  const focusRunBotActiveTrade = useUiStore((s) => s.focusRunBotActiveTrade);
  const openPaperLegs = useMemo(() => {
    if (Array.isArray(activeTrades) && activeTrades.length > 0) return activeTrades;
    return activeTrade && activeTrade.status === "open" ? [activeTrade] : [];
  }, [activeTrades, activeTrade]);
  const logRows = useMemo(() => {
    const rows = logs ?? [];
    return rows.filter((log) => {
      const msg = String(log?.message ?? "").toLowerCase();
      // Trade open/close/partials already appear in Trade History; keep System Logs focused on system events.
      return !(
        msg.includes("buy") ||
        msg.includes("sell") ||
        msg.includes("partial-sell") ||
        msg.includes("partial sell") ||
        msg.includes("opened paper trade") ||
        msg.includes("closed paper trade")
      );
    });
  }, [logs]);
  const botRunning = botState?.status === "running";
  const [logNowTs, setLogNowTs] = useState(() => Date.now());
  useEffect(() => {
    if (!botRunning) return undefined;
    const t = setInterval(() => setLogNowTs(Date.now()), 1000);
    return () => clearInterval(t);
  }, [botRunning]);
  const tradeRows = tradeHistory ?? [];
  const showTradeHistoryTableLoader =
    Boolean(historyLoading) && tradeRows.length === 0 && openPaperLegs.length === 0;
  const [isSystemLogsOpen, setIsSystemLogsOpen] = useState(false);
  const [isTradeHistoryOpen, setIsTradeHistoryOpen] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  /** paper | mainnet | all — default all */
  const [channelFilter, setChannelFilter] = useState("all");
  const [tokenFilter, setTokenFilter] = useState("all");
  const [expandedTradeIds, setExpandedTradeIds] = useState(() => new Set());
  const [tradeHistoryPage, setTradeHistoryPage] = useState(1);
  const tradeHistoryRowsPerPage = isSystemLogsOpen
    ? TRADE_HISTORY_ROWS_EXPANDED_SYSTEM_LOGS
    : TRADE_HISTORY_ROWS_COLLAPSED_SYSTEM_LOGS;
  /** Closed leg ≈ 2 rows (buy+sell); keep whole trades on one page. */
  const tradeHistoryEntitiesPerPage = Math.max(1, Math.floor(tradeHistoryRowsPerPage / 2));

  const tokenOptions = useMemo(() => {
    const ordered = [];
    const seen = new Set();
    for (const leg of openPaperLegs) {
      const sym = leg?.symbol;
      if (!sym || seen.has(sym)) continue;
      ordered.push(sym);
      seen.add(sym);
    }
    /** tradeHistory is newest-first; first unseen symbol = most recently closed among remaining. */
    for (const trade of tradeRows) {
      const sym = trade.symbol;
      if (!sym || seen.has(sym)) continue;
      ordered.push(sym);
      seen.add(sym);
    }
    return ordered;
  }, [tradeRows, openPaperLegs]);

  const tradeHistoryEntities = useMemo(() => {
    const executionChannelForTrade = (trade) =>
      trade?.executionChannel === "mainnet" ? "mainnet" : "paper";

    const partialRowsFromTrade = (trade, idPrefix) => {
      const q0 = initialOpenBucketQuantity(trade);
      const groupKey = tradeGroupKey(trade);
      const legChannel = executionChannelForTrade(trade);
      return (trade.partialFills ?? []).map((pf, idx) => {
        const proceeds = partialClipProceedsUsdt(pf);
        return {
        id: `${idPrefix}-partial-${idx}-${pf.time}`,
        tradeKey: groupKey,
        executionChannel: legChannel,
        time: pf.time,
        type: "partial_sell",
        symbol: trade.symbol,
        baseAsset: trade.baseAsset,
        chartUrl: trade.chartUrl,
        dexPaperPriceRef: trade.dexPaperPriceRef,
        price: pf.price,
        betUsdt: trade.positionSizeUsdt,
        pnlPercent:
          pf.clipPnlPercentOfBet != null && Number.isFinite(Number(pf.clipPnlPercentOfBet))
            ? Number(pf.clipPnlPercentOfBet)
            : clipPnlPercentOfBet(pf.realizedUsdt, trade.positionSizeUsdt),
        pnlUsdt: pf.realizedUsdt,
        proceedsUsdt: proceeds,
        exitReason:
          pf.mode === "tp_step"
            ? legChannel === "mainnet"
              ? `tp +${pf.stepPercent}% (mark)`
              : `tp +${pf.stepPercent}%`
            : pf.mode === "dip_retrace"
              ? `retrace ${pf.stepPercent}%`
              : `dip ${pf.stepPercent}%`,
        exitDescription: (() => {
          const signal = Number(pf.signalMarkUsd);
          const fill = Number(pf.price);
          const showMarkVsFill =
            legChannel === "mainnet" &&
            Number.isFinite(signal) &&
            Number.isFinite(fill) &&
            signal > 0 &&
            fill > 0 &&
            Math.abs(signal - fill) / signal > 0.0005;
          let desc = `P-SELL: ${(pf.fractionOfRemaining * 100).toFixed(0)}% of remaining @ ${formatMoney(
            pf.price
          )}. Est. proceeds: ${proceeds != null ? `${formatMoney(proceeds)} USDT` : "—"} · Clip PnL: ${formatMoney(
            pf.realizedUsdt
          )}.`;
          if (pf.mode === "tp_step") {
            desc +=
              " TP step used total PnL vs bet vs the ladder threshold on the bot mark (Dex/Binance), not the eventual Jupiter price.";
          }
          desc +=
            " P-SELL $/% are frozen for this clip (stored on fill; later price moves do not rewrite this row).";
          if (showMarkVsFill) {
            desc += ` Mark when exit was queued: ${formatMoney(signal)} · on-chain effective: ${formatMoney(fill)}.`;
          }
          return desc;
        })(),
        timeSpent: null,
        totalFeesUsdt: partialClipTotalFeesUsdt(pf),
        openPosition: false,
        bucketPctOfInitial: bucketPctOfInitialSold(pf.quantitySold, q0)
      };
      });
    };

    const closed = (tradeRows ?? []).map((trade) => {
      const groupKey = tradeGroupKey(trade);
      const rowIdPrefix = typeof trade?.id === "string" && trade.id ? trade.id : groupKey;
      const betUsdt = trade.positionSizeUsdt;
      const q0 = initialOpenBucketQuantity(trade);
      const sumPartialSold = (trade.partialFills ?? []).reduce(
        (sum, pf) => sum + (Number.isFinite(pf.quantitySold) ? pf.quantitySold : 0),
        0
      );
      const finalCloseQty = Math.max(0, q0 - sumPartialSold);
      const closeBucketPct =
        q0 <= 0 || finalCloseQty <= q0 * 1e-9 ? null : bucketPctOfInitialSold(finalCloseQty, q0);

      const buy = {
        id: `${rowIdPrefix}-buy`,
        tradeKey: groupKey,
        time: trade.openedAt,
        type: "buy",
        symbol: trade.symbol,
        baseAsset: trade.baseAsset,
        chartUrl: trade.chartUrl,
        dexPaperPriceRef: trade.dexPaperPriceRef,
        price: trade.entryPrice,
        betUsdt,
        pnlPercent: null,
        pnlUsdt: null,
        exitReason: null,
        exitDescription: null,
        entryReason: trade.entryReason ?? null,
        entryMode: trade.entryMode ?? null,
        settingsAtOpen: trade.settingsAtOpen ?? null,
        timeSpent: null,
        totalFeesUsdt: trade.totalFeesUsdt ?? null,
        openPosition: false,
        bucketPctOfInitial: null
      };
      const sell = {
        id: `${rowIdPrefix}-sell`,
        tradeKey: groupKey,
        time: trade.closedAt,
        type: "sell",
        symbol: trade.symbol,
        baseAsset: trade.baseAsset,
        chartUrl: trade.chartUrl,
        dexPaperPriceRef: trade.dexPaperPriceRef,
        price: trade.exitPrice,
        betUsdt,
        pnlPercent: trade.pnlPercent,
        pnlUsdt: trade.pnlUsdt,
        exitReason: trade.exitReason ?? null,
        exitReasonLabel:
          trade.exitReason === "break_even"
            ? formatBreakEvenExitLabel({
                entryPrice: trade.entryPrice,
                exitPrice: trade.exitPrice,
                peakPrice: trade.peakPrice
              }) ?? "Break-even"
            : null,
        entryPrice: trade.entryPrice,
        peakPrice: trade.peakPrice,
        exitDescription: exitReasonDescription(
          trade.exitReason,
          {
            entryPrice: trade.entryPrice,
            exitPrice: trade.exitPrice,
            peakPrice: trade.peakPrice,
            betUsdt
          },
          trade.settingsAtOpen ?? null
        ),
        settingsAtOpen: trade.settingsAtOpen ?? null,
        timeSpent: formatDuration(trade.openedAt, trade.closedAt),
        totalFeesUsdt: trade.totalFeesUsdt ?? null,
        openPosition: false,
        bucketPctOfInitial: closeBucketPct
      };
      const partials = partialRowsFromTrade(trade, rowIdPrefix);
      const executionChannel = executionChannelForTrade(trade);
      return {
        tradeKey: groupKey,
        executionChannel,
        buy: { ...buy, executionChannel },
        sell: { ...sell, executionChannel },
        partials
      };
    });

    const open = (openPaperLegs ?? []).map((leg) => {
      const groupKey = tradeGroupKey(leg);
      const rowIdPrefix = leg.id || groupKey;
      const executionChannel = executionChannelForTrade(leg);
      const buy = {
        id: `${leg.id}-buy-active`,
        tradeKey: groupKey,
        executionChannel,
        time: leg.openedAt,
        type: "buy",
        symbol: leg.symbol,
        baseAsset: leg.baseAsset,
        chartUrl: leg.chartUrl,
        dexPaperPriceRef: leg.dexPaperPriceRef,
        price: leg.entryPrice,
        betUsdt: leg.positionSizeUsdt,
        pnlPercent: leg.pnlPercent,
        pnlUsdt: leg.pnlUsdt,
        exitReason: null,
        exitDescription: null,
        entryReason: leg.entryReason ?? null,
        entryMode: leg.entryMode ?? null,
        settingsAtOpen: leg.settingsAtOpen ?? null,
        timeSpent: formatDuration(leg.openedAt, new Date().toISOString()),
        totalFeesUsdt: leg.totalFeesUsdt ?? null,
        openPosition: true,
        bucketPctOfInitial: null
      };
      const partials = partialRowsFromTrade(leg, rowIdPrefix);
      return { tradeKey: groupKey, executionChannel, buy, sell: null, partials };
    });

    return [...open, ...closed]
      .filter((e) => e.buy?.time || e.sell?.time)
      .sort((a, b) => anchorMsForEntity(b) - anchorMsForEntity(a));
  }, [tradeRows, openPaperLegs]);

  const filteredHistoryEntities = useMemo(() => {
    return tradeHistoryEntities.filter((e) => {
      const sym = e.buy?.symbol ?? e.sell?.symbol ?? e.partials[0]?.symbol;
      if (tokenFilter !== "all" && sym !== tokenFilter) return false;
      if (channelFilter === "paper" && e.executionChannel === "mainnet") return false;
      if (channelFilter === "mainnet" && e.executionChannel !== "mainnet") return false;
      if (typeFilter === "partial_sell") return false;
      if (typeFilter === "buy") return Boolean(e.buy);
      if (typeFilter === "sell") return Boolean(e.sell);
      return true;
    });
  }, [tradeHistoryEntities, tokenFilter, typeFilter, channelFilter]);

  const orderedHistoryEntities = useMemo(() => {
    const list = [...filteredHistoryEntities];
    if (typeFilter === "sell") {
      return list.sort((a, b) => new Date(b.sell.time).getTime() - new Date(a.sell.time).getTime());
    }
    if (typeFilter === "buy") {
      return list.sort((a, b) => new Date(b.buy.time).getTime() - new Date(a.buy.time).getTime());
    }
    return list.sort((a, b) => anchorMsForEntity(b) - anchorMsForEntity(a));
  }, [filteredHistoryEntities, typeFilter]);

  const partialRowsByTrade = useMemo(() => {
    const grouped = new Map();
    for (const entity of tradeHistoryEntities) {
      const sym = entity.buy?.symbol ?? entity.sell?.symbol;
      if (tokenFilter !== "all" && sym !== tokenFilter) continue;
      if (channelFilter === "paper" && entity.executionChannel === "mainnet") continue;
      if (channelFilter === "mainnet" && entity.executionChannel !== "mainnet") continue;
      if (!entity.partials?.length) continue;
      const key = String(entity.tradeKey ?? "");
      const sorted = [...entity.partials].sort(
        (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime()
      );
      grouped.set(key, sorted);
    }
    return grouped;
  }, [tradeHistoryEntities, tokenFilter, channelFilter]);

  const displayedTradeEvents = useMemo(() => {
    if (typeFilter === "partial_sell") {
      return tradeHistoryEntities
        .flatMap((e) => e.partials)
        .filter((p) => {
          if (!p) return false;
          if (tokenFilter !== "all" && p.symbol !== tokenFilter) return false;
          if (channelFilter === "paper" && p.executionChannel === "mainnet") return false;
          if (channelFilter === "mainnet" && p.executionChannel !== "mainnet") return false;
          return true;
        })
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
    }
    return orderedHistoryEntities.flatMap((e) => {
      const out = [];
      if (typeFilter === "all" || typeFilter === "buy") {
        if (e.buy) out.push(e.buy);
      }
      if (typeFilter === "all" || typeFilter === "sell") {
        if (e.sell) out.push(e.sell);
      }
      return out;
    });
  }, [orderedHistoryEntities, tradeHistoryEntities, typeFilter, tokenFilter, channelFilter]);
  const tradeHistoryTotalPages = Math.max(
    1,
    Math.ceil(
      (typeFilter === "all" ? orderedHistoryEntities.length : displayedTradeEvents.length) /
        (typeFilter === "all" ? tradeHistoryEntitiesPerPage : tradeHistoryRowsPerPage)
    )
  );
  const tradeHistorySafePage = Math.min(tradeHistoryPage, tradeHistoryTotalPages);
  const pagedHistoryEntities = useMemo(() => {
    if (typeFilter !== "all") return [];
    const start = (tradeHistorySafePage - 1) * tradeHistoryEntitiesPerPage;
    return orderedHistoryEntities.slice(start, start + tradeHistoryEntitiesPerPage);
  }, [orderedHistoryEntities, tradeHistorySafePage, tradeHistoryEntitiesPerPage, typeFilter]);
  const pagedTradeEvents = useMemo(() => {
    if (typeFilter === "all") return [];
    const start = (tradeHistorySafePage - 1) * tradeHistoryRowsPerPage;
    return displayedTradeEvents.slice(start, start + tradeHistoryRowsPerPage);
  }, [displayedTradeEvents, tradeHistorySafePage, tradeHistoryRowsPerPage, typeFilter]);
  const partialCountByTrade = useMemo(() => {
    const counts = new Map();
    for (const [key, rows] of partialRowsByTrade) {
      counts.set(key, rows.length);
    }
    return counts;
  }, [partialRowsByTrade]);

  const toggleTradeDetails = (tradeKey) => {
    const key = String(tradeKey ?? "");
    if (!key) return;
    setExpandedTradeIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  useEffect(() => {
    if (tradeHistorySafePage !== tradeHistoryPage) {
      setTradeHistoryPage(tradeHistorySafePage);
    }
  }, [tradeHistorySafePage, tradeHistoryPage]);

  return (
    <Card className="min-h-[calc(100vh-180px)]">
      <CardContent className="space-y-5 pt-3">
        <AccordionSection
          title="System Logs"
          isOpen={isSystemLogsOpen}
          onToggle={() => setIsSystemLogsOpen((prev) => !prev)}
          headerClassName="min-h-[56px] px-4 py-3"
          titleClassName="text-sm font-medium"
          iconClassName="h-5 w-5"
          contentClassName="px-0 pb-0"
        >
          <div className="rounded-b-lg border-t border-[var(--border)]">
            <table className="w-full text-left text-xs">
              <thead className="bg-[var(--panel)] [&_th]:text-left">
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th className="w-[10rem] py-2 pl-2 pr-3">Time</th>
                  <th className="py-2 pl-2 pr-3">Level</th>
                  <th className="py-2 pl-2 pr-3">Description</th>
                </tr>
              </thead>
            </table>
            <div className="max-h-[280px] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <tbody>
                  {logRows.length === 0 ? (
                    <tr>
                      <td className="py-3 px-3 text-[var(--text-muted)]" colSpan={3}>
                        No logs yet.
                      </td>
                    </tr>
                  ) : (
                    logRows.map((log) => (
                      <tr key={`${log.time}-${log.message}`} className="border-b border-[var(--border)]/60">
                        <td className="w-[10rem] py-2 px-3 text-[var(--text-muted)]">{formatDateTime(log.time)}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${levelClasses(log.level)}`}
                          >
                            {log.level}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-[var(--text)]">
                          {resolveTradeCooldownLogMessage(log.message, {
                            botRunning,
                            tradeCooldownSeconds: botState?.config?.tradeCooldownSeconds,
                            lastMomentumTradeOpenedAt: botState?.lastMomentumTradeOpenedAt,
                            nowTs: logNowTs
                          })}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </AccordionSection>

        <AccordionSection
          title="Trade History"
          isOpen={isTradeHistoryOpen}
          onToggle={() => setIsTradeHistoryOpen((prev) => !prev)}
          headerClassName="min-h-[56px] px-4 py-3"
          titleClassName="text-sm font-medium"
          iconClassName="h-5 w-5"
          contentClassName="px-0 pb-0"
          headerRight={
            <div className="flex items-center gap-2">
              {historyLoading ? (
                <Loader2
                  className="h-4 w-4 shrink-0 animate-spin text-[#E50914]"
                  aria-label="Loading trade history"
                />
              ) : null}
              <select
                className="h-8 min-w-[140px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-xs text-[var(--input-fg)]"
                value={typeFilter}
                onChange={(event) => {
                  setTypeFilter(event.target.value);
                  setTradeHistoryPage(1);
                }}
              >
                <option value="all">Type: All</option>
                <option value="buy">Type: Buy</option>
                <option value="sell">Type: Sell</option>
                <option value="partial_sell">Type: P-SELL</option>
              </select>
              <select
                className="h-8 min-w-[150px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-xs text-[var(--input-fg)]"
                value={channelFilter}
                onChange={(event) => {
                  setChannelFilter(event.target.value);
                  setTradeHistoryPage(1);
                }}
                title="Filter by simulated paper vs on-chain mainnet legs"
              >
                <option value="all">Channel: All</option>
                <option value="paper">Channel: Paper</option>
                <option value="mainnet">Channel: Mainnet</option>
              </select>
              <select
                className="h-8 min-w-[160px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-xs text-[var(--input-fg)]"
                value={tokenFilter}
                onChange={(event) => {
                  setTokenFilter(event.target.value);
                  setTradeHistoryPage(1);
                }}
              >
                <option value="all">Token: All</option>
                {tokenOptions.map((symbol) => {
                  const ref =
                    openPaperLegs.find((l) => l.symbol === symbol) ??
                    tradeRows.find((t) => t.symbol === symbol);
                  return (
                    <option key={symbol} value={symbol}>
                      {formatPaperTradeTokenLabel({ symbol, baseAsset: ref?.baseAsset })}
                    </option>
                  );
                })}
              </select>
            </div>
          }
        >
          <PaginatedTableContainer
            page={tradeHistorySafePage}
            totalPages={tradeHistoryTotalPages}
            onPageChange={setTradeHistoryPage}
            className="rounded-b-lg border-0 border-t border-[var(--border)]"
          >
            <div className="overflow-x-auto border-b border-[var(--border)]/60">
              <table className="min-w-full w-max table-fixed text-xs">
                <TradeHistoryColGroup />
                <thead className="[&_th]:text-left">
                  <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                    <th className="py-2 pl-2 pr-2">Time</th>
                    <th className="py-2 pl-2 pr-2">Token</th>
                    <th className="py-2 pl-2 pr-2">Type</th>
                    <th className="py-2 pl-2 pr-2">Bet (USDT)</th>
                    <th className="py-2 pl-2 pr-2">Price</th>
                    <th className="py-2 pl-2 pr-2">Lot Size</th>
                    <th className="py-2 pl-2 pr-2">Time Spent</th>
                    <th className="py-2 pl-2 pr-2">Fees</th>
                    <th className="py-2 pl-2 pr-2" title="Full exit: total PnL vs bet. Partial: this clip’s realized $ as % of bet.">
                      PnL (%age)
                    </th>
                    <th className="py-2 pl-2 pr-2">PnL (USDT)</th>
                    <th
                      className="py-2 pl-2 pr-2"
                      title="Partial clip: USDT proceeds. Mainnet: after you Sign sell, the bot re-reads the tx and replaces mark-based amounts with USDT/USDC actually received when possible; if inference fails, compare Solscan."
                    >
                      Proceeds (USDT)
                    </th>
                    <th className="py-2 pl-2 pr-2">Entry/Exit Reason</th>
                    <th className="py-2 pl-2 pr-2">Description</th>
                  </tr>
                </thead>
              </table>
            </div>
            <div className="overflow-x-auto overflow-y-visible">
              <table className="min-w-full w-max table-fixed text-xs">
                <TradeHistoryColGroup />
                <tbody>
                {showTradeHistoryTableLoader ? (
                  <tr>
                    <td className="py-7 px-3" colSpan={13}>
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Loader2
                          className="h-4 w-4 shrink-0 animate-spin text-[#E50914]"
                          aria-hidden
                        />
                        <span className="text-xs text-[var(--text-muted)]">Loading trade history…</span>
                      </div>
                    </td>
                  </tr>
                ) : (typeFilter === "all" ? pagedHistoryEntities.length === 0 : pagedTradeEvents.length === 0) ? (
                  <tr>
                    <td className="py-3 px-3 text-[var(--text-muted)]" colSpan={13}>
                      No trade history for selected filters.
                    </td>
                  </tr>
                ) : typeFilter === "all" ? (
                  pagedHistoryEntities.map((entity, entityIdx) => {
                    const tk = String(entity.tradeKey ?? "");
                    const partialRows = partialRowsByTrade.get(tk) ?? [];
                    const hasP = partialRows.length > 0;
                    const isExpanded = hasP && expandedTradeIds.has(tk);
                    const canTog = hasP;
                    const hasFocusedTrade = expandedTradeIds.size > 0;
                    const isDimmedByFocus = hasFocusedTrade && !expandedTradeIds.has(tk);
                    const buyBorder = entity.sell || hasP ? "border-b-0" : "border-b";
                    /** Open legs and closed legs are separate `tradeKey`s — draw a rule so rows aren’t read as one trade. */
                    const betweenTrades =
                      entityIdx > 0 ? "border-t-2 border-t-[var(--border)]" : "";
                    const buyRowBorder = [betweenTrades, buyBorder].filter(Boolean).join(" ");
                    return (
                      <Fragment key={tk}>
                        <TradeHistoryTableMainRow
                          event={entity.buy}
                          tradeKey={tk}
                          focusRunBotActiveTrade={focusRunBotActiveTrade}
                          canTogglePartials={canTog}
                          isExpanded={isExpanded}
                          isDimmedByFocus={isDimmedByFocus}
                          rowBorderClass={buyRowBorder}
                          onTogglePartials={toggleTradeDetails}
                        />
                        {isExpanded && hasP
                          ? partialRows.map((child, childIndex) => {
                              const last = childIndex === partialRows.length - 1;
                              const partialRowBorder = last && !entity.sell ? "border-b" : "border-b-0";
                              return (
                                <tr
                                  key={child.id}
                                  className={`${partialRowBorder} cursor-pointer border-[var(--border)]/60 bg-[var(--panel-2)]/35 hover:bg-[var(--panel-2)]/25`}
                                  onClick={() => toggleTradeDetails(tk)}
                                >
                                  <td className="py-[3px] pl-3 pr-8 text-right text-[var(--text)] whitespace-nowrap">
                                    {formatTimeOnly(child.time)}
                                  </td>
                                  <td className="py-[3px] px-3 text-[var(--text)]">
                                    <span className="text-[var(--text-muted)]">↳ </span>
                                    <a
                                      href={chartHrefForHistoryEvent(child)}
                                      target="_blank"
                                      rel="noreferrer"
                                      className="text-[#E50914] underline-offset-2 hover:underline"
                                      title={chartLinkTitleForEvent(child)}
                                      onClick={(e) => e.stopPropagation()}
                                    >
                                      {formatPaperTradeTokenLabel({
                                        symbol: child.symbol,
                                        baseAsset: child.baseAsset
                                      })}
                                    </a>
                                  </td>
                                  <td className="py-[3px] px-3">
                                    <span className="mr-[5px] inline-flex rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-amber-700 dark:text-amber-400">
                                      P-SELL
                                    </span>
                                  </td>
                                  <td className="py-[3px] px-3 text-[var(--text-muted)]">N/A</td>
                                  <td className="py-[3px] px-3">
                                    {Number.isFinite(Number(child.price)) ? formatMoney(child.price) : "N/A"}
                                  </td>
                                  <td className="py-[3px] px-2 text-[var(--text)]">
                                    {child.bucketPctOfInitial != null ? `${child.bucketPctOfInitial}%` : "N/A"}
                                  </td>
                                  <td className="py-[3px] px-3 whitespace-nowrap text-[var(--text-muted)]">
                                    {child.timeSpent ?? "N/A"}
                                  </td>
                                  <td className="py-[3px] px-3">
                                    {formatHistoryFeesCell(child.totalFeesUsdt)}
                                  </td>
                                  <td
                                    className={`py-[3px] px-3 text-left font-medium ${
                                      Number(child.pnlUsdt) >= 0 ? "text-emerald-500" : "text-[#e50914]"
                                    }`}
                                  >
                                    {child.pnlPercent != null ? formatPercent(child.pnlPercent) : "N/A"}
                                  </td>
                                  <td
                                    className={`py-[3px] px-3 text-left font-medium ${
                                      Number(child.pnlUsdt) >= 0 ? "text-emerald-500" : "text-[#e50914]"
                                    }`}
                                  >
                                    {Number.isFinite(Number(child.pnlUsdt)) ? formatMoney(child.pnlUsdt) : "N/A"}
                                  </td>
                                  <td className="py-[3px] px-3 tabular-nums text-[var(--text)]">
                                    {child.proceedsUsdt != null && Number.isFinite(Number(child.proceedsUsdt))
                                      ? formatMoney(child.proceedsUsdt)
                                      : "—"}
                                  </td>
                                  <td
                                    className={`py-[3px] px-3 text-left text-[11px] uppercase ${
                                      isDipReason(child) ? "text-[#e50914]" : "text-[var(--text)]"
                                    }`}
                                  >
                                    {displayExitReasonCell(child)}
                                  </td>
                                  <td className="py-[3px] px-3 text-left align-middle text-[11px] leading-snug text-[var(--text)]">
                                    <p
                                      className="line-clamp-3 max-w-full break-words"
                                      title={child.exitDescription != null ? String(child.exitDescription) : undefined}
                                    >
                                      {child.exitDescription ?? "N/A"}
                                    </p>
                                  </td>
                                </tr>
                              );
                            })
                          : null}
                        {entity.sell ? (
                          <TradeHistoryTableMainRow
                            event={entity.sell}
                            tradeKey={tk}
                            focusRunBotActiveTrade={focusRunBotActiveTrade}
                            canTogglePartials={canTog}
                            isExpanded={isExpanded}
                            isDimmedByFocus={isDimmedByFocus}
                            rowBorderClass="border-b"
                            onTogglePartials={toggleTradeDetails}
                          />
                        ) : null}
                      </Fragment>
                    );
                  })
                ) : (
                  pagedTradeEvents.map((event, index) => {
                    const isSell = event.type === "sell";
                    const isPartial = event.type === "partial_sell";
                    const isOpenPosition = Boolean(event.openPosition);
                    const tradeKey = String(event.tradeKey ?? "");
                    const hasPartials = (partialCountByTrade.get(tradeKey) ?? 0) > 0;
                    const canTogglePartials =
                      (isSell || isOpenPosition) && typeFilter !== "partial_sell" && hasPartials;
                    const isExpanded = canTogglePartials && expandedTradeIds.has(tradeKey);
                    const showLivePnl = isSell || isOpenPosition;
                    const showClipPnl = isPartial;
                    const isGain = Number(event.pnlPercent) >= 0;
                    const clipGain = isPartial && Number(event.pnlUsdt) >= 0;
                    const hasPartialPnlPct =
                      isPartial && event.pnlPercent != null && Number.isFinite(Number(event.pnlPercent));
                    const isChildRow = isPartial;
                    const cellPy = isChildRow ? "py-1" : "py-2";
                    const partialRows = partialRowsByTrade.get(tradeKey) ?? [];
                    const shouldRenderPartialChildren = isExpanded && partialRows.length > 0 && (isSell || isOpenPosition);
                    const expandedLabelTone = isExpanded ? "text-[var(--text-muted)]" : "";
                    const hasFocusedTrade = expandedTradeIds.size > 0;
                    const isDimmedByFocus = hasFocusedTrade && !expandedTradeIds.has(tradeKey);
                    const nextEvent = pagedTradeEvents[index + 1];
                    const nextEventSameTrade =
                      nextEvent && String(nextEvent.tradeKey ?? "") === tradeKey && !nextEvent.openPosition;
                    const rowBorderClass = isExpanded || nextEventSameTrade ? "border-b-0" : "border-b";
                    return (
                      <Fragment key={event.id}>
                        <tr
                          className={`border-[var(--border)]/60 ${rowBorderClass} ${isChildRow ? "bg-[var(--panel-2)]/35" : ""} ${canTogglePartials ? "cursor-pointer hover:bg-[var(--panel-2)]/25" : ""} ${isDimmedByFocus ? "opacity-40 blur-[1px]" : ""} transition-[filter,opacity] duration-150`}
                          onClick={canTogglePartials ? () => toggleTradeDetails(tradeKey) : undefined}
                        >
                          <td className={`${cellPy} px-3 ${expandedLabelTone || "text-[var(--text)]"}`}>{formatDateTime(event.time)}</td>
                          <td className={`${cellPy} px-3 ${expandedLabelTone || "text-[var(--text)]"}`}>
                            {isChildRow ? <span className="text-[var(--text-muted)]">↳ </span> : null}
                            <a
                              href={chartHrefForHistoryEvent(event)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-[var(--text)] underline-offset-2 hover:underline"
                              title={chartLinkTitleForEvent(event)}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {formatPaperTradeTokenLabel({
                                symbol: event.symbol,
                                baseAsset: event.baseAsset
                              })}
                            </a>
                          </td>
                          <td className={`${cellPy} px-3 ${isChildRow ? "" : "text-center"}`}>
                            <div className={`${isChildRow ? "inline-flex" : "flex w-full justify-center"} items-center gap-1 whitespace-nowrap`}>
                              <span
                                className={`inline-flex rounded-md border px-2 py-0.5 text-[11px] leading-none font-semibold ${
                                  isSell
                                    ? "border-[#e50914]/30 bg-[#e50914]/10 uppercase text-[#e50914]"
                                    : isPartial
                                      ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                      : isOpenPosition
                                        ? "border-sky-500/30 bg-sky-500/10 uppercase text-sky-600 dark:text-sky-400"
                                        : "border-emerald-500/30 bg-emerald-500/10 uppercase text-emerald-500"
                                }`}
                              >
                                {isOpenPosition ? "buy · open" : isPartial ? "P-SELL" : event.type}
                              </span>
                            </div>
                          </td>
                          <td className={`${cellPy} px-3 ${expandedLabelTone || "text-[var(--text)]"}`}>
                            {isPartial ? (
                              <span className="text-[var(--text-muted)]">N/A</span>
                            ) : isSell && !isPartial ? (
                              <span className="text-[var(--text-muted)]">—</span>
                            ) : typeof event.betUsdt === "number" ? (
                              formatMoney(event.betUsdt)
                            ) : (
                              "N/A"
                            )}
                          </td>
                          <td className={`${cellPy} px-3 ${expandedLabelTone || "text-[var(--text)]"}`}>
                            {Number.isFinite(Number(event.price)) ? formatMoney(event.price) : "N/A"}
                          </td>
                          <td className={`${cellPy} px-2 ${expandedLabelTone || "text-[var(--text)]"}`}>
                            {event.bucketPctOfInitial != null ? `${event.bucketPctOfInitial}%` : "N/A"}
                          </td>
                          <td className={`${cellPy} px-3 ${expandedLabelTone || "text-[var(--text-muted)]"}`}>{event.timeSpent ?? "N/A"}</td>
                          <td className={`${cellPy} px-3`}>
                            {formatHistoryFeesCell(event.totalFeesUsdt)}
                          </td>
                          <td
                            className={`${cellPy} px-3 text-left font-medium ${
                              showLivePnl
                                ? isGain
                                  ? "text-emerald-500"
                                  : "text-[#e50914]"
                                : showClipPnl
                                  ? clipGain
                                    ? "text-emerald-500"
                                    : "text-[#e50914]"
                                  : "text-[var(--text-muted)]"
                            }`}
                          >
                            {showLivePnl
                              ? formatPercent(event.pnlPercent ?? 0)
                              : showClipPnl
                                ? hasPartialPnlPct
                                  ? formatPercent(event.pnlPercent)
                                  : "N/A"
                                : "N/A"}
                          </td>
                          <td
                            className={`${cellPy} px-3 text-left font-medium ${
                              showLivePnl
                                ? isGain
                                  ? "text-emerald-500"
                                  : "text-[#e50914]"
                                : showClipPnl
                                  ? clipGain
                                    ? "text-emerald-500"
                                    : "text-[#e50914]"
                                  : "text-[var(--text-muted)]"
                            }`}
                          >
                            {showLivePnl
                              ? formatMoney(event.pnlUsdt ?? 0)
                              : showClipPnl
                                ? formatMoney(event.pnlUsdt ?? 0)
                                : "N/A"}
                          </td>
                          <td className={`${cellPy} px-3 tabular-nums ${expandedLabelTone || "text-[var(--text)]"}`}>
                            {showClipPnl &&
                            event.proceedsUsdt != null &&
                            Number.isFinite(Number(event.proceedsUsdt))
                              ? formatMoney(event.proceedsUsdt)
                              : "—"}
                          </td>
                          <td
                            className={`break-words ${cellPy} px-3 align-middle text-left text-[11px] ${
                              isDipReason(event) ? "text-[#e50914]" : "text-[var(--text)]"
                            } ${
                              event.exitReasonLabel ? "normal-case" : "uppercase"
                            }`}
                          >
                            {displayExitReasonCell(event)}
                          </td>
                          <td
                            className={`break-words ${cellPy} px-3 align-middle text-[11px] leading-snug ${expandedLabelTone || "text-[var(--text)]"}`}
                          >
                            <TradeHistoryDescriptionCell event={event} focusRunBotActiveTrade={focusRunBotActiveTrade} />
                          </td>
                        </tr>
                        {shouldRenderPartialChildren
                          ? partialRows.map((child, childIndex) => {
                              const isLastChild = childIndex === partialRows.length - 1;
                              const keepBorderAfterChild = isLastChild && !nextEventSameTrade;
                              return (
                              <tr
                                key={child.id}
                                className={`${keepBorderAfterChild ? "border-b" : "border-b-0"} cursor-pointer border-[var(--border)]/60 hover:bg-[var(--panel-2)]/25`}
                                onClick={() => toggleTradeDetails(tradeKey)}
                              >
                                <td className="py-[3px] pl-3 pr-8 text-right text-[var(--text)] whitespace-nowrap">{formatTimeOnly(child.time)}</td>
                                <td className="py-[3px] px-3 text-[var(--text)]">
                                  <a
                                    href={chartHrefForHistoryEvent(child)}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-[#E50914] underline-offset-2 hover:underline"
                                    title={chartLinkTitleForEvent(child)}
                                  >
                                    {formatPaperTradeTokenLabel({
                                      symbol: child.symbol,
                                      baseAsset: child.baseAsset
                                    })}
                                  </a>
                                </td>
                                <td className="py-[3px] px-3">
                                  <span className="mr-[5px] inline-flex rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[11px] leading-none font-semibold text-amber-700 dark:text-amber-400">
                                    P-SELL
                                  </span>
                                </td>
                                <td className="py-[3px] px-3 text-[var(--text-muted)]">N/A</td>
                                <td className="py-[3px] px-3">
                                  {Number.isFinite(Number(child.price)) ? formatMoney(child.price) : "N/A"}
                                </td>
                                <td className="py-[3px] px-2 text-[var(--text)]">
                                  {child.bucketPctOfInitial != null ? `${child.bucketPctOfInitial}%` : "N/A"}
                                </td>
                                <td className="py-[3px] px-3 whitespace-nowrap text-[var(--text-muted)]">{child.timeSpent ?? "N/A"}</td>
                                <td className="py-[3px] px-3">
                                  {formatHistoryFeesCell(child.totalFeesUsdt)}
                                </td>
                                <td
                                  className={`py-[3px] px-3 text-left font-medium ${
                                    Number(child.pnlUsdt) >= 0 ? "text-emerald-500" : "text-[#e50914]"
                                  }`}
                                >
                                  {child.pnlPercent != null ? formatPercent(child.pnlPercent) : "N/A"}
                                </td>
                                <td
                                  className={`py-[3px] px-3 text-left font-medium ${
                                    Number(child.pnlUsdt) >= 0 ? "text-emerald-500" : "text-[#e50914]"
                                  }`}
                                >
                                  {Number.isFinite(Number(child.pnlUsdt)) ? formatMoney(child.pnlUsdt) : "N/A"}
                                </td>
                                <td className="py-[3px] px-3 tabular-nums text-[var(--text)]">
                                  {child.proceedsUsdt != null && Number.isFinite(Number(child.proceedsUsdt))
                                    ? formatMoney(child.proceedsUsdt)
                                    : "—"}
                                </td>
                                <td
                                  className={`py-[3px] px-3 text-left text-[11px] uppercase ${
                                    isDipReason(child) ? "text-[#e50914]" : "text-[var(--text)]"
                                  }`}
                                >
                                  {displayExitReasonCell(child)}
                                </td>
                                <td className="py-[3px] px-3 text-left align-middle text-[11px] leading-snug text-[var(--text)]">
                                  <p
                                    className="line-clamp-3 max-w-full break-words"
                                    title={child.exitDescription != null ? String(child.exitDescription) : undefined}
                                  >
                                    {child.exitDescription ?? "N/A"}
                                  </p>
                                </td>
                              </tr>
                              );
                            })
                          : null}
                      </Fragment>
                    );
                  })
                )}
                </tbody>
              </table>
            </div>
          </PaginatedTableContainer>
        </AccordionSection>
      </CardContent>
    </Card>
  );
}
