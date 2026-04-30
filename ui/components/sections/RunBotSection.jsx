import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, CircleHelp, Info } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import {
  formatGainLossPercent,
  formatMoney,
  formatPercent,
  formatUsdtPair,
  getTokenGainSortValue
} from "../../lib/formatters";
import { useUiStore } from "../../stores/useUiStore";
import { useBotStore } from "../../stores/useBotStore";
import { useRunBotScannerFormStore } from "../../stores/useRunBotScannerFormStore";
import { useRunBotTradeFormStore } from "../../stores/useRunBotTradeFormStore";
import {
  mergedConfigPayload,
  scannerDraftsEqual,
  tradeDraftsEqual
} from "../../lib/runBotConfigSlices";
import { cn } from "../../lib/utils";

/** Matches `TimeframeKey` in bff scanner (for preview / table header). */
const SCAN_TABLE_TIMEFRAMES = [
  "5m",
  "10m",
  "15m",
  "30m",
  "1h",
  "2h",
  "3h",
  "6h",
  "12h",
  "24h",
  "3d",
  "1w",
  "1mo"
];

/** Persisted venue preference; BFF scanner + prices use Binance until other adapters exist. */
const MARKET_SOURCE_OPTIONS = [
  { value: "binance", label: "Binance" },
  { value: "coinbase", label: "Coinbase (planned)" },
  { value: "kraken", label: "Kraken (planned)" },
  { value: "bybit", label: "Bybit (planned)" },
  {
    value: "dexscreener",
    label: "DexScreener (data only — no trading API)"
  }
];

/** Upward = staged sells when total PnL % vs entry hits each threshold (same order as steps). */
const UPWARD_TP_PRESETS = {
  none: { steps: "none", uniform: 0.25, perStep: "" },
  balanced: { steps: "1.5,3,4.5,6", uniform: 0.25, perStep: "" },
  aggressive: { steps: "1,2,3,4", uniform: 0.25, perStep: "" },
  conservative: { steps: "2,4,6,8", uniform: 0.25, perStep: "" },
  /** 1%→10%, 2%→20%, … 5%→100% of *remaining* at each hit. */
  progressive_5: { steps: "1,2,3,4,5", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,1" },
  /** Multiplier presets: at m%, 2m%, ... 10m% sell 10%,20%,...,100% of remaining. */
  multiplier_1: { steps: "1,2,3,4,5,6,7,8,9,10", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_2: { steps: "2,4,6,8,10,12,14,16,18,20", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_3: { steps: "3,6,9,12,15,18,21,24,27,30", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_4: { steps: "4,8,12,16,20,24,28,32,36,40", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_5: { steps: "5,10,15,20,25,30,35,40,45,50", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_8: { steps: "8,16,24,32,40,48,56,64,72,80", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_10: { steps: "10,20,30,40,50,60,70,80,90,100", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" }
};

/** Max affordable loss — must match BFF `STOP_LOSS_PERCENT_UI_CHOICES`. */
const MAX_AFFORDABLE_LOSS_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 15, 20];

/** First option (`off`) maps to `liquidityCheckRequired: false`; others match BFF `LiquidityGuardMode`. */
const LIQUIDITY_GUARD_OPTIONS = [
  { value: "off", label: "Off" },
  { value: "both", label: "Volume + MC" },
  { value: "volume", label: "Volume only" },
  { value: "mc", label: "MC only" }
];

/** Min market cap when liquidity + MC guard is not Off — must match BFF `MIN_MARKET_CAP_USD_CHOICES`. */
const MIN_MARKET_CAP_OPTIONS = [
  { value: 50_000, label: "$50k" },
  { value: 100_000, label: "$100k" },
  { value: 150_000, label: "$150k" },
  { value: 200_000, label: "$200k" },
  { value: 300_000, label: "$300k" },
  { value: 400_000, label: "$400k" },
  { value: 500_000, label: "$500k" },
  { value: 700_000, label: "$700k" },
  { value: 1_000_000, label: "$1M" },
  { value: 1_000_001, label: "> $1M" }
];

/** Downward = retracement (peak−price)/(peak−entry)×100; each step sells % of *remaining*. */
const DOWNWARD_RETRACE_PRESETS = {
  none: { steps: "none", fracs: "" },
  balanced: { steps: "50,60,70,80,90,100", fracs: "0.1,0.2,0.3,0.4,0.5,0.6" },
  /** 10%→10%, 20%→20%, 30%→30%, 40%→40%, 100%→100% of remaining (5 steps). */
  proportional_5: { steps: "10,20,30,40,100", fracs: "0.1,0.2,0.3,0.4,1" }
};

function detectUpwardPresetKey(tradeDraft) {
  if (tradeDraft.takeProfitStepsPercent === "none") return "none";
  const per = String(tradeDraft.takeProfitStepSellFractions ?? "").trim();
  for (const [key, preset] of Object.entries(UPWARD_TP_PRESETS)) {
    if (key === "none") continue;
    if (preset.steps !== tradeDraft.takeProfitStepsPercent) continue;
    if ((preset.perStep || "") !== per) continue;
    if (!per && Number(tradeDraft.takeProfitStepSellFraction) !== preset.uniform) continue;
    return key;
  }
  return "custom";
}

function formatSettingsNumberList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "—";
  return arr.map((n) => (Number.isFinite(Number(n)) ? String(n) : "?")).join(", ");
}

function tradeSettingsAtOpenRows(settings) {
  if (!settings || typeof settings !== "object") return [];
  const guardLabel =
    LIQUIDITY_GUARD_OPTIONS.find((o) => o.value === settings.liquidityGuard)?.label ?? String(
      settings.liquidityGuard ?? "—"
    );
  const venueLabel =
    MARKET_SOURCE_OPTIONS.find((o) => o.value === settings.marketSource)?.label ?? String(
      settings.marketSource ?? "—"
    );
  return [
    ["Venue", venueLabel],
    ["Auto mode", settings.autoMode ? "On" : "Off"],
    ["Bet amount (USDT)", settings.positionSizeUsdt != null ? `$${Number(settings.positionSizeUsdt)}` : "—"],
    ["Max hold (min)", settings.maxHoldMinutes != null ? String(settings.maxHoldMinutes) : "—"],
    ["Stop loss %", settings.stopLossPercent != null ? `${settings.stopLossPercent}%` : "—"],
    ["Take profit steps %", formatSettingsNumberList(settings.takeProfitStepsPercent)],
    [
      "TP sell fraction",
      settings.takeProfitStepSellFractions?.length
        ? formatSettingsNumberList(settings.takeProfitStepSellFractions)
        : settings.takeProfitStepSellFraction != null
          ? String(settings.takeProfitStepSellFraction)
          : "—"
    ],
    ["Dip steps %", formatSettingsNumberList(settings.dipStepsPercent)],
    ["Dip sell fractions", formatSettingsNumberList(settings.dipStepSellFractions)],
    ["Retracement dip steps %", formatSettingsNumberList(settings.dipRetracementStepsPercent)],
    ["Retracement sell fractions", formatSettingsNumberList(settings.dipRetracementSellFractions)],
    [
      "Min MFE for retracement dip %",
      settings.minDipRetracementMfeBasisPercent != null ? String(settings.minDipRetracementMfeBasisPercent) : "—"
    ],
    ["Scanner timeframe", settings.timeframe ?? "—"],
    ["Scan limit", settings.scanLimit != null ? String(settings.scanLimit) : "—"],
    ["Scan interval (s)", settings.scanIntervalSeconds != null ? String(settings.scanIntervalSeconds) : "—"],
    ["Liquidity + MC guard", settings.liquidityCheckRequired ? "On" : "Off"],
    ["Guard mode", guardLabel],
    ["Min 5m volume (USDT)", settings.minFiveMinuteFlowUsdt != null ? formatMoney(settings.minFiveMinuteFlowUsdt) : "—"],
    ["Min market cap (USD)", settings.minMarketCapUsd != null ? formatMoney(settings.minMarketCapUsd) : "—"]
  ];
}

function detectDownwardPresetKey(tradeDraft) {
  if (tradeDraft.dipRetracementSteps === "none") return "none";
  const fr = String(tradeDraft.dipRetracementSellFractions ?? "").trim();
  for (const [key, preset] of Object.entries(DOWNWARD_RETRACE_PRESETS)) {
    if (key === "none") continue;
    if (preset.steps !== tradeDraft.dipRetracementSteps) continue;
    if (preset.fracs !== fr) continue;
    return key;
  }
  return "custom";
}

function FieldLabel({ id, label, help, activeTip, onToggleTip }) {
  const isOpen = activeTip === id;

  return (
    <div className="relative inline-flex items-center gap-1" data-tooltip-root="true">
      <span className="text-xs font-medium text-[var(--text-muted)]">{label}</span>
      <button
        className="inline-flex h-4 w-4 items-center justify-center rounded-full text-[var(--text-muted)] hover:text-[var(--text)]"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          onToggleTip(isOpen ? null : id);
        }}
        type="button"
      >
        <CircleHelp className="h-3.5 w-3.5" />
      </button>
      {isOpen ? (
        <div className="absolute left-0 top-full z-20 mt-1 max-w-[340px] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-sm leading-6 text-[var(--text)] shadow-lg">
          {help}
        </div>
      ) : null}
    </div>
  );
}

function AccordionSection({
  title,
  titleMeta,
  isOpen,
  onToggle,
  headerRight,
  headerRightWhenCollapsed,
  children,
  contentClassName
}) {
  return (
    <section className="rounded-lg border border-[var(--border)]">
      <div
        className="flex min-h-[64px] w-full cursor-pointer items-center justify-between gap-3 px-5 py-4"
        onClick={onToggle}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            onToggle();
          }
        }}
      >
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className="text-base font-semibold text-[var(--text)]">{title}</span>
          {titleMeta ? (
            <span className="text-xs font-normal text-[var(--text-muted)]">{titleMeta}</span>
          ) : null}
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
          {isOpen ? headerRight : headerRightWhenCollapsed}
          <button
            type="button"
            className="cursor-pointer"
            onClick={onToggle}
            aria-label={`${isOpen ? "Collapse" : "Expand"} ${title}`}
          >
            <ChevronDown
              className={`h-7 w-7 text-[var(--text-muted)] transition-transform ${isOpen ? "rotate-180" : ""}`}
            />
          </button>
        </div>
      </div>
      {isOpen ? <div className={cn("px-3 pb-3", contentClassName)}>{children}</div> : null}
    </section>
  );
}

export function RunBotSection({ botState, previewScanLoading, onAction, onSaveConfig }) {
  const runBotActiveTradeFocusNonce = useUiStore((s) => s.runBotActiveTradeFocusNonce);
  const activeTradeSectionRef = useRef(null);
  const prevHadActiveTradeRef = useRef(false);
  const [activeTip, setActiveTip] = useState(null);
  const [isBotSettingsOpen, setIsBotSettingsOpen] = useState(false);
  const [isScannerSettingsOpen, setIsScannerSettingsOpen] = useState(true);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [isTradeOpen, setIsTradeOpen] = useState(false);
  const [scanLimitFilter, setScanLimitFilter] = useState(20);
  /** Default matches saved scanner window (`scanDraft.timeframe`); synced when config loads or you change Scanner timeframe. */
  const [scanTimeframeFilter, setScanTimeframeFilter] = useState("1h");
  const [volumeSortDirection, setVolumeSortDirection] = useState(null);
  /** Gain/Loss column follows selected scan timeframe filter. */
  const gainSortMetric = "window";
  const [gainSortDirection, setGainSortDirection] = useState(null);
  const [isSavingScannerConfig, setIsSavingScannerConfig] = useState(false);
  const [isSavingTradeConfig, setIsSavingTradeConfig] = useState(false);
  const [isRunBotRequestPending, setIsRunBotRequestPending] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [isTradeSettingsModalOpen, setIsTradeSettingsModalOpen] = useState(false);
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);
  const [isStopActionPending, setIsStopActionPending] = useState(false);
  const [stopConfirmMode, setStopConfirmMode] = useState(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const [extendMinutes, setExtendMinutes] = useState(10);
  /** In auto mode while bot is stopped, hide persisted scan data until Run Bot or Refresh Scan. */
  const [showAutoStoppedScan, setShowAutoStoppedScan] = useState(false);
  const prevAutoModeRef = useRef(undefined);
  const prevBotStatusRef = useRef(botState?.status);

  const scanDraft = useRunBotScannerFormStore((s) => s.draft);
  const patchScanDraft = useRunBotScannerFormStore((s) => s.patchDraft);
  const hasScannerDirty = useRunBotScannerFormStore((s) => !scannerDraftsEqual(s.draft, s.baseline));

  const tradeDraft = useRunBotTradeFormStore((s) => s.draft);
  const patchTradeDraft = useRunBotTradeFormStore((s) => s.patchDraft);
  const hasTradeDirty = useRunBotTradeFormStore((s) => !tradeDraftsEqual(s.draft, s.baseline));

  useEffect(() => {
    if (!botState?.config || isSavingScannerConfig) return;
    useRunBotScannerFormStore.getState().syncFromServerIfNotDirty(botState.config);
  }, [botState?.config, isSavingScannerConfig]);

  useEffect(() => {
    if (!botState?.config || isSavingTradeConfig) return;
    useRunBotTradeFormStore.getState().syncFromServerIfNotDirty(botState.config);
  }, [botState?.config, isSavingTradeConfig]);

  /** After a scan, keep the header dropdown aligned with the timeframe the server used (tokens + gain column). */
  useEffect(() => {
    if (!botState?.lastScanAt || !botState?.lastScanTimeframe) return;
    const tf = botState.lastScanTimeframe;
    if (SCAN_TABLE_TIMEFRAMES.includes(tf)) {
      setScanTimeframeFilter(tf);
    }
  }, [botState?.lastScanAt, botState?.lastScanTimeframe]);

  useEffect(() => {
    if (scanDraft.timeframe === "30m" || scanDraft.timeframe === "1h") {
      setScanTimeframeFilter(scanDraft.timeframe);
    }
  }, [scanDraft.timeframe]);

  useEffect(() => {
    if (botState?.lastScanAt) return;
    const tf = botState?.config?.timeframe;
    if (tf && SCAN_TABLE_TIMEFRAMES.includes(tf)) {
      setScanTimeframeFilter(tf);
    }
  }, [botState?.lastScanAt, botState?.config?.timeframe]);

  useEffect(() => {
    if (!activeTip) return undefined;

    const handleOutsideClick = (event) => {
      const target = event.target;
      if (target instanceof Element && target.closest('[data-tooltip-root="true"]')) {
        return;
      }
      setActiveTip(null);
    };

    document.addEventListener("mousedown", handleOutsideClick);
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [activeTip]);

  useEffect(() => {
    if (tradeDraft.autoMode && !prevAutoModeRef.current) {
      setShowAutoStoppedScan(false);
    }
    prevAutoModeRef.current = tradeDraft.autoMode;
  }, [tradeDraft.autoMode]);

  useEffect(() => {
    const prev = prevBotStatusRef.current;
    const cur = botState?.status;
    if (prev === "running" && cur !== "running") {
      setShowAutoStoppedScan(false);
    }
    prevBotStatusRef.current = cur;
  }, [botState?.status]);

  const configPayload = () =>
    mergedConfigPayload(botState?.config, useRunBotScannerFormStore.getState().draft, useRunBotTradeFormStore.getState().draft);

  const handleStart = async () => {
    setIsRunBotRequestPending(true);
    try {
      await onSaveConfig(configPayload());
      const cfg = useBotStore.getState().botState?.config;
      if (cfg) {
        useRunBotScannerFormStore.getState().hydrateFromConfig(cfg);
        useRunBotTradeFormStore.getState().hydrateFromConfig(cfg);
      }
      await onAction("start");
      if (!useRunBotTradeFormStore.getState().draft.autoMode) {
        await onAction("previewScan", { limit: scanLimitFilter, timeframe: scanTimeframeFilter });
      }
    } finally {
      setIsRunBotRequestPending(false);
    }
  };

  const handleConfirmStop = async (closeActiveTrade) => {
    setStopConfirmMode(closeActiveTrade ? "close" : "keep");
    setIsStopActionPending(true);
    try {
      await onAction("stop", { closeActiveTrade });
      setIsStopModalOpen(false);
    } finally {
      setIsStopActionPending(false);
      setStopConfirmMode(null);
    }
  };

  const handleSaveScanner = async () => {
    setIsSavingScannerConfig(true);
    try {
      await onSaveConfig(useRunBotScannerFormStore.getState().getPayload());
      const cfg = useBotStore.getState().botState?.config;
      if (cfg) useRunBotScannerFormStore.getState().hydrateFromConfig(cfg);
    } finally {
      setIsSavingScannerConfig(false);
    }
  };

  const handleSaveTrade = async () => {
    setIsSavingTradeConfig(true);
    try {
      await onSaveConfig(useRunBotTradeFormStore.getState().getPayload());
      const cfg = useBotStore.getState().botState?.config;
      if (cfg) useRunBotTradeFormStore.getState().hydrateFromConfig(cfg);
    } finally {
      setIsSavingTradeConfig(false);
    }
  };

  const handleResetScannerConfig = () => {
    useRunBotScannerFormStore.getState().resetDraftToBaseline();
  };

  const handleResetTradeConfig = () => {
    useRunBotTradeFormStore.getState().resetDraftToBaseline();
  };

  const upwardPresetKey = detectUpwardPresetKey(tradeDraft);
  const upwardIsCustom = upwardPresetKey === "custom";
  const downwardPresetKey = detectDownwardPresetKey(tradeDraft);
  const downwardIsCustom = downwardPresetKey === "custom";

  const botRunning = botState?.status === "running";
  const autoStopped = Boolean(tradeDraft.autoMode && botState && !botRunning);
  const scanTableLoading = previewScanLoading || isRunBotRequestPending;
  const showAutoScanInUi =
    !tradeDraft.autoMode || botRunning || showAutoStoppedScan || previewScanLoading || isRunBotRequestPending;
  const lastScanAt = botState?.lastScanAt;
  const scanMetaFromServer =
    autoStopped && !showAutoStoppedScan && !previewScanLoading && !isRunBotRequestPending;
  const scannedTokens = botState?.lastScanTokens ?? [];
  const scannedTokensForUi = showAutoScanInUi ? scannedTokens : [];
  const effectiveScanTimeframe =
    tradeDraft.autoMode &&
    botState &&
    !scanMetaFromServer &&
    (botState.lastScanTimeframe || botState.config?.timeframe)
      ? botState.lastScanTimeframe ?? botState.config?.timeframe ?? scanTimeframeFilter
      : scanTimeframeFilter;
  const getDisplayedVolume = (token) => {
    if (effectiveScanTimeframe === "5m") {
      return typeof token?.fiveMinuteQuoteVolumeUsdt === "number" ? token.fiveMinuteQuoteVolumeUsdt : null;
    }
    return typeof token?.quoteVolume === "number" ? token.quoteVolume : null;
  };
  const sortedScannedTokens = useMemo(() => {
    const toNum = (v) =>
      v != null && Number.isFinite(Number(v)) ? Number(v) : Number.NEGATIVE_INFINITY;
    return [...scannedTokensForUi].sort((a, b) => {
      if (gainSortDirection) {
        const cmp =
          gainSortDirection === "asc"
            ? toNum(getTokenGainSortValue(a, gainSortMetric)) -
              toNum(getTokenGainSortValue(b, gainSortMetric))
            : toNum(getTokenGainSortValue(b, gainSortMetric)) -
              toNum(getTokenGainSortValue(a, gainSortMetric));
        if (cmp !== 0) return cmp;
      }
      if (volumeSortDirection) {
        const aVolume = Number(getDisplayedVolume(a));
        const bVolume = Number(getDisplayedVolume(b));
        const aSafe = Number.isFinite(aVolume) ? aVolume : Number.NEGATIVE_INFINITY;
        const bSafe = Number.isFinite(bVolume) ? bVolume : Number.NEGATIVE_INFINITY;
        return volumeSortDirection === "asc" ? aSafe - bSafe : bSafe - aSafe;
      }
      return 0;
    });
  }, [
    scannedTokensForUi,
    gainSortDirection,
    volumeSortDirection,
    effectiveScanTimeframe
  ]);
  const activeTrade = botState?.activeTrade;
  const formatDateTime = (value) => {
    if (!value) return "n/a";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "n/a";
    return date.toLocaleString(undefined, {
      year: "numeric",
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  };
  const tradeWhyBought = activeTrade?.entryReason ?? "Momentum entry based on scan factors.";
  const toggleVolumeSort = () => {
    setVolumeSortDirection((prev) => {
      if (prev === null) return "desc";
      if (prev === "desc") return "asc";
      return null;
    });
  };
  const toggleGainSort = () => {
    setGainSortDirection((prev) => {
      if (prev === null) return "desc";
      if (prev === "desc") return "asc";
      return null;
    });
  };
  const handleConfirmCloseTrade = () => {
    setIsCloseModalOpen(false);
    void onAction("close");
  };
  const formatLastScannedAgo = (value) => {
    if (!value) return "n/a";
    const ts = new Date(value).getTime();
    if (Number.isNaN(ts)) return "n/a";
    const diffSeconds = Math.max(0, Math.floor((nowTs - ts) / 1000));
    if (diffSeconds < 60) return `${diffSeconds}s back`;
    const diffMinutes = Math.floor(diffSeconds / 60);
    if (diffMinutes < 60) return `${diffMinutes} min${diffMinutes === 1 ? "" : "s"} back`;
    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return `${diffHours} hr${diffHours === 1 ? "" : "s"} back`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays} day${diffDays === 1 ? "" : "s"} back`;
  };
  const formatTimeframeForHeader = (timeframe) => timeframe || "window";
  const formatUsdNoDecimals = (value) => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return "n/a";
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "USD",
      maximumFractionDigits: 0
    }).format(numeric);
  };
  const scanStatusMeta = previewScanLoading
    ? "Scanning…"
    : isRunBotRequestPending
      ? "Starting…"
      : scanMetaFromServer
      ? "No scan yet"
      : lastScanAt
        ? `Last scanned ${formatLastScannedAgo(lastScanAt)}`
        : "No scan yet";
  const scanWindowLabel =
    tradeDraft.autoMode &&
    botState &&
    !scanMetaFromServer &&
    (botState.lastScanTimeframe || botState.config?.timeframe)
      ? botState.lastScanTimeframe ?? botState.config?.timeframe
      : null;
  const scannedTokensTitleMeta = [tradeDraft.autoMode ? "Auto mode" : "Manual", scanWindowLabel, scanStatusMeta]
    .filter(Boolean)
    .join(" · ");
  const formatElapsed = (openedAt) => {
    if (!openedAt) return "n/a";
    const opened = new Date(openedAt).getTime();
    if (Number.isNaN(opened)) return "n/a";
    const totalSeconds = Math.max(0, Math.floor((nowTs - opened) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  };
  const formatRemaining = (openedAt, maxHoldMinutes) => {
    if (!openedAt || !Number.isFinite(Number(maxHoldMinutes))) return "n/a";
    const opened = new Date(openedAt).getTime();
    if (Number.isNaN(opened)) return "n/a";
    const totalLimitSeconds = Math.max(0, Math.floor(Number(maxHoldMinutes) * 60));
    const elapsedSeconds = Math.max(0, Math.floor((nowTs - opened) / 1000));
    const remainingSeconds = Math.max(0, totalLimitSeconds - elapsedSeconds);
    const hours = Math.floor(remainingSeconds / 3600);
    const minutes = Math.floor((remainingSeconds % 3600) / 60);
    const seconds = remainingSeconds % 60;
    if (remainingSeconds === 0) return "Auto close due";
    return `${hours}h ${String(minutes).padStart(2, "0")}m ${String(seconds).padStart(2, "0")}s`;
  };
  const handleExtendTradeTime = async () => {
    if (!activeTrade) return;
    await onAction("extendTradeTime", { extendByMinutes: Number(extendMinutes) });
  };
  const triggerHeaderAutoScan = (nextLimit, nextTimeframe) => {
    setShowAutoStoppedScan(true);
    void onAction("previewScan", { limit: Number(nextLimit), timeframe: nextTimeframe });
  };
  const pnlClass =
    typeof activeTrade?.pnlPercent === "number"
      ? activeTrade.pnlPercent >= 0
        ? "text-emerald-500"
        : "text-[#e50914]"
      : "text-[var(--text)]";
  const soldPercent = (() => {
    if (!activeTrade) return null;
    const remainingQty = Number(activeTrade.quantity);
    const soldQty = Array.isArray(activeTrade.partialFills)
      ? activeTrade.partialFills.reduce((sum, fill) => {
          const q = Number(fill?.quantitySold);
          return Number.isFinite(q) && q > 0 ? sum + q : sum;
        }, 0)
      : 0;
    if (!Number.isFinite(remainingQty) || remainingQty < 0) return null;
    const initialQty = remainingQty + soldQty;
    if (!Number.isFinite(initialQty) || initialQty <= 0) return 0;
    return Math.max(0, Math.min(100, (soldQty / initialQty) * 100));
  })();
  const collapsedPnlClass =
    typeof activeTrade?.pnlPercent === "number"
      ? activeTrade.pnlPercent >= 0
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
        : "border-[#e50914]/30 bg-[#e50914]/10 text-[#e50914]"
      : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--text-muted)]";

  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const ms = activeTrade?.openedAt ? 1000 : 10_000;
    const timer = setInterval(tick, ms);
    return () => clearInterval(timer);
  }, [activeTrade?.openedAt]);

  useEffect(() => {
    const hasTrade = Boolean(botState?.activeTrade);
    if (hasTrade && !prevHadActiveTradeRef.current) {
      setIsTradeOpen(true);
    }
    prevHadActiveTradeRef.current = hasTrade;
  }, [botState?.activeTrade]);

  useEffect(() => {
    if (runBotActiveTradeFocusNonce === 0) return;
    setIsTradeOpen(true);
    const id = requestAnimationFrame(() => {
      activeTradeSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [runBotActiveTradeFocusNonce]);

  return (
    <Card className="min-h-[calc(100vh-180px)] bg-[var(--panel)]">
      <CardContent className="flex h-full flex-col justify-between space-y-4 pt-5 text-sm text-[var(--text-muted)]">
        <div className="space-y-4">
          <form className="space-y-4 pt-2">
            <AccordionSection
              title="Scanner Settings"
              isOpen={isScannerSettingsOpen}
              onToggle={() => setIsScannerSettingsOpen((prev) => !prev)}
              contentClassName="pb-0"
            >
              <div>
              <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-1">
                <FieldLabel
                  id="marketSource"
                  label="Market source"
                  help="Target exchange or data provider for this bot profile. Today only Binance spot data is wired (scanner + prices). Other options are stored for the roadmap. DexScreener publishes a public API for pair stats, volume, and discovery — it does not execute trades or replace a CEX/broker API."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={scanDraft.marketSource}
                  onChange={(event) => patchScanDraft({ marketSource: event.target.value })}
                >
                  {MARKET_SOURCE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="scanInterval"
                  label="Scan Interval"
                  help="How often the bot checks for new entries when Auto mode is enabled."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={scanDraft.scanIntervalSeconds}
                  onChange={(event) => patchScanDraft({ scanIntervalSeconds: event.target.value })}
                >
                  {[30, 60, 120, 180, 300].map((value) => (
                    <option key={value} value={value}>
                      {value}s
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="scanLimit"
                  label="Scanner Limit"
                  help="How many top tokens are scanned each cycle before picking an entry."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={scanDraft.scanLimit}
                  onChange={(event) => patchScanDraft({ scanLimit: event.target.value })}
                >
                  {[5, 10, 15, 20].map((value) => (
                    <option key={value} value={value}>
                      Top {value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="scannerTimeframe"
                  label="Scanner timeframe (saved)"
                  help="Rolling window for scanner gain/volume ranking and auto scans (BFF: 30m or 1h). The Scanned Tokens timeframe dropdown is set to this when you load config or change this field; use Refresh Scan to fetch. Entry checks still use 5m micro-trend separately."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={scanDraft.timeframe}
                  onChange={(event) => patchScanDraft({ timeframe: event.target.value })}
                >
                  <option value="30m">30m</option>
                  <option value="1h">1h</option>
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="timeframe"
                  label="Entry Chart"
                  help="Hardcoded to 5m for now. Bot always validates micro-trend and flow on 5m candles before entry."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <input
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  disabled
                  value="5m (Fixed)"
                  readOnly
                />
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="liquidityGuard"
                  label="Liquidity + MC Guard"
                  help="**Off** — no extra volume/MC gates for momentum entry (Min 5m / Min MC are ignored for entry). **Volume + MC** / **Volume only** / **MC only** — turn gates on and choose which apply. Scan list may still apply a 5m volume prefilter on Binance. Binance MC uses a small static cap table (unknown = fail); Dex uses pair marketCap / fdv."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={scanDraft.liquidityCheckRequired ? scanDraft.liquidityGuard : "off"}
                  onChange={(event) => {
                    const v = event.target.value;
                    if (v === "off") {
                      patchScanDraft({ liquidityCheckRequired: false });
                    } else {
                      patchScanDraft({
                        liquidityCheckRequired: true,
                        liquidityGuard: v
                      });
                    }
                  }}
                >
                  {LIQUIDITY_GUARD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="min5mFlow"
                  label="Min 5m Volume"
                  help="Scan results only include tokens with at least this much quote volume in the latest 5m window (Binance kline / DexScreener m5). When the guard is not Off, this threshold also feeds the **Volume** side of momentum entry (if your guard mode includes volume)."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={scanDraft.minFiveMinuteFlowUsdt}
                  onChange={(event) =>
                    patchScanDraft({ minFiveMinuteFlowUsdt: Number(event.target.value) })
                  }
                >
                  <option value={10000}>10k</option>
                  <option value={30000}>30k</option>
                  <option value={60000}>60k</option>
                  <option value={100000}>100k</option>
                  <option value={200000}>200k</option>
                  <option value={300000}>300k</option>
                  <option value={500000}>500k</option>
                  <option value={800000}>800k</option>
                  <option value={1000000}>1M</option>
                  <option value={1000001}>{"> 1M"}</option>
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="minMarketCap"
                  label="Min Market Cap"
                  help="Used when Liquidity + MC Guard is not **Off** and your guard mode includes **MC**. Token must have reported market cap (or FDV on Dex) at least this high. **> $1M** means strictly above $1M (≥ $1,000,001)."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={scanDraft.minMarketCapUsd}
                  onChange={(event) =>
                    patchScanDraft({ minMarketCapUsd: Number(event.target.value) })
                  }
                >
                  {MIN_MARKET_CAP_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              </div>

              <div className="mt-4 flex w-full flex-wrap items-center justify-end border-t border-[var(--border)] pt-3 pb-3">
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Button
                    size="sm"
                    type="button"
                    onClick={handleSaveScanner}
                    disabled={!hasScannerDirty || isSavingScannerConfig}
                    className="h-7 shrink-0 rounded-md px-2.5 text-[11px] leading-none border border-[#e50914] bg-[#e50914] text-white hover:bg-[#c40710]"
                  >
                    {isSavingScannerConfig ? "Saving..." : "Save Config"}
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={handleResetScannerConfig}
                    className="h-7 shrink-0 rounded-md px-2.5 text-[11px] leading-none"
                  >
                    Reset Config
                  </Button>
                </div>
              </div>
              </div>
            </AccordionSection>

            <AccordionSection
              title="Bot Settings"
              isOpen={isBotSettingsOpen}
              onToggle={() => setIsBotSettingsOpen((prev) => !prev)}
              contentClassName="pb-0"
            >
              <div>
              <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-1">
                <FieldLabel
                  id="amount"
                  label="Bet Amount (USDT)"
                  help="Position size used per paper trade. Limited to safer presets for now."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={tradeDraft.positionSizeUsdt}
                  onChange={(event) => patchTradeDraft({ positionSizeUsdt: event.target.value })}
                >
                  {[5, 10, 15, 20, 25, 30, 35, 40, 45, 50].map((value) => (
                    <option key={value} value={value}>
                      ${value}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="stopLoss"
                  label="Max Affordable Loss"
                  help="If unrealized PnL vs entry is this far **into the red**, the bot closes the trade (full exit). Same rule as before—only the label is clearer for planning how much drawdown you can accept."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={String(tradeDraft.stopLossPercent)}
                  onChange={(event) =>
                    patchTradeDraft({ stopLossPercent: Number(event.target.value) })
                  }
                >
                  {MAX_AFFORDABLE_LOSS_OPTIONS.map((value) => (
                    <option key={value} value={String(value)}>
                      {value}%
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="maxHold"
                  label="Max Hold Time"
                  help="Failsafe exit time. Position closes after this duration even without stop-loss hit."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={tradeDraft.maxHoldMinutes}
                  onChange={(event) => patchTradeDraft({ maxHoldMinutes: event.target.value })}
                >
                  {[15, 30, 45, 60, 120].map((value) => (
                    <option key={value} value={value}>
                      {value} min
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="tpUpward"
                  label="Take profit (upward)"
                  help="Locks gains while price is still **rising in your favor** vs entry. Each threshold is **total PnL %** (same as account view), not chart patterns. **Multiplier presets** use m,2m,...,10m with sells 10%,20%,...,100% of remaining (e.g. m=3 => 3%,6%,...,30%). **Off** = no upward clips; use downward + stop + max hold instead."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={upwardPresetKey}
                  onChange={(event) => {
                    const key = event.target.value;
                    const preset = UPWARD_TP_PRESETS[key];
                    if (!preset) return;
                    patchTradeDraft({
                      takeProfitStepsPercent: preset.steps,
                      takeProfitStepSellFraction: preset.uniform,
                      takeProfitStepSellFractions: preset.perStep ?? ""
                    });
                  }}
                >
                  <option value="balanced">
                    {
                      "Balanced — Profit - 1.5%, Sell - 25% | Profit - 3%, Sell - 25% | Profit - 4.5%, Sell - 25% | Profit - 6%, Sell - 25%"
                    }
                  </option>
                  <option value="aggressive">
                    {
                      "Aggressive — Profit - 1%, Sell - 25% | Profit - 2%, Sell - 25% | Profit - 3%, Sell - 25% | Profit - 4%, Sell - 25%"
                    }
                  </option>
                  <option value="conservative">
                    {
                      "Conservative — Profit - 2%, Sell - 25% | Profit - 4%, Sell - 25% | Profit - 6%, Sell - 25% | Profit - 8%, Sell - 25%"
                    }
                  </option>
                  <option value="progressive_5">
                    {
                      "Progressive — Profit - 1%, Sell - 10% | Profit - 2%, Sell - 20% | Profit - 3%, Sell - 30% | Profit - 4%, Sell - 40% | Profit - 5%, Sell - 100%"
                    }
                  </option>
                  <option value="multiplier_1">Multiplier 1x — 1%,2%,...,10% with sells 10%,20%,...,100%</option>
                  <option value="multiplier_2">Multiplier 2x — 2%,4%,...,20% with sells 10%,20%,...,100%</option>
                  <option value="multiplier_3">Multiplier 3x — 3%,6%,...,30% with sells 10%,20%,...,100%</option>
                  <option value="multiplier_4">Multiplier 4x — 4%,8%,...,40% with sells 10%,20%,...,100%</option>
                  <option value="multiplier_5">Multiplier 5x — 5%,10%,...,50% with sells 10%,20%,...,100%</option>
                  <option value="multiplier_8">Multiplier 8x — 8%,16%,...,80% with sells 10%,20%,...,100%</option>
                  <option value="multiplier_10">Multiplier 10x — 10%,20%,...,100% with sells 10%,20%,...,100%</option>
                  <option value="none">Off (no upward staged sells)</option>
                  <option value="custom" disabled={!upwardIsCustom}>
                    {upwardIsCustom ? "Custom (from saved config)" : "Custom"}
                  </option>
                </select>
              </label>
              <label className="grid gap-1 md:col-span-1">
                <FieldLabel
                  id="tpDownward"
                  label="Take profit (downward)"
                  help="Acts while price **gives back** part of the move from **entry to the best high** since you opened. Measure: (peak − current) / (peak − entry) × 100. Each line sells **that fraction of what you still hold** (after any upward clips). **Balanced** = six wider steps (50→100% giveback, 10→60% clips). **Progressive (5 steps)** = 10% giveback→sell 10% of remaining, 20%→20%, … 100% giveback→sell 100% (full exit at full retracement to entry). **Off** disables this; legacy “dip from peak **price**” still exists only after an upward clip if downward is off. Stop loss still applies below your floor."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={downwardPresetKey}
                  onChange={(event) => {
                    const key = event.target.value;
                    const preset = DOWNWARD_RETRACE_PRESETS[key];
                    if (!preset) return;
                    patchTradeDraft({
                      dipRetracementSteps: preset.steps,
                      dipRetracementSellFractions: preset.fracs
                    });
                  }}
                >
                  <option value="balanced">
                    {
                      "Balanced — PnL Loss - 50%, Sell - 10% | PnL Loss - 60%, Sell - 20% | PnL Loss - 70%, Sell - 30% | PnL Loss - 80%, Sell - 40% | PnL Loss - 90%, Sell - 50% | PnL Loss - 100%, Sell - 60%"
                    }
                  </option>
                  <option value="proportional_5">
                    {
                      "Aggressive — PnL Loss - 10%, Sell - 10% | PnL Loss - 20%, Sell - 20% | PnL Loss - 30%, Sell - 30% | PnL Loss - 40%, Sell - 40% | PnL Loss - 100%, Sell - 100%"
                    }
                  </option>
                  <option value="none">Off (no downward retracement clips)</option>
                  <option value="custom" disabled={!downwardIsCustom}>
                    {downwardIsCustom ? "Custom (from saved config)" : "Custom"}
                  </option>
                </select>
              </label>
              {tradeDraft.dipRetracementSteps !== "none" ? (
                <label className="grid gap-1 md:col-span-1">
                  <FieldLabel
                    id="minMfeRetrace"
                    label="Minimum move up before downward sells"
                    help="Why: downward % is (peak−price)/(peak−entry). If price only ticked a hair above entry, that denominator is tiny—normal noise looks like a huge “retrace” and could trigger sells too early. Pick a **whole percent**: only arm those PnL Loss / Sell pairs after ((peak−entry)/entry)×100 reaches at least this much. Higher = stricter; lower = sooner on smaller pops."
                    activeTip={activeTip}
                    onToggleTip={setActiveTip}
                  />
                  <select
                    className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                    value={String(tradeDraft.minDipRetracementMfeBasisPercent)}
                    onChange={(event) =>
                      patchTradeDraft({
                        minDipRetracementMfeBasisPercent: Number(event.target.value)
                      })
                    }
                  >
                    {[5, 10, 20, 30, 50, 80, 100].map((value) => (
                      <option key={value} value={value}>
                        {value}% move up vs entry (before arming downward)
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              </div>

              <div className="mt-4 flex w-full flex-wrap items-center gap-x-3 gap-y-2 border-t border-[var(--border)] pt-3 pb-3">
                <label className="grid shrink-0 gap-0.5">
                  <FieldLabel
                    id="autoModeSwitch"
                    label="Auto Mode"
                    help="Enable auto scan cycle while bot is running."
                    activeTip={activeTip}
                    onToggleTip={setActiveTip}
                  />
                  <button
                    type="button"
                    onClick={() => patchTradeDraft({ autoMode: !tradeDraft.autoMode })}
                    className={`relative inline-flex h-6 w-[68px] items-center rounded-full border px-0.5 transition ${
                      tradeDraft.autoMode ? "border-[#e50914] bg-[#e50914]" : "border-[#9ca3af] bg-[#6b7280]"
                    }`}
                    aria-pressed={Boolean(tradeDraft.autoMode)}
                    aria-label={`Auto mode ${tradeDraft.autoMode ? "on" : "off"}`}
                  >
                    <span
                      className={`pointer-events-none absolute text-[9px] font-bold tracking-wide ${
                        tradeDraft.autoMode ? "left-1.5 text-white" : "right-1.5 text-white"
                      }`}
                    >
                      {tradeDraft.autoMode ? "ON" : "OFF"}
                    </span>
                    <span
                      className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition ${
                        tradeDraft.autoMode ? "translate-x-[50px]" : "translate-x-0"
                      }`}
                    />
                  </button>
                </label>
                <div className="min-w-[2rem] flex-1 basis-[1rem]" aria-hidden />
                <div className="flex flex-wrap items-center justify-end gap-1.5">
                  <Button
                    size="sm"
                    type="button"
                    onClick={handleSaveTrade}
                    disabled={!hasTradeDirty || isSavingTradeConfig}
                    className="h-7 shrink-0 rounded-md px-2.5 text-[11px] leading-none border border-[#e50914] bg-[#e50914] text-white hover:bg-[#c40710]"
                  >
                    {isSavingTradeConfig ? "Saving..." : "Save Config"}
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={handleResetTradeConfig}
                    className="h-7 shrink-0 rounded-md px-2.5 text-[11px] leading-none"
                  >
                    Reset Config
                  </Button>
                  {botRunning ? (
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      className="h-7 shrink-0 rounded-md px-2.5 text-[11px] leading-none border-[#e50914] text-[#e50914] hover:bg-[#e50914]/10"
                      onClick={() => setIsStopModalOpen(true)}
                    >
                      Stop Bot
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      type="button"
                      className="h-7 shrink-0 rounded-md px-2.5 text-[11px] leading-none border border-[#e50914] bg-[#e50914] text-white hover:bg-[#c40710]"
                      onClick={handleStart}
                      disabled={isRunBotRequestPending}
                    >
                      {isRunBotRequestPending
                        ? "Starting…"
                        : tradeDraft.autoMode
                          ? "Run Bot (Auto)"
                          : "Scan Tokens"}
                    </Button>
                  )}
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    className="h-7 shrink-0 rounded-md px-2.5 text-[11px] leading-none"
                    onClick={() => {
                      setShowAutoStoppedScan(true);
                      void onAction("previewScan", { limit: scanLimitFilter, timeframe: scanTimeframeFilter });
                    }}
                  >
                    Refresh Scan
                  </Button>
                </div>
              </div>
              </div>
            </AccordionSection>
          </form>
          <AccordionSection
              title="Scanned Tokens"
              titleMeta={scannedTokensTitleMeta}
              isOpen={isScanOpen}
              onToggle={() => setIsScanOpen((prev) => !prev)}
              headerRight={
                <>
                  <select
                    className="h-9 min-w-[160px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--input-fg)]"
                    value={scanLimitFilter}
                    onChange={(event) => {
                      const nextLimit = Number(event.target.value);
                      setScanLimitFilter(nextLimit);
                      triggerHeaderAutoScan(nextLimit, scanTimeframeFilter);
                    }}
                  >
                    {[5, 10, 15, 20].map((value) => (
                      <option key={value} value={value}>
                        {value} tokens
                      </option>
                    ))}
                  </select>
                  <select
                    className="h-9 min-w-[140px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--input-fg)]"
                    value={scanTimeframeFilter}
                    onChange={(event) => {
                      const nextTimeframe = event.target.value;
                      setScanTimeframeFilter(nextTimeframe);
                      triggerHeaderAutoScan(scanLimitFilter, nextTimeframe);
                    }}
                  >
                    {SCAN_TABLE_TIMEFRAMES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                </>
              }
            >
            <div className="space-y-2 pt-2">
              {autoStopped && !showAutoStoppedScan ? (
                <p className="text-xs text-[var(--text-muted)]">
                  Start <span className="font-medium text-[var(--text)]">Run Bot (Auto)</span> or use{" "}
                  <span className="font-medium text-[var(--text)]">Refresh Scan</span> to load tokens.
                </p>
              ) : null}
              <div className="max-h-[260px] overflow-y-auto overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[var(--panel)]">
                    <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="py-2 pr-2">Token</th>
                      <th className="py-2 pr-2">Token name</th>
                      <th className="py-2 pr-2">Signal</th>
                      <th className="py-2 pr-2">Score</th>
                      <th
                        className="min-w-[128px] py-2 pr-2 align-top"
                        title={`Gain/Loss uses selected scan timeframe (${formatTimeframeForHeader(
                          effectiveScanTimeframe
                        )}).`}
                      >
                        <button
                          type="button"
                          className="inline-flex cursor-pointer items-center gap-1"
                          onClick={toggleGainSort}
                          aria-label="Sort by gain/loss"
                        >
                          Gain/Loss
                          <span className="text-[10px] leading-none">
                            {gainSortDirection === "desc"
                              ? "▼"
                              : gainSortDirection === "asc"
                                ? "▲"
                                : "↕"}
                          </span>
                        </button>
                      </th>
                      <th className="py-2 pr-2">Spread</th>
                      <th
                        className="py-2 pr-2"
                        title="Quote volume for the selected scan timeframe."
                      >
                        <button
                          type="button"
                          className="inline-flex cursor-pointer items-center gap-1"
                          onClick={toggleVolumeSort}
                        >
                          {`Volume (${formatTimeframeForHeader(effectiveScanTimeframe)})`}
                          <span className="text-[10px]">
                            {volumeSortDirection === "desc"
                              ? "▼"
                              : volumeSortDirection === "asc"
                                ? "▲"
                                : "↕"}
                          </span>
                        </button>
                      </th>
                      <th className="py-2 pr-2">MC</th>
                      <th className="py-2 pr-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanTableLoading ? (
                      <tr>
                        <td className="py-6" colSpan={9}>
                          <div className="flex flex-col items-center justify-center gap-2">
                            <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--myFavColor)] border-r-transparent [animation-direction:normal]" />
                            {isRunBotRequestPending && !previewScanLoading ? (
                              <span className="text-[var(--text-muted)]">Starting bot…</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {!scanTableLoading && scannedTokensForUi.length === 0 ? (
                      <tr>
                        <td className="py-3 text-[var(--text-muted)]" colSpan={9}>
                          {autoStopped && !showAutoStoppedScan
                            ? "No scan yet — start Run Bot (Auto) or Refresh Scan."
                            : "No scanned tokens yet. Click Refresh Scan."}
                        </td>
                      </tr>
                    ) : !scanTableLoading ? (
                      sortedScannedTokens.map((token) => {
                        const isActive = botState?.activeTrade?.symbol === token.symbol;
                        const hasAnyActiveTrade = Boolean(botState?.activeTrade);
                        const disableStartForOtherRows = hasAnyActiveTrade && !isActive;
                        return (
                          <tr key={token.symbol} className="border-b border-[var(--border)]/60">
                            <td className="py-2 pr-2 align-middle">
                              <p className="text-[var(--text)]">{formatUsdtPair(token.symbol)}</p>
                              <a
                                className="mt-0.5 inline-block text-[11px] text-[#E50914] underline-offset-2 hover:underline"
                                href={
                                  token.links?.binance ??
                                  `https://www.binance.com/en/trade/${token.baseAsset}_USDT?type=spot`
                                }
                                rel="noreferrer"
                                target="_blank"
                              >
                                Chart
                              </a>
                            </td>
                            <td className="py-2 pr-2 text-[var(--text)]">
                              {(token.baseAsset && String(token.baseAsset).trim()) || "—"}
                            </td>
                            <td className="py-2 pr-2 uppercase">{token.signal?.replace("_", " ")}</td>
                            <td className="py-2 pr-2">{token.score}</td>
                            <td className="py-2 pr-2">
                              {formatGainLossPercent(getTokenGainSortValue(token, gainSortMetric))}
                            </td>
                            <td className="py-2 pr-2">{formatPercent(token.spreadPercent)}</td>
                            <td className="py-2 pr-2">
                              {(() => {
                                const displayedVolume = getDisplayedVolume(token);
                                return displayedVolume == null ? "n/a" : formatMoney(displayedVolume);
                              })()}
                            </td>
                            <td className="py-2 pr-2">
                              {typeof token?.metadata?.marketCapUsd === "number"
                                ? formatUsdNoDecimals(token.metadata.marketCapUsd)
                                : "n/a"}
                            </td>
                            <td className="py-2 pr-0 text-right">
                              <Button
                                size="sm"
                                type="button"
                                variant={isActive ? "outline" : "default"}
                                className={
                                  isActive
                                    ? "border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
                                    : ""
                                }
                                onClick={() =>
                                  isActive ? undefined : onAction("startTrade", { symbol: token.symbol })
                                }
                                disabled={isActive || disableStartForOtherRows}
                              >
                                {isActive ? (
                                  "Trade in Progress"
                                ) : (
                                  "Start Trade"
                                )}
                              </Button>
                            </td>
                          </tr>
                        );
                      })
                    ) : null}
                  </tbody>
                </table>
              </div>
            </div>
            </AccordionSection>
          <div ref={activeTradeSectionRef} className="scroll-mt-6">
          <AccordionSection
            title="Active Trade"
            isOpen={isTradeOpen}
            onToggle={() => setIsTradeOpen((prev) => !prev)}
            headerRightWhenCollapsed={
              activeTrade ? (
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${collapsedPnlClass}`}
                >
                  Net PnL: {formatPercent(activeTrade.pnlPercent)} ({formatMoney(activeTrade.pnlUsdt)})
                </span>
              ) : null
            }
          >
          <div className="rounded-lg bg-[var(--panel)] p-3">
            {activeTrade ? (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="py-2 pr-2">Token</th>
                      <th className="py-2 pr-2">Bet Amount</th>
                      <th className="py-2 pr-2">%age Sold</th>
                      <th className="py-2 pr-2">Buy Price</th>
                      <th className="py-2 pr-2">Current</th>
                      <th className="py-2 pr-2">Net PnL %</th>
                      <th className="py-2 pr-2">Net PnL USDT</th>
                      <th className="py-2 pr-2">Time Bought</th>
                      <th className="py-2 pr-2">Time Spent</th>
                      <th className="py-2 pr-2">Time Remaining</th>
                      <th className="py-2 pr-2">Extend Time</th>
                      <th className="py-2 pr-2">Why Bought</th>
                      <th className="py-2 pl-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td className="py-2 pr-2 align-middle">
                        <p className="text-[var(--text)]">{formatUsdtPair(activeTrade.symbol)}</p>
                        <a
                          className="mt-0.5 inline-block text-[11px] text-[#E50914] underline-offset-2 hover:underline"
                          href={
                            activeTrade.chartUrl ??
                            `https://www.binance.com/en/trade/${activeTrade.baseAsset}_USDT?type=spot`
                          }
                          rel="noreferrer"
                          target="_blank"
                        >
                          Chart
                        </a>
                      </td>
                      <td className="py-2 pr-2">
                        {formatMoney(activeTrade.positionSizeUsdt ?? botState?.config?.positionSizeUsdt)}
                      </td>
                      <td className="py-2 pr-2 font-medium text-[#e50914]">
                        {soldPercent == null ? "—" : `${soldPercent.toFixed(0)}%`}
                      </td>
                      <td className="py-2 pr-2">{formatMoney(activeTrade.entryPrice)}</td>
                      <td className="py-2 pr-2">{formatMoney(activeTrade.currentPrice)}</td>
                      <td className={`py-2 pr-2 font-medium ${pnlClass}`}>{formatPercent(activeTrade.pnlPercent)}</td>
                      <td className={`py-2 pr-2 font-medium ${pnlClass}`}>{formatMoney(activeTrade.pnlUsdt)}</td>
                      <td className="py-2 pr-2">{formatDateTime(activeTrade.openedAt)}</td>
                      <td className="py-2 pr-2">{formatElapsed(activeTrade.openedAt)}</td>
                      <td className="py-2 pr-2">
                        {formatRemaining(
                          activeTrade.openedAt,
                          activeTrade.maxHoldMinutesAtEntry ?? botState?.config?.maxHoldMinutes
                        )}
                      </td>
                      <td className="py-2 pr-2">
                        <div className="flex items-center gap-2">
                          <select
                            className="h-8 min-w-[92px] rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-xs text-[var(--input-fg)]"
                            value={extendMinutes}
                            onChange={(event) => setExtendMinutes(Number(event.target.value))}
                          >
                            {[5, 10, 15, 30, 60, 120].map((value) => (
                              <option key={value} value={value}>
                                +{value}m
                              </option>
                            ))}
                          </select>
                          <Button
                            size="sm"
                            type="button"
                            className="border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
                            onClick={handleExtendTradeTime}
                          >
                            Extend
                          </Button>
                        </div>
                      </td>
                      <td className="max-w-[360px] py-2 pr-2 text-[var(--text)]">
                        <div className="flex items-start gap-1.5">
                          <span className="min-w-0 flex-1">{tradeWhyBought}</span>
                          <button
                            type="button"
                            className="mt-0.5 shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
                            title="Bot settings used when this trade opened"
                            aria-label="Show bot settings for this trade"
                            onClick={() => setIsTradeSettingsModalOpen(true)}
                          >
                            <Info className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                      <td className="py-2 pl-2 text-right">
                        <Button
                          size="sm"
                          type="button"
                          variant="outline"
                          className="border border-amber-600 bg-amber-600 text-white hover:bg-amber-700"
                          onClick={() => setIsCloseModalOpen(true)}
                        >
                          Close Trade
                        </Button>
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            ) : (
              <p>No open paper trade.</p>
            )}
          </div>
          </AccordionSection>
          </div>
        </div>
      </CardContent>
      {isStopModalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-lg rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-[var(--text)]">Stop bot?</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Stopping ends the bot process for now: scheduled auto scans are cleared and status becomes{" "}
              <span className="font-medium text-[var(--text)]">stopped</span>. You can start the bot again anytime.
            </p>
            {activeTrade ? (
              <div className="mt-3 space-y-2 text-sm text-[var(--text-muted)]">
                <p>
                  Open paper position:{" "}
                  <span className="font-medium text-[var(--text)]">{formatUsdtPair(activeTrade.symbol)}</span>.
                </p>
                <p>
                  <strong className="text-[var(--text)]">Stop Bot</strong> keeps it open (still shown under Active Trade
                  until you close it).
                </p>
                <p>
                  <strong className="text-[var(--text)]">Stop Bot + Active Trade</strong> closes it at the current
                  paper price, records history, then stops.
                </p>
              </div>
            ) : (
              <p className="mt-3 text-sm text-[var(--text-muted)]">No open paper trade.</p>
            )}
            <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                disabled={isStopActionPending}
                onClick={() => setIsStopModalOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="outline"
                className="border-[#e50914] text-[#e50914] hover:bg-[#e50914]/10"
                disabled={isStopActionPending}
                onClick={() => void handleConfirmStop(false)}
              >
                {isStopActionPending && stopConfirmMode === "keep" ? "Working…" : "Stop Bot"}
              </Button>
              {activeTrade ? (
                <Button
                  type="button"
                  className="border border-[#e50914] bg-[#e50914] text-white hover:bg-[#c40710]"
                  disabled={isStopActionPending}
                  onClick={() => void handleConfirmStop(true)}
                  title="Closes the open paper trade at the current price, then stops the bot."
                >
                  {isStopActionPending && stopConfirmMode === "close" ? "Working…" : "Stop Bot + Active Trade"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {isTradeSettingsModalOpen && activeTrade ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trade-settings-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) setIsTradeSettingsModalOpen(false);
          }}
        >
          <div
            className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h3 id="trade-settings-title" className="text-lg font-semibold text-[var(--text)]">
              Bot settings at trade open
            </h3>
            <p className="mt-1 text-xs text-[var(--text-muted)]">
              Snapshot from when this position was opened (changing Bot Settings later does not update this).
            </p>
            {activeTrade.settingsAtOpen ? (
              <dl className="mt-4 space-y-2 text-sm">
                {tradeSettingsAtOpenRows(activeTrade.settingsAtOpen).map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[minmax(0,11rem)_1fr] gap-x-3 gap-y-1 border-b border-[var(--border)] border-opacity-50 py-2 last:border-0">
                    <dt className="text-[var(--text-muted)]">{label}</dt>
                    <dd className="text-right text-[var(--text)]">{value}</dd>
                  </div>
                ))}
              </dl>
            ) : (
              <p className="mt-4 text-sm text-[var(--text-muted)]">
                No snapshot stored for this trade (trades opened before this feature only show the live config in Bot
                Settings, not a frozen copy).
              </p>
            )}
            <div className="mt-5 flex justify-end">
              <Button type="button" variant="outline" onClick={() => setIsTradeSettingsModalOpen(false)}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : null}
      {isCloseModalOpen && activeTrade ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-[var(--text)]">Confirm Close Trade</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              You are about to close this trade with net PnL:
            </p>
            <p className={`mt-2 text-base font-semibold ${pnlClass}`}>
              {formatPercent(activeTrade.pnlPercent)} ({formatMoney(activeTrade.pnlUsdt)})
            </p>
            <p className="mt-3 rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-500">
              This action cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setIsCloseModalOpen(false)}>
                Cancel
              </Button>
              <Button
                type="button"
                className="border border-amber-600 bg-amber-600 text-white hover:bg-amber-700"
                onClick={handleConfirmCloseTrade}
              >
                Yes, Close Trade
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
}
