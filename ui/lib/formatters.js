export function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1 ? 2 : 8
  }).format(value ?? 0);
}

export function formatPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  return `${Number(value).toFixed(2)}%`;
}

export function formatGainLossPercent(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "n/a";
  const numeric = Number(value);
  const sign = numeric > 0 ? "+" : "";
  return `${sign}${numeric.toFixed(2)}%`;
}

export function formatUsdtPair(symbol) {
  if (!symbol) return "";
  if (symbol.endsWith("USDT")) {
    return `${symbol.slice(0, -4)}/USDT`;
  }
  return symbol;
}

/** `metric`: which gain field to show/sort — scan `window` = `gainPercent`. */
export function getTokenGainSortValue(token, metric) {
  if (!token) return null;
  switch (metric) {
    case "m5":
      return token.fiveMinuteChangePercent;
    case "m10":
      return token.gainLoss10mPercent;
    case "m30":
      return token.gainLoss30mPercent;
    case "window":
    default:
      return token.gainPercent;
  }
}
