/** USDT bet presets: $0.05…$1.00 in 5¢ steps, then $2…$10 (keep in sync with bff `paperBot` normalize). */

export const BET_AMOUNT_USDT_OPTIONS = (() => {
  const out = [];
  for (let i = 1; i <= 20; i += 1) {
    out.push(Number((i * 0.05).toFixed(2)));
  }
  for (let x = 2; x <= 10; x += 1) {
    out.push(x);
  }
  return out;
})();

const DEFAULT_BET_USDT = 5;

export function snapBetAmountUsdt(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_BET_USDT;
  let best = BET_AMOUNT_USDT_OPTIONS[0];
  let bestDist = Math.abs(best - n);
  for (const v of BET_AMOUNT_USDT_OPTIONS) {
    const d = Math.abs(v - n);
    if (d < bestDist) {
      best = v;
      bestDist = d;
    }
  }
  return best;
}
