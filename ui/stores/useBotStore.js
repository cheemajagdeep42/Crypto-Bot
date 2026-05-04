"use client";

import { create } from "zustand";
import {
  addDexTokenBot,
  closeBotTrade,
  extendBotTradeTime,
  fetchBotState,
  previewScanBot,
  scanBot,
  setBotAutoMode,
  stackManualTradeBot,
  startTradeBot,
  startBot,
  stopBot,
  updateBotConfig
} from "../lib/api/dashboardApi";
import { toastError } from "../lib/toast";

const BOT_POLL_MS = 10_000;

export const useBotStore = create((set, get) => ({
  botState: null,
  /** Set when the last `fetchBotState` failed (e.g. BFF not on :3001). Cleared on success. */
  botStateError: null,
  botPollTimer: null,
  previewScanLoading: false,
  addDexTokenLoading: false,
  stackManualTradeLoading: false,

  loadBotState: async () => {
    try {
      const body = await fetchBotState();
      if (!body || typeof body !== "object" || body.config == null) {
        throw new Error("Bot state response missing config.");
      }
      set({ botState: body, botStateError: null });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Keep last good snapshot on refresh failure (10s poll / transient BFF hiccup). Clearing botState
      // forced sync(null) in RunBotSection and made saved configs look "lost".
      set((s) => ({ botStateError: msg, botState: s.botState }));
    }
  },

  runBotAction: async (action, payload) => {
    const { botState } = get();
    const isPreviewScan = action === "previewScan";
    const isAddDexToken = action === "addDexToken";
    const isStackManualTrade = action === "stackManualTrade";
    if (isPreviewScan) set({ previewScanLoading: true });
    if (isAddDexToken) set({ addDexTokenLoading: true });
    if (isStackManualTrade) set({ stackManualTradeLoading: true });
    try {
      if (action === "start") await startBot();
      if (action === "stop") await stopBot(Boolean(payload?.closeActiveTrade));
      if (action === "scan") await scanBot();
      if (action === "previewScan") await previewScanBot(payload?.limit, payload?.timeframe);
      if (action === "addDexToken")
        await addDexTokenBot({
          tokenAddress: String(payload?.tokenAddress ?? "").trim(),
          ...(payload?.chainId ? { chainId: String(payload.chainId) } : {}),
          ...(payload?.timeframe ? { timeframe: String(payload.timeframe) } : {})
        });
      if (action === "startTrade") await startTradeBot(payload);
      if (action === "stackManualTrade") await stackManualTradeBot(payload);
      if (action === "close") await closeBotTrade(payload?.tradeId);
      if (action === "extendTradeTime")
        await extendBotTradeTime(payload?.extendByMinutes, payload?.tradeId);
      if (action === "toggleAuto") await setBotAutoMode(!(botState?.config?.autoMode ?? true));
      await get().loadBotState();
    } catch (error) {
      toastError(error, "Bot action failed");
    } finally {
      if (isPreviewScan) set({ previewScanLoading: false });
      if (isAddDexToken) set({ addDexTokenLoading: false });
      if (isStackManualTrade) set({ stackManualTradeLoading: false });
    }
  },

  saveBotConfig: async (configPatch) => {
    try {
      await updateBotConfig(configPatch);
      await get().loadBotState();
    } catch (error) {
      toastError(error, "Failed to save config");
      throw error;
    }
  },

  startPollingBotState: () => {
    if (get().botPollTimer) return;
    const timer = setInterval(() => {
      void get().loadBotState();
    }, BOT_POLL_MS);
    set({ botPollTimer: timer });
  },

  stopPollingBotState: () => {
    const timer = get().botPollTimer;
    if (timer) clearInterval(timer);
    set({ botPollTimer: null });
  }
}));
