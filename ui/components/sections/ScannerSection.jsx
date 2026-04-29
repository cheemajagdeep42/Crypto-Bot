import { Card, CardContent, CardHeader, CardTitle } from "../ui/card";
import { Loader2 } from "lucide-react";
import { formatGainLossPercent, formatUsdtPair } from "../../lib/formatters";
import { Pagination } from "../common/Pagination";

const timeframes = ["30m", "1h", "3h", "6h", "12h", "24h", "3d", "1w", "1mo"];

const signalFilterOptions = [
  { value: "all", label: "All signals" },
  { value: "good_buy", label: "Good buy" },
  { value: "watch", label: "Watch" },
  { value: "bad_buy", label: "Bad buy" }
];

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
  onPageChange
}) {
  const targetRows = 7;
  const hasRows = signals.length > 0;
  const placeholderCount =
    !loading && hasRows ? Math.max(0, targetRows - signals.length) : 0;
  const showEmptyState = !loading && !hasRows;

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
        <div className="relative rounded-lg border border-[var(--border)]">
          {loading ? (
            <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-white/50 dark:bg-black/20">
              <Loader2 className="h-7 w-7 animate-spin text-[#E50914]" />
            </div>
          ) : null}
          <div className="overflow-hidden">
            <table className="min-w-full table-fixed text-sm">
              <thead className="bg-[#f8fafc] text-left text-sm tracking-wide text-[var(--text-muted)]">
                <tr>
                  <th className="h-12 px-3 py-2 align-middle">Token</th>
                  <th className="h-12 px-3 py-2 align-middle">Signal</th>
                  <th className="h-12 px-3 py-2 text-right align-middle">Score</th>
                  <th className="h-12 px-3 py-2 text-right align-middle">Gain/Loss</th>
                  <th className="h-12 px-3 py-2 text-right align-middle">Pullback</th>
                  <th className="h-12 px-3 py-2 text-right align-middle">Spread</th>
                  <th className="h-12 px-3 py-2 text-right align-middle">Volume</th>
                </tr>
              </thead>
              <tbody>
                {showEmptyState ? (
                  <tr className="border-t border-[var(--border)]">
                    <td className="px-3 align-middle" colSpan={7}>
                      <div className="flex min-h-[280px] items-center justify-center text-sm text-[var(--text-muted)]">
                        No data found
                      </div>
                    </td>
                  </tr>
                ) : (
                  <>
                    {signals.map((token) => (
                      <tr key={token.symbol} className="h-14 border-t border-[var(--border)]">
                        <td className="px-3 py-2 align-middle">
                          <p className="text-sm font-medium text-[var(--brand)]">{token.baseAsset}</p>
                          <div className="mt-0.5 flex items-center gap-2 text-xs">
                            <span className="text-[var(--text-muted)]">{formatUsdtPair(token.symbol)}</span>
                            <a
                              className="text-[#E50914] underline-offset-2 hover:underline"
                              href={`https://www.binance.com/en/trade/${token.baseAsset}_USDT?type=spot`}
                              rel="noreferrer"
                              target="_blank"
                            >
                              Chart
                            </a>
                          </div>
                        </td>
                        <td className="px-3 py-2 align-middle">{token.signal ?? "n/a"}</td>
                        <td className="px-3 py-2 text-right align-middle">{token.score ?? "n/a"}</td>
                        <td className="px-3 py-2 text-right align-middle">{formatGainLossPercent(token.gainPercent)}</td>
                        <td className="px-3 py-2 text-right align-middle">{formatGainLossPercent(token.pullbackPercent)}</td>
                        <td className="px-3 py-2 text-right align-middle">{formatGainLossPercent(token.spreadPercent)}</td>
                        <td className="px-3 py-2 text-right align-middle">
                          {typeof token.quoteVolume === "number"
                            ? token.quoteVolume.toLocaleString(undefined, { maximumFractionDigits: 0 })
                            : "n/a"}
                        </td>
                      </tr>
                    ))}
                    {placeholderCount > 0 &&
                      Array.from({ length: placeholderCount }).map((_, index) => (
                        <tr key={`placeholder-${index}`} className="h-14 border-t border-[var(--border)]">
                          <td className="px-3 py-2 align-middle" colSpan={7}>
                            &nbsp;
                          </td>
                        </tr>
                      ))}
                  </>
                )}
              </tbody>
            </table>
          </div>
          <Pagination page={page} totalPages={totalPages} onPageChange={onPageChange} />
        </div>
      </CardContent>
    </Card>
  );
}
