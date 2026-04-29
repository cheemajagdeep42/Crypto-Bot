"use client";

import { create } from "zustand";
import {
  closeBotTrade,
  extendBotTradeTime,
  fetchBotState,
  previewScanBot,
  scanBot,
  setBotAutoMode,
  startTradeBot,
  startBot,
  stopBot,
  updateBotConfig
} from "../lib/api/dashboardApi";

const BOT_POLL_MS = 10_000;

export const useBotStore = create((set, get) => ({
  botState: null,
  botPollTimer: null,
  previewScanLoading: false,

  loadBotState: async () => {
    try {
      const body = await fetchBotState();
      set({ botState: body });
    } catch {
      set({ botState: null });
    }
  },

  runBotAction: async (action, payload) => {
    const { botState } = get();
    const isPreviewScan = action === "previewScan";
    if (isPreviewScan) set({ previewScanLoading: true });
    try {
      if (action === "start") await startBot();
      if (action === "stop") await stopBot(Boolean(payload?.closeActiveTrade));
      if (action === "scan") await scanBot();
      if (action === "previewScan") await previewScanBot(payload?.limit, payload?.timeframe);
      if (action === "startTrade") await startTradeBot(payload?.symbol);
      if (action === "close") await closeBotTrade();
      if (action === "extendTradeTime") await extendBotTradeTime(payload?.extendByMinutes);
      if (action === "toggleAuto") await setBotAutoMode(!(botState?.config?.autoMode ?? true));
      await get().loadBotState();
    } finally {
      if (isPreviewScan) set({ previewScanLoading: false });
    }
  },

  saveBotConfig: async (configPatch) => {
    await updateBotConfig(configPatch);
    await get().loadBotState();
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
