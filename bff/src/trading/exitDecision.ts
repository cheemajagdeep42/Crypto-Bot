/**
 * Pure exit rules shared by paper execution and mainnet (Jupiter) pending sells.
 * Mirrors `PaperMomentumBot.evaluateExitForTrade` + `tryDipRetracementFromEntry` order.
 */
export type ExitReasonKind =
    | "stop_loss"
    | "take_profit"
    | "time_stop"
    | "manual"
    | "break_even"
    | "red_dip"
    | "dip_retrace";

export type ExitDecision =
    | { kind: "none" }
    | { kind: "close_full"; reason: ExitReasonKind }
    | {
          kind: "partial";
          mode: "tp_step" | "dip_step" | "dip_retrace";
          stepPercent: number;
          requestedFraction: number;
          /** When hit, append to `takeProfitStepsHit` after fill. */
          advanceTpHit?: number;
          /** When hit, append to `dipStepsHit` after fill. */
          advanceDipHit?: number;
          /** When hit, append to `dipRetracementStepsHit` after fill. */
          advanceDipRetraceHit?: number;
      };

export type ExitDecisionTradeSnapshot = {
    pnlPercent: number;
    entryPrice: number;
    peakPrice: number;
    currentPrice: number;
    takeProfitStepsHit: number[];
    dipStepsHit: number[];
    dipRetracementStepsHit: number[];
    openedAt: string;
    maxHoldMinutesAtEntry?: number;
};

/** Frozen settings subset used only for exit math (paper + mainnet). */
export type ExitRules = {
    stopLossPercent: number;
    takeProfitStepsPercent: number[];
    takeProfitStepSellFraction: number;
    takeProfitStepSellFractions: number[];
    dipStepsPercent: number[];
    dipStepSellFractions: number[];
    dipRetracementStepsPercent: number[];
    dipRetracementSellFractions: number[];
    minDipRetracementMfeBasisPercent: number;
    maxHoldMinutes: number;
};

function dipRetracementDecision(
    currentPrice: number,
    trade: Pick<ExitDecisionTradeSnapshot, "entryPrice" | "peakPrice" | "dipRetracementStepsHit">,
    rules: ExitRules
): ExitDecision | null {
    const steps = rules.dipRetracementStepsPercent;
    if (steps.length === 0) return null;

    const entry = trade.entryPrice;
    const peak = trade.peakPrice;
    const mfe = peak - entry;
    const minBasis = rules.minDipRetracementMfeBasisPercent;
    if (
        !Number.isFinite(mfe) ||
        mfe <= 0 ||
        (mfe / Math.max(entry, Number.EPSILON)) * 100 < minBasis
    ) {
        return null;
    }

    const retracePercent = ((peak - currentPrice) / mfe) * 100;
    if (!Number.isFinite(retracePercent)) return null;

    for (let index = 0; index < steps.length; index += 1) {
        const step = steps[index];
        if (trade.dipRetracementStepsHit.some((hit) => Number(hit) === Number(step))) continue;
        if (retracePercent < step) continue;

        const sellFraction = rules.dipRetracementSellFractions[index] ?? 0.25;
        if (sellFraction >= 1) {
            return { kind: "close_full", reason: "dip_retrace" };
        }
        return {
            kind: "partial",
            mode: "dip_retrace",
            stepPercent: step,
            requestedFraction: sellFraction,
            advanceDipRetraceHit: step,
        };
    }
    return null;
}

/**
 * @param configMaxHoldMinutes — `BotConfig.maxHoldMinutes` fallback when trade has no per-leg override.
 */
export function decideExit(
    trade: ExitDecisionTradeSnapshot,
    currentPrice: number,
    rules: ExitRules,
    configMaxHoldMinutes: number,
    ageMinutes: number
): ExitDecision {
    if (trade.pnlPercent <= -rules.stopLossPercent) {
        return { kind: "close_full", reason: "stop_loss" };
    }

    const tpSteps = rules.takeProfitStepsPercent;
    const tpFracs = rules.takeProfitStepSellFractions;
    for (let index = 0; index < tpSteps.length; index += 1) {
        const step = tpSteps[index];
        const stepAlreadyHit = trade.takeProfitStepsHit.some((hit) => Number(hit) === Number(step));
        if (trade.pnlPercent >= step && !stepAlreadyHit) {
            const clipFraction =
                tpFracs.length > index && Number.isFinite(tpFracs[index])
                    ? Math.min(1, Math.max(0.05, tpFracs[index] as number))
                    : rules.takeProfitStepSellFraction;
            return {
                kind: "partial",
                mode: "tp_step",
                stepPercent: step,
                requestedFraction: clipFraction,
                advanceTpHit: step,
            };
        }
    }

    const retr = dipRetracementDecision(currentPrice, trade, rules);
    if (retr) return retr;

    /** Peak drawdown % — (peak−price)/peak×100. Independent of MFE retracement; configured via dipStepsPercent (UI downward presets). */
    if (trade.takeProfitStepsHit.length > 0 && rules.dipStepsPercent.length > 0) {
        const drawdownPercent =
            ((trade.peakPrice - currentPrice) / Math.max(trade.peakPrice, Number.EPSILON)) * 100;

        for (let index = 0; index < rules.dipStepsPercent.length; index += 1) {
            const dipStep = rules.dipStepsPercent[index];
            if (
                drawdownPercent < dipStep ||
                trade.dipStepsHit.some((hit) => Number(hit) === Number(dipStep))
            ) {
                continue;
            }

            const sellFraction = rules.dipStepSellFractions[index] ?? 1;
            if (sellFraction >= 1) {
                return { kind: "close_full", reason: "red_dip" };
            }
            return {
                kind: "partial",
                mode: "dip_step",
                stepPercent: dipStep,
                requestedFraction: sellFraction,
                advanceDipHit: dipStep,
            };
        }
    }

    const maxHoldForTrade = trade.maxHoldMinutesAtEntry ?? rules.maxHoldMinutes ?? configMaxHoldMinutes;
    if (ageMinutes >= maxHoldForTrade) {
        return { kind: "close_full", reason: "time_stop" };
    }

    return { kind: "none" };
}
