"use client";

import { create } from "zustand";
import {
  configToScannerDraft,
  scannerDraftsEqual,
  scannerDraftToPayload
} from "../lib/runBotConfigSlices";

export const useRunBotScannerFormStore = create((set, get) => ({
  draft: configToScannerDraft(null),
  baseline: configToScannerDraft(null),

  patchDraft: (partial) => set((s) => ({ draft: { ...s.draft, ...partial } })),

  syncFromServerIfNotDirty: (config) => {
    const next = configToScannerDraft(config);
    set((s) => {
      if (!scannerDraftsEqual(s.draft, s.baseline)) return s;
      return { draft: { ...next }, baseline: { ...next } };
    });
  },

  hydrateFromConfig: (config) => {
    const next = configToScannerDraft(config);
    set({ draft: { ...next }, baseline: { ...next } });
  },

  resetDraftToBaseline: () => set((s) => ({ draft: { ...s.baseline } })),

  isDirty: () => {
    const { draft, baseline } = get();
    return !scannerDraftsEqual(draft, baseline);
  },

  getPayload: () => scannerDraftToPayload(get().draft)
}));
