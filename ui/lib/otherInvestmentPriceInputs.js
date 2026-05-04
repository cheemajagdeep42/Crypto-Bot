const STORAGE_KEY = "other-investments-price-inputs-v1";

/** @typedef {{ buy?: string; current?: string }} PriceDraft */

/** @returns {Record<string, PriceDraft>} */
export function loadOtherInvestmentPriceInputs() {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    return parsed;
  } catch {
    return {};
  }
}

/** @param {Record<string, PriceDraft>} map */
export function saveOtherInvestmentPriceInputs(map) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    /* ignore */
  }
}

/**
 * PnL (AUD) from cost basis = totalInvested, avg buy price per unit, and current price per unit.
 * units = totalInvested / buyPrice; marketValue = units * currentPrice; PnL = marketValue - totalInvested.
 *
 * @param {{ totalInvested: number; buyPriceAud?: number | null }} row
 * @param {string} buyStr - from input or empty → falls back to row.buyPriceAud
 * @param {string} currentStr
 * @returns {number | null}
 */
export function computeOtherInvestmentPnl(row, buyStr, currentStr) {
  const invested = Number(row.totalInvested);
  const buyParsed = Number(String(buyStr ?? "").replace(/,/g, "").trim());
  const buy =
    Number.isFinite(buyParsed) && buyParsed > 0
      ? buyParsed
      : Number(row.buyPriceAud) > 0
        ? Number(row.buyPriceAud)
        : NaN;
  const current = Number(String(currentStr ?? "").replace(/,/g, "").trim());
  if (!Number.isFinite(invested) || invested <= 0 || !Number.isFinite(buy) || buy <= 0 || !Number.isFinite(current)) {
    return null;
  }
  const units = invested / buy;
  const marketValue = units * current;
  return marketValue - invested;
}
