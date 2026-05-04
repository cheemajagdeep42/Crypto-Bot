"use client";

import { create } from "zustand";
import { fetchSignals } from "../lib/api/dashboardApi";
import { toastError } from "../lib/toast";

export const useScannerStore = create((set, get) => ({
  signals: [],
  signalsLoading: false,
  statusText: "Loading market data...",
  limit: 10,
  timeframe: "24h",
  signalFilter: "all",
  page: 1,
  pageSize: 7,

  setLimit: (limit) => set({ limit, page: 1 }),
  setTimeframe: (timeframe) => set({ timeframe, page: 1 }),
  setSignalFilter: (signalFilter) => set({ signalFilter, page: 1 }),
  setPage: (page) => set({ page }),

  loadSignals: async () => {
    const { limit, timeframe } = get();
    set({ signalsLoading: true });
    try {
      const body = await fetchSignals(limit, timeframe);
      set({
        signals: body.tokens ?? [],
        statusText: `Showing ${body.tokens?.length ?? 0} trending tokens.`,
        page: 1
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to load signals.";
      toastError(error, "Failed to load market signals");
      set({
        signals: [],
        statusText: msg
      });
    } finally {
      set({ signalsLoading: false });
    }
  }
}));
