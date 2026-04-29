import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { BotState } from "../paperBot";
import type { BotStore } from "./store";

const DATA_DIR = path.resolve(__dirname, "..", "..", "data");
const DB_FILE = path.join(DATA_DIR, "bot-state.sqlite");

export class SqliteBotStore implements BotStore {
    private readonly db: DatabaseSync;

    constructor() {
        mkdirSync(DATA_DIR, { recursive: true });
        this.db = new DatabaseSync(DB_FILE);
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS bot_runtime (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                status TEXT NOT NULL,
                mode TEXT NOT NULL,
                config_json TEXT NOT NULL,
                active_trade_json TEXT,
                last_scan_at TEXT,
                next_scan_at TEXT,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bot_trade_history (
                id TEXT PRIMARY KEY,
                closed_at TEXT,
                trade_json TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS bot_logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                time TEXT NOT NULL,
                level TEXT NOT NULL,
                message TEXT NOT NULL
            )
        `);
    }

    hasState(): boolean {
        const row = this.db
            .prepare("SELECT 1 AS found FROM bot_runtime WHERE id = 1 LIMIT 1")
            .get() as { found: number } | undefined;
        return Boolean(row?.found);
    }

    loadState(): BotState | null {
        try {
            const runtime = this.db
                .prepare(
                    `
                    SELECT status, mode, config_json, active_trade_json, last_scan_at, next_scan_at
                    FROM bot_runtime
                    WHERE id = 1
                `
                )
                .get() as
                | {
                      status: BotState["status"];
                      mode: BotState["mode"];
                      config_json: string;
                      active_trade_json: string | null;
                      last_scan_at: string | null;
                      next_scan_at: string | null;
                  }
                | undefined;

            if (!runtime) return null;

            const tradeRows = this.db
                .prepare(
                    `
                    SELECT trade_json
                    FROM bot_trade_history
                    ORDER BY closed_at DESC, id DESC
                `
                )
                .all() as Array<{ trade_json: string }>;

            const logRows = this.db
                .prepare(
                    `
                    SELECT time, level, message
                    FROM bot_logs
                    ORDER BY time DESC, id DESC
                `
                )
                .all() as Array<{
                time: string;
                level: "info" | "warn" | "error";
                message: string;
            }>;

            return {
                status: runtime.status,
                mode: runtime.mode,
                config: JSON.parse(runtime.config_json) as BotState["config"],
                activeTrade: runtime.active_trade_json
                    ? (JSON.parse(runtime.active_trade_json) as BotState["activeTrade"])
                    : null,
                lastScanTokens: [],
                tradeHistory: tradeRows.map((row) => JSON.parse(row.trade_json) as BotState["tradeHistory"][number]),
                logs: logRows,
                lastScanAt: runtime.last_scan_at,
                nextScanAt: runtime.next_scan_at,
                lastScanTimeframe: "24h",
            };
        } catch {
            return null;
        }
    }

    persistState(state: BotState): void {
        try {
            const now = new Date().toISOString();
            this.db.exec("BEGIN IMMEDIATE TRANSACTION");
            this.db
                .prepare(
                    `
                    INSERT INTO bot_runtime (
                        id, status, mode, config_json, active_trade_json, last_scan_at, next_scan_at, updated_at
                    )
                    VALUES (1, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        status = excluded.status,
                        mode = excluded.mode,
                        config_json = excluded.config_json,
                        active_trade_json = excluded.active_trade_json,
                        last_scan_at = excluded.last_scan_at,
                        next_scan_at = excluded.next_scan_at,
                        updated_at = excluded.updated_at
                `
                )
                .run(
                    state.status,
                    state.mode,
                    JSON.stringify(state.config),
                    state.activeTrade ? JSON.stringify(state.activeTrade) : null,
                    state.lastScanAt,
                    state.nextScanAt,
                    now
                );

            this.db.exec("DELETE FROM bot_trade_history");
            const insertTrade = this.db.prepare(
                "INSERT INTO bot_trade_history (id, closed_at, trade_json) VALUES (?, ?, ?)"
            );
            for (const trade of state.tradeHistory) {
                insertTrade.run(trade.id, trade.closedAt ?? null, JSON.stringify(trade));
            }

            this.db.exec("DELETE FROM bot_logs");
            const insertLog = this.db.prepare(
                "INSERT INTO bot_logs (time, level, message) VALUES (?, ?, ?)"
            );
            for (const log of state.logs) {
                insertLog.run(log.time, log.level, log.message);
            }

            this.db.exec("COMMIT");
        } catch {
            try {
                this.db.exec("ROLLBACK");
            } catch {
                // Ignore rollback errors.
            }
            // Persistence must never crash the bot loop.
        }
    }
}

export function hasSqliteStoreFile(): boolean {
    return existsSync(DB_FILE);
}
