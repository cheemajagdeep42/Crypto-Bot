/**
 * Live countdown for BFF log lines like "Trade cooldown: ~52s remaining before next auto entry."
 * Uses persisted bot state (last open + cooldown seconds), not the frozen seconds in the log text.
 *
 * @param {string} message
 * @param {{
 *   botRunning?: boolean;
 *   tradeCooldownSeconds?: number | null;
 *   lastMomentumTradeOpenedAt?: string | null;
 *   nowTs?: number;
 * }} ctx
 * @returns {string}
 */
export function resolveTradeCooldownLogMessage(message, ctx) {
  const msg = String(message ?? "");
  if (!msg.includes("Trade cooldown:") || !msg.includes("remaining before next auto entry")) {
    return msg;
  }
  const cd = Number(ctx.tradeCooldownSeconds);
  const last = ctx.lastMomentumTradeOpenedAt;
  const nowTs = typeof ctx.nowTs === "number" ? ctx.nowTs : Date.now();
  if (!ctx.botRunning || !Number.isFinite(cd) || cd <= 0 || !last) return msg;
  const opened = new Date(last).getTime();
  if (Number.isNaN(opened)) return msg;
  const elapsed = (nowTs - opened) / 1000;
  if (!Number.isFinite(elapsed)) return msg;
  if (elapsed >= cd) {
    return "Trade cooldown: ready — next auto entry not blocked.";
  }
  const rem = Math.max(0, Math.ceil(cd - elapsed));
  return `Trade cooldown: ~${rem}s remaining before next auto entry.`;
}
