"use client";

import { create } from "zustand";
import { fetchBotState } from "../lib/api/dashboardApi";

const HISTORY_POLL_MS = 12_000;

export const useHistoryStore = create((set, get) => ({
  logs: [],
  tradeHistory: [],
  historyPollTimer: null,

  loadHistory: async () => {
    try {
      const body = await fetchBotState();
      set({
        logs: body?.logs ?? [],
        tradeHistory: body?.tradeHistory ?? []
      });
    } catch {
      set({
        logs: [],
        tradeHistory: []
      });
    }
  },

  startPollingHistory: () => {
    if (get().historyPollTimer) return;
    const timer = setInterval(() => {
      void get().loadHistory();
    }, HISTORY_POLL_MS);
    set({ historyPollTimer: timer });
  },

  stopPollingHistory: () => {
    const timer = get().historyPollTimer;
    if (timer) clearInterval(timer);
    set({ historyPollTimer: null });
  }
}));
