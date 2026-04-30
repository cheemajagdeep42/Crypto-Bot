import { useMemo, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { formatMoney, formatPercent, formatUsdtPair } from "../../lib/formatters";
import { useUiStore } from "../../stores/useUiStore";

function formatDateTime(value) {
  if (!value) return "n/a";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

function levelClasses(level) {
  if (level === "error") return "bg-[#e50914]/10 text-[#e50914] border-[#e50914]/30";
  if (level === "warn") return "bg-amber-500/10 text-amber-500 border-amber-500/30";
  return "bg-emerald-500/10 text-emerald-500 border-emerald-500/30";
}

function formatDuration(start, end) {
  if (!start || !end) return "n/a";
  const startTs = new Date(start).getTime();
  const endTs = new Date(end).getTime();
  if (Number.isNaN(startTs) || Number.isNaN(endTs) || endTs < startTs) return "n/a";
  const totalSeconds = Math.floor((endTs - startTs) / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours <= 0 && minutes <= 0) return `${seconds}s`;
  if (hours <= 0) return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  return `${hours}h ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function exitReasonDescription(reason, tradeContext) {
  const map = {
    take_profit: "Target profit reached from staged take-profit exits.",
    stop_loss: "Stopped out because drawdown crossed configured stop-loss.",
    time_stop: "Closed due to max hold time rule.",
    manual: "Manually closed by user action.",
    break_even: "Break-even protection triggered after profits.",
    red_dip: "Closed on sharp pullback after momentum faded.",
    dip_retrace: "Closed on full exit from entry→peak retracement rule (or final step sold 100% of remainder)."
  };
  let base = map[reason] ?? "No exit reason description available.";
  if (reason === "break_even" && tradeContext) {
    const extra = breakEvenMetricsSentence(tradeContext);
    if (extra) base = `${base} ${extra}`;
  }
  return base;
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
  if (!event.exitReason) return "n/a";
  return String(event.exitReason).replace(/_/g, " ").toUpperCase();
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

function AccordionBlock({ title, isOpen, onToggle, headerRight, children }) {
  return (
    <section className="rounded-lg border border-[var(--border)]">
      <div className="flex min-h-[56px] w-full items-center justify-between px-4 py-3 text-left">
        <span className="text-sm font-medium text-[var(--text)]">{title}</span>
        <div className="ml-auto flex items-center gap-2">
          {isOpen ? headerRight : null}
          <button type="button" onClick={onToggle} className="cursor-pointer" aria-label={`${isOpen ? "Collapse" : "Expand"} ${title}`}>
            <ChevronDown
              className={`h-5 w-5 text-[var(--text-muted)] transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>
      {isOpen ? <div className="px-0 pb-0">{children}</div> : null}
    </section>
  );
}

export function HistorySection({ logs, tradeHistory, activeTrade }) {
  const focusRunBotActiveTrade = useUiStore((s) => s.focusRunBotActiveTrade);
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
  const tradeRows = tradeHistory ?? [];
  const [isSystemLogsOpen, setIsSystemLogsOpen] = useState(true);
  const [isTradeHistoryOpen, setIsTradeHistoryOpen] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [tokenFilter, setTokenFilter] = useState("all");
  const [expandedTradeIds, setExpandedTradeIds] = useState(() => new Set());

  const tokenOptions = useMemo(() => {
    const ordered = [];
    const seen = new Set();
    if (activeTrade?.symbol) {
      ordered.push(activeTrade.symbol);
      seen.add(activeTrade.symbol);
    }
    /** tradeHistory is newest-first; first unseen symbol = most recently closed among remaining. */
    for (const trade of tradeRows) {
      const sym = trade.symbol;
      if (!sym || seen.has(sym)) continue;
      ordered.push(sym);
      seen.add(sym);
    }
    return ordered;
  }, [tradeRows, activeTrade?.symbol]);

  const tradeEvents = useMemo(() => {
    const partialRowsFromTrade = (trade, idPrefix) => {
      const q0 = initialOpenBucketQuantity(trade);
      const groupKey = tradeGroupKey(trade);
      return (trade.partialFills ?? []).map((pf, idx) => ({
        id: `${idPrefix}-partial-${idx}-${pf.time}`,
        tradeKey: groupKey,
        time: pf.time,
        type: "partial_sell",
        symbol: trade.symbol,
        price: pf.price,
        betUsdt: trade.positionSizeUsdt,
        pnlPercent: clipPnlPercentOfBet(pf.realizedUsdt, trade.positionSizeUsdt),
        pnlUsdt: pf.realizedUsdt,
        exitReason:
          pf.mode === "tp_step"
            ? `tp +${pf.stepPercent}%`
            : pf.mode === "dip_retrace"
              ? `retrace ${pf.stepPercent}%`
              : `dip ${pf.stepPercent}%`,
        exitDescription: `Partial-SELL: ${(pf.fractionOfRemaining * 100).toFixed(0)}% of remaining @ ${formatMoney(
          pf.price
        )}. Realized on clip: ${formatMoney(pf.realizedUsdt)}.`,
        timeSpent: null,
        totalFeesUsdt: null,
        openPosition: false,
        bucketPctOfInitial: bucketPctOfInitialSold(pf.quantitySold, q0)
      }));
    };

    const events = tradeRows.flatMap((trade) => {
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

      const openEvent = {
        id: `${rowIdPrefix}-buy`,
        tradeKey: groupKey,
        time: trade.openedAt,
        type: "buy",
        symbol: trade.symbol,
        price: trade.entryPrice,
        betUsdt,
        pnlPercent: null,
        pnlUsdt: null,
        exitReason: null,
        exitDescription: null,
        timeSpent: null,
        totalFeesUsdt: trade.totalFeesUsdt ?? null,
        openPosition: false,
        bucketPctOfInitial: null
      };
      const closeEvent = {
        id: `${rowIdPrefix}-sell`,
        tradeKey: groupKey,
        time: trade.closedAt,
        type: "sell",
        symbol: trade.symbol,
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
        exitDescription: exitReasonDescription(trade.exitReason, {
          entryPrice: trade.entryPrice,
          exitPrice: trade.exitPrice,
          peakPrice: trade.peakPrice
        }),
        timeSpent: formatDuration(trade.openedAt, trade.closedAt),
        totalFeesUsdt: trade.totalFeesUsdt ?? null,
        openPosition: false,
        bucketPctOfInitial: closeBucketPct
      };
      return [openEvent, ...partialRowsFromTrade(trade, rowIdPrefix), closeEvent];
    });

    const openActive =
      activeTrade && activeTrade.status === "open"
        ? [
            {
              id: `${activeTrade.id}-buy-active`,
              tradeKey: tradeGroupKey(activeTrade),
              time: activeTrade.openedAt,
              type: "buy",
              symbol: activeTrade.symbol,
              price: activeTrade.entryPrice,
              betUsdt: activeTrade.positionSizeUsdt,
              pnlPercent: activeTrade.pnlPercent,
              pnlUsdt: activeTrade.pnlUsdt,
              exitReason: "open",
              exitDescription: null,
              timeSpent: formatDuration(activeTrade.openedAt, new Date().toISOString()),
              totalFeesUsdt: activeTrade.totalFeesUsdt ?? null,
              openPosition: true,
              bucketPctOfInitial: null
            },
            ...partialRowsFromTrade(activeTrade, activeTrade.id || tradeGroupKey(activeTrade))
          ]
        : [];

    return [...openActive, ...events]
      .filter((event) => event.time)
      .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime());
  }, [tradeRows, activeTrade]);

  const filteredTradeEvents = tradeEvents.filter((event) => {
    const matchType = typeFilter === "all" || event.type === typeFilter;
    const matchToken = tokenFilter === "all" || event.symbol === tokenFilter;
    return matchType && matchToken;
  });
  const displayedTradeEvents = useMemo(() => {
    if (typeFilter === "partial_sell") return filteredTradeEvents;

    const partialsByTrade = new Map();
    for (const event of filteredTradeEvents) {
      if (event.type !== "partial_sell") continue;
      const key = String(event.tradeKey ?? "");
      if (!partialsByTrade.has(key)) partialsByTrade.set(key, []);
      partialsByTrade.get(key).push(event);
    }

    const baseRows = filteredTradeEvents.filter((event) => event.type !== "partial_sell");
    const rows = [];
    for (const event of baseRows) {
      rows.push(event);
      if (event.type === "sell" || (event.type === "buy" && event.openPosition)) {
        const key = String(event.tradeKey ?? "");
        if (expandedTradeIds.has(key)) {
          const partials = partialsByTrade.get(key) ?? [];
          rows.push(...partials);
        }
      }
    }
    return rows;
  }, [filteredTradeEvents, expandedTradeIds, typeFilter]);
  const partialCountByTrade = useMemo(() => {
    const counts = new Map();
    for (const event of filteredTradeEvents) {
      if (event.type !== "partial_sell") continue;
      const key = String(event.tradeKey ?? "");
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [filteredTradeEvents]);

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

  return (
    <Card className="min-h-[calc(100vh-180px)]">
      <CardContent className="space-y-5 pt-3">
        <AccordionBlock
          title="System Logs"
          isOpen={isSystemLogsOpen}
          onToggle={() => setIsSystemLogsOpen((prev) => !prev)}
        >
          <div className="max-h-[280px] overflow-y-auto rounded-b-lg border-t border-[var(--border)]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--panel)]">
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Level</th>
                  <th className="py-2 px-3">Description</th>
                </tr>
              </thead>
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
                      <td className="py-2 px-3 text-[var(--text-muted)]">{formatDateTime(log.time)}</td>
                      <td className="py-2 px-3">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${levelClasses(log.level)}`}
                        >
                          {log.level}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-[var(--text)]">{log.message}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </AccordionBlock>

        <AccordionBlock
          title="Trade History"
          isOpen={isTradeHistoryOpen}
          onToggle={() => setIsTradeHistoryOpen((prev) => !prev)}
          headerRight={
            <div className="flex items-center gap-2">
              <select
                className="h-8 min-w-[140px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-xs text-[var(--input-fg)]"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
              >
                <option value="all">Type: All</option>
                <option value="buy">Type: Buy</option>
                <option value="sell">Type: Sell</option>
                <option value="partial_sell">Type: Partial-SELL</option>
              </select>
              <select
                className="h-8 min-w-[160px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-xs text-[var(--input-fg)]"
                value={tokenFilter}
                onChange={(event) => setTokenFilter(event.target.value)}
              >
                <option value="all">Token: All</option>
                {tokenOptions.map((symbol) => (
                  <option key={symbol} value={symbol}>
                    {formatUsdtPair(symbol)}
                  </option>
                ))}
              </select>
            </div>
          }
        >
          <div className="max-h-[300px] overflow-y-auto rounded-b-lg border-t border-[var(--border)]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-[var(--panel)]">
                <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                  <th className="py-2 px-3">Time</th>
                  <th className="py-2 px-3">Type</th>
                  <th className="py-2 px-3">Token</th>
                  <th className="py-2 px-3 text-right">Bet (USDT)</th>
                  <th className="py-2 px-3 text-right">Price</th>
                  <th className="max-w-[11rem] py-2 px-3 align-top">Exit Reason</th>
                  <th className="w-[22rem] max-w-[22rem] py-2 px-3 align-top">Exit Description</th>
                  <th className="py-2 px-3 text-right">%age of Bucket</th>
                  <th className="py-2 px-3">Time Spent</th>
                  <th className="py-2 px-3 text-right">Fees</th>
                  <th className="py-2 px-3 text-right" title="Full exit: total PnL vs bet. Partial: this clip’s realized $ as % of bet.">
                    PnL %
                  </th>
                  <th className="py-2 px-3 text-right">PnL USDT</th>
                </tr>
              </thead>
              <tbody>
                {displayedTradeEvents.length === 0 ? (
                  <tr>
                    <td className="py-3 px-3 text-[var(--text-muted)]" colSpan={12}>
                      No trade history for selected filters.
                    </td>
                  </tr>
                ) : (
                  displayedTradeEvents.map((event) => {
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
                    return (
                      <tr
                        key={event.id}
                        className={`border-b border-[var(--border)]/60 ${isChildRow ? "bg-[var(--panel-2)]/35" : ""}`}
                      >
                        <td className={`${cellPy} px-3 text-[var(--text-muted)]`}>{formatDateTime(event.time)}</td>
                        <td className={`${cellPy} px-3`}>
                          <div className="inline-flex items-center gap-1 whitespace-nowrap">
                            <span
                              className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                                isSell
                                  ? "border-[#e50914]/30 bg-[#e50914]/10 uppercase text-[#e50914]"
                                  : isPartial
                                    ? "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                    : isOpenPosition
                                      ? "border-sky-500/30 bg-sky-500/10 uppercase text-sky-600 dark:text-sky-400"
                                      : "border-emerald-500/30 bg-emerald-500/10 uppercase text-emerald-500"
                              }`}
                            >
                              {isOpenPosition ? "buy · open" : isPartial ? "Partial-SELL" : event.type}
                            </span>
                          {canTogglePartials ? (
                            <button
                              type="button"
                              className="inline-flex rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/20"
                              onClick={(e) => {
                                e.stopPropagation();
                                toggleTradeDetails(tradeKey);
                              }}
                            >
                              {isExpanded ? "Hide Details" : "Details"}
                            </button>
                          ) : null}
                          </div>
                        </td>
                        <td className={`${cellPy} px-3 text-[var(--text)]`}>
                          {isChildRow ? <span className="text-[var(--text-muted)]">↳ </span> : null}
                          {formatUsdtPair(event.symbol)}
                        </td>
                        <td className={`${cellPy} px-3 text-right text-[var(--text)]`}>
                          {typeof event.betUsdt === "number" ? formatMoney(event.betUsdt) : "n/a"}
                        </td>
                        <td className={`${cellPy} px-3 text-right`}>{formatMoney(event.price)}</td>
                        <td
                          className={`max-w-[11rem] break-words ${cellPy} px-3 align-top text-[var(--text)] text-xs sm:text-sm ${
                            event.exitReasonLabel ? "normal-case" : "uppercase"
                          }`}
                        >
                          {displayExitReasonCell(event)}
                        </td>
                        <td className={`w-[22rem] max-w-[22rem] break-words ${cellPy} px-3 align-top text-[var(--text)]`}>
                          {event.openPosition ? (
                            <div className="flex flex-wrap items-center gap-2">
                              <span>Position still open.</span>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 shrink-0 px-2 text-xs"
                                onClick={() => focusRunBotActiveTrade()}
                              >
                                Details
                              </Button>
                            </div>
                          ) : (
                            event.exitDescription ?? "n/a"
                          )}
                        </td>
                        <td className={`${cellPy} px-3 text-right text-[var(--text)]`}>
                          {event.bucketPctOfInitial != null ? `${event.bucketPctOfInitial}%` : "—"}
                        </td>
                        <td className={`${cellPy} px-3 text-[var(--text-muted)]`}>{event.timeSpent ?? "n/a"}</td>
                        <td className={`${cellPy} px-3 text-right`}>{formatMoney(event.totalFeesUsdt ?? 0)}</td>
                        <td
                          className={`${cellPy} px-3 text-right font-medium ${
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
                                : "—"
                              : "n/a"}
                        </td>
                        <td
                          className={`${cellPy} px-3 text-right font-medium ${
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
                              : "n/a"}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </AccordionBlock>
      </CardContent>
    </Card>
  );
}
