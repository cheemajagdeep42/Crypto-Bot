/** Split Run Bot config into scanner vs trade slices for independent draft state. */

import { snapBetAmountUsdt } from "./betAmountOptions";
import { snapMaxSlippagePercent } from "./maxSlippageOptions";
import { snapTradeCooldownSeconds } from "./tradeCooldownOptions";

/** Keep in sync with `MIN_ENTRY_CHART_TIMEFRAME_OPTIONS` in bff `minEntryChart.ts`. */
export const MIN_ENTRY_CHART_TIMEFRAME_OPTIONS = ["2m", "5m", "10m", "15m", "30m", "1h", "24h"];

function normalizeUiMinEntryChartTimeframes(raw) {
  if (!Array.isArray(raw) || raw.length === 0) return ["5m"];
  const allow = new Set(MIN_ENTRY_CHART_TIMEFRAME_OPTIONS);
  const want = new Set(raw.map((x) => String(x).trim()).filter((s) => allow.has(s)));
  const ordered = MIN_ENTRY_CHART_TIMEFRAME_OPTIONS.filter((tf) => want.has(tf));
  return ordered.length > 0 ? ordered : ["5m"];
}

export function parseNumberList(text) {
  return String(text ?? "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
}

export function botConfigToPayload(config) {
  if (!config) return null;
  return {
    marketSource: config.marketSource ?? "binance",
    autoMode: Boolean(config.autoMode),
    positionSizeUsdt: Number(config.positionSizeUsdt),
    scanLimit: Number(config.scanLimit),
    liquidityGuard: config.liquidityGuard ?? "both",
    liquidityCheckRequired: Boolean(config.liquidityCheckRequired),
    minFiveMinuteFlowUsdt: Number(config.minFiveMinuteFlowUsdt ?? 30000),
    minMarketCapUsd: Number(config.minMarketCapUsd ?? 1_000_000),
    maxMarketCapUsd: Number(config.maxMarketCapUsd ?? 0),
    dexMinPairAgeMinutes: Number(config.dexMinPairAgeMinutes ?? 30),
    minEntryChartTimeframes: normalizeUiMinEntryChartTimeframes(config.minEntryChartTimeframes),
    stopLossPercent: Number(config.stopLossPercent),
    maxHoldMinutes: Number(config.maxHoldMinutes),
    takeProfitStepsPercent: Array.isArray(config.takeProfitStepsPercent)
      ? config.takeProfitStepsPercent
      : [],
    takeProfitStepSellFraction: Number(config.takeProfitStepSellFraction ?? 0.25),
    takeProfitStepSellFractions: Array.isArray(config.takeProfitStepSellFractions)
      ? config.takeProfitStepSellFractions
      : [],
    dipStepsPercent: Array.isArray(config.dipStepsPercent) ? config.dipStepsPercent : [],
    dipStepSellFractions: Array.isArray(config.dipStepSellFractions) ? config.dipStepSellFractions : [],
    dipRetracementStepsPercent: Array.isArray(config.dipRetracementStepsPercent)
      ? config.dipRetracementStepsPercent
      : [],
    dipRetracementSellFractions: Array.isArray(config.dipRetracementSellFractions)
      ? config.dipRetracementSellFractions
      : [],
    minDipRetracementMfeBasisPercent: Number(config.minDipRetracementMfeBasisPercent ?? 5),
    maxSlippagePercent: snapMaxSlippagePercent(config.maxSlippagePercent ?? 2),
    watchWalletAddress: typeof config.watchWalletAddress === "string" ? config.watchWalletAddress : "",
    watchWalletAddressW2: typeof config.watchWalletAddressW2 === "string" ? config.watchWalletAddressW2 : "",
    executionMode: config.executionMode === "live" ? "live" : "paper",
    autoSignMainnet: Boolean(config.autoSignMainnet),
    autoSignBetUsdt: snapBetAmountUsdt(config.autoSignBetUsdt ?? 0.2),
    tradeCooldownSeconds: snapTradeCooldownSeconds(config.tradeCooldownSeconds ?? 0)
  };
}

export function configToScannerDraft(config) {
  if (!config) {
    return {
      marketSource: "binance",
      scanLimit: 20,
      liquidityGuard: "both",
      liquidityCheckRequired: false,
      minFiveMinuteFlowUsdt: 30000,
      minMarketCapUsd: 1_000_000,
      maxMarketCapUsd: 0,
      dexMinPairAgeMinutes: 30,
      minEntryChartTimeframes: ["5m"]
    };
  }
  return {
    marketSource: config.marketSource ?? "binance",
    scanLimit: config.scanLimit,
    liquidityGuard: config.liquidityGuard ?? "both",
    liquidityCheckRequired:
      typeof config.liquidityCheckRequired === "boolean" ? config.liquidityCheckRequired : false,
    minFiveMinuteFlowUsdt: config.minFiveMinuteFlowUsdt ?? 30000,
    minMarketCapUsd: config.minMarketCapUsd ?? 1_000_000,
    maxMarketCapUsd: config.maxMarketCapUsd ?? 0,
    dexMinPairAgeMinutes: config.dexMinPairAgeMinutes ?? 30,
    minEntryChartTimeframes: normalizeUiMinEntryChartTimeframes(config.minEntryChartTimeframes)
  };
}

export function configToTradeDraft(config) {
  if (!config) {
    return {
      autoMode: false,
      positionSizeUsdt: 5,
      stopLossPercent: 5,
      maxHoldMinutes: 30,
      takeProfitStepsPercent: "1.5,3,4.5,6",
      takeProfitStepSellFraction: 0.25,
      takeProfitStepSellFractions: "",
      dipStepsPercent: "10,15,20,25,30,40",
      dipStepSellFractions: "0.1,0.2,0.3,0.4,0.5,0.6",
      dipRetracementSteps: "none",
      dipRetracementSellFractions: "",
      minDipRetracementMfeBasisPercent: 5,
      maxSlippagePercent: 2,
      executionMode: "paper",
      autoSignMainnet: false,
      autoSignBetUsdt: 0.2,
      tradeCooldownSeconds: 0
    };
  }
  const retrOff = (config.dipRetracementStepsPercent?.length ?? 0) === 0;
  const rSteps = retrOff ? "none" : config.dipRetracementStepsPercent.join(",");
  const rFrac =
    retrOff || !Array.isArray(config.dipRetracementSellFractions)
      ? ""
      : config.dipRetracementSellFractions.join(",");
  return {
    autoMode: typeof config.autoMode === "boolean" ? config.autoMode : false,
    positionSizeUsdt: snapBetAmountUsdt(config.positionSizeUsdt ?? 5),
    stopLossPercent: config.stopLossPercent,
    maxHoldMinutes: config.maxHoldMinutes,
    takeProfitStepsPercent:
      (config.takeProfitStepsPercent?.length ?? 0) > 0
        ? config.takeProfitStepsPercent.join(",")
        : "none",
    takeProfitStepSellFraction: config.takeProfitStepSellFraction ?? 0.25,
    takeProfitStepSellFractions:
      Array.isArray(config.takeProfitStepsPercent) &&
      config.takeProfitStepsPercent.length > 0 &&
      Array.isArray(config.takeProfitStepSellFractions) &&
      config.takeProfitStepSellFractions.length === config.takeProfitStepsPercent.length
        ? config.takeProfitStepSellFractions.join(",")
        : "",
    dipStepsPercent: Array.isArray(config.dipStepsPercent) ? config.dipStepsPercent.join(",") : "",
    dipStepSellFractions: Array.isArray(config.dipStepSellFractions)
      ? config.dipStepSellFractions.join(",")
      : "",
    dipRetracementSteps: rSteps,
    dipRetracementSellFractions: rFrac,
    minDipRetracementMfeBasisPercent: config.minDipRetracementMfeBasisPercent ?? 5,
    maxSlippagePercent: snapMaxSlippagePercent(config.maxSlippagePercent ?? 2),
    executionMode: config.executionMode === "live" ? "live" : "paper",
    autoSignMainnet: Boolean(config.autoSignMainnet),
    autoSignBetUsdt: snapBetAmountUsdt(config.autoSignBetUsdt ?? 0.2),
    tradeCooldownSeconds: snapTradeCooldownSeconds(config.tradeCooldownSeconds ?? 0)
  };
}

export function scannerDraftToPayload(draft) {
  return {
    marketSource: draft.marketSource ?? "binance",
    scanLimit: Number(draft.scanLimit),
    liquidityGuard: draft.liquidityGuard,
    liquidityCheckRequired: Boolean(draft.liquidityCheckRequired),
    minFiveMinuteFlowUsdt: Number(draft.minFiveMinuteFlowUsdt),
    minMarketCapUsd: Number(draft.minMarketCapUsd),
    maxMarketCapUsd: Number(draft.maxMarketCapUsd ?? 0),
    dexMinPairAgeMinutes: Number(draft.dexMinPairAgeMinutes ?? 30),
    minEntryChartTimeframes: normalizeUiMinEntryChartTimeframes(draft.minEntryChartTimeframes)
  };
}

export function tradeDraftToPayload(draft) {
  const retracementOff = draft.dipRetracementSteps === "none";
  return {
    autoMode: Boolean(draft.autoMode),
    positionSizeUsdt: snapBetAmountUsdt(draft.positionSizeUsdt),
    stopLossPercent: Number(draft.stopLossPercent),
    maxHoldMinutes: Number(draft.maxHoldMinutes),
    takeProfitStepsPercent:
      draft.takeProfitStepsPercent === "none" ? [] : parseNumberList(draft.takeProfitStepsPercent),
    takeProfitStepSellFraction: Number(draft.takeProfitStepSellFraction),
    takeProfitStepSellFractions: parseNumberList(draft.takeProfitStepSellFractions),
    dipStepsPercent: parseNumberList(draft.dipStepsPercent),
    dipStepSellFractions: parseNumberList(draft.dipStepSellFractions),
    dipRetracementStepsPercent: retracementOff ? [] : parseNumberList(draft.dipRetracementSteps),
    dipRetracementSellFractions: retracementOff ? [] : parseNumberList(draft.dipRetracementSellFractions),
    minDipRetracementMfeBasisPercent: Number(draft.minDipRetracementMfeBasisPercent),
    maxSlippagePercent: snapMaxSlippagePercent(draft.maxSlippagePercent),
    executionMode: draft.executionMode === "live" ? "live" : "paper",
    autoSignMainnet: Boolean(draft.autoSignMainnet),
    autoSignBetUsdt: snapBetAmountUsdt(draft.autoSignBetUsdt ?? 0.2),
    tradeCooldownSeconds: snapTradeCooldownSeconds(draft.tradeCooldownSeconds ?? 0)
  };
}

export function scannerDraftsEqual(a, b) {
  return (
    JSON.stringify(scannerDraftToPayload(a)) === JSON.stringify(scannerDraftToPayload(b))
  );
}

export function tradeDraftsEqual(a, b) {
  return JSON.stringify(tradeDraftToPayload(a)) === JSON.stringify(tradeDraftToPayload(b));
}

export function mergedConfigPayload(botConfig, scannerDraft, tradeDraft) {
  const base = botConfigToPayload(botConfig) ?? {};
  return {
    ...base,
    ...scannerDraftToPayload(scannerDraft),
    ...tradeDraftToPayload(tradeDraft)
  };
}
