/**
 * Jupiter max-slippage % presets (0.5% steps, max 10%) — same grid as bot UI / paperBot.
 * Used to escalate slippage on simulation failure (e.g. 0x1771) up to 10%.
 */
const SLIPPAGE_PERCENT_CHOICES: readonly number[] = (() => {
    const out: number[] = [];
    for (let i = 1; i <= 20; i += 1) {
        out.push(Number((i * 0.5).toFixed(1)));
    }
    return out;
})();

function snapSlippageToChoice(n: number): number {
    if (!Number.isFinite(n) || n <= 0) {
        return SLIPPAGE_PERCENT_CHOICES[0]!;
    }
    let best = SLIPPAGE_PERCENT_CHOICES[0]!;
    let bestDist = Math.abs(best - n);
    for (const v of SLIPPAGE_PERCENT_CHOICES) {
        const d = Math.abs(v - n);
        if (d < bestDist) {
            best = v;
            bestDist = d;
        }
    }
    return best;
}

/** Percents from first try (snapped to grid) through 10%, inclusive — for auto-retry on slippage errors. */
export function buildJupiterSlippageLadderPercent(startMaxSlippagePercent: number): number[] {
    const start = snapSlippageToChoice(startMaxSlippagePercent);
    const idx = SLIPPAGE_PERCENT_CHOICES.indexOf(start);
    const from = idx >= 0 ? idx : 0;
    return SLIPPAGE_PERCENT_CHOICES.slice(from).filter((x) => x <= 10);
}
