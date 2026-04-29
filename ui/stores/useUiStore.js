"use client";

import { create } from "zustand";

export const useUiStore = create((set) => ({
  activeSection: "scanner",
  /** Incremented when user should land on Run Bot → Active Trade (e.g. from Logs). */
  runBotActiveTradeFocusNonce: 0,
  setActiveSection: (activeSection) => set({ activeSection }),
  focusRunBotActiveTrade: () =>
    set((state) => ({
      activeSection: "runBot",
      runBotActiveTradeFocusNonce: state.runBotActiveTradeFocusNonce + 1
    }))
}));
