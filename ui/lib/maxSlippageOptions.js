/** Max slippage % for swaps (live); UI presets 0.5…10 in 0.5% steps. Keep in sync with `paperBot` normalize. */

export const MAX_SLIPPAGE_PERCENT_OPTIONS = (() => {
  const out = [];
  for (let i = 1; i <= 20; i += 1) {
    out.push(Number((i * 0.5).toFixed(1)));
  }
  return out;
})();

const DEFAULT_MAX_SLIPPAGE_PERCENT = 2;

export function snapMaxSlippagePercent(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_MAX_SLIPPAGE_PERCENT;
  let best = MAX_SLIPPAGE_PERCENT_OPTIONS[0];
  let bestDist = Math.abs(best - n);
  for (const v of MAX_SLIPPAGE_PERCENT_OPTIONS) {
    const d = Math.abs(v - n);
    if (d < bestDist) {
      best = v;
      bestDist = d;
    }
  }
  return best;
}
