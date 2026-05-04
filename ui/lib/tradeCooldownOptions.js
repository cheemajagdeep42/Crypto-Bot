/** Keep in sync with `bff/src/paperBot.ts` TRADE_COOLDOWN_SECONDS_CHOICES. */
export const TRADE_COOLDOWN_SECONDS_OPTIONS = [
  { value: 0, label: "Off" },
  { value: 30, label: "30 seconds" },
  { value: 60, label: "1 minute" },
  { value: 120, label: "2 minutes" },
  { value: 180, label: "3 minutes" },
  { value: 300, label: "5 minutes" },
  { value: 600, label: "10 minutes" },
  { value: 900, label: "15 minutes" },
  { value: 1800, label: "30 minutes" },
  { value: 3600, label: "1 hour" }
];

export function snapTradeCooldownSeconds(raw) {
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0) return 0;
  const choices = TRADE_COOLDOWN_SECONDS_OPTIONS.map((o) => o.value).filter((v) => v > 0);
  let best = choices[0];
  let bestDist = Math.abs(best - n);
  for (const v of choices) {
    const d = Math.abs(v - n);
    if (d < bestDist) {
      best = v;
      bestDist = d;
    }
  }
  return best;
}
