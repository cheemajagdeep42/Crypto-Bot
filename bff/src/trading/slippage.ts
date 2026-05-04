/**
 * Convert UI "max slippage %" (e.g. 2 = 2%) to basis points for Jupiter-style APIs.
 * 100 bps = 1%. Clamped to 0.5%–10% in bps (50–1000) to match bot config presets.
 */
export function slippageBpsFromMaxSlippagePercent(maxSlippagePercent: number): number {
    return Math.max(50, Math.min(1000, Math.round(Number(maxSlippagePercent) * 100)));
}
