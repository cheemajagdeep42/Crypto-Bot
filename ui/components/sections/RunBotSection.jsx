import { useEffect, useRef, useState } from "react";
import { ChevronDown, CircleHelp } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { formatGainLossPercent, formatMoney, formatPercent, formatUsdtPair } from "../../lib/formatters";
import { useUiStore } from "../../stores/useUiStore";

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

function parseNumberList(text) {
  return String(text ?? "")
    .split(",")
    .map((item) => Number(item.trim()))
    .filter((item) => Number.isFinite(item));
}

function formToPayload(form) {
  return {
    autoMode: Boolean(form.autoMode),
    positionSizeUsdt: Number(form.positionSizeUsdt),
    scanIntervalSeconds: Number(form.scanIntervalSeconds),
    scanLimit: Number(form.scanLimit),
    timeframe: form.timeframe,
    liquidityGuard: form.liquidityGuard,
    liquidityCheckRequired: Boolean(form.liquidityCheckRequired),
    minFiveMinuteFlowUsdt: Number(form.minFiveMinuteFlowUsdt),
    stopLossPercent: Number(form.stopLossPercent),
    maxHoldMinutes: Number(form.maxHoldMinutes),
    takeProfitStepsPercent: parseNumberList(form.takeProfitStepsPercent)
  };
}

function botConfigToPayload(config) {
  if (!config) return null;
  return {
    autoMode: Boolean(config.autoMode),
    positionSizeUsdt: Number(config.positionSizeUsdt),
    scanIntervalSeconds: Number(config.scanIntervalSeconds),
    scanLimit: Number(config.scanLimit),
    timeframe: config.timeframe,
    liquidityGuard: config.liquidityGuard ?? "both",
    liquidityCheckRequired: Boolean(config.liquidityCheckRequired),
    minFiveMinuteFlowUsdt: Number(config.minFiveMinuteFlowUsdt ?? 30000),
    stopLossPercent: Number(config.stopLossPercent),
    maxHoldMinutes: Number(config.maxHoldMinutes),
    takeProfitStepsPercent: Array.isArray(config.takeProfitStepsPercent)
      ? config.takeProfitStepsPercent
      : []
  };
}

/** Maps last-saved config (payload shape) back to form state for Reset Config. */
function payloadToFormFields(payload) {
  if (!payload) return null;
  const steps = payload.takeProfitStepsPercent;
  const stepsStr =
    Array.isArray(steps) && steps.length > 0 ? steps.join(",") : "1.5,3,4.5,6";
  return {
    autoMode: payload.autoMode,
    positionSizeUsdt: payload.positionSizeUsdt,
    scanIntervalSeconds: payload.scanIntervalSeconds,
    scanLimit: payload.scanLimit,
    timeframe: payload.timeframe,
    liquidityGuard: payload.liquidityGuard ?? "both",
    liquidityCheckRequired: payload.liquidityCheckRequired,
    minFiveMinuteFlowUsdt: payload.minFiveMinuteFlowUsdt,
    stopLossPercent: payload.stopLossPercent,
    maxHoldMinutes: payload.maxHoldMinutes,
    takeProfitStepsPercent: stepsStr
  };
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

function AccordionSection({ title, titleMeta, isOpen, onToggle, headerRight, headerRightWhenCollapsed, children }) {
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
      {isOpen ? <div className="px-3 pb-3">{children}</div> : null}
    </section>
  );
}

export function RunBotSection({ botState, previewScanLoading, onAction, onSaveConfig }) {
  const runBotActiveTradeFocusNonce = useUiStore((s) => s.runBotActiveTradeFocusNonce);
  const activeTradeSectionRef = useRef(null);
  const prevHadActiveTradeRef = useRef(false);
  const [activeTip, setActiveTip] = useState(null);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [isScanOpen, setIsScanOpen] = useState(false);
  const [isTradeOpen, setIsTradeOpen] = useState(false);
  const [scanLimitFilter, setScanLimitFilter] = useState(20);
  const [scanTimeframeFilter, setScanTimeframeFilter] = useState("24h");
  const [volumeSortDirection, setVolumeSortDirection] = useState(null);
  const [isSavingConfig, setIsSavingConfig] = useState(false);
  const [isRunBotRequestPending, setIsRunBotRequestPending] = useState(false);
  const [isEditingDraft, setIsEditingDraft] = useState(false);
  const [baselineSnapshot, setBaselineSnapshot] = useState(null);
  const initialConfigSnapshotRef = useRef(null);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);
  const [isStopActionPending, setIsStopActionPending] = useState(false);
  const [stopConfirmMode, setStopConfirmMode] = useState(null);
  const [nowTs, setNowTs] = useState(Date.now());
  const [extendMinutes, setExtendMinutes] = useState(10);
  /** In auto mode while bot is stopped, hide persisted scan data until Run Bot or Refresh Scan. */
  const [showAutoStoppedScan, setShowAutoStoppedScan] = useState(false);
  const prevAutoModeRef = useRef(undefined);
  const prevBotStatusRef = useRef(botState?.status);
  const [form, setForm] = useState({
    autoMode: false,
    positionSizeUsdt: 5,
    scanIntervalSeconds: 120,
    scanLimit: 20,
    timeframe: "1h",
    liquidityGuard: "both",
    liquidityCheckRequired: false,
    minFiveMinuteFlowUsdt: 30000,
    stopLossPercent: 1.5,
    maxHoldMinutes: 30,
    takeProfitStepsPercent: "1.5,3,4.5,6"
  });

  useEffect(() => {
    if (!botState?.config) return;
    if (isEditingDraft || isSavingConfig) return;
    const incomingBaseline = botConfigToPayload(botState.config);
    setBaselineSnapshot(incomingBaseline);
    if (!initialConfigSnapshotRef.current) {
      initialConfigSnapshotRef.current = incomingBaseline;
    }
    setForm((prev) => ({
      positionSizeUsdt: botState.config.positionSizeUsdt,
      autoMode: typeof botState.config.autoMode === "boolean" ? botState.config.autoMode : false,
      scanIntervalSeconds: botState.config.scanIntervalSeconds,
      scanLimit: botState.config.scanLimit,
      timeframe: botState.config.timeframe,
      liquidityGuard: botState.config.liquidityGuard ?? "both",
      liquidityCheckRequired:
        typeof botState.config.liquidityCheckRequired === "boolean"
          ? botState.config.liquidityCheckRequired
          : prev.liquidityCheckRequired,
      minFiveMinuteFlowUsdt: botState.config.minFiveMinuteFlowUsdt ?? 30000,
      stopLossPercent: botState.config.stopLossPercent,
      maxHoldMinutes: botState.config.maxHoldMinutes,
      takeProfitStepsPercent: (botState.config.takeProfitStepsPercent ?? []).join(",")
    }));
  }, [botState, isEditingDraft, isSavingConfig]);

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
    if (form.autoMode && !prevAutoModeRef.current) {
      setShowAutoStoppedScan(false);
    }
    prevAutoModeRef.current = form.autoMode;
  }, [form.autoMode]);

  useEffect(() => {
    const prev = prevBotStatusRef.current;
    const cur = botState?.status;
    if (prev === "running" && cur !== "running") {
      setShowAutoStoppedScan(false);
    }
    prevBotStatusRef.current = cur;
  }, [botState?.status]);

  const configPayload = () => formToPayload(form);

  const handleStart = async () => {
    setIsRunBotRequestPending(true);
    try {
      await onSaveConfig(configPayload());
      await onAction("start");
      if (!form.autoMode) {
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

  const handleSave = async () => {
    setIsSavingConfig(true);
    try {
      await onSaveConfig(configPayload());
      setIsEditingDraft(false);
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleResetConfig = () => {
    const base = initialConfigSnapshotRef.current ?? baselineSnapshot ?? botConfigToPayload(botState?.config);
    const fields = payloadToFormFields(base);
    if (!fields) return;
    setForm((prev) => ({ ...prev, ...fields }));
    setIsEditingDraft(false);
  };

  const handleMCToggle = () => {
    const nextValue = !form.liquidityCheckRequired;
    setIsEditingDraft(true);
    setForm((prev) => ({ ...prev, liquidityCheckRequired: nextValue }));
  };

  const baselinePayload = baselineSnapshot ?? botConfigToPayload(botState?.config);

  const hasDirtyConfigChanges = baselinePayload
    ? JSON.stringify(configPayload()) !== JSON.stringify(baselinePayload)
    : false;
  const botRunning = botState?.status === "running";
  const autoStopped = Boolean(form.autoMode && botState && !botRunning);
  const scanTableLoading = previewScanLoading || isRunBotRequestPending;
  const showAutoScanInUi =
    !form.autoMode || botRunning || showAutoStoppedScan || previewScanLoading || isRunBotRequestPending;
  const scannedTokens = botState?.lastScanTokens ?? [];
  const scannedTokensForUi = showAutoScanInUi ? scannedTokens : [];
  const sortedScannedTokens = [...scannedTokensForUi].sort((a, b) => {
    if (!volumeSortDirection) return 0;
    const aVolume = typeof a.quoteVolume === "number" ? a.quoteVolume : -Infinity;
    const bVolume = typeof b.quoteVolume === "number" ? b.quoteVolume : -Infinity;
    return volumeSortDirection === "asc" ? aVolume - bVolume : bVolume - aVolume;
  });
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
  const lastScanAt = botState?.lastScanAt;
  const scanMetaFromServer =
    autoStopped && !showAutoStoppedScan && !previewScanLoading && !isRunBotRequestPending;
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
    form.autoMode &&
    botState &&
    !scanMetaFromServer &&
    (botState.lastScanTimeframe || botState.config?.timeframe)
      ? botState.lastScanTimeframe ?? botState.config?.timeframe
      : null;
  const scannedTokensTitleMeta = [form.autoMode ? "Auto mode" : "Manual", scanWindowLabel, scanStatusMeta]
    .filter(Boolean)
    .join(" · ");
  const effectiveScanTimeframe =
    form.autoMode &&
    botState &&
    !scanMetaFromServer &&
    (botState.lastScanTimeframe || botState.config?.timeframe)
      ? botState.lastScanTimeframe ?? botState.config?.timeframe ?? scanTimeframeFilter
      : scanTimeframeFilter;
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
  const pnlClass =
    typeof activeTrade?.pnlPercent === "number"
      ? activeTrade.pnlPercent >= 0
        ? "text-emerald-500"
        : "text-[#e50914]"
      : "text-[var(--text)]";
  const collapsedPnlClass =
    typeof activeTrade?.pnlPercent === "number"
      ? activeTrade.pnlPercent >= 0
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
        : "border-[#e50914]/30 bg-[#e50914]/10 text-[#e50914]"
      : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--text-muted)]";

  const botConfigReady = Boolean(botState?.config);
  const savedConfigAutoMode = botState?.config?.autoMode === true;

  useEffect(() => {
    if (!botConfigReady) return;
    if (form.autoMode || savedConfigAutoMode) return;
    void onAction("previewScan", { limit: scanLimitFilter, timeframe: scanTimeframeFilter });
  }, [botConfigReady, savedConfigAutoMode, form.autoMode, scanLimitFilter, scanTimeframeFilter, onAction]);

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
          <AccordionSection
            title="Strategy Config"
            isOpen={isConfigOpen}
            onToggle={() => setIsConfigOpen((prev) => !prev)}
          >
          <form
            className="pt-2"
            onChangeCapture={() => setIsEditingDraft(true)}
          >
            <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-1">
                <FieldLabel
                  id="amount"
                  label="Amount (USDT)"
                  help="Position size used per paper trade. Limited to safer presets for now."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={form.positionSizeUsdt}
                  onChange={(event) => setForm((prev) => ({ ...prev, positionSizeUsdt: event.target.value }))}
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
                  id="scanInterval"
                  label="Scan Interval"
                  help="How often the bot checks for new entries when Auto mode is enabled."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={form.scanIntervalSeconds}
                  onChange={(event) => setForm((prev) => ({ ...prev, scanIntervalSeconds: event.target.value }))}
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
                  value={form.scanLimit}
                  onChange={(event) => setForm((prev) => ({ ...prev, scanLimit: event.target.value }))}
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
                  help="Fixed to BOTH checks: token must satisfy minimum 5m volume threshold and minimum market cap."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <input
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  disabled
                  value="Both (Volume + Market Cap)"
                  readOnly
                />
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="min5mFlow"
                  label="Min 5m Volume"
                  help="Minimum quote volume required in the latest 5m candle when Volume guard is selected."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={form.minFiveMinuteFlowUsdt}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, minFiveMinuteFlowUsdt: Number(event.target.value) }))
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
                  id="stopLoss"
                  label="Stop Loss"
                  help="Trade exits if unrealized PnL drops beyond this percentage."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={form.stopLossPercent}
                  onChange={(event) => setForm((prev) => ({ ...prev, stopLossPercent: event.target.value }))}
                >
                  {[0.8, 1, 1.5, 2, 3].map((value) => (
                    <option key={value} value={value}>
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
                  value={form.maxHoldMinutes}
                  onChange={(event) => setForm((prev) => ({ ...prev, maxHoldMinutes: event.target.value }))}
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
                  id="tpSteps"
                  label="Take-Profit Steps"
                  help="The bot sells in incremental partial exits as price moves up. With the default Balanced profile (1.5, 3, 4.5, 6), it sells 25% of the original position at +1.5%, another 25% at +3.0%, another 25% at +4.5%, and the final 25% at +6.0%."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={form.takeProfitStepsPercent}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, takeProfitStepsPercent: event.target.value }))
                  }
                >
                  <option value="1.5,3,4.5,6">Balanced (1.5, 3, 4.5, 6)</option>
                  <option value="1,2,3,4">Aggressive (1, 2, 3, 4)</option>
                  <option value="2,4,6,8">Conservative (2, 4, 6, 8)</option>
                </select>
              </label>
              <div className="md:col-span-3 flex flex-wrap items-end gap-x-6 gap-y-4">
                <label className="grid shrink-0 gap-1">
                  <FieldLabel
                    id="autoModeSwitch"
                    label="Auto Mode"
                    help="Enable auto scan cycle while bot is running."
                    activeTip={activeTip}
                    onToggleTip={setActiveTip}
                  />
                  <button
                    type="button"
                    onClick={() => {
                      setIsEditingDraft(true);
                      setForm((prev) => ({ ...prev, autoMode: !prev.autoMode }));
                    }}
                    className={`relative inline-flex h-[27px] w-[80px] items-center rounded-full border px-1 transition ${
                      form.autoMode ? "border-[#e50914] bg-[#e50914]" : "border-[#9ca3af] bg-[#6b7280]"
                    }`}
                    aria-pressed={Boolean(form.autoMode)}
                    aria-label={`Auto mode ${form.autoMode ? "on" : "off"}`}
                  >
                    <span
                      className={`pointer-events-none absolute text-[10px] font-bold tracking-wide ${
                        form.autoMode ? "left-2 text-white" : "right-2 text-white"
                      }`}
                    >
                      {form.autoMode ? "ON" : "OFF"}
                    </span>
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition ${
                        form.autoMode ? "translate-x-[54px]" : "translate-x-0"
                      }`}
                    />
                  </button>
                </label>
                <label className="grid shrink-0 gap-1">
                  <FieldLabel
                    id="mcSwitch"
                    label="MC Check"
                    help="Require liquidity + market-cap checks before entry."
                    activeTip={activeTip}
                    onToggleTip={setActiveTip}
                  />
                  <button
                    type="button"
                    onClick={handleMCToggle}
                    className={`relative inline-flex h-[27px] w-[80px] items-center rounded-full border px-1 transition ${
                      form.liquidityCheckRequired ? "border-[#e50914] bg-[#e50914]" : "border-[#9ca3af] bg-[#6b7280]"
                    }`}
                    aria-pressed={Boolean(form.liquidityCheckRequired)}
                    aria-label={`MC check ${form.liquidityCheckRequired ? "on" : "off"}`}
                  >
                    <span
                      className={`pointer-events-none absolute text-[10px] font-bold tracking-wide ${
                        form.liquidityCheckRequired ? "left-2 text-white" : "right-2 text-white"
                      }`}
                    >
                      {form.liquidityCheckRequired ? "ON" : "OFF"}
                    </span>
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow-md transition ${
                        form.liquidityCheckRequired ? "translate-x-[54px]" : "translate-x-0"
                      }`}
                    />
                  </button>
                </label>
                <div className="min-w-[2rem] flex-1 basis-[1rem]" aria-hidden />
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    size="sm"
                    type="button"
                    onClick={handleSave}
                    disabled={!hasDirtyConfigChanges || isSavingConfig}
                    className="h-9 shrink-0 border border-[#e50914] bg-[#e50914] text-white hover:bg-[#c40710]"
                  >
                    {isSavingConfig ? "Saving..." : "Save Config"}
                  </Button>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={handleResetConfig}
                    className="h-9 shrink-0"
                  >
                    Reset Config
                  </Button>
                  {botRunning ? (
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      className="h-9 shrink-0 border-[#e50914] text-[#e50914] hover:bg-[#e50914]/10"
                      onClick={() => setIsStopModalOpen(true)}
                    >
                      Stop Bot
                    </Button>
                  ) : (
                    <Button
                      size="sm"
                      type="button"
                      className="h-9 shrink-0 border border-[#e50914] bg-[#e50914] text-white hover:bg-[#c40710]"
                      onClick={handleStart}
                      disabled={isRunBotRequestPending}
                    >
                      {isRunBotRequestPending
                        ? "Starting…"
                        : form.autoMode
                          ? "Run Bot (Auto)"
                          : "Scan Tokens"}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </form>
          </AccordionSection>
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
                    onChange={(event) => setScanLimitFilter(Number(event.target.value))}
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
                    onChange={(event) => setScanTimeframeFilter(event.target.value)}
                  >
                    {SCAN_TABLE_TIMEFRAMES.map((value) => (
                      <option key={value} value={value}>
                        {value}
                      </option>
                    ))}
                  </select>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setShowAutoStoppedScan(true);
                      void onAction("previewScan", { limit: scanLimitFilter, timeframe: scanTimeframeFilter });
                    }}
                  >
                    Refresh Scan
                  </Button>
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
                      <th className="py-2 pr-2">Signal</th>
                      <th className="py-2 pr-2">Score</th>
                      <th className="w-[150px] py-2 pr-2">
                        Gain/Loss ({formatTimeframeForHeader(effectiveScanTimeframe)})
                      </th>
                      <th className="py-2 pr-2">Spread</th>
                      <th className="py-2 pr-2">
                        <button
                          type="button"
                          className="inline-flex cursor-pointer items-center gap-1"
                          onClick={toggleVolumeSort}
                        >
                          Volume
                          <span className="text-[10px]">
                            {volumeSortDirection === "desc"
                              ? "▼"
                              : volumeSortDirection === "asc"
                                ? "▲"
                                : "↕"}
                          </span>
                        </button>
                      </th>
                      <th className="py-2 pr-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scanTableLoading ? (
                      <tr>
                        <td className="py-6" colSpan={7}>
                          <div className="flex flex-col items-center justify-center gap-2">
                            <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--myFavColor)]" />
                            {isRunBotRequestPending && !previewScanLoading ? (
                              <span className="text-[var(--text-muted)]">Starting bot…</span>
                            ) : null}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    {!scanTableLoading && scannedTokensForUi.length === 0 ? (
                      <tr>
                        <td className="py-3 text-[var(--text-muted)]" colSpan={7}>
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
                                href={`https://www.binance.com/en/trade/${token.baseAsset}_USDT?type=spot`}
                                rel="noreferrer"
                                target="_blank"
                              >
                                Chart
                              </a>
                            </td>
                            <td className="py-2 pr-2 uppercase">{token.signal?.replace("_", " ")}</td>
                            <td className="py-2 pr-2">{token.score}</td>
                            <td className="py-2 pr-2">{formatGainLossPercent(token.gainPercent)}</td>
                            <td className="py-2 pr-2">{formatPercent(token.spreadPercent)}</td>
                            <td className="py-2 pr-2">{formatMoney(token.quoteVolume)}</td>
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
                  PnL: {formatPercent(activeTrade.pnlPercent)} ({formatMoney(activeTrade.pnlUsdt)})
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
                      <th className="py-2 pr-2">Buy Price</th>
                      <th className="py-2 pr-2">Current</th>
                      <th className="py-2 pr-2">PnL %</th>
                      <th className="py-2 pr-2">PnL USDT</th>
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
                          href={`https://www.binance.com/en/trade/${activeTrade.baseAsset}_USDT?type=spot`}
                          rel="noreferrer"
                          target="_blank"
                        >
                          Chart
                        </a>
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
                      <td className="max-w-[360px] py-2 pr-2 text-[var(--text)]">{tradeWhyBought}</td>
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
