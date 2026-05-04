"use client";

import { useMemo, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Loader2 } from "lucide-react";
import {
  formatGainLossPercent,
  formatPairAge,
  formatUsdtPair,
  getTokenGainSortValue
} from "../../lib/formatters";
import { PaginatedTableContainer } from "../common/PaginatedTableContainer";

const timeframes = ["30m", "1h", "3h", "6h", "12h", "24h", "3d", "1w", "1mo"];

const signalFilterOptions = [
  { value: "all", label: "All signals" },
  { value: "good_buy", label: "Good buy" },
  { value: "watch", label: "Watch" },
  { value: "bad_buy", label: "Bad buy" }
];

/** DexScreener pair page or Binance spot — used as chart/deep link for scanned rows. */
function chartHrefForToken(token) {
  const dex = token?.metadata?.dexUrl;
  const link = token?.links?.binance;
  const base = typeof token?.baseAsset === "string" ? token.baseAsset.trim() : "";
  return (
    (typeof dex === "string" && dex.trim()) ||
    (typeof link === "string" && link.trim()) ||
    (base ? `https://www.binance.com/en/trade/${base}_USDT?type=spot` : "#")
  );
}

export function ScannerSection({
  signals,
  statusText,
  limit,
  timeframe,
  signalFilter = "all",
  onSignalFilterChange,
  loading,
  page,
  totalPages,
  onLimitChange,
  onTimeframeChange,
  onPageChange,
  showPairAgeColumn = false
}) {
  const [gainSortMetric, setGainSortMetric] = useState("window");
  const [gainSortDirection, setGainSortDirection] = useState(null);

  const sortedSignals = useMemo(() => {
    const toNum = (v) =>
      v != null && Number.isFinite(Number(v)) ? Number(v) : Number.NEGATIVE_INFINITY;
    if (!gainSortDirection) return signals;
    return [...signals].sort((a, b) =>
      gainSortDirection === "asc"
        ? toNum(getTokenGainSortValue(a, gainSortMetric)) -
            toNum(getTokenGainSortValue(b, gainSortMetric))
        : toNum(getTokenGainSortValue(b, gainSortMetric)) -
            toNum(getTokenGainSortValue(a, gainSortMetric))
    );
  }, [signals, gainSortDirection, gainSortMetric]);

  const targetRows = 7;
  const hasRows = signals.length > 0;
  const placeholderCount =
    !loading && hasRows ? Math.max(0, targetRows - signals.length) : 0;
  const showEmptyState = !loading && !hasRows;
  const colCount = 8 + (showPairAgeColumn ? 1 : 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-[var(--text)]">Market</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <select
            className="h-9 min-w-[150px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--input-fg)]"
            value={signalFilter}
            onChange={(event) => onSignalFilterChange?.(event.target.value)}
          >
            {signalFilterOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          <select
            className="h-9 min-w-[160px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--input-fg)]"
            value={limit}
            onChange={(event) => onLimitChange(Number(event.target.value))}
          >
            {[5, 10, 15, 20].map((value) => (
              <option key={value} value={value}>
                {value} tokens
              </option>
            ))}
          </select>
          <select
            className="h-9 min-w-[140px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--input-fg)]"
            value={timeframe}
            onChange={(event) => onTimeframeChange(event.target.value)}
          >
            {timeframes.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-[var(--text-muted)]">{statusText}</p>
        <div className="relative">
          {loading ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/50 dark:bg-black/20">
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-[#E50914]" aria-hidden />
            </div>
          ) : null}
          <PaginatedTableContainer page={page} totalPages={totalPages} onPageChange={onPageChange}>
            <table className="min-w-full table-fixed text-sm">
              <thead className="bg-[#f8fafc] text-left text-sm tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th className="h-12 px-3 py-2 align-middle">Token</th>
                  <th className="h-12 px-3 py-2 align-middle">Signal</th>
                  <th className="h-12 px-3 py-2 text-right align-middle">Score</th>
                  <th
                    className="h-12 px-3 py-2 align-middle text-right"
                    title={`“Match scan” uses the timeframe from the toolbar above (${timeframe}). Other options show 5m / 10m / 30m only.`}
                  >
                    <div className="inline-flex flex-wrap items-center justify-end gap-1">
                      <select
                        className="h-7 max-w-[6.5rem] rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1 text-[10px] text-[var(--input-fg)]"
                        value={gainSortMetric}
                        onChange={(e) => setGainSortMetric(e.target.value)}
                      >
                        <option value="window">Match scan</option>
                        <option value="m5">5m</option>
                        <option value="m10">10m</option>
                        <option value="m30">30m</option>
                      </select>
                      <button
                        type="button"
                        className="inline-flex shrink-0 items-center rounded border border-transparent px-0.5 text-[var(--text-muted)] hover:border-[var(--border)]"
                        onClick={() =>
                          setGainSortDirection((prev) =>
                            prev === null ? "desc" : prev === "desc" ? "asc" : null
                          )
                        }
                        aria-label="Sort by gain/loss"
                      >
                        <span className="text-[10px] leading-none">
                          {gainSortDirection === "desc"
                            ? "▼"
                            : gainSortDirection === "asc"
                              ? "▲"
                              : "↕"}
                        </span>
                      </button>
                    </div>
                  </th>
                  {showPairAgeColumn ? (
                    <th
                      className="h-12 px-3 py-2 text-right align-middle whitespace-nowrap"
                      title="Time since the DEX pool was created (DexScreener pairCreatedAt)."
                    >
                      Pair age
                    </th>
                  ) : null}
                  <th className="h-12 px-3 py-2 text-right align-middle">Pullback</th>
                  <th className="h-12 px-3 py-2 text-right align-middle">Spread</th>
                  <th
                    className="h-12 px-3 py-2 text-right align-middle"
                    title="Volume for selected timeframe, not 5m guard."
                  >
                    Vol (window)
                  </th>
                  <th
                    className="h-12 px-3 py-2 text-right align-middle"
                    title="Latest 5m quote volume (USDT)."
                  >
                    Vol (5m)
                  </th>
                </tr>
              </thead>
              <tbody>
                {showEmptyState ? (
                  <tr className="border-t border-[var(--border)]">
                    <td className="px-3 align-middle" colSpan={colCount}>
                      <div className="flex min-h-[280px] items-center justify-center text-sm text-[var(--text-muted)]">
                        No data found
                      </div>
                    </td>
                  </tr>
                ) : (
                  <>
                    {sortedSignals.map((token) => (
                      <tr key={token.symbol} className="h-14 border-t border-[var(--border)]">
                        <td className="px-3 py-2 align-middle">
                          <p className="text-sm font-medium">
                            <a
                              className="text-[var(--brand)] underline-offset-2 hover:underline"
                              href={chartHrefForToken(token)}
                              target="_blank"
                              rel="noreferrer"
                              title="Open chart / pair page"
                            >
                              {token.baseAsset}
                            </a>
                          </p>
                          <div className="mt-0.5 text-xs text-[var(--text-muted)]">
                            {formatUsdtPair(token.symbol)}
                          </div>
                        </td>
                        <td className="px-3 py-2 align-middle">{token.signal ?? "n/a"}</td>
                        <td className="px-3 py-2 text-right align-middle">{token.score ?? "n/a"}</td>
                        <td className="px-3 py-2 text-right align-middle">
                          {formatGainLossPercent(getTokenGainSortValue(token, gainSortMetric))}
                        </td>
                        {showPairAgeColumn ? (
                          <td className="px-3 py-2 text-right align-middle tabular-nums whitespace-nowrap">
                            {formatPairAge(token.pairListedAtMs)}
                          </td>
                        ) : null}
                        <td className="px-3 py-2 text-right align-middle">{formatGainLossPercent(token.pullbackPercent)}</td>
                        <td className="px-3 py-2 text-right align-middle">{formatGainLossPercent(token.spreadPercent)}</td>
                        <td className="px-3 py-2 text-right align-middle">
                          {typeof token.quoteVolume === "number"
                            ? token.quoteVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })
                            : "n/a"}
                        </td>
                        <td className="px-3 py-2 text-right align-middle">
                          {typeof token.fiveMinuteQuoteVolumeUsdt === "number"
                            ? token.fiveMinuteQuoteVolumeUsdt.toLocaleString(undefined, {
                                maximumFractionDigits: 0,
                              })
                            : "n/a"}
                        </td>
                      </tr>
                    ))}
                    {placeholderCount > 0 &&
                      Array.from({ length: placeholderCount }).map((_, index) => (
                        <tr key={`placeholder-${index}`} className="h-14 border-t border-[var(--border)]">
                          <td className="px-3 py-2 align-middle" colSpan={colCount}>
                            &nbsp;
                          </td>
                        </tr>
                      ))}
                  </>
                )}
              </tbody>
            </table>
          </PaginatedTableContainer>
        </div>
      </CardContent>
    </Card>
  );
}
