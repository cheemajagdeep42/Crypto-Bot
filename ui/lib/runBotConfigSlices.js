/** Split Run Bot config into scanner vs trade slices for independent draft state. */

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
    scanIntervalSeconds: Number(config.scanIntervalSeconds),
    scanLimit: Number(config.scanLimit),
    timeframe: config.timeframe,
    liquidityGuard: config.liquidityGuard ?? "both",
    liquidityCheckRequired: Boolean(config.liquidityCheckRequired),
    minFiveMinuteFlowUsdt: Number(config.minFiveMinuteFlowUsdt ?? 30000),
    minMarketCapUsd: Number(config.minMarketCapUsd ?? 1_000_000),
    stopLossPercent: Number(config.stopLossPercent),
    maxHoldMinutes: Number(config.maxHoldMinutes),
    takeProfitStepsPercent: Array.isArray(config.takeProfitStepsPercent)
      ? config.takeProfitStepsPercent
      : [],
    takeProfitStepSellFraction: Number(config.takeProfitStepSellFraction ?? 0.25),
    takeProfitStepSellFractions: Array.isArray(config.takeProfitStepSellFractions)
      ? config.takeProfitStepSellFractions
      : [],
    dipStepsPercent: Array.isArray(config.dipStepsPercent) ? config.dipStepsPercent : [10, 20, 30],
    dipStepSellFractions: Array.isArray(config.dipStepSellFractions)
      ? config.dipStepSellFractions
      : [0.25, 0.5, 1],
    dipRetracementStepsPercent: Array.isArray(config.dipRetracementStepsPercent)
      ? config.dipRetracementStepsPercent
      : [],
    dipRetracementSellFractions: Array.isArray(config.dipRetracementSellFractions)
      ? config.dipRetracementSellFractions
      : [],
    minDipRetracementMfeBasisPercent: Number(config.minDipRetracementMfeBasisPercent ?? 5)
  };
}

export function configToScannerDraft(config) {
  if (!config) {
    return {
      marketSource: "binance",
      scanIntervalSeconds: 120,
      scanLimit: 20,
      timeframe: "1h",
      liquidityGuard: "both",
      liquidityCheckRequired: false,
      minFiveMinuteFlowUsdt: 30000,
      minMarketCapUsd: 1_000_000
    };
  }
  return {
    marketSource: config.marketSource ?? "binance",
    scanIntervalSeconds: config.scanIntervalSeconds,
    scanLimit: config.scanLimit,
    timeframe: config.timeframe,
    liquidityGuard: config.liquidityGuard ?? "both",
    liquidityCheckRequired:
      typeof config.liquidityCheckRequired === "boolean" ? config.liquidityCheckRequired : false,
    minFiveMinuteFlowUsdt: config.minFiveMinuteFlowUsdt ?? 30000,
    minMarketCapUsd: config.minMarketCapUsd ?? 1_000_000
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
      dipStepsPercent: "10,20,30",
      dipStepSellFractions: "0.25,0.5,1",
      dipRetracementSteps: "50,60,70,80,90,100",
      dipRetracementSellFractions: "0.1,0.2,0.3,0.4,0.5,0.6",
      minDipRetracementMfeBasisPercent: 5
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
    positionSizeUsdt: config.positionSizeUsdt,
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
    dipStepsPercent: Array.isArray(config.dipStepsPercent)
      ? config.dipStepsPercent.join(",")
      : "10,20,30",
    dipStepSellFractions: Array.isArray(config.dipStepSellFractions)
      ? config.dipStepSellFractions.join(",")
      : "0.25,0.5,1",
    dipRetracementSteps: rSteps,
    dipRetracementSellFractions: rFrac,
    minDipRetracementMfeBasisPercent: config.minDipRetracementMfeBasisPercent ?? 5
  };
}

export function scannerDraftToPayload(draft) {
  return {
    marketSource: draft.marketSource ?? "binance",
    scanIntervalSeconds: Number(draft.scanIntervalSeconds),
    scanLimit: Number(draft.scanLimit),
    timeframe: draft.timeframe,
    liquidityGuard: draft.liquidityGuard,
    liquidityCheckRequired: Boolean(draft.liquidityCheckRequired),
    minFiveMinuteFlowUsdt: Number(draft.minFiveMinuteFlowUsdt),
    minMarketCapUsd: Number(draft.minMarketCapUsd)
  };
}

export function tradeDraftToPayload(draft) {
  const retracementOff = draft.dipRetracementSteps === "none";
  return {
    autoMode: Boolean(draft.autoMode),
    positionSizeUsdt: Number(draft.positionSizeUsdt),
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
    minDipRetracementMfeBasisPercent: Number(draft.minDipRetracementMfeBasisPercent)
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
