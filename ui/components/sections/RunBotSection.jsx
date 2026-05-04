import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { CircleHelp, Info, Loader2, RefreshCw, X } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import {
  formatGainLossPercent,
  formatMoney,
  formatPairAge,
  formatPercent,
  formatPaperTradeTokenLabel,
  formatUsdtPair,
  getTokenGainSortValue
} from "../../lib/formatters";
import { useUiStore } from "../../stores/useUiStore";
import { useQuoteSignStore } from "../../stores/useQuoteSignStore";
import { useBotStore } from "../../stores/useBotStore";
import { useRunBotScannerFormStore } from "../../stores/useRunBotScannerFormStore";
import { useRunBotTradeFormStore } from "../../stores/useRunBotTradeFormStore";
import {
  mergedConfigPayload,
  MIN_ENTRY_CHART_TIMEFRAME_OPTIONS,
  scannerDraftsEqual,
  tradeDraftsEqual
} from "../../lib/runBotConfigSlices";
import { BET_AMOUNT_USDT_OPTIONS, snapBetAmountUsdt } from "../../lib/betAmountOptions";
import { MAX_SLIPPAGE_PERCENT_OPTIONS } from "../../lib/maxSlippageOptions";
import { TRADE_COOLDOWN_SECONDS_OPTIONS } from "../../lib/tradeCooldownOptions";
import {
  fetchJupiterQuotePreview,
  inferMainnetBuyFromTx,
  registerMainnetOpenBot,
  setAutoEntryTargetBot
} from "../../lib/api/dashboardApi";
import { JupiterWalletBar, LIVE_MAINNET_SWAP_HELP } from "../jupiter/JupiterWalletBar";
import { hasPendingMainnetSells } from "../../lib/mainnetPendingQueue";
import { MainnetPendingBuyForLeg, mainnetLegNeedsOnChainBuy } from "../jupiter/MainnetPendingBuyBar";
import { MainnetPendingSellForLeg } from "../jupiter/MainnetPendingSellBar";
import { ManualMainnetRecordForm } from "../jupiter/ManualMainnetRecordForm";
import { AccordionSection } from "../common/AccordionSection";
import { toast, toastError } from "../../lib/toast";
import { resolveTradeCooldownLogMessage } from "../../lib/tradeCooldownLogDisplay";

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
  /** Multiplier presets: at m%, 2m%, ... 10m% sell 10%,20%,...,100% of remaining. */
  multiplier_1: { steps: "1,2,3,4,5,6,7,8,9,10", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_2: { steps: "2,4,6,8,10,12,14,16,18,20", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_3: { steps: "3,6,9,12,15,18,21,24,27,30", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_4: { steps: "4,8,12,16,20,24,28,32,36,40", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_5: { steps: "5,10,15,20,25,30,35,40,45,50", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_6: { steps: "6,12,18,24,30,36,42,48,54,60", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_7: { steps: "7,14,21,28,35,42,49,56,63,70", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_8: { steps: "8,16,24,32,40,48,56,64,72,80", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
  multiplier_9: { steps: "9,18,27,36,45,54,63,72,81,90", uniform: 0.25, perStep: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1" },
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

/** Upper MC bound — must match BFF `MAX_MARKET_CAP_USD_CHOICES`. `0` = no limit. */
const MAX_MARKET_CAP_OPTIONS = [
  { value: 0, label: "No limit" },
  { value: 500_000, label: "$500k" },
  { value: 1_000_000, label: "$1M" },
  { value: 2_000_000, label: "$2M" },
  { value: 5_000_000, label: "$5M" },
  { value: 10_000_000, label: "$10M" },
  { value: 25_000_000, label: "$25M" },
  { value: 50_000_000, label: "$50M" },
  { value: 100_000_000, label: "$100M" }
];

/** DexScreener pair minimum age before scan — must stay within BFF clamp 1…1440 minutes. */
const DEX_MIN_PAIR_AGE_MINUTES_OPTIONS = [2, 5, 10, 15, 20, 30, 45, 60, 90, 120, 180, 240, 360, 720, 1440];

const LOOP_TIME_OPTIONS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

/** Downward = peak drawdown (peak−price)/peak×100; each step sells % of *remaining* (after at least one upward TP clip). */
const DOWNWARD_PEAK_DIP_PRESETS = {
  none: { steps: "none", fracs: "" },
  balanced: { steps: "10,15,20,25,30,40", fracs: "0.1,0.2,0.3,0.4,0.5,0.6" },
  /** 10% drawdown off peak → sell 10% of remaining, 20% → 20%, … 100% → 100% (10 steps). */
  linear_10: {
    steps: "10,20,30,40,50,60,70,80,90,100",
    fracs: "0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1"
  },
  proportional_5: { steps: "10,20,30,40,50", fracs: "0.1,0.2,0.3,0.4,1" }
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

/** Match frozen `settingsAtOpen` arrays to the same multiplier / off / custom presets as Bot Settings. */
function snapshotStepsMatchPresetComma(arr, commaStr) {
  if (!commaStr || !Array.isArray(arr)) return false;
  const parts = commaStr.split(",").map((s) => Number(String(s).trim()));
  if (parts.length !== arr.length) return false;
  for (let i = 0; i < parts.length; i += 1) {
    const a = Number(arr[i]);
    if (!Number.isFinite(a) || !Number.isFinite(parts[i]) || Math.abs(a - parts[i]) > 1e-6) return false;
  }
  return true;
}

function detectUpwardPresetKeyFromSnapshot(settings) {
  const stepsArr = settings?.takeProfitStepsPercent;
  if (!Array.isArray(stepsArr) || stepsArr.length === 0) return "none";
  const fracsArr = settings?.takeProfitStepSellFractions;
  const uniform = Number(settings?.takeProfitStepSellFraction);

  for (const [key, preset] of Object.entries(UPWARD_TP_PRESETS)) {
    if (key === "none") continue;
    if (!snapshotStepsMatchPresetComma(stepsArr, preset.steps)) continue;
    if (preset.perStep) {
      if (!snapshotStepsMatchPresetComma(fracsArr, preset.perStep)) continue;
    } else if ((fracsArr?.length ?? 0) > 0) {
      continue;
    } else if (uniform !== preset.uniform) {
      continue;
    }
    return key;
  }
  return "custom";
}

const UPWARD_PRESET_SNAPSHOT_LABELS = {
  none: "Off (no upward take-profit)",
  multiplier_1: "Multiplier 1x",
  multiplier_2: "Multiplier 2x",
  multiplier_3: "Multiplier 3x",
  multiplier_4: "Multiplier 4x",
  multiplier_5: "Multiplier 5x",
  multiplier_6: "Multiplier 6x",
  multiplier_7: "Multiplier 7x",
  multiplier_8: "Multiplier 8x",
  multiplier_9: "Multiplier 9x",
  multiplier_10: "Multiplier 10x",
  custom: "Custom ladder (not a built-in multiplier)"
};

function upwardSellingPresetSummaryLine(settings) {
  const key = detectUpwardPresetKeyFromSnapshot(settings);
  return UPWARD_PRESET_SNAPSHOT_LABELS[key] ?? UPWARD_PRESET_SNAPSHOT_LABELS.custom;
}

function formatSettingsNumberList(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return "—";
  return arr.map((n) => (Number.isFinite(Number(n)) ? String(n) : "?")).join(", ");
}

/** Short labels for settings snapshot (not the full MARKET_SOURCE_OPTIONS copy). */
function snapshotSourceLabel(marketSource) {
  const m = String(marketSource ?? "").trim().toLowerCase();
  const map = {
    binance: "Binance",
    dexscreener: "DexScreener",
    coinbase: "Coinbase",
    kraken: "Kraken",
    bybit: "Bybit",
  };
  return map[m] ?? (m ? marketSource : "—");
}

/** Chart / pair page for a scanned token (Dex pair URL may be `metadata.dexUrl` or `links.binance`). */
function chartHrefForScannedToken(token) {
  if (!token) return null;
  const dex = token.metadata?.dexUrl;
  const link = token.links?.binance;
  const base = token.baseAsset != null ? String(token.baseAsset).trim() : "";
  const href =
    (typeof dex === "string" && dex.trim()) ||
    (typeof link === "string" && link.trim()) ||
    (base ? `https://www.binance.com/en/trade/${base}_USDT?type=spot` : "");
  return href || null;
}

/** Readable take-profit ladder: compact grid (2–3 steps per row on wide screens). */
function takeProfitLadderSummary(settings) {
  const steps = settings.takeProfitStepsPercent;
  if (!Array.isArray(steps) || steps.length === 0) return "—";
  const fracs = settings.takeProfitStepSellFractions;
  const uniform = Number(settings.takeProfitStepSellFraction);

  return (
    <div>
      <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3 lg:grid-cols-4">
        {steps.map((stepRaw, i) => {
          const step = Number(stepRaw);
          const stepLabel = Number.isFinite(step) ? step : stepRaw;
          const f =
            Array.isArray(fracs) && fracs.length === steps.length && Number.isFinite(Number(fracs[i]))
              ? Number(fracs[i])
              : Number.isFinite(uniform)
                ? uniform
                : null;
          const sellPct = f != null && f >= 0 ? String(Math.round(f * 100)) : null;
          return (
            <div
              key={`tp-${i}-${stepLabel}`}
              className="rounded border border-[var(--border)]/80 bg-[var(--panel-2)]/40 px-2 py-1.5 text-[11px] leading-snug"
            >
              <span className="font-semibold tabular-nums text-[var(--text)]">+{stepLabel}%</span>
              <span className="text-[var(--text-muted)]"> PnL → </span>
              {sellPct != null ? (
                <>
                  <span className="font-semibold tabular-nums text-[var(--text)]">{sellPct}%</span>
                  <span className="text-[var(--text-muted)]"> of remaining</span>
                </>
              ) : (
                <span className="text-[var(--text-muted)]">fraction not set</span>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 text-[10px] leading-relaxed text-[var(--text-muted)]">
        Steps are % gain vs entry on the position; each fraction applies to what is left after earlier take-profits.
      </p>
    </div>
  );
}

function tradeSettingsAtOpenRows(settings) {
  if (!settings || typeof settings !== "object") return [];
  const guardLabel =
    LIQUIDITY_GUARD_OPTIONS.find((o) => o.value === settings.liquidityGuard)?.label ?? String(
      settings.liquidityGuard ?? "—"
    );
  return [
    ["Source", snapshotSourceLabel(settings.marketSource)],
    ["Auto mode", settings.autoMode ? "On" : "Off"],
    ["Bet amount (USDT)", settings.positionSizeUsdt != null ? `$${Number(settings.positionSizeUsdt)}` : "—"],
    [
      "Max slippage",
      settings.maxSlippagePercent != null && settings.maxSlippagePercent !== undefined
        ? `${settings.maxSlippagePercent}%`
        : "—"
    ],
    [
      "Auto-sign bet (USDT)",
      settings.autoSignBetUsdt != null && settings.autoSignBetUsdt !== undefined
        ? formatMoney(settings.autoSignBetUsdt)
        : formatMoney(0.2)
    ],
    ["Max hold (min)", settings.maxHoldMinutes != null ? String(settings.maxHoldMinutes) : "—"],
    ["Stop loss %", settings.stopLossPercent != null ? `${settings.stopLossPercent}%` : "—"],
    ["Dip steps %", formatSettingsNumberList(settings.dipStepsPercent)],
    ["Dip sell fractions", formatSettingsNumberList(settings.dipStepSellFractions)],
    ["Retracement dip steps %", formatSettingsNumberList(settings.dipRetracementStepsPercent)],
    ["Retracement sell fractions", formatSettingsNumberList(settings.dipRetracementSellFractions)],
    [
      "Min MFE for retracement dip %",
      settings.minDipRetracementMfeBasisPercent != null ? String(settings.minDipRetracementMfeBasisPercent) : "—"
    ],
    [
      "Min entry charts",
      Array.isArray(settings.minEntryChartTimeframes) && settings.minEntryChartTimeframes.length > 0
        ? settings.minEntryChartTimeframes.join(", ")
        : "5m"
    ],
    ["Scan limit", settings.scanLimit != null ? String(settings.scanLimit) : "—"],
    ["Liquidity + MC guard", settings.liquidityCheckRequired ? "On" : "Off"],
    ["Guard mode", guardLabel],
    ["Min 5m volume (USDT)", settings.minFiveMinuteFlowUsdt != null ? formatMoney(settings.minFiveMinuteFlowUsdt) : "—"],
    ["Min market cap (USD)", settings.minMarketCapUsd != null ? formatMoney(settings.minMarketCapUsd) : "—"],
    [
      "Max market cap (USD)",
      settings.maxMarketCapUsd != null && Number(settings.maxMarketCapUsd) > 0
        ? formatMoney(settings.maxMarketCapUsd)
        : "No limit"
    ],
    [
      "Min pair age (Dex)",
      settings.dexMinPairAgeMinutes != null ? `${settings.dexMinPairAgeMinutes} min` : "—"
    ]
  ];
}

/** Insert full-width TP block between stop-loss and dip settings in the snapshot modal. */
function splitTradeSettingsRowsForLayout(rows) {
  const i = rows.findIndex(([label]) => label === "Dip steps %");
  if (i <= 0) return { head: rows, tail: [] };
  return { head: rows.slice(0, i), tail: rows.slice(i) };
}

function TradeSettingsFieldCard({ label, children }) {
  return (
    <div className="rounded-md border border-[var(--border)]/60 bg-[var(--panel-2)]/20 px-2 py-1.5">
      <div className="text-[9px] font-medium uppercase tracking-wide text-[var(--text-muted)]">{label}</div>
      <div className="mt-1 min-w-0 break-words text-xs leading-tight text-[var(--text)]">{children}</div>
    </div>
  );
}

export function TradeSettingsSnapshotBody({ settings }) {
  const snapshotRows = tradeSettingsAtOpenRows(settings);
  const { head, tail } = splitTradeSettingsRowsForLayout(snapshotRows);
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {head.map(([label, value]) => (
          <TradeSettingsFieldCard key={label} label={label}>
            {value}
          </TradeSettingsFieldCard>
        ))}
      </div>
      <div className="rounded-md border border-[var(--border)]/60 bg-[var(--panel-2)]/15 px-2 py-2 sm:px-3 sm:py-2.5">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <div className="text-[9px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
            Take profit (per step)
          </div>
          <div className="text-[10px] leading-snug text-[var(--text)]">
            <span className="text-[var(--text-muted)]">Selling preset · </span>
            <span className="font-medium text-[var(--text)]">{upwardSellingPresetSummaryLine(settings)}</span>
          </div>
        </div>
        <div className="mt-1.5">{takeProfitLadderSummary(settings)}</div>
      </div>
      {tail.length > 0 ? (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          {tail.map(([label, value]) => (
            <TradeSettingsFieldCard key={label} label={label}>
              {value}
            </TradeSettingsFieldCard>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function detectDownwardPresetKey(tradeDraft) {
  const steps = String(tradeDraft.dipStepsPercent ?? "").trim();
  const fr = String(tradeDraft.dipStepSellFractions ?? "").trim();
  if (!steps) return "none";
  for (const [key, preset] of Object.entries(DOWNWARD_PEAK_DIP_PRESETS)) {
    if (key === "none") continue;
    if (preset.steps !== steps) continue;
    if (preset.fracs !== fr) continue;
    return key;
  }
  return "custom";
}

function FieldLabel({ id, label, help, activeTip, onToggleTip, tipClassName }) {
  const isOpen = activeTip === id;
  const tipBoxClass =
    tipClassName ??
    "max-w-[340px] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-sm leading-6 text-[var(--text)] shadow-lg";

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
        <div className={`absolute left-0 top-full z-20 mt-1 ${tipBoxClass}`}>{help}</div>
      ) : null}
    </div>
  );
}

const takeProfitUpwardHelp = (
  <div className="space-y-2.5 text-xs leading-relaxed">
    <p>
      Staged sells while price is still <strong className="text-[var(--text)]">moving in your favor</strong> vs entry.
      Each line is your <strong className="text-[var(--text)]">total PnL %</strong> on the position (same idea as the PnL
      column), not a chart pattern.
    </p>
    <div className="rounded-md border border-[var(--border)]/80 bg-[var(--panel-2)]/40 px-2.5 py-2">
      <p className="font-semibold text-[var(--text)]">Multiplier Nx (preset)</p>
      <p className="mt-1 text-[var(--text-muted)]">
        Ten steps at <strong className="text-[var(--text)]">N%, 2N%, 3N%, … 10N%</strong> PnL. Each time a step hits, the
        bot sells <strong className="text-[var(--text)]">10%, 20%, … 100%</strong> of what you{" "}
        <strong className="text-[var(--text)]">still hold</strong> (after earlier clips). The last step sells 100% of
        remaining at 10N% PnL.
      </p>
      <ul className="mt-2 list-inside list-disc space-y-0.5 text-[11px] text-[var(--text-muted)]">
        <li>
          <span className="font-medium text-[var(--text)]">1x</span> → 1%, 2%, …, 10%
        </li>
        <li>
          <span className="font-medium text-[var(--text)]">3x</span> → 3%, 6%, …, 30%
        </li>
        <li>
          <span className="font-medium text-[var(--text)]">10x</span> → 10%, 20%, …, 100%
        </li>
      </ul>
    </div>
    <p className="text-[var(--text-muted)]">
      <strong className="text-[var(--text)]">Off</strong> — no upward take-profit clips (stop loss, max hold, and
      downward rules still apply if set). <strong className="text-[var(--text)]">Custom</strong> — your saved ladder
      doesn’t match a multiplier; pick a multiplier to replace it, or keep as-is.
    </p>
  </div>
);

const takeProfitDownwardHelp = (
  <div className="space-y-2.5 text-xs leading-relaxed">
    <p>
      Staged sells when price <strong className="text-[var(--text)]">drops below the trade high</strong> (peak since
      open), as a percent <strong className="text-[var(--text)]">off that peak</strong>. Only runs{" "}
      <strong className="text-[var(--text)]">after at least one upward take-profit clip</strong> has fired (same as
      before). Not the same as total PnL % (upward TP).
    </p>
    <div className="rounded-md border border-[var(--border)]/80 bg-[var(--panel-2)]/40 px-2.5 py-2">
      <p className="font-semibold text-[var(--text)]">Drawdown % off peak</p>
      <p className="mt-1 text-[var(--text-muted)]">
        <span className="font-mono text-[11px] text-[var(--text)]">(peak − price) / peak × 100</span>. Each step sells
        the matching <strong className="text-[var(--text)]">fraction of what you still hold</strong>.
      </p>
    </div>
    <div className="rounded-md border border-[var(--border)]/80 bg-[var(--panel-2)]/40 px-2.5 py-2">
      <p className="font-semibold text-[var(--text)]">Presets</p>
      <ul className="mt-2 list-inside list-disc space-y-1 text-[11px] text-[var(--text-muted)]">
        <li>
          <span className="font-medium text-[var(--text)]">Decent (1:1)</span> — ten steps{" "}
          <strong className="text-[var(--text)]">10%, 20%, … 100%</strong> off peak; sells{" "}
          <strong className="text-[var(--text)]">10%, 20%, … 100%</strong> of remaining at each step (last step exits
          the rest).
        </li>
        <li>
          <span className="font-medium text-[var(--text)]">Balanced</span> — six steps{" "}
          <strong className="text-[var(--text)]">10–40%</strong> off peak; sells{" "}
          <strong className="text-[var(--text)]">10%…60%</strong> of remaining.
        </li>
        <li>
          <span className="font-medium text-[var(--text)]">Aggressive</span> — five steps{" "}
          <strong className="text-[var(--text)]">10–50%</strong> off peak; sells{" "}
          <strong className="text-[var(--text)]">10%…100%</strong> of remaining (last step closes the rest).
        </li>
      </ul>
    </div>
    <p className="text-[var(--text-muted)]">
      <strong className="text-[var(--text)]">Off</strong> — no peak-drawdown clips.{" "}
      <strong className="text-[var(--text)]">Custom</strong> — your comma-separated dip % / fractions don’t match a
      preset (saved config). <strong className="text-[var(--text)]">MFE retracement</strong>{" "}
      <span className="font-mono text-[10px]">(peak−price)/(peak−entry)</span> is only available via API/advanced saves,
      not this dropdown.
    </p>
  </div>
);

/** Match BFF `autoEntryTarget` to a scan row (symbol or Solana mint). */
function tokenMatchesAutoArmRow(token, arm) {
  if (!token || !arm?.symbol) return false;
  const wantMint = String(arm.contractAddress ?? "").trim().toLowerCase();
  const gotMint = String(token.metadata?.contractAddress ?? "").trim().toLowerCase();
  if (wantMint && gotMint) return gotMint === wantMint;
  return token.symbol === arm.symbol;
}

export function RunBotSection({ botState, previewScanLoading, onAction, onSaveConfig, view = "run" }) {
  const isConfigsView = view === "configs";
  const setActiveSection = useUiStore((s) => s.setActiveSection);
  const runBotActiveTradeFocusNonce = useUiStore((s) => s.runBotActiveTradeFocusNonce);
  const pendingToken = useQuoteSignStore((s) => s.pendingToken);
  const togglePendingToken = useQuoteSignStore((s) => s.togglePendingToken);
  const clearPendingToken = useQuoteSignStore((s) => s.clearPendingToken);
  const setPendingToken = useQuoteSignStore((s) => s.setPendingToken);
  const pendingIsSolanaMint = Boolean(
    pendingToken &&
      String(pendingToken.metadata?.chain ?? "").toLowerCase() === "solana" &&
      pendingToken.metadata?.contractAddress
  );
  const addDexTokenLoading = useBotStore((s) => s.addDexTokenLoading);
  const botStateError = useBotStore((s) => s.botStateError);
  const activeTradeSectionRef = useRef(null);
  /** Tracks last seen trade id so we only auto-collapse sibling accordions when a trade is new, not on every poll. */
  const prevActiveTradeIdsRef = useRef("");
  const hasTradeOnMount = Boolean(botState?.activeTrades?.length || botState?.activeTrade);
  const [activeTip, setActiveTip] = useState(null);
  const [isBotSettingsOpen, setIsBotSettingsOpen] = useState(false);
  const [isScannerSettingsOpen, setIsScannerSettingsOpen] = useState(!hasTradeOnMount);
  const [isScanOpen, setIsScanOpen] = useState(true);
  const [isQuoteSignOpen, setIsQuoteSignOpen] = useState(true);
  const [isAutoBuyPanelOpen, setIsAutoBuyPanelOpen] = useState(true);
  const [isBffActivityOpen, setIsBffActivityOpen] = useState(true);
  const [isArmingAuto, setIsArmingAuto] = useState(false);
  const [isTradeOpen, setIsTradeOpen] = useState(hasTradeOnMount);
  const [isMissedBuyFormOpen, setIsMissedBuyFormOpen] = useState(false);
  const [scanLimitFilter, setScanLimitFilter] = useState(20);
  /** Table / preview scan window; bot auto-scans use a fixed 1h window on the server. */
  const [scanTimeframeFilter, setScanTimeframeFilter] = useState("1h");
  const [volumeSortDirection, setVolumeSortDirection] = useState(null);
  /** Gain/Loss column follows selected scan timeframe filter. */
  const gainSortMetric = "window";
  const [gainSortDirection, setGainSortDirection] = useState(null);
  const [isSavingScannerConfig, setIsSavingScannerConfig] = useState(false);
  const [isSavingTradeConfig, setIsSavingTradeConfig] = useState(false);
  const [isRunBotRequestPending, setIsRunBotRequestPending] = useState(false);
  const [isCloseModalOpen, setIsCloseModalOpen] = useState(false);
  const [tradePendingClose, setTradePendingClose] = useState(null);
  const [isTradeSettingsModalOpen, setIsTradeSettingsModalOpen] = useState(false);
  const [settingsForTrade, setSettingsForTrade] = useState(null);
  const [isStopModalOpen, setIsStopModalOpen] = useState(false);
  const [isStopActionPending, setIsStopActionPending] = useState(false);
  const [stopConfirmMode, setStopConfirmMode] = useState(null);
  const [loopTimeMultiplier, setLoopTimeMultiplier] = useState(1);
  const [nowTs, setNowTs] = useState(Date.now());
  const [extendMinutes, setExtendMinutes] = useState(10);
  const [pasteAddress, setPasteAddress] = useState("");
  const [jupiterPreview, setJupiterPreview] = useState(null);
  const [jupiterQuoteError, setJupiterQuoteError] = useState(null);
  const [jupiterQuoteLoading, setJupiterQuoteLoading] = useState(false);
  const [jupiterOutputDecimals, setJupiterOutputDecimals] = useState(6);
  /** Bet size for Jupiter quote/sign only; does not persist to bot config. Resets from saved bet when the quoted token changes. */
  const [jupiterTxnBetUsdt, setJupiterTxnBetUsdt] = useState(() => snapBetAmountUsdt(5));
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
  /** Execution mode control lives in Scanner accordion but edits trade draft — scanner Save must include it. */
  const executionModeDirty = useRunBotTradeFormStore((s) => s.draft.executionMode !== s.baseline.executionMode);

  useEffect(() => {
    if (isSavingScannerConfig) return;
    if (botState?.config) {
      useRunBotScannerFormStore.getState().syncFromServerIfNotDirty(botState.config);
    } else if (botState === null) {
      useRunBotScannerFormStore.getState().syncFromServerIfNotDirty(null);
    }
  }, [botState, isSavingScannerConfig]);

  useEffect(() => {
    if (isSavingTradeConfig) return;
    if (botState?.config) {
      useRunBotTradeFormStore.getState().syncFromServerIfNotDirty(botState.config);
    } else if (botState === null) {
      useRunBotTradeFormStore.getState().syncFromServerIfNotDirty(null);
    }
  }, [botState, isSavingTradeConfig]);

  /** After a scan, keep the header dropdown aligned with the timeframe the server used (tokens + gain column). */
  useEffect(() => {
    if (!botState?.lastScanAt || !botState?.lastScanTimeframe) return;
    const tf = botState.lastScanTimeframe;
    if (SCAN_TABLE_TIMEFRAMES.includes(tf)) {
      setScanTimeframeFilter(tf);
    }
  }, [botState?.lastScanAt, botState?.lastScanTimeframe]);

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
      const scan = useRunBotScannerFormStore.getState();
      const trade = useRunBotTradeFormStore.getState();
      const scannerDirtyNow = !scannerDraftsEqual(scan.draft, scan.baseline);
      const execDirtyNow = trade.draft.executionMode !== trade.baseline.executionMode;
      if (!scannerDirtyNow && !execDirtyNow) return;

      const patch = {};
      if (scannerDirtyNow) Object.assign(patch, scan.getPayload());
      if (execDirtyNow) {
        patch.executionMode = trade.draft.executionMode === "live" ? "live" : "paper";
      }
      await onSaveConfig(patch);
      const cfg = useBotStore.getState().botState?.config;
      if (cfg) {
        useRunBotScannerFormStore.getState().hydrateFromConfig(cfg);
        useRunBotTradeFormStore.getState().hydrateFromConfig(cfg);
      }
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

  const handleConfirmPaperTrade = async () => {
    const t = pendingToken;
    if (!t?.symbol) return;
    try {
      await onAction("startTrade", { symbol: t.symbol, ...configPayload() });
    } finally {
      clearPendingToken();
    }
  };

  const handleReQuote = async () => {
    const sym = pendingToken?.symbol;
    if (!sym) return;
    setShowAutoStoppedScan(true);
    await onAction("previewScan", { limit: scanLimitFilter, timeframe: scanTimeframeFilter });
    const tokens = useBotStore.getState().botState?.lastScanTokens ?? [];
    const fresh = tokens.find((t) => t.symbol === sym);
    if (fresh) setPendingToken(fresh);
  };

  const handleAddPastedAddress = async () => {
    const addr = pasteAddress.trim();
    if (!addr) return;
    setShowAutoStoppedScan(true);
    try {
      await onAction("addDexToken", {
        tokenAddress: addr,
        chainId: "solana",
        timeframe: scanTimeframeFilter
      });
      setPasteAddress("");
      const tokens = useBotStore.getState().botState?.lastScanTokens ?? [];
      const added = tokens[0];
      if (added) setPendingToken(added);
    } catch {
      /* toast from store */
    }
  };

  const handleJupiterQuotePreview = async () => {
    const mint = pendingToken?.metadata?.contractAddress;
    if (!mint || String(pendingToken?.metadata?.chain ?? "").toLowerCase() !== "solana") return;
    setJupiterQuoteLoading(true);
    setJupiterQuoteError(null);
    try {
      const body = await fetchJupiterQuotePreview({
        outputMint: mint,
        amountUsd: jupiterTxnBetUsdt,
        maxSlippagePercent: tradeDraft.maxSlippagePercent ?? 2,
        outputDecimals: jupiterOutputDecimals
      });
      setJupiterPreview(body?.preview ?? null);
    } catch (err) {
      setJupiterPreview(null);
      setJupiterQuoteError(err instanceof Error ? err.message : "Jupiter quote failed");
    } finally {
      setJupiterQuoteLoading(false);
    }
  };

  const upwardPresetKey = detectUpwardPresetKey(tradeDraft);
  const upwardIsCustom = upwardPresetKey === "custom";
  const downwardPresetKey = detectDownwardPresetKey(tradeDraft);
  const downwardIsCustom = downwardPresetKey === "custom";

  const botRunning = botState?.status === "running";
  const autoModeEffective = Boolean(tradeDraft.autoMode ?? botState?.config?.autoMode);
  const executionModeEffective = tradeDraft.executionMode ?? botState?.config?.executionMode ?? "paper";
  const autoSignMainnetEffective = Boolean(
    tradeDraft.autoSignMainnet ?? botState?.config?.autoSignMainnet
  );
  /** Manual mode: full Quote and Sign accordion. Auto mode: separate auto-entry panel. */
  const showManualQuoteAccordion = !autoModeEffective;
  /** BFF sells without Phantom — hide in-table pending-sell signing row. */
  const hideAutoSignedLivePendingSellUi =
    autoModeEffective && executionModeEffective === "live" && autoSignMainnetEffective;
  const autoStopped = Boolean(tradeDraft.autoMode && botState && !botRunning);
  const scanTableLoading = previewScanLoading || isRunBotRequestPending || addDexTokenLoading;
  const showAutoScanInUi =
    !tradeDraft.autoMode || botRunning || showAutoStoppedScan || previewScanLoading || isRunBotRequestPending;
  const lastScanAt = botState?.lastScanAt;
  const scanMetaFromServer =
    autoStopped && !showAutoStoppedScan && !previewScanLoading && !isRunBotRequestPending;
  const scannedTokens = botState?.lastScanTokens ?? [];
  const scannedTokensForUi = showAutoScanInUi ? scannedTokens : [];
  const dexMarketForPaste = botState?.config?.marketSource === "dexscreener";
  const effectiveScanTimeframe =
    tradeDraft.autoMode && botState && !scanMetaFromServer && botState.lastScanTimeframe
      ? botState.lastScanTimeframe
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
  const showScanPairAgeColumn = useMemo(() => {
    if (botState?.config?.marketSource !== "dexscreener") return false;
    return scannedTokensForUi.some(
      (t) => t.pairListedAtMs != null && Number.isFinite(Number(t.pairListedAtMs))
    );
  }, [botState?.config?.marketSource, scannedTokensForUi]);
  const scanTableColSpan = 9 + (showScanPairAgeColumn ? 1 : 0);

  useEffect(() => {
    if (isConfigsView || !pendingToken) return;
    if (!autoModeEffective) {
      setIsQuoteSignOpen(true);
      return;
    }
    setIsAutoBuyPanelOpen(true);
  }, [isConfigsView, pendingToken, autoModeEffective]);

  const activeTradesList = useMemo(() => {
    const list = botState?.activeTrades;
    if (Array.isArray(list) && list.length > 0) return list;
    return botState?.activeTrade ? [botState.activeTrade] : [];
  }, [botState?.activeTrades, botState?.activeTrade]);
  const activeTrade = activeTradesList[0] ?? null;
  const formatDateTime = (value) => {
    if (!value) return "n/a";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "n/a";
    return date.toLocaleString(undefined, {
      month: "short",
      day: "2-digit",
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    });
  };

  const handleConfirmAutoArm = async () => {
    const pt = pendingToken;
    if (!pt?.symbol) return;
    const running = useBotStore.getState().botState?.status === "running";
    if (!running) {
      toast.error("Bot is not running. Start Run Bot (Auto), then click Auto again.");
      return;
    }
    setIsArmingAuto(true);
    try {
      await setAutoEntryTargetBot({
        symbol: pt.symbol,
        ...(pt.metadata?.contractAddress ? { contractAddress: pt.metadata.contractAddress } : {})
      });
      await useBotStore.getState().loadBotState();
      toast.success("Auto entry set for this token.");
    } catch (e) {
      toastError(e, "Could not set auto entry");
    } finally {
      setIsArmingAuto(false);
    }
  };

  const handleClearAutoArm = async () => {
    setIsArmingAuto(true);
    try {
      await setAutoEntryTargetBot({ clear: true });
      await useBotStore.getState().loadBotState();
      toast.success("Auto entry cleared.");
    } catch (e) {
      toastError(e, "Could not clear arm");
    } finally {
      setIsArmingAuto(false);
    }
  };

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
    void onAction("close", { tradeId: tradePendingClose?.id });
    setTradePendingClose(null);
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
    tradeDraft.autoMode && botState && !scanMetaFromServer && botState.lastScanTimeframe
      ? botState.lastScanTimeframe
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
    if (hours <= 0) return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return `${hours}h ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
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
    if (hours <= 0) return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
    return `${hours}h ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  };
  const handleExtendTradeTime = async (tradeId) => {
    if (!tradeId) return;
    await onAction("extendTradeTime", { extendByMinutes: Number(extendMinutes), tradeId });
  };
  const triggerHeaderAutoScan = (nextLimit, nextTimeframe) => {
    setShowAutoStoppedScan(true);
    void onAction("previewScan", { limit: Number(nextLimit), timeframe: nextTimeframe });
  };
  const gainLossClassFromNumber = (n) =>
    typeof n === "number" && Number.isFinite(n)
      ? n >= 0
        ? "text-emerald-500"
        : "text-[#e50914]"
      : "text-[var(--text)]";
  const pnlClassFor = (trade) => gainLossClassFromNumber(trade?.pnlPercent);
  const pnlPctOfBet = (usdt, bet) => {
    const b = Number(bet);
    const u = Number(usdt);
    if (!Number.isFinite(b) || b <= 0 || !Number.isFinite(u)) return NaN;
    return (u / b) * 100;
  };
  const pnlClass = pnlClassFor(activeTrade);
  const soldPercentFor = (trade) => {
    if (!trade) return null;
    const remainingQty = Number(trade.quantity);
    const soldQty = Array.isArray(trade.partialFills)
      ? trade.partialFills.reduce((sum, fill) => {
          const q = Number(fill?.quantitySold);
          return Number.isFinite(q) && q > 0 ? sum + q : sum;
        }, 0)
      : 0;
    if (!Number.isFinite(remainingQty) || remainingQty < 0) return null;
    const initialQty = remainingQty + soldQty;
    if (!Number.isFinite(initialQty) || initialQty <= 0) return 0;
    return Math.max(0, Math.min(100, (soldQty / initialQty) * 100));
  };
  const collapsedPnlClass =
    typeof activeTrade?.pnlPercent === "number"
      ? activeTrade.pnlPercent >= 0
        ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-500"
        : "border-[#e50914]/30 bg-[#e50914]/10 text-[#e50914]"
      : "border-[var(--border)] bg-[var(--panel-2)] text-[var(--text-muted)]";

  useEffect(() => {
    const tick = () => setNowTs(Date.now());
    tick();
    const ms = botRunning || activeTradesList.length > 0 ? 1000 : 10_000;
    const timer = setInterval(tick, ms);
    return () => clearInterval(timer);
  }, [activeTradesList.length, botRunning]);

  useEffect(() => {
    const sig = activeTradesList.map((t) => t.id).join("|");
    const prev = prevActiveTradeIdsRef.current;
    if (sig && sig !== prev) {
      setIsTradeOpen(true);
      setIsScannerSettingsOpen(false);
      setIsBotSettingsOpen(false);
      setIsScanOpen(false);
    }
    prevActiveTradeIdsRef.current = sig;
  }, [activeTradesList]);

  useEffect(() => {
    if (runBotActiveTradeFocusNonce === 0) return;
    setIsTradeOpen(true);
    setIsScannerSettingsOpen(false);
    setIsBotSettingsOpen(false);
    setIsScanOpen(false);
    const id = requestAnimationFrame(() => {
      activeTradeSectionRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [runBotActiveTradeFocusNonce]);

  useEffect(() => {
    setJupiterPreview(null);
    setJupiterQuoteError(null);
    if (!pendingToken?.symbol) return;
    const ps = useRunBotTradeFormStore.getState().draft.positionSizeUsdt;
    setJupiterTxnBetUsdt(snapBetAmountUsdt(ps));
  }, [pendingToken?.symbol]);

  const jupiterImpliedUsdPerToken =
    jupiterPreview?.approxUsdPerToken != null &&
    Number.isFinite(Number(jupiterPreview.approxUsdPerToken))
      ? Number(jupiterPreview.approxUsdPerToken)
      : null;

  const formatBotLogTime = (iso) => {
    if (!iso) return "—";
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return d.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: true
    });
  };
  const botLogEntries = Array.isArray(botState?.logs) ? botState.logs.slice(0, 15) : [];

  return (
    <Card className="min-h-[calc(100vh-180px)] bg-[var(--panel)]">
      <CardContent className="flex h-full flex-col justify-between space-y-4 pt-5 text-sm text-[var(--text-muted)]">
        <div className="space-y-4">
          {botStateError ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
              {botState?.config ? (
                <>
                  <span className="font-medium text-[var(--text)]">Could not refresh from BFF.</span> Forms still
                  reflect the last loaded config; fix connectivity to port 3001.{" "}
                </>
              ) : (
                <>
                  <span className="font-medium text-[var(--text)]">Cannot reach the BFF bot API.</span> Forms use
                  built-in defaults until{" "}
                  <code className="rounded bg-black/10 px-1 dark:bg-white/10">/api/bot/state</code> succeeds (start{" "}
                  <code className="rounded bg-black/10 px-1 dark:bg-white/10">npm run dev</code> in{" "}
                  <code className="rounded bg-black/10 px-1 dark:bg-white/10">bff</code>).{" "}
                </>
              )}
              <span className="text-[var(--text-muted)]">{botStateError}</span>
            </p>
          ) : null}
          {isConfigsView ? (
            <>
            <div className="border-b border-[var(--border)] pb-3">
              <div className="-mx-1 flex min-w-0 items-baseline gap-3 overflow-x-auto px-1 whitespace-nowrap">
                <h2 className="shrink-0 text-lg font-semibold text-[var(--text)]">Configs</h2>
                <p className="mb-0 text-xs text-[var(--text-muted)]">
                  Scanner filters and bot trading rules. Save here, then start the bot from here or from{" "}
                  <span className="font-medium text-[var(--text)]">Run Bot</span> in the sidebar (same controls below).
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {botRunning ? (
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    className="h-9 shrink-0 rounded-md px-3 text-xs leading-none border-[#e50914] text-[#e50914] hover:bg-[#e50914]/10"
                    onClick={() => setIsStopModalOpen(true)}
                  >
                    Stop Bot
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    type="button"
                    className="h-9 shrink-0 rounded-md px-3 text-xs leading-none border border-[#e50914] bg-[#e50914] text-white hover:bg-[#c40710]"
                    onClick={() => void handleStart()}
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
                  className="h-9 shrink-0 rounded-md px-3 text-xs"
                  onClick={() => setActiveSection("runBot")}
                >
                  Open Run Bot
                </Button>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Scanned tokens, quote flow, and Active Trade table are on the{" "}
                <span className="font-medium text-[var(--text)]">Run Bot</span> page.
              </p>
            </div>
            </>
          ) : (
            <div className="flex flex-col gap-3 rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/30 px-3 py-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap items-center gap-2">
                {botRunning ? (
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    className="h-9 shrink-0 rounded-md px-3 text-xs leading-none border-[#e50914] text-[#e50914] hover:bg-[#e50914]/10"
                    onClick={() => setIsStopModalOpen(true)}
                  >
                    Stop Bot
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    type="button"
                    className="h-9 shrink-0 rounded-md px-3 text-xs leading-none border border-[#e50914] bg-[#e50914] text-white hover:bg-[#c40710]"
                    onClick={() => void handleStart()}
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
                  className="h-9 shrink-0 rounded-md px-3 text-xs"
                  onClick={() => setActiveSection("configs")}
                >
                  Open Configs
                </Button>
              </div>
              <p className="text-xs text-[var(--text-muted)]">
                Scanner limits and bet size live under{" "}
                <span className="font-medium text-[var(--text)]">Configs</span>.
              </p>
            </div>
          )}
          {botState ? (
            <AccordionSection
              title="BFF activity"
              isOpen={isBffActivityOpen}
              onToggle={() => setIsBffActivityOpen((prev) => !prev)}
              containerClassName="rounded-lg border border-[var(--border)] bg-[var(--panel-2)]/20"
              headerClassName="min-h-0 gap-2 px-3 py-2"
              titleClassName="text-xs font-semibold"
              iconClassName="h-5 w-5"
              contentClassName="border-t border-[var(--border)] px-2 pb-2 pt-0"
              headerRight={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-[#e50914] hover:text-[#c40710]"
                  onClick={() => setActiveSection("history")}
                >
                  Full Logs
                </Button>
              }
              headerRightWhenCollapsed={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs text-[#e50914] hover:text-[#c40710]"
                  onClick={() => setActiveSection("history")}
                >
                  Full Logs
                </Button>
              }
            >
              {botLogEntries.length > 0 ? (
                <div className="max-h-40 overflow-y-auto py-1 font-mono text-[11px] leading-relaxed">
                  {botLogEntries.map((entry, idx) => (
                    <div
                      key={`${entry.time}-${idx}`}
                      className="break-words border-b border-[var(--border)]/50 py-1.5 last:border-0"
                    >
                      <span className="text-[var(--text-muted)]">{formatBotLogTime(entry.time)}</span>{" "}
                      <span
                        className={
                          entry.level === "error"
                            ? "text-[#e50914]"
                            : entry.level === "warn"
                              ? "text-amber-600"
                              : "text-emerald-600"
                        }
                      >
                        [{entry.level}]
                      </span>{" "}
                      <span className="text-[var(--text)]">
                        {resolveTradeCooldownLogMessage(entry.message, {
                          botRunning,
                          tradeCooldownSeconds: botState?.config?.tradeCooldownSeconds,
                          lastMomentumTradeOpenedAt: botState?.lastMomentumTradeOpenedAt,
                          nowTs
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="px-1 py-3 text-xs text-[var(--text-muted)]">
                  No log lines yet. When the bot scans, you will see why a trade was skipped (e.g. gates, cooldown) here
                  and under Logs.
                </p>
              )}
            </AccordionSection>
          ) : null}
          {isConfigsView ? (
          <form className="space-y-4 pt-2">
            <AccordionSection
              title="Scanner Settings"
              isOpen={isScannerSettingsOpen}
              onToggle={() => setIsScannerSettingsOpen((prev) => !prev)}
              contentClassName="px-3 pb-0"
            >
              <div>
              <label className="mb-3 grid max-w-xs gap-1">
                <FieldLabel
                  id="executionMode"
                  label="Execution mode"
                  help="Paper: bot trades are simulated; you can still preview Jupiter quotes. Live (mainnet): shows Phantom signing for real USDT → token swaps on Solana in Quote and Sign. Use Save Config in this section or under Trade / Bot Settings — both persist execution mode when it changed."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  id="executionModeSelect"
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm text-[var(--input-fg)]"
                  value={tradeDraft.executionMode === "live" ? "live" : "paper"}
                  onChange={(event) =>
                    patchTradeDraft({
                      executionMode: event.target.value === "live" ? "live" : "paper"
                    })
                  }
                >
                  <option value="paper">Paper (simulated)</option>
                  <option value="live">Live (mainnet — Phantom)</option>
                </select>
              </label>
              <div className="grid gap-3 md:grid-cols-2">
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
              <div className="grid gap-1 sm:col-span-2">
                <FieldLabel
                  id="minEntryChart"
                  label="Min Entry Chart"
                  help="Scanner row only if every checked window is strictly positive (>0%): **2m** — Binance from 1m klines (close ~2m ago vs now); Dex approximates from m5/h1 (no native 2m). Other windows: Binance klines + 24h ticker; Dex priceChange (10m/15m/30m approximated when fields are missing). At least one box must stay on (default 5m). Momentum auto-entry still requires 5m micro-trend, flow, and MC gates when those are enabled."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <div className="flex flex-wrap gap-x-4 gap-y-2 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 py-2">
                  {MIN_ENTRY_CHART_TIMEFRAME_OPTIONS.map((tf) => {
                    const selected = scanDraft.minEntryChartTimeframes ?? ["5m"];
                    const checked = selected.includes(tf);
                    return (
                      <label key={tf} className="flex cursor-pointer items-center gap-2 text-sm text-[var(--text)]">
                        <input
                          type="checkbox"
                          className="h-4 w-4 rounded border-[var(--input-border)]"
                          checked={checked}
                          onChange={(event) => {
                            const set = new Set(selected);
                            if (event.target.checked) set.add(tf);
                            else set.delete(tf);
                            let next = MIN_ENTRY_CHART_TIMEFRAME_OPTIONS.filter((x) => set.has(x));
                            if (next.length === 0) next = ["5m"];
                            patchScanDraft({ minEntryChartTimeframes: next });
                          }}
                        />
                        <span>{tf}</span>
                      </label>
                    );
                  })}
                </div>
              </div>
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
                  <option value={100}>$100</option>
                  <option value={200}>$200</option>
                  <option value={500}>$500</option>
                  <option value={1000}>$1k</option>
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
              <label className="grid gap-1">
                <FieldLabel
                  id="maxMarketCap"
                  label="Max Market Cap"
                  help="Tokens with **reported** market cap (or FDV on Dex) **above** this are excluded from the scan list and from auto momentum entry. Use this to avoid very large caps that rarely move. **No limit** keeps previous behavior. Unknown MC is not treated as above max (Binance/Dex)."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={scanDraft.maxMarketCapUsd}
                  onChange={(event) =>
                    patchScanDraft({ maxMarketCapUsd: Number(event.target.value) })
                  }
                >
                  {MAX_MARKET_CAP_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="dexMinPairAge"
                  label="Min pair age (Dex)"
                  help="DexScreener safety filter: pool must be at least this old (from pairCreatedAt) before it can appear in the scanner. Shorter windows (e.g. 2 min) catch newer launches but increase sniper/rug noise. Default 30 minutes."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={scanDraft.dexMinPairAgeMinutes}
                  onChange={(event) =>
                    patchScanDraft({ dexMinPairAgeMinutes: Number(event.target.value) })
                  }
                >
                  {DEX_MIN_PAIR_AGE_MINUTES_OPTIONS.map((m) => (
                    <option key={m} value={m}>
                      {m} min
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
                    disabled={(!hasScannerDirty && !executionModeDirty) || isSavingScannerConfig}
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
              contentClassName="px-3 pb-0"
            >
              <div>
              <div className="grid gap-3 md:grid-cols-3">
              <label className="grid gap-1">
                <FieldLabel
                  id="amount"
                  label="Bet Amount (USDT)"
                  help="Position size per leg: $0.05–$1.00 in 5¢ steps, then $2–$10 (max). Pick small amounts when testing before live."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={tradeDraft.positionSizeUsdt}
                  onChange={(event) =>
                    patchTradeDraft({ positionSizeUsdt: Number(event.target.value) })
                  }
                >
                  {BET_AMOUNT_USDT_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {formatMoney(value)}
                    </option>
                  ))}
                </select>
                <p className="text-[10px] leading-snug text-[var(--text-muted)]">
                  Paper trades and manual live entries use this amount. Auto-sign live uses{" "}
                  <span className="font-medium text-[var(--text)]">Auto-sign bet</span> below.
                </p>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="maxSlippage"
                  label="Max slippage (%)"
                  help="Single setting for paper and live: max price movement you accept per swap. The BFF TradeEngine uses this (defaultMaxSlippagePercent) for Solana quotes; wire the same when Jupiter live executes. 0.5%–10% in 0.5% steps; default 2%."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={tradeDraft.maxSlippagePercent}
                  onChange={(event) =>
                    patchTradeDraft({ maxSlippagePercent: Number(event.target.value) })
                  }
                >
                  {MAX_SLIPPAGE_PERCENT_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}%
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="autoSignMainnet"
                  label="Auto-sign mainnet"
                  help="Live + Auto mode: BFF signs Jupiter buys/sells with SOLANA_AUTO_SIGN_SECRET_KEY. **Auto-sign bet** sets the USDT size for each **automatic** entry only (same presets as Bet Amount). On failure, slippage is retried from Max slippage % up to 10% in 0.5% steps. Set SOLANA_RPC_URL to a reliable mainnet HTTPS RPC."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={tradeDraft.executionMode !== "live"}
                  value={tradeDraft.autoSignMainnet ? "on" : "off"}
                  onChange={(event) =>
                    patchTradeDraft({ autoSignMainnet: event.target.value === "on" })
                  }
                >
                  <option value="off">Off — sign in Phantom</option>
                  <option value="on">On — server key (see help)</option>
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="autoSignBetUsdt"
                  label="Auto-sign bet (USDT)"
                  help="USDT notional for each **server-signed automatic** buy when Live + Auto-sign + Auto mode are on. Presets match Bet Amount ($0.05–$1 by 5¢, then $2–$10). Use small values for testing. Does not change paper trades or Phantom manual swaps."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  disabled={tradeDraft.executionMode !== "live"}
                  value={tradeDraft.autoSignBetUsdt ?? 0.2}
                  onChange={(event) =>
                    patchTradeDraft({ autoSignBetUsdt: Number(event.target.value) })
                  }
                >
                  {BET_AMOUNT_USDT_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {formatMoney(value)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="tradeCooldown"
                  label="Cooling time"
                  help="When Auto mode is running: seconds between automatic scans and minimum wait after an auto momentum entry before another auto entry. Set to 0 to disable entry cooldown; scans then run every 120s so the API is not hammered."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm"
                  value={tradeDraft.tradeCooldownSeconds ?? 0}
                  onChange={(event) =>
                    patchTradeDraft({ tradeCooldownSeconds: Number(event.target.value) })
                  }
                >
                  {TRADE_COOLDOWN_SECONDS_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
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
                  id="loopTime"
                  label="Loop Time"
                  help="UI-only loop speed selector for Bot Settings. Does not change backend/BFF behavior."
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm"
                  value={loopTimeMultiplier}
                  onChange={(event) => setLoopTimeMultiplier(Number(event.target.value))}
                >
                  {LOOP_TIME_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value}x
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <FieldLabel
                  id="tpUpward"
                  label="Take profit (upward)"
                  help={takeProfitUpwardHelp}
                  tipClassName="max-w-[min(26rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 shadow-lg"
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
                  <option value="multiplier_1">Multiplier 1x</option>
                  <option value="multiplier_2">Multiplier 2x</option>
                  <option value="multiplier_3">Multiplier 3x</option>
                  <option value="multiplier_4">Multiplier 4x</option>
                  <option value="multiplier_5">Multiplier 5x</option>
                  <option value="multiplier_6">Multiplier 6x</option>
                  <option value="multiplier_7">Multiplier 7x</option>
                  <option value="multiplier_8">Multiplier 8x</option>
                  <option value="multiplier_9">Multiplier 9x</option>
                  <option value="multiplier_10">Multiplier 10x</option>
                  <option value="none">Off</option>
                  <option value="custom" disabled={!upwardIsCustom}>
                    {upwardIsCustom ? "Custom (from saved config)" : "Custom"}
                  </option>
                </select>
              </label>
              <label className="grid gap-1 md:col-span-1">
                <FieldLabel
                  id="tpDownward"
                  label="Take profit (downward)"
                  help={takeProfitDownwardHelp}
                  tipClassName="max-w-[min(26rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 shadow-lg"
                  activeTip={activeTip}
                  onToggleTip={setActiveTip}
                />
                <select
                  className="h-9 w-full rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-sm disabled:cursor-not-allowed disabled:opacity-70"
                  value={downwardPresetKey}
                  onChange={(event) => {
                    const key = event.target.value;
                    const preset = DOWNWARD_PEAK_DIP_PRESETS[key];
                    if (!preset) return;
                    if (preset.steps === "none") {
                      patchTradeDraft({
                        dipStepsPercent: "",
                        dipStepSellFractions: "",
                        dipRetracementSteps: "none",
                        dipRetracementSellFractions: ""
                      });
                      return;
                    }
                    patchTradeDraft({
                      dipStepsPercent: preset.steps,
                      dipStepSellFractions: preset.fracs,
                      dipRetracementSteps: "none",
                      dipRetracementSellFractions: ""
                    });
                  }}
                >
                  <option value="linear_10">
                    Decent (1:1) — 10–100% off peak in 10% steps, sell 10%…100% of remaining (10 steps)
                  </option>
                  <option value="balanced">
                    Balanced — 10–40% off peak, sell 10%…60% of remaining (6 steps)
                  </option>
                  <option value="proportional_5">
                    Aggressive — 10–50% off peak, sell 10%…100% of remaining (5 steps)
                  </option>
                  <option value="none">Off (no peak-drawdown clips)</option>
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
                </div>
              </div>
              </div>
            </AccordionSection>
          </form>
          ) : null}
          {!isConfigsView ? (
          <>
          <AccordionSection
              title="Scanned Tokens"
              titleMeta={scannedTokensTitleMeta}
              isOpen={isScanOpen}
              onToggle={() => setIsScanOpen((prev) => !prev)}
              headerRight={
                <>
                  <Button
                    size="sm"
                    type="button"
                    variant="outline"
                    className="h-9 shrink-0 rounded-md px-3 text-xs leading-none border-[#e50914] text-[#e50914] hover:bg-[#e50914]/10"
                    onClick={() => {
                      setShowAutoStoppedScan(true);
                      void onAction("previewScan", { limit: scanLimitFilter, timeframe: scanTimeframeFilter });
                    }}
                  >
                    Refresh Scan
                  </Button>
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
              {dexMarketForPaste ? (
                <>
                  <div className="flex flex-col gap-2 rounded-md border border-[var(--border)]/60 bg-[var(--panel-2)]/20 p-2 sm:flex-row sm:items-center">
                    <input
                      type="text"
                      spellCheck={false}
                      autoComplete="off"
                      placeholder="Solana mint, pair id, or DexScreener link (e.g. …/solana/…)"
                      value={pasteAddress}
                      onChange={(event) => setPasteAddress(event.target.value)}
                      disabled={addDexTokenLoading}
                      className="h-9 min-w-0 flex-1 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-3 text-xs text-[var(--input-fg)] placeholder:text-[var(--text-muted)] disabled:opacity-60"
                    />
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="h-9 shrink-0 whitespace-nowrap rounded-md px-3 text-xs"
                      onClick={() => void handleAddPastedAddress()}
                      disabled={addDexTokenLoading || !pasteAddress.trim()}
                    >
                      {addDexTokenLoading ? (
                        <Loader2 className="mr-1.5 inline h-4 w-4 shrink-0 animate-spin" aria-hidden />
                      ) : null}
                      Add to results
                    </Button>
                  </div>
                  <p className="text-[10px] text-[var(--text-muted)]">
                    With <span className="font-medium text-[var(--text)]">Auto mode</span>, this token stays at the top of
                    each scan. You still use <span className="font-medium text-[var(--text)]">Buy (auto)</span> →{" "}
                    <span className="font-medium text-[var(--text)]">Confirm — arm</span> before the bot may enter.
                  </p>
                </>
              ) : (
                <p className="text-[10px] text-[var(--text-muted)]">
                  To paste a contract address and add it here, set{" "}
                  <button
                    type="button"
                    className="font-medium text-[#e50914] underline-offset-2 hover:underline"
                    onClick={() => setActiveSection("configs")}
                  >
                    Market source
                  </button>{" "}
                  to DexScreener in Configs.
                </p>
              )}
              <div
                className={`relative max-h-[260px] overflow-x-auto ${
                  scanTableLoading ? "min-h-[200px] overflow-y-hidden" : "overflow-y-auto"
                }`}
              >
                {scanTableLoading ? (
                  <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/50 dark:bg-black/20">
                    <Loader2
                      className="h-4 w-4 shrink-0 animate-spin text-[#E50914]"
                      aria-hidden
                    />
                    <span className="sr-only">Loading scanned tokens</span>
                    {isRunBotRequestPending && !previewScanLoading ? (
                      <span className="text-xs text-[var(--text-muted)]">Starting bot…</span>
                    ) : null}
                  </div>
                ) : null}
                <table className="w-full text-left text-xs">
                  <thead className="sticky top-0 z-10 bg-[var(--panel)]">
                    <tr className="border-b border-[var(--border)] text-[var(--text-muted)]">
                      <th className="py-2 pr-2">Token</th>
                      <th className="py-2 pr-2">Signal</th>
                      <th className="py-2 pr-2">Score</th>
                      <th
                        className="whitespace-nowrap py-2 pr-2 tabular-nums"
                        title={
                          botState?.config?.marketSource === "dexscreener"
                            ? "Pair USD price from DexScreener (priceUsd on the pool)."
                            : "Last traded price (USD) for the symbol."
                        }
                      >
                        Price
                      </th>
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
                      {showScanPairAgeColumn ? (
                        <th
                          className="whitespace-nowrap py-2 pr-2"
                          title="Time since the DEX pool was created (DexScreener pairCreatedAt)."
                        >
                          Pair age
                        </th>
                      ) : null}
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
                    {!scanTableLoading && scannedTokensForUi.length === 0 ? (
                      <tr>
                        <td className="py-3 text-[var(--text-muted)]" colSpan={scanTableColSpan}>
                          {autoStopped && !showAutoStoppedScan
                            ? "No scan yet — start Run Bot (Auto) or Refresh Scan."
                            : "No scanned tokens yet. Click Refresh Scan."}
                        </td>
                      </tr>
                    ) : !scanTableLoading ? (
                      sortedScannedTokens.map((token) => {
                        const isActive = activeTradesList.some((t) => t.symbol === token.symbol);
                        const atMaxOpenLegs = activeTradesList.length >= 2;
                        const isRowSelected = pendingToken?.symbol === token.symbol;
                        return (
                          <tr
                            key={token.symbol}
                            className={`border-b border-[var(--border)]/60 ${
                              isRowSelected ? "bg-[var(--brand-soft)]/40" : ""
                            }`}
                          >
                            <td className="py-2 pr-2 align-middle">
                              {(() => {
                                const name = (token.baseAsset && String(token.baseAsset).trim()) || "";
                                const href = chartHrefForScannedToken(token);
                                const pairLabel = formatUsdtPair(token.symbol);
                                const linkBody =
                                  !name ? (
                                    "—"
                                  ) : href ? (
                                    <a
                                      className="font-medium text-[#E50914] underline-offset-2 hover:underline"
                                      href={href}
                                      rel="noreferrer"
                                      target="_blank"
                                    >
                                      {name}
                                    </a>
                                  ) : (
                                    name
                                  );
                                return (
                                  <div className="min-w-0">
                                    <p className="text-sm font-medium leading-snug text-[var(--text)]">{linkBody}</p>
                                    {pairLabel ? (
                                      <p className="mt-0.5 text-[11px] text-[var(--text-muted)]">{pairLabel}</p>
                                    ) : null}
                                  </div>
                                );
                              })()}
                            </td>
                            <td className="py-2 pr-2 uppercase">{token.signal?.replace("_", " ")}</td>
                            <td className="py-2 pr-2">{token.score}</td>
                            <td className="py-2 pr-2 tabular-nums text-[var(--text)]">
                              {Number.isFinite(Number(token.lastPrice)) ? formatMoney(token.lastPrice) : "n/a"}
                            </td>
                            <td className="py-2 pr-2">
                              {formatGainLossPercent(getTokenGainSortValue(token, gainSortMetric))}
                            </td>
                            {showScanPairAgeColumn ? (
                              <td className="py-2 pr-2 tabular-nums whitespace-nowrap">
                                {formatPairAge(token.pairListedAtMs)}
                              </td>
                            ) : null}
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
                                variant={isActive ? "outline" : isRowSelected ? "outline" : "default"}
                                className={
                                  isActive
                                    ? "border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
                                    : isRowSelected
                                      ? "border-emerald-600 text-emerald-700 hover:bg-emerald-600/10"
                                      : ""
                                }
                                onClick={() => {
                                  if (isActive) return;
                                  togglePendingToken(token);
                                }}
                                disabled={isActive}
                                title={
                                  atMaxOpenLegs && !isActive
                                    ? autoModeEffective
                                      ? "Select a row, then use Auto below. New entries wait until a leg is closed."
                                      : "You can review the quote below; confirm stays disabled until a leg is closed."
                                    : undefined
                                }
                              >
                                {isActive
                                  ? "In position"
                                  : autoModeEffective
                                    ? isRowSelected
                                      ? "Selected"
                                      : "Select"
                                    : isRowSelected
                                      ? "Selected"
                                      : "Select for quote"}
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
            {showManualQuoteAccordion ? (
            <AccordionSection
              title={
                pendingToken && pendingIsSolanaMint ? "Quote and Sign (Jupiter)" : "Quote and Sign"
              }
              isOpen={isQuoteSignOpen}
              onToggle={() => setIsQuoteSignOpen((prev) => !prev)}
              contentClassName="px-3 pb-3"
            >
              <div className="space-y-3 pt-2">
                {!pendingToken ? (
                  <p className="text-xs text-[var(--text-muted)]">
                    In <span className="font-medium text-[var(--text)]">Scanned Tokens</span>, click{" "}
                    <span className="font-medium text-[var(--text)]">Select for quote</span> on a row. Review the summary
                    here, then confirm to open the paper position.
                  </p>
                ) : (
                  <>
                    <div className="rounded-lg border border-[var(--border)]/80 bg-[var(--panel-2)]/30 p-3 text-xs">
                      {pendingIsSolanaMint ? (
                        <div className="flex w-full min-w-0 flex-nowrap items-end justify-between gap-x-3 overflow-visible pb-1">
                          <div className="min-w-0 max-w-[min(18rem,32%)] shrink">
                            <p className="text-xs font-medium text-[var(--text-muted)]">Token</p>
                            <p className="mt-0.5 truncate font-medium text-[var(--text)]">
                              {formatPaperTradeTokenLabel(pendingToken)}
                            </p>
                          </div>
                          <div className="min-w-[6.5rem] shrink-0">
                            <FieldLabel
                              id="quotePairPriceSol"
                              label="Pair price (USD)"
                              help="After **Refresh**, this is the implied USDT per output token from the Jupiter quote (same as “Implied price” below). Before a quote, it shows the scan’s DexScreener USD pair price."
                              activeTip={activeTip}
                              onToggleTip={setActiveTip}
                              tipClassName="max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-relaxed text-[var(--text)] shadow-lg"
                            />
                            <p className="mt-0.5 truncate tabular-nums text-[var(--text)]">
                              {jupiterImpliedUsdPerToken != null
                                ? formatMoney(jupiterImpliedUsdPerToken)
                                : Number.isFinite(Number(pendingToken.lastPrice))
                                  ? formatMoney(pendingToken.lastPrice)
                                  : Number.isFinite(Number(pendingToken.ask))
                                    ? formatMoney(pendingToken.ask)
                                    : "—"}
                            </p>
                          </div>
                          <div className="min-w-[4.5rem] shrink-0">
                            <FieldLabel
                              id="quoteMaxSlippageDisplay"
                              label="Max slippage (%)"
                              help="From Bot Settings. Used for Jupiter quotes/swaps and the trade engine; change under Configs → Bot Settings."
                              activeTip={activeTip}
                              onToggleTip={setActiveTip}
                              tipClassName="max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-relaxed text-[var(--text)] shadow-lg"
                            />
                            <p className="mt-0.5 truncate text-[11px] tabular-nums text-[var(--text)]">
                              {tradeDraft.maxSlippagePercent != null && tradeDraft.maxSlippagePercent !== undefined
                                ? `${tradeDraft.maxSlippagePercent}%`
                                : "—"}
                            </p>
                          </div>
                          <div className="shrink-0">
                            <label
                              className="grid w-max gap-0.5 text-[10px] text-[var(--text-muted)]"
                              htmlFor="quoteJupiterOutDecimals"
                              title="Token decimals for quote display / min-out formatting"
                            >
                              Decimals
                              <select
                                id="quoteJupiterOutDecimals"
                                className="h-6 w-11 rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1 text-center text-xs text-[var(--input-fg)]"
                                value={jupiterOutputDecimals}
                                onChange={(event) => setJupiterOutputDecimals(Number(event.target.value))}
                              >
                                <option value={6}>6</option>
                                <option value={9}>9</option>
                              </select>
                            </label>
                          </div>
                          <div className="grid w-[6rem] shrink-0 gap-0.5 text-[10px] text-[var(--text-muted)]">
                            <FieldLabel
                              id="quoteBetUsdtSol"
                              label="Bet (USDT)"
                              help="Same presets as Bot Settings. Used only for this Jupiter quote and swap — saved bot bet is unchanged."
                              activeTip={activeTip}
                              onToggleTip={setActiveTip}
                              tipClassName="max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-relaxed text-[var(--text)] shadow-lg"
                            />
                            <select
                              className="h-6 w-full rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1.5 text-[11px] leading-none text-[var(--input-fg)]"
                              value={jupiterTxnBetUsdt}
                              onChange={(event) => {
                                setJupiterTxnBetUsdt(Number(event.target.value));
                                setJupiterPreview(null);
                                setJupiterQuoteError(null);
                              }}
                            >
                              {BET_AMOUNT_USDT_OPTIONS.map((value) => (
                                <option key={value} value={value}>
                                  {formatMoney(value)}
                                </option>
                              ))}
                            </select>
                          </div>
                          <div className="relative shrink-0" data-tooltip-root="true">
                            <div className="inline-flex h-8 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--panel)] shadow-sm">
                              <button
                                type="button"
                                className="inline-flex h-full items-center gap-1.5 border-r border-[var(--border)] px-3 text-xs text-[var(--text)] hover:bg-[var(--panel-2)]/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)] disabled:opacity-50"
                                onClick={() => void handleJupiterQuotePreview()}
                                disabled={jupiterQuoteLoading}
                                title="Fetch a Jupiter quote (routes and min-out change as the market moves)."
                              >
                                {jupiterQuoteLoading ? (
                                  <Loader2 className="h-4 w-4 shrink-0 animate-spin" aria-hidden />
                                ) : (
                                  <RefreshCw className="h-3.5 w-3.5 shrink-0" aria-hidden />
                                )}
                                Refresh
                              </button>
                              <button
                                type="button"
                                className="inline-flex h-full items-center justify-center bg-[var(--panel-2)]/40 px-2 text-[var(--text-muted)] hover:bg-[var(--panel-2)]/70 hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--panel)]"
                                aria-expanded={activeTip === "jupiterQuoteInfo"}
                                aria-label="Jupiter quote and swap details"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setActiveTip(activeTip === "jupiterQuoteInfo" ? null : "jupiterQuoteInfo");
                                }}
                              >
                                <Info className="h-3.5 w-3.5 shrink-0" aria-hidden />
                              </button>
                            </div>
                            {activeTip === "jupiterQuoteInfo" ? (
                              <div
                                className="absolute right-0 bottom-full z-[100] mb-1 w-[min(28rem,calc(100vw-2rem))] rounded-lg border border-[var(--border)] bg-[var(--panel)] p-4 text-sm leading-relaxed text-[var(--text)] shadow-lg"
                                role="tooltip"
                              >
                                <div className="space-y-3">
                                  <p>
                                    Fetches a real <span className="font-medium">ExactIn</span> quote (USDT → token) from
                                    Jupiter.{" "}
                                    {tradeDraft.executionMode === "live" ? (
                                      <>
                                        With <span className="font-medium">Live</span> mode, use{" "}
                                        <span className="font-medium">Sign &amp; send swap</span> below with Phantom for a
                                        mainnet transaction.{" "}
                                      </>
                                    ) : (
                                      <>
                                        Set <span className="font-medium">Execution mode</span> to{" "}
                                        <span className="font-medium">Live (mainnet)</span> in Configs to show on-chain
                                        signing.{" "}
                                      </>
                                    )}
                                    Quote bet and max slippage from Bot Settings are sent to the API.
                                  </p>
                                  <p className="text-[var(--text-muted)]">
                                    Jupiter swap spends SPL USDT, not USDC. Phantom, fees, quote refresh, and why Active
                                    trades stays paper-only:
                                  </p>
                                  <p className="text-[var(--text)]">{LIVE_MAINNET_SWAP_HELP}</p>
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-8 shrink-0 rounded-md px-3 text-xs"
                            onClick={() => clearPendingToken()}
                          >
                            Clear selection
                          </Button>
                        </div>
                      ) : (
                        <div className="grid min-w-0 grid-cols-1 gap-x-2 gap-y-2 sm:grid-cols-2 md:grid-cols-4">
                          <div className="min-w-0">
                            <FieldLabel
                              id="quoteToken"
                              label="Token"
                              help="Token selected from Scanned Tokens for this quote."
                              activeTip={activeTip}
                              onToggleTip={setActiveTip}
                              tipClassName="max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-relaxed text-[var(--text)] shadow-lg"
                            />
                            <p className="mt-0.5 truncate font-medium text-[var(--text)]">
                              {formatPaperTradeTokenLabel(pendingToken)}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <FieldLabel
                              id="quotePairPrice"
                              label="Pair price (USD)"
                              help="Same figure DexScreener exposes as the pair’s USD price on the last bot scan. The live site can differ slightly after new trades or a refresh."
                              activeTip={activeTip}
                              onToggleTip={setActiveTip}
                              tipClassName="max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-relaxed text-[var(--text)] shadow-lg"
                            />
                            <p className="mt-0.5 truncate tabular-nums text-[var(--text)]">
                              {Number.isFinite(Number(pendingToken.lastPrice))
                                ? formatMoney(pendingToken.lastPrice)
                                : Number.isFinite(Number(pendingToken.ask))
                                  ? formatMoney(pendingToken.ask)
                                  : "—"}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <FieldLabel
                              id="quoteMaxSlippageDisplay"
                              label="Max slippage (%)"
                              help="From Bot Settings. Used for Jupiter quotes/swaps and the trade engine; change under Configs → Bot Settings."
                              activeTip={activeTip}
                              onToggleTip={setActiveTip}
                              tipClassName="max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-relaxed text-[var(--text)] shadow-lg"
                            />
                            <p className="mt-0.5 truncate text-[11px] tabular-nums text-[var(--text)]">
                              {tradeDraft.maxSlippagePercent != null && tradeDraft.maxSlippagePercent !== undefined
                                ? `${tradeDraft.maxSlippagePercent}%`
                                : "—"}
                            </p>
                          </div>
                          <div className="min-w-0">
                            <FieldLabel
                              id="quoteBetUsdt"
                              label="Bet (USDT)"
                              help="Same presets as Bot Settings. Updates the trade draft used when you confirm a paper trade; Save Config in Bot Settings to persist."
                              activeTip={activeTip}
                              onToggleTip={setActiveTip}
                              tipClassName="max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-relaxed text-[var(--text)] shadow-lg"
                            />
                            <select
                              className="mt-0.5 h-6 w-full max-w-[5.75rem] rounded border border-[var(--input-border)] bg-[var(--input-bg)] px-1.5 py-0 text-[11px] leading-none text-[var(--input-fg)]"
                              value={tradeDraft.positionSizeUsdt}
                              onChange={(event) =>
                                patchTradeDraft({ positionSizeUsdt: Number(event.target.value) })
                              }
                            >
                              {BET_AMOUNT_USDT_OPTIONS.map((value) => (
                                <option key={value} value={value}>
                                  {formatMoney(value)}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      )}
                      {pendingIsSolanaMint ? (
                        <>
                          {jupiterQuoteError ? (
                            <p className="mt-2 text-xs text-[#e50914]">{jupiterQuoteError}</p>
                          ) : null}
                          {jupiterPreview ? (
                            <dl className="mt-3 grid gap-x-3 gap-y-1 text-[11px] sm:grid-cols-2">
                              <dt className="text-[var(--text-muted)]">Spend (USDT, est.)</dt>
                              <dd className="tabular-nums text-[var(--text)]">
                                {formatMoney(jupiterPreview.spendUsd)}
                              </dd>
                              <dt className="text-[var(--text-muted)]">≈ Tokens received</dt>
                              <dd className="tabular-nums text-[var(--text)]">
                                {jupiterPreview.approxOutTokens != null
                                  ? jupiterPreview.approxOutTokens.toLocaleString(undefined, {
                                      maximumSignificantDigits: 8
                                    })
                                  : "—"}{" "}
                                <span className="text-[10px] text-[var(--text-muted)]">
                                  ({jupiterOutputDecimals} dec)
                                </span>
                              </dd>
                              <dt className="text-[var(--text-muted)]">Implied price (USDT / token)</dt>
                              <dd className="tabular-nums text-[var(--text)]">
                                {jupiterPreview.approxUsdPerToken != null &&
                                Number.isFinite(Number(jupiterPreview.approxUsdPerToken))
                                  ? formatMoney(jupiterPreview.approxUsdPerToken)
                                  : "—"}
                                <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">
                                  from quote out
                                </span>
                              </dd>
                              <dt className="text-[var(--text-muted)]">Worst price (USDT / token, min out)</dt>
                              <dd className="tabular-nums text-[var(--text)]">
                                {jupiterPreview.worstUsdPerToken != null &&
                                Number.isFinite(Number(jupiterPreview.worstUsdPerToken))
                                  ? formatMoney(jupiterPreview.worstUsdPerToken)
                                  : "—"}
                                <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">
                                  slippage floor
                                </span>
                              </dd>
                              <dt className="text-[var(--text-muted)]">Min out (raw)</dt>
                              <dd className="break-all font-mono text-[10px] text-[var(--text)]">
                                {jupiterPreview.otherAmountThreshold}
                              </dd>
                              <dt className="text-[var(--text-muted)]">Price impact</dt>
                              <dd className="tabular-nums text-[var(--text)]">
                                {jupiterPreview.priceImpactPct != null
                                  ? `${jupiterPreview.priceImpactPct}%`
                                  : "—"}
                              </dd>
                              <dt className="text-[var(--text-muted)]">Route hops</dt>
                              <dd className="tabular-nums text-[var(--text)]">{jupiterPreview.routeHops}</dd>
                              <dt className="text-[var(--text-muted)]">Slippage</dt>
                              <dd className="tabular-nums text-[var(--text)]">
                                {jupiterPreview.slippageBps} bps
                                {Number.isFinite(Number(jupiterPreview.slippageBps)) ? (
                                  <span className="ml-1 text-[10px] font-normal text-[var(--text-muted)]">
                                    (= {(Number(jupiterPreview.slippageBps) / 100).toFixed(2)}% — 100 bps per 1%)
                                  </span>
                                ) : null}
                              </dd>
                            </dl>
                          ) : null}
                          {tradeDraft.executionMode === "live" ? (
                            <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)]/60 pt-3">
                              <JupiterWalletBar
                                showHelp={false}
                                outputMint={pendingToken.metadata.contractAddress}
                                amountUsd={jupiterTxnBetUsdt}
                                maxSlippagePercent={tradeDraft.maxSlippagePercent ?? 2}
                                disabledReason={
                                  !Number.isFinite(Number(jupiterTxnBetUsdt)) ||
                                  Number(jupiterTxnBetUsdt) < 0.01
                                    ? "Set bet (USDT) to at least 0.01 for Jupiter."
                                    : null
                                }
                                onSwapConfirmed={async (txSig) => {
                                  const live = tradeDraft.executionMode === "live";
                                  const token = pendingToken;
                                  const mint = token?.metadata?.contractAddress;
                                  const chain = String(token?.metadata?.chain ?? "").toLowerCase();
                                  if (!live || !token || !mint || chain !== "solana") {
                                    throw new Error(
                                      "Swap confirmed, but quote context changed before we could record Active Trades."
                                    );
                                  }

                                  let quantityTokens = null;
                                  let entryPriceUsd = null;
                                  let tokenDecimals = jupiterOutputDecimals;
                                  const qty = jupiterPreview?.approxOutTokens;
                                  if (qty != null && Number.isFinite(Number(qty))) {
                                    quantityTokens = Number(qty);
                                    entryPriceUsd =
                                      jupiterPreview?.worstUsdPerToken != null &&
                                      Number.isFinite(Number(jupiterPreview.worstUsdPerToken))
                                        ? Number(jupiterPreview.worstUsdPerToken)
                                        : Number(token.ask);
                                  } else {
                                    // Fallback: parse the confirmed tx from chain if local quote preview was cleared/stale.
                                    const inferredBody = await inferMainnetBuyFromTx({ signature: txSig });
                                    const inf = inferredBody?.inferred;
                                    if (!inf) {
                                      throw new Error(
                                        "Swap confirmed on-chain, but app could not infer quantity/entry from tx."
                                      );
                                    }
                                    quantityTokens = Number(inf.quantityTokens);
                                    entryPriceUsd = Number(inf.entryPriceUsd);
                                    tokenDecimals = Number(inf.tokenDecimals ?? tokenDecimals);
                                  }

                                  if (
                                    !Number.isFinite(Number(quantityTokens)) ||
                                    Number(quantityTokens) <= 0 ||
                                    !Number.isFinite(Number(entryPriceUsd)) ||
                                    Number(entryPriceUsd) <= 0
                                  ) {
                                    throw new Error(
                                      "Swap confirmed on-chain, but derived quantity/entry was invalid for Active Trades."
                                    );
                                  }

                                  await registerMainnetOpenBot({
                                    symbol: token.symbol,
                                    baseAsset: token.baseAsset,
                                    entryPriceUsd: Number(entryPriceUsd),
                                    quantityTokens: Number(quantityTokens),
                                    positionSizeUsdt: Number(jupiterTxnBetUsdt),
                                    outputMint: mint,
                                    tokenDecimals: Number(tokenDecimals),
                                    txSignature: txSig,
                                    dexChainId: token.metadata?.dexChainId,
                                    dexPairAddress: token.metadata?.dexPairAddress,
                                    chartUrl: token.links?.binance
                                  });
                                  await useBotStore.getState().loadBotState();
                                  clearPendingToken();
                                  toast.success("Swap confirmed and added to Active Trades.");
                                }}
                              />
                            </div>
                          ) : null}
                        </>
                      ) : null}
                      {tradeDraft.executionMode !== "live" ? (
                      <p className="mt-3 flex items-start gap-1.5 border-t border-[var(--border)]/80 pt-3 text-[11px] leading-relaxed text-[var(--text-muted)]">
                        <span className="relative inline-flex shrink-0" data-tooltip-root="true">
                          <button
                            type="button"
                            className="mt-0.5 inline-flex rounded text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--panel)]"
                            aria-expanded={activeTip === "quotePaperConfirmInfo"}
                            aria-label="Paper confirm and Solana swap flow"
                            onClick={(event) => {
                              event.preventDefault();
                              event.stopPropagation();
                              setActiveTip(activeTip === "quotePaperConfirmInfo" ? null : "quotePaperConfirmInfo");
                            }}
                          >
                            <Info className="h-3.5 w-3.5" aria-hidden />
                          </button>
                          {activeTip === "quotePaperConfirmInfo" ? (
                            <div
                              className="absolute left-0 top-full z-20 mt-1 max-w-[min(22rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-relaxed text-[var(--text)] shadow-lg"
                              role="tooltip"
                            >
                              <p>
                                Confirm uses <span className="font-medium">Paper buy</span> as the entry, not the pair
                                headline alone. On Solana, <span className="font-medium">Refresh</span>{" "}
                                previews the route; with <span className="font-medium">Execution mode Live</span>, connect
                                Phantom and use <span className="font-medium">Sign &amp; send swap</span>.
                              </p>
                            </div>
                          ) : null}
                        </span>
                        <span className="min-w-0">
                          <span className="font-medium text-[var(--text)]">Paper confirm</span> vs pair headline; Solana{" "}
                          <span className="font-medium text-[var(--text)]">Refresh</span> then{" "}
                          <span className="font-medium text-[var(--text)]">Live</span> + Phantom.{" "}
                          <span className="text-[var(--text-muted)]">Full explanation in the info panel.</span>
                        </span>
                      </p>
                      ) : null}
                      {tradeDraft.executionMode !== "live" ? (
                      <div className="mt-3 flex flex-col items-stretch gap-2 sm:items-end">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)] sm:text-right">
                          Actions
                        </p>
                        <div className="flex flex-wrap justify-end gap-2 rounded-md border border-[var(--border)]/80 bg-[var(--panel)]/50 p-2">
                          <Button
                            type="button"
                            size="sm"
                            className="h-9 shrink-0 rounded-md px-3 text-xs border border-[#e50914] bg-[#e50914] text-white hover:bg-[#c40710]"
                            onClick={() => void handleConfirmPaperTrade()}
                            disabled={
                              !pendingToken?.symbol ||
                              activeTradesList.some((t) => t.symbol === pendingToken.symbol) ||
                              activeTradesList.length >= 2
                            }
                            title={
                              activeTradesList.length >= 2 &&
                              !activeTradesList.some((t) => t.symbol === pendingToken.symbol)
                                ? "Maximum 2 open paper trades. Close a leg to start another."
                                : undefined
                            }
                          >
                            Confirm paper trade
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 shrink-0 rounded-md px-3 text-xs border-[var(--border)]"
                            onClick={() => void handleReQuote()}
                            disabled={previewScanLoading || !pendingToken?.symbol}
                            title="Refresh scan prices for this token (same limit and timeframe as Scanned Tokens)."
                          >
                            {previewScanLoading ? (
                              <Loader2 className="mr-1.5 inline h-4 w-4 shrink-0 animate-spin" aria-hidden />
                            ) : null}
                            ReQuote
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 shrink-0 rounded-md px-3 text-xs"
                            onClick={() => clearPendingToken()}
                          >
                            Clear selection
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 shrink-0 rounded-md px-3 text-xs"
                            onClick={() => setActiveSection("configs")}
                          >
                            Edit settings
                          </Button>
                        </div>
                      </div>
                      ) : !pendingIsSolanaMint ? (
                      <div className="mt-3 flex flex-col items-stretch gap-2 border-t border-[var(--border)]/80 pt-3 sm:items-end">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)] sm:text-right">
                          Actions
                        </p>
                        <div className="flex flex-wrap justify-end gap-2 rounded-md border border-[var(--border)]/80 bg-[var(--panel)]/50 p-2">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 shrink-0 rounded-md px-3 text-xs border-[var(--border)]"
                            onClick={() => void handleReQuote()}
                            disabled={previewScanLoading || !pendingToken?.symbol}
                            title="Refresh scan prices for this token (same limit and timeframe as Scanned Tokens)."
                          >
                            {previewScanLoading ? (
                              <Loader2 className="mr-1.5 inline h-4 w-4 shrink-0 animate-spin" aria-hidden />
                            ) : null}
                            ReQuote
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 shrink-0 rounded-md px-3 text-xs"
                            onClick={() => clearPendingToken()}
                          >
                            Clear selection
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 shrink-0 rounded-md px-3 text-xs"
                            onClick={() => setActiveSection("configs")}
                          >
                            Edit settings
                          </Button>
                        </div>
                      </div>
                      ) : null}
                    </div>
                  </>
                )}
              </div>
            </AccordionSection>
            ) : null}
            {autoModeEffective ? (
              <AccordionSection
                title="Auto entry"
                isOpen={isAutoBuyPanelOpen}
                onToggle={() => setIsAutoBuyPanelOpen((prev) => !prev)}
                contentClassName="px-3 pb-3"
              >
                <div className="space-y-3 pt-2 text-xs text-[var(--text-muted)]">
                  {!pendingToken ? (
                    <p>
                      Choose <span className="font-medium text-[var(--text)]">Select</span> on a row in Scanned Tokens,
                      then click <span className="font-medium text-[var(--text)]">Auto</span> here. The bot must be
                      running.
                    </p>
                  ) : (
                    <>
                      <div className="rounded-lg border border-[var(--border)]/80 bg-[var(--panel-2)]/30 p-3">
                        <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--text-muted)]">
                          Selected
                        </p>
                        <p className="mt-0.5 font-medium text-[var(--text)]">
                          {formatPaperTradeTokenLabel(pendingToken)}
                        </p>
                      </div>
                      {!botRunning ? (
                        <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-900 dark:text-amber-100">
                          <span className="font-medium text-[var(--text)]">Bot is not running.</span> Start{" "}
                          <span className="font-medium text-[var(--text)]">Run Bot (Auto)</span>, then click Auto.
                        </p>
                      ) : null}
                      {tokenMatchesAutoArmRow(pendingToken, botState?.autoEntryTarget) ? (
                        <p className="text-[var(--text)]">
                          <span className="font-medium text-emerald-600 dark:text-emerald-400">Auto is set</span> for this
                          token. Scanner gates still apply.
                        </p>
                      ) : null}
                      <div className="flex flex-wrap items-center gap-2">
                        {!tokenMatchesAutoArmRow(pendingToken, botState?.autoEntryTarget) ? (
                          <Button
                            type="button"
                            size="sm"
                            className="h-9 rounded-md border border-[#e50914] bg-[#e50914] px-4 text-xs font-medium text-white hover:bg-[#c40710] disabled:opacity-50"
                            disabled={isArmingAuto || !botRunning}
                            title={!botRunning ? "Start the bot first" : undefined}
                            onClick={() => void handleConfirmAutoArm()}
                          >
                            {isArmingAuto ? "…" : "Auto"}
                          </Button>
                        ) : null}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          className="h-9 text-xs"
                          onClick={() => clearPendingToken()}
                        >
                          Clear selection
                        </Button>
                        {botState?.autoEntryTarget ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-9 text-xs"
                            disabled={isArmingAuto}
                            onClick={() => void handleClearAutoArm()}
                          >
                            Clear auto token
                          </Button>
                        ) : null}
                      </div>
                    </>
                  )}
                </div>
              </AccordionSection>
            ) : null}
          <div ref={activeTradeSectionRef} className="scroll-mt-6">
          <AccordionSection
            title={activeTradesList.length > 1 ? "Active Trades" : "Active Trade"}
            isOpen={isTradeOpen}
            onToggle={() => setIsTradeOpen((prev) => !prev)}
            headerRight={
              isTradeOpen ? (
                <button
                  type="button"
                  className="rounded-md border border-[var(--border)] bg-[var(--panel)] px-2.5 py-1 text-xs font-medium text-[var(--text)] hover:bg-[var(--panel-muted)]"
                  aria-expanded={isMissedBuyFormOpen}
                  aria-controls="missed-mainnet-buy-form"
                  onClick={(e) => {
                    e.stopPropagation();
                    setIsMissedBuyFormOpen((open) => !open);
                  }}
                >
                  {isMissedBuyFormOpen ? "Hide missed buy" : "Missed buy"}
                </button>
              ) : null
            }
            headerRightWhenCollapsed={
              activeTrade ? (
                <span
                  className={`inline-flex items-center rounded-md border px-2 py-1 text-xs font-medium ${collapsedPnlClass}`}
                >
                  {activeTradesList.length > 1 ? `${activeTradesList.length} legs · ` : null}
                  <span
                    title="Total vs bet: realized from all P-SELLs + unrealized on remaining at current mark."
                  >
                    Net PnL: {formatPercent(activeTrade.pnlPercent)} ({formatMoney(activeTrade.pnlUsdt)})
                  </span>
                  {activeTradesList.length > 1 ? " (1st leg)" : null}
                </span>
              ) : null
            }
          >
          <div className="rounded-lg bg-[var(--panel)] p-3 text-sm">
            {isMissedBuyFormOpen ? (
              <ManualMainnetRecordForm prefillToken={pendingToken} id="missed-mainnet-buy-form" />
            ) : null}
            {activeTradesList.length > 0 ? (
              <div className="mt-1 overflow-hidden rounded-xl border border-[var(--border)]">
                <div className="overflow-x-auto">
                  <table
                    className="w-full border-collapse text-left text-sm [&_thead_th]:text-center [&_thead_th:not(:first-child)]:border-l [&_thead_th:not(:first-child)]:border-[var(--border)] [&_thead_th:not(:first-child)]:pl-2 [&_tbody>tr>td:not(:first-child)]:border-l [&_tbody>tr>td:not(:first-child)]:border-[var(--border)] [&_tbody>tr>td:not(:first-child)]:pl-2 [&_tbody>tr:last-child]:border-b-0"
                  >
                  <thead>
                    <tr className="border-b border-[var(--border)] text-xs font-medium text-[var(--text-muted)]">
                      <th className="py-2 pr-2">Token</th>
                      <th className="py-2 pr-2">Type</th>
                      <th className="py-2 pr-2">Bet Amount</th>
                      <th className="py-2 pr-2">%age Sold</th>
                      <th className="py-2 pr-2">
                        <div className="leading-tight">
                          <span className="block">Buy price</span>
                          <span className="my-1 block border-t border-[var(--border)] pt-1">Current</span>
                        </div>
                      </th>
                      <th
                        className="py-2 pr-2"
                        title="Total net PnL: dollar amount (realized + unrealized at mark), then % vs original bet for this leg."
                      >
                        <div className="leading-tight">
                          <span className="block">Net PnL</span>
                          <span className="my-1 block border-t border-[var(--border)] pt-1">Net PnL (%)</span>
                        </div>
                      </th>
                      <th
                        className="py-2 pr-2"
                        title="Unrealized PnL on tokens still held: % of bet and USDT at current mark."
                      >
                        PnL (Open)
                      </th>
                      <th
                        className="py-2 pr-2"
                        title="Realized PnL from partial / full sells already settled on this leg: % of bet and USDT."
                      >
                        PnL (Close)
                      </th>
                      <th className="py-2 pr-2">Time Bought</th>
                      <th
                        className="py-2 pr-2"
                        title="Elapsed since open, then time left before max-hold auto close."
                      >
                        <div className="leading-tight">
                          <span className="block">Time Spent</span>
                          <span className="my-1 block border-t border-[var(--border)] pt-1">Time Remaining</span>
                        </div>
                      </th>
                      <th className="py-2 pr-2">Extend Time</th>
                      <th className="max-w-[222px] py-2 px-2">Why Bought</th>
                      <th className="py-2 px-2">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeTradesList.map((row, legIdx) => {
                      const rowPnl = pnlClassFor(row);
                      const soldPct = soldPercentFor(row);
                      const why = row.entryReason ?? "Momentum entry based on scan factors.";
                      const maxSlip = Number(
                        botState?.config?.maxSlippagePercent ?? tradeDraft.maxSlippagePercent ?? 2
                      );
                      const activeTradesColSpan = 13;
                      const legBet = row.positionSizeUsdt ?? botState?.config?.positionSizeUsdt;
                      const openPctOfBet = pnlPctOfBet(row.unrealizedPnlUsdt, legBet);
                      const closePctOfBet = pnlPctOfBet(row.realizedPnlUsdt, legBet);
                      const openClass = gainLossClassFromNumber(openPctOfBet);
                      const closeClass = gainLossClassFromNumber(closePctOfBet);
                      const entryPx = Number(row.entryPrice);
                      const curPx = Number(row.currentPrice);
                      const currentVsBuyClass =
                        Number.isFinite(entryPx) && Number.isFinite(curPx)
                          ? curPx > entryPx
                            ? "text-emerald-500"
                            : "text-[#e50914]"
                          : "text-[var(--text)]";
                      return (
                        <Fragment key={row.id}>
                        <tr className="border-b border-[var(--border)]/40">
                          <td className="py-2 px-2 text-center align-middle">
                            <div className="flex flex-col items-center gap-0.5 text-sm leading-snug">
                              <a
                                className="font-medium text-[#E50914] underline-offset-2 hover:underline"
                                href={
                                  row.chartUrl ??
                                  `https://www.binance.com/en/trade/${row.baseAsset}_USDT?type=spot`
                                }
                                rel="noreferrer"
                                target="_blank"
                                title="Open chart"
                              >
                                {formatPaperTradeTokenLabel(row)}
                              </a>
                              {activeTradesList.length > 1 ? (
                                <span className="text-xs font-normal text-[var(--text-muted)]">
                                  (leg {legIdx + 1})
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-center text-[var(--text-muted)]">
                            {row.executionChannel === "mainnet" ? "Mainnet" : "Paper"}
                          </td>
                          <td className="py-2 px-2 text-center tabular-nums">
                            {formatMoney(row.positionSizeUsdt ?? botState?.config?.positionSizeUsdt)}
                          </td>
                          <td className="py-2 px-2 text-center font-medium tabular-nums text-[#e50914]">
                            {soldPct == null ? "—" : `${soldPct.toFixed(2)}%`}
                          </td>
                          <td className="py-2 px-2 text-center">
                            <div className="tabular-nums">{formatMoney(row.entryPrice)}</div>
                            <div className="my-1 border-t border-[var(--border)]" aria-hidden />
                            <div className={`font-medium tabular-nums ${currentVsBuyClass}`}>
                              {formatMoney(row.currentPrice)}
                            </div>
                          </td>
                          <td className={`py-2 px-2 text-center font-medium tabular-nums ${rowPnl}`}>
                            <div>{formatMoney(row.pnlUsdt)}</div>
                            <div className="my-1 border-t border-[var(--border)]" aria-hidden />
                            <div>{formatPercent(row.pnlPercent)}</div>
                          </td>
                          <td
                            className={`py-2 px-2 text-center text-sm font-medium tabular-nums leading-snug ${openClass}`}
                          >
                            <div>{formatMoney(row.unrealizedPnlUsdt)}</div>
                            <div className="my-1 border-t border-[var(--border)]" aria-hidden />
                            <div>{formatPercent(openPctOfBet)}</div>
                          </td>
                          <td
                            className={`py-2 px-2 text-center text-sm font-medium tabular-nums leading-snug ${closeClass}`}
                          >
                            <div>{formatMoney(row.realizedPnlUsdt)}</div>
                            <div className="my-1 border-t border-[var(--border)]" aria-hidden />
                            <div>{formatPercent(closePctOfBet)}</div>
                          </td>
                          <td className="py-2 px-2 text-center text-xs leading-snug tabular-nums">
                            {formatDateTime(row.openedAt)}
                          </td>
                          <td className="py-2 px-2 text-center tabular-nums leading-snug">
                            <div>{formatElapsed(row.openedAt)}</div>
                            <div className="my-1 border-t border-[var(--border)]" aria-hidden />
                            <div>
                              {formatRemaining(
                                row.openedAt,
                                row.maxHoldMinutesAtEntry ?? botState?.config?.maxHoldMinutes
                              )}
                            </div>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <div className="mx-auto flex flex-col items-center gap-2">
                              <select
                                className="h-8 w-[98px] shrink-0 rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] px-2 text-xs text-[var(--input-fg)]"
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
                                className="w-[96px] shrink-0 border border-emerald-700 bg-emerald-700 text-white hover:bg-emerald-800"
                                onClick={() => void handleExtendTradeTime(row.id)}
                              >
                                Extend
                              </Button>
                            </div>
                          </td>
                          <td className="max-w-[222px] py-2 pl-2 pr-1 text-left align-top text-[var(--text)]">
                            <div className="flex w-full min-w-0 items-start justify-between gap-1">
                              <span className="min-w-0 flex-1 text-xs leading-snug break-words line-clamp-2">
                                {why}
                              </span>
                              <button
                                type="button"
                                className="shrink-0 rounded p-0.5 text-[var(--text-muted)] hover:bg-[var(--panel-2)] hover:text-[var(--text)]"
                                title="Bot settings used when this trade opened"
                                aria-label="Show bot settings for this trade"
                                onClick={() => {
                                  setSettingsForTrade(row);
                                  setIsTradeSettingsModalOpen(true);
                                }}
                              >
                                <Info className="h-4 w-4" />
                              </button>
                            </div>
                          </td>
                          <td className="py-2 px-2 text-center">
                            <div className="flex flex-col items-center gap-2">
                              <Button
                                size="sm"
                                type="button"
                                variant="outline"
                                className="shrink-0 border border-amber-600 bg-amber-600 text-white hover:bg-amber-700"
                                onClick={() => {
                                  setTradePendingClose(row);
                                  setIsCloseModalOpen(true);
                                }}
                              >
                                Close Trade
                              </Button>
                              {activeTradesList.length === 1 ? (
                                <Button
                                  size="sm"
                                  type="button"
                                  variant="outline"
                                  className="shrink-0 border-[var(--border)]"
                                  disabled
                                  title="Stacking a second leg on the same token is disabled here (risky). To open another trade, use Start on a different token (max 2 open legs)."
                                >
                                  Trigger new trade
                                </Button>
                              ) : null}
                              {mainnetLegNeedsOnChainBuy(row) ? (
                                <a
                                  href={`#mainnet-pending-buy-${row.id}`}
                                  className="inline-flex h-8 shrink-0 items-center rounded-md border border-emerald-700/80 bg-emerald-900/20 px-3 text-xs font-medium text-emerald-700 hover:bg-emerald-900/35 dark:text-emerald-400"
                                >
                                  Sign buy
                                </a>
                              ) : null}
                            </div>
                          </td>
                        </tr>
                        {hasPendingMainnetSells(row) && !hideAutoSignedLivePendingSellUi ? (
                          <tr className="border-b border-[var(--border)]/40 bg-[var(--panel-muted)]/30">
                            <td colSpan={activeTradesColSpan} className="px-2 py-2">
                              <MainnetPendingSellForLeg row={row} maxSlippagePercent={maxSlip} />
                            </td>
                          </tr>
                        ) : null}
                        {mainnetLegNeedsOnChainBuy(row) ? (
                          <tr className="border-b border-[var(--border)]/40 bg-[var(--panel-muted)]/30">
                            <td colSpan={activeTradesColSpan} className="px-2 py-2">
                              <MainnetPendingBuyForLeg
                                row={row}
                                legIndex={activeTradesList.length > 1 ? legIdx + 1 : null}
                                maxSlippagePercent={maxSlip}
                              />
                            </td>
                          </tr>
                        ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
                </div>
              </div>
            ) : (
              <p>No open paper trade.</p>
            )}
          </div>
          </AccordionSection>
          </div>
          </>
          ) : null}
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
            {activeTradesList.length > 0 ? (
              <div className="mt-3 space-y-2 text-sm text-[var(--text-muted)]">
                <p>
                  Open paper {activeTradesList.length > 1 ? "positions" : "position"}:{" "}
                  <span className="font-medium text-[var(--text)]">
                    {formatPaperTradeTokenLabel(activeTradesList[0])}
                    {activeTradesList.length > 1 ? ` · ${activeTradesList.length} legs` : ""}
                  </span>
                  .
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
              {activeTradesList.length > 0 ? (
                <Button
                  type="button"
                  className="border border-[#e50914] bg-[#e50914] text-white hover:bg-[#c40710]"
                  disabled={isStopActionPending}
                  onClick={() => void handleConfirmStop(true)}
                  title="Closes all open paper legs at current prices, then stops the bot."
                >
                  {isStopActionPending && stopConfirmMode === "close" ? "Working…" : "Stop Bot + Active Trade(s)"}
                </Button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      {isTradeSettingsModalOpen && settingsForTrade ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="trade-settings-title"
          onClick={(event) => {
            if (event.target === event.currentTarget) {
              setIsTradeSettingsModalOpen(false);
              setSettingsForTrade(null);
            }
          }}
        >
          <div
            className="flex max-h-[85vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--panel)] shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-start justify-between gap-3 border-b border-[var(--border)] px-5 py-4 sm:px-6">
              <div className="min-w-0 pr-2">
                <h3 id="trade-settings-title" className="text-lg font-semibold text-[var(--text)]">
                  Bot settings at trade open
                </h3>
                <p className="mt-1 text-xs text-[var(--text-muted)]">
                  Snapshot for{" "}
                  <span className="font-medium text-[var(--text)]">
                    {formatPaperTradeTokenLabel(settingsForTrade)}
                  </span>{" "}
                  (leg id <code className="text-[var(--text)]">{settingsForTrade.id}</code>). Changing Bot Settings
                  later does not update this row.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="shrink-0 gap-1.5"
                onClick={() => {
                  setIsTradeSettingsModalOpen(false);
                  setSettingsForTrade(null);
                }}
              >
                <X className="h-4 w-4" aria-hidden />
                Close
              </Button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
              {settingsForTrade.settingsAtOpen ? (
                <TradeSettingsSnapshotBody settings={settingsForTrade.settingsAtOpen} />
              ) : (
                <p className="text-sm text-[var(--text-muted)]">
                  No snapshot stored for this trade (trades opened before this feature only show the live config in Bot
                  Settings, not a frozen copy).
                </p>
              )}
            </div>
          </div>
        </div>
      ) : null}
      {isCloseModalOpen && tradePendingClose ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--panel)] p-5 shadow-2xl">
            <h3 className="text-lg font-semibold text-[var(--text)]">Confirm Close Trade</h3>
            <p className="mt-2 text-sm text-[var(--text-muted)]">
              Close{" "}
              <span className="font-medium text-[var(--text)]">
                {formatPaperTradeTokenLabel(tradePendingClose)}
              </span>{" "}
              (leg{" "}
              <code className="text-xs">{tradePendingClose.id}</code>) with net PnL:
            </p>
            <p className={`mt-2 text-base font-semibold ${pnlClassFor(tradePendingClose)}`}>
              {formatPercent(tradePendingClose.pnlPercent)} ({formatMoney(tradePendingClose.pnlUsdt)})
            </p>
            <p className="mt-3 rounded-md border border-amber-600/40 bg-amber-600/10 px-3 py-2 text-sm text-amber-500">
              This action cannot be undone.
            </p>
            <div className="mt-5 flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setIsCloseModalOpen(false);
                  setTradePendingClose(null);
                }}
              >
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
