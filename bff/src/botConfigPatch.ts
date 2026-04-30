import { normalizeMarketSource, type BotConfigPatch } from "./paperBot";
import { normalizeLiquidityGuard } from "./scanner";

function parseArray(value: unknown): number[] | undefined {
    if (!Array.isArray(value)) return undefined;
    return value.map((item) => Number(item)).filter((item) => Number.isFinite(item));
}

/** Build a partial config patch from request body without defaulting missing keys. */
export function buildBotConfigPatch(body: Record<string, unknown>): BotConfigPatch {
    const patch: BotConfigPatch = {};
    if (typeof body.marketSource === "string") {
        patch.marketSource = normalizeMarketSource(body.marketSource);
    }
    if ("autoMode" in body) {
        patch.autoMode = Boolean(body.autoMode);
    }
    if ("scanLimit" in body) {
        patch.scanLimit = Number(body.scanLimit);
    }
    if ("liquidityCheckRequired" in body) {
        patch.liquidityCheckRequired = Boolean(body.liquidityCheckRequired);
    }
    if ("liquidityGuard" in body) {
        patch.liquidityGuard = normalizeLiquidityGuard(body.liquidityGuard);
    }
    if ("timeframe" in body && body.timeframe !== undefined && body.timeframe !== null) {
        patch.timeframe = body.timeframe === "30m" ? "30m" : "1h";
    }
    if ("minFiveMinuteFlowUsdt" in body && body.minFiveMinuteFlowUsdt !== undefined && body.minFiveMinuteFlowUsdt !== null) {
        patch.minFiveMinuteFlowUsdt = Number(body.minFiveMinuteFlowUsdt);
    }
    if (body.minMarketCapUsd !== undefined && body.minMarketCapUsd !== null) {
        patch.minMarketCapUsd = Number(body.minMarketCapUsd);
    }
    if ("positionSizeUsdt" in body && body.positionSizeUsdt !== undefined && body.positionSizeUsdt !== null) {
        patch.positionSizeUsdt = Number(body.positionSizeUsdt);
    }
    if ("takeProfitStepsPercent" in body) {
        const tp = parseArray(body.takeProfitStepsPercent);
        if (tp !== undefined) {
            patch.takeProfitStepsPercent = tp;
        }
    }
    if ("takeProfitStepSellFraction" in body && body.takeProfitStepSellFraction !== undefined && body.takeProfitStepSellFraction !== null) {
        patch.takeProfitStepSellFraction = Number(body.takeProfitStepSellFraction);
    }
    if (Array.isArray(body.takeProfitStepSellFractions)) {
        const fr = parseArray(body.takeProfitStepSellFractions);
        if (fr !== undefined) {
            patch.takeProfitStepSellFractions = fr;
        }
    }
    if ("dipStepsPercent" in body) {
        const d = parseArray(body.dipStepsPercent);
        if (d !== undefined) {
            patch.dipStepsPercent = d;
        }
    }
    if ("dipStepSellFractions" in body) {
        const d = parseArray(body.dipStepSellFractions);
        if (d !== undefined) {
            patch.dipStepSellFractions = d;
        }
    }
    if ("stopLossPercent" in body && body.stopLossPercent !== undefined && body.stopLossPercent !== null) {
        patch.stopLossPercent = Number(body.stopLossPercent);
    }
    if ("maxHoldMinutes" in body && body.maxHoldMinutes !== undefined && body.maxHoldMinutes !== null) {
        patch.maxHoldMinutes = Number(body.maxHoldMinutes);
    }
    if ("scanIntervalSeconds" in body && body.scanIntervalSeconds !== undefined && body.scanIntervalSeconds !== null) {
        patch.scanIntervalSeconds = Number(body.scanIntervalSeconds);
    }
    if (Array.isArray(body.dipRetracementStepsPercent)) {
        const steps = parseArray(body.dipRetracementStepsPercent);
        if (steps !== undefined) {
            patch.dipRetracementStepsPercent = steps;
        }
    }
    if (Array.isArray(body.dipRetracementSellFractions)) {
        const fr = parseArray(body.dipRetracementSellFractions);
        if (fr !== undefined) {
            patch.dipRetracementSellFractions = fr;
        }
    }
    if (
        body.minDipRetracementMfeBasisPercent !== undefined &&
        body.minDipRetracementMfeBasisPercent !== null
    ) {
        patch.minDipRetracementMfeBasisPercent = Number(body.minDipRetracementMfeBasisPercent);
    }
    return patch;
}

