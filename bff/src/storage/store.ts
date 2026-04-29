import type { BotState } from "../paperBot";

export interface BotStore {
    loadState(): BotState | null;
    persistState(state: BotState): void;
}
