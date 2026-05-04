"use client";

import { create } from "zustand";

/**
 * Token selected from the Run Bot scan table for the Quote & Sign step before confirming a trade.
 * Shape matches `TokenSignal` from the BFF (subset used by the UI).
 */
export const useQuoteSignStore = create((set) => ({
  pendingToken: null,
  setPendingToken: (token) => set({ pendingToken: token ?? null }),
  clearPendingToken: () => set({ pendingToken: null }),
  togglePendingToken: (token) =>
    set((state) => {
      if (!token?.symbol) return { pendingToken: null };
      if (state.pendingToken?.symbol === token.symbol) return { pendingToken: null };
      return { pendingToken: token };
    })
}));
