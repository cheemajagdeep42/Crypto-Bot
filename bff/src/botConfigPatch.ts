import { normalizeBotMinEntryChartTimeframes } from "./minEntryChart";
import { normalizeAutoSignBetUsdt, normalizeMarketSource, type BotConfigPatch } from "./paperBot";
import { normalizeLiquidityGuard, normalizeMaxMarketCapUsd } from "./scanner";
import { normalizeWatchWalletAddress } from "./watchWalletAddress";

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
    if (body.executionMode === "live" || body.executionMode === "paper") {
        patch.executionMode = body.executionMode;
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
    if ("minFiveMinuteFlowUsdt" in body && body.minFiveMinuteFlowUsdt !== undefined && body.minFiveMinuteFlowUsdt !== null) {
        patch.minFiveMinuteFlowUsdt = Number(body.minFiveMinuteFlowUsdt);
    }
    if (body.minMarketCapUsd !== undefined && body.minMarketCapUsd !== null) {
        patch.minMarketCapUsd = Number(body.minMarketCapUsd);
    }
    if (body.maxMarketCapUsd !== undefined && body.maxMarketCapUsd !== null) {
        patch.maxMarketCapUsd = normalizeMaxMarketCapUsd(body.maxMarketCapUsd);
    }
    if (body.dexMinPairAgeMinutes !== undefined && body.dexMinPairAgeMinutes !== null) {
        patch.dexMinPairAgeMinutes = Number(body.dexMinPairAgeMinutes);
    }
    if (Array.isArray(body.minEntryChartTimeframes)) {
        patch.minEntryChartTimeframes = normalizeBotMinEntryChartTimeframes(body.minEntryChartTimeframes);
    }
    if ("positionSizeUsdt" in body && body.positionSizeUsdt !== undefined && body.positionSizeUsdt !== null) {
        patch.positionSizeUsdt = Number(body.positionSizeUsdt);
    }
    if ("maxSlippagePercent" in body && body.maxSlippagePercent !== undefined && body.maxSlippagePercent !== null) {
        patch.maxSlippagePercent = Number(body.maxSlippagePercent);
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
    if ("watchWalletAddress" in body) {
        patch.watchWalletAddress = normalizeWatchWalletAddress(body.watchWalletAddress);
    }
    if ("watchWalletAddressW2" in body) {
        patch.watchWalletAddressW2 = normalizeWatchWalletAddress(body.watchWalletAddressW2);
    }
    if ("autoSignMainnet" in body) {
        patch.autoSignMainnet = Boolean(body.autoSignMainnet);
    }
    if (body.autoSignBetUsdt !== undefined && body.autoSignBetUsdt !== null) {
        patch.autoSignBetUsdt = normalizeAutoSignBetUsdt(body.autoSignBetUsdt);
    }
    if (
        "tradeCooldownSeconds" in body &&
        body.tradeCooldownSeconds !== undefined &&
        body.tradeCooldownSeconds !== null
    ) {
        patch.tradeCooldownSeconds = Number(body.tradeCooldownSeconds);
    }
    return patch;
}

