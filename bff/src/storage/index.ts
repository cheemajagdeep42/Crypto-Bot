import { JsonBotStore } from "./jsonBotStore";
import { SqliteBotStore } from "./sqliteBotStore";
import type { BotStore } from "./store";

export function createBotStore(): BotStore {
    const provider = (process.env.BOT_STORE ?? "json").toLowerCase();
    if (provider === "sqlite") {
        const sqliteStore = new SqliteBotStore();
        if (!sqliteStore.hasState()) {
            const jsonStore = new JsonBotStore();
            const jsonState = jsonStore.loadState();
            if (jsonState) sqliteStore.persistState(jsonState);
        }
        return sqliteStore;
    }
    return new JsonBotStore();
}
