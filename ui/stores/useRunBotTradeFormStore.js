"use client";

import { create } from "zustand";
import {
  configToTradeDraft,
  tradeDraftsEqual,
  tradeDraftToPayload
} from "../lib/runBotConfigSlices";

export const useRunBotTradeFormStore = create((set, get) => ({
  draft: configToTradeDraft(null),
  baseline: configToTradeDraft(null),

  patchDraft: (partial) => set((s) => ({ draft: { ...s.draft, ...partial } })),

  syncFromServerIfNotDirty: (config) => {
    const next = configToTradeDraft(config);
    set((s) => {
      if (!tradeDraftsEqual(s.draft, s.baseline)) return s;
      return { draft: { ...next }, baseline: { ...next } };
    });
  },

  hydrateFromConfig: (config) => {
    const next = configToTradeDraft(config);
    set({ draft: { ...next }, baseline: { ...next } });
  },

  resetDraftToBaseline: () => set((s) => ({ draft: { ...s.baseline } })),

  isDirty: () => {
    const { draft, baseline } = get();
    return !tradeDraftsEqual(draft, baseline);
  },

  getPayload: () => tradeDraftToPayload(get().draft)
}));
