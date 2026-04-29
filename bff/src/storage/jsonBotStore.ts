import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { BotState } from "../paperBot";
import type { BotStore } from "./store";

const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const STATE_FILE = path.join(DATA_DIR, "bot-state.json");

export class JsonBotStore implements BotStore {
    loadState(): BotState | null {
        if (!existsSync(STATE_FILE)) return null;

        try {
            return JSON.parse(readFileSync(STATE_FILE, "utf8")) as BotState;
        } catch {
            return null;
        }
    }

    persistState(state: BotState): void {
        try {
            mkdirSync(DATA_DIR, { recursive: true });
            writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
        } catch {
            // Persistence must never crash the bot loop.
        }
    }
}
