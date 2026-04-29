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
  return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
}

function exitReasonDescription(reason) {
  const map = {
    take_profit: "Target profit reached from staged take-profit exits.",
    stop_loss: "Stopped out because drawdown crossed configured stop-loss.",
    time_stop: "Closed due to max hold time rule.",
    manual: "Manually closed by user action.",
    break_even: "Break-even protection triggered after profits.",
    red_dip: "Closed on sharp pullback after momentum faded."
  };
  return map[reason] ?? "No exit reason description available.";
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
  const logRows = logs ?? [];
  const tradeRows = tradeHistory ?? [];
  const [isSystemLogsOpen, setIsSystemLogsOpen] = useState(true);
  const [isTradeHistoryOpen, setIsTradeHistoryOpen] = useState(true);
  const [typeFilter, setTypeFilter] = useState("all");
  const [tokenFilter, setTokenFilter] = useState("all");

  const tokenOptions = useMemo(() => {
    const unique = Array.from(new Set(tradeRows.map((trade) => trade.symbol).filter(Boolean)));
    return unique.sort();
  }, [tradeRows]);

  const tradeEvents = useMemo(() => {
    const events = tradeRows.flatMap((trade) => {
      const betUsdt = trade.positionSizeUsdt;
      const openEvent = {
        id: `${trade.id}-buy`,
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
        openPosition: false
      };
      const closeEvent = {
        id: `${trade.id}-sell`,
        time: trade.closedAt,
        type: "sell",
        symbol: trade.symbol,
        price: trade.exitPrice,
        betUsdt,
        pnlPercent: trade.pnlPercent,
        pnlUsdt: trade.pnlUsdt,
        exitReason: trade.exitReason ?? null,
        exitDescription: exitReasonDescription(trade.exitReason),
        timeSpent: formatDuration(trade.openedAt, trade.closedAt),
        totalFeesUsdt: trade.totalFeesUsdt ?? null,
        openPosition: false
      };
      return [openEvent, closeEvent];
    });

    const openActive =
      activeTrade && activeTrade.status === "open"
        ? [
            {
              id: `${activeTrade.id}-buy-active`,
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
              openPosition: true
            }
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
                  <th className="py-2 px-3">Exit Reason</th>
                  <th className="py-2 px-3">Exit Description</th>
                  <th className="py-2 px-3">Time Spent</th>
                  <th className="py-2 px-3 text-right">Fees</th>
                  <th className="py-2 px-3 text-right">PnL %</th>
                  <th className="py-2 px-3 text-right">PnL USDT</th>
                </tr>
              </thead>
              <tbody>
                {filteredTradeEvents.length === 0 ? (
                  <tr>
                    <td className="py-3 px-3 text-[var(--text-muted)]" colSpan={11}>
                      No trade history for selected filters.
                    </td>
                  </tr>
                ) : (
                  filteredTradeEvents.map((event) => {
                    const isSell = event.type === "sell";
                    const isOpenPosition = Boolean(event.openPosition);
                    const showLivePnl = isSell || isOpenPosition;
                    const isGain = Number(event.pnlPercent) >= 0;
                    return (
                      <tr key={event.id} className="border-b border-[var(--border)]/60">
                        <td className="py-2 px-3 text-[var(--text-muted)]">{formatDateTime(event.time)}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase ${
                              isSell
                                ? "border-[#e50914]/30 bg-[#e50914]/10 text-[#e50914]"
                                : isOpenPosition
                                  ? "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-400"
                                  : "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
                            }`}
                          >
                            {isOpenPosition ? "buy · open" : event.type}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-[var(--text)]">{formatUsdtPair(event.symbol)}</td>
                        <td className="py-2 px-3 text-right text-[var(--text)]">
                          {typeof event.betUsdt === "number" ? formatMoney(event.betUsdt) : "n/a"}
                        </td>
                        <td className="py-2 px-3 text-right">{formatMoney(event.price)}</td>
                        <td className="py-2 px-3 uppercase text-[var(--text)]">{event.exitReason ?? "n/a"}</td>
                        <td className="max-w-[360px] py-2 px-3 text-[var(--text)]">
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
                        <td className="py-2 px-3 text-[var(--text-muted)]">{event.timeSpent ?? "n/a"}</td>
                        <td className="py-2 px-3 text-right">{formatMoney(event.totalFeesUsdt ?? 0)}</td>
                        <td
                          className={`py-2 px-3 text-right font-medium ${
                            showLivePnl ? (isGain ? "text-emerald-500" : "text-[#e50914]") : "text-[var(--text-muted)]"
                          }`}
                        >
                          {showLivePnl ? formatPercent(event.pnlPercent ?? 0) : "n/a"}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-medium ${
                            showLivePnl ? (isGain ? "text-emerald-500" : "text-[#e50914]") : "text-[var(--text-muted)]"
                          }`}
                        >
                          {showLivePnl ? formatMoney(event.pnlUsdt ?? 0) : "n/a"}
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
