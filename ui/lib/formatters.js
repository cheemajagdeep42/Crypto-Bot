export function formatMoney(value) {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: value >= 1 ? 2 : 8
  }).format(value ?? 0);
}

export function formatAud(value) {
  return new Intl.NumberFormat("en-AU", {
    style: "currency",
    currency: "AUD",
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

/**
 * Human-readable token for open bot legs: Binance-style `BTC/USDT`, Dex `TICKER · sim`.
 * "sim" = bot-simulated book (DexScreener USD price), not your Phantom/on-chain balance — even if Execution mode is Live for Jupiter.
 * Dex scans use synthetic `DS_{base}_{pairPrefix}` symbols — prefer `baseAsset` for display.
 * @param {{ symbol?: string; baseAsset?: string } | null | undefined} trade
 */
export function formatPaperTradeTokenLabel(trade) {
  if (!trade) return "—";
  const sym = String(trade.symbol ?? "").trim();
  const base = trade.baseAsset != null ? String(trade.baseAsset).trim() : "";
  const isDexSynthetic = sym.startsWith("DS_");
  if (sym.endsWith("USDT") && !isDexSynthetic) {
    return formatUsdtPair(sym);
  }
  if (base) {
    return isDexSynthetic || !sym.endsWith("USDT") ? `${base} · sim` : `${base}/USDT`;
  }
  return formatUsdtPair(sym) || sym || "—";
}

/** DexScreener `pairListedAtMs` → compact age since pool creation. */
export function formatPairAge(listedAtMs) {
  if (listedAtMs == null || !Number.isFinite(Number(listedAtMs))) return "—";
  const ms = Number(listedAtMs);
  const ageMs = Math.max(0, Date.now() - ms);
  const mins = ageMs / 60000;
  if (mins < 1) return "<1m";
  if (mins < 60) return `${Math.round(mins)}m`;
  const hrs = mins / 60;
  if (hrs < 48) return `${Math.round(hrs)}h`;
  const days = hrs / 24;
  if (days < 60) return `${Math.round(days)}d`;
  const mo = days / 30.4375;
  if (mo < 24) return `${Math.round(mo)}mo`;
  const yrs = days / 365.25;
  const y = Math.round(yrs * 10) / 10;
  return `${y}y`;
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
