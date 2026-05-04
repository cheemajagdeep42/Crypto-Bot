/**
 * SolHouse-style Telegram ingest (MTProto user session).
 *
 * Required env (when using live listener):
 * - TELEGRAM_API_ID — from https://my.telegram.org/apps (after login; “API development tools”)
 * - TELEGRAM_API_HASH
 * - TELEGRAM_STRING_SESSION — run `npx ts-node scripts/gen-telegram-session.ts` once
 * - TELEGRAM_PUMP_CHANNEL — public username without @, e.g. solhousesignal
 *
 * Optional:
 * - TELEGRAM_PUMP_TRIGGER_SUBSTRING — default: 💎 Exclusive Solana Gem Alert! 💎
 * - TELEGRAM_PUMP_SHOW_ALL — if unset, all channel posts are shown (testing). Set to false for gem-trigger-only.
 */
import { TelegramClient, utils } from "telegram";
import { StringSession } from "telegram/sessions";
import { NewMessage, NewMessageEvent } from "telegram/events";

const MAX_MESSAGES = 20;
const DEFAULT_TRIGGER = "💎 Exclusive Solana Gem Alert! 💎";

export type PumpMessage = {
    id: string;
    text: string;
    receivedAt: string;
    telegramMessageId?: number;
};

const ring: PumpMessage[] = [];
let client: TelegramClient | null = null;
let listenerActive = false;
let lastError: string | null = null;
let handlerBound = false;

function envChannelUsername(): string {
    return (process.env.TELEGRAM_PUMP_CHANNEL ?? "").trim().replace(/^@/, "").toLowerCase();
}

function envTrigger(): string {
    return (process.env.TELEGRAM_PUMP_TRIGGER_SUBSTRING ?? "").trim() || DEFAULT_TRIGGER;
}

/**
 * When true, show all channel posts; when false, only messages containing the trigger substring.
 * Default true if env is unset (easier testing). Set TELEGRAM_PUMP_SHOW_ALL=false for gem-only.
 */
function envPumpShowAllChannelMessages(): boolean {
    const raw = process.env.TELEGRAM_PUMP_SHOW_ALL;
    if (raw === undefined || raw === "") return true;
    const v = raw.trim().toLowerCase();
    if (v === "0" || v === "false" || v === "no") return false;
    return true;
}

export function isPumpTelegramConfigured(): boolean {
    const id = Number(process.env.TELEGRAM_API_ID);
    const hash = (process.env.TELEGRAM_API_HASH ?? "").trim();
    const sess = (process.env.TELEGRAM_STRING_SESSION ?? "").trim();
    const ch = envChannelUsername();
    return Number.isFinite(id) && id > 0 && hash.length > 0 && sess.length > 0 && ch.length > 0;
}

export function getPumpFeedState(): {
    messages: PumpMessage[];
    listenerActive: boolean;
    configured: boolean;
    lastError: string | null;
    channel: string;
    showAllChannelMessages: boolean;
} {
    return {
        messages: [...ring],
        listenerActive,
        configured: isPumpTelegramConfigured(),
        lastError,
        channel: envChannelUsername(),
        showAllChannelMessages: envPumpShowAllChannelMessages(),
    };
}

function pushMessage(text: string, telegramMessageId?: number): void {
    const msg: PumpMessage = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
        text,
        receivedAt: new Date().toISOString(),
        telegramMessageId,
    };
    ring.unshift(msg);
    while (ring.length > MAX_MESSAGES) {
        ring.pop();
    }
}

function messageText(event: NewMessageEvent): string {
    const m = event.message;
    const raw = (m as { text?: string; message?: string }).text ?? (m as { message?: string }).message;
    return typeof raw === "string" ? raw : "";
}

function messageDisplayText(event: NewMessageEvent): string {
    const t = messageText(event);
    if (t.trim()) return t;
    const m = event.message as { media?: unknown };
    if (m.media) return "(media — no caption text)";
    return "(empty message)";
}

/**
 * Match channel posts by marked peer id (e.g. -100…), not getChat().
 * GramJS getChat() often fails for channels (dialog scan limit / cache), which silently dropped every message.
 */
async function attachHandler(tc: TelegramClient, channelPeerIdMarked: string): Promise<void> {
    if (handlerBound) return;
    const trigger = envTrigger();
    const showAll = envPumpShowAllChannelMessages();

    const handler = async (event: NewMessageEvent) => {
        if (!listenerActive) return;
        const fromId = event.chatId != null ? String(event.chatId) : "";
        if (fromId !== channelPeerIdMarked) return;
        const display = messageDisplayText(event);
        if (!showAll && !display.includes(trigger)) return;
        pushMessage(display, event.message.id);
    };

    /** Channel posts may not classify as `incoming`; keep unfiltered and rely on peer id + trigger in handler. */
    tc.addEventHandler(handler, new NewMessage({}));
    handlerBound = true;
}

export async function startPumpTelegramListener(): Promise<{ ok: boolean; error?: string }> {
    lastError = null;
    if (!isPumpTelegramConfigured()) {
        return {
            ok: false,
            error:
                "Telegram pump feed is not configured. Set TELEGRAM_API_ID, TELEGRAM_API_HASH, TELEGRAM_STRING_SESSION, TELEGRAM_PUMP_CHANNEL in bff/.env (see scripts/gen-telegram-session.ts).",
        };
    }

    if (listenerActive && client?.connected) {
        return { ok: true };
    }

    listenerActive = true;

    const apiId = Number(process.env.TELEGRAM_API_ID);
    const apiHash = (process.env.TELEGRAM_API_HASH ?? "").trim();
    const sessionStr = (process.env.TELEGRAM_STRING_SESSION ?? "").trim();

    try {
        if (client) {
            try {
                await client.disconnect();
            } catch {
                /* ignore */
            }
            client = null;
            handlerBound = false;
        }

        const stringSession = new StringSession(sessionStr);
        const tc = new TelegramClient(stringSession, apiId, apiHash, { connectionRetries: 5 });
        client = tc;
        await tc.connect();
        const authorized = await tc.checkAuthorization();
        if (!authorized) {
            listenerActive = false;
            client = null;
            handlerBound = false;
            const err =
                "Telegram client is not logged in. Run `npx ts-node scripts/gen-telegram-session.ts` in the bff folder and set TELEGRAM_STRING_SESSION.";
            lastError = err;
            return { ok: false, error: err };
        }

        const channelWant = envChannelUsername();
        let channelPeerIdMarked: string;
        try {
            const entity = await tc.getEntity(channelWant);
            channelPeerIdMarked = String(utils.getPeerId(entity));
        } catch (e) {
            listenerActive = false;
            try {
                await tc.disconnect();
            } catch {
                /* ignore */
            }
            client = null;
            handlerBound = false;
            const detail = e instanceof Error ? e.message : String(e);
            const err = `Telegram: cannot open channel @${channelWant}. Open/join that channel in the Telegram app with the same account you used for TELEGRAM_STRING_SESSION, then start again. (${detail})`;
            lastError = err;
            return { ok: false, error: err };
        }

        await attachHandler(tc, channelPeerIdMarked);
        return { ok: true };
    } catch (e) {
        listenerActive = false;
        client = null;
        handlerBound = false;
        lastError = e instanceof Error ? e.message : String(e);
        return { ok: false, error: lastError };
    }
}

export async function stopPumpTelegramListener(): Promise<void> {
    listenerActive = false;
    handlerBound = false;
    if (client) {
        try {
            await client.disconnect();
        } catch {
            /* ignore */
        }
        client = null;
    }
}
