type WebSocketLike = {
    close: () => void;
    send: (data: string) => void;
    addEventListener: (
        type: "open" | "message" | "close" | "error",
        listener: (event: { data?: unknown }) => void
    ) => void;
};

export type BookTickerUpdate = {
    symbol: string;
    bid: number;
    ask: number;
    eventTime: string;
};

export type MarketStreamState = {
    status: "stopped" | "connecting" | "connected" | "reconnecting" | "error";
    url: string;
    connectedAt: string | null;
    lastMessageAt: string | null;
    reconnects: number;
    trackedSymbols: number;
    isFresh: boolean;
    lastError: string | null;
};

type BinanceBookTickerPayload = {
    s: string;
    b: string;
    a: string;
};

const STREAM_URL = "wss://stream.binance.com:9443/ws";
const STALE_AFTER_MS = 10_000;
const RECONNECT_DELAY_MS = 3_000;
const DEFAULT_SUBSCRIPTIONS = [
    "btcusdt@bookTicker",
    "ethusdt@bookTicker",
    "bnbusdt@bookTicker",
    "solusdt@bookTicker",
    "xrpusdt@bookTicker",
];

function toWebSocketLike(socket: unknown): WebSocketLike | null {
    if (!socket || typeof socket !== "object") return null;

    const maybeSocket = socket as {
        addEventListener?: WebSocketLike["addEventListener"];
        on?: (event: string, listener: (...args: unknown[]) => void) => void;
        close?: () => void;
    };

    if (typeof maybeSocket.addEventListener === "function" && typeof maybeSocket.close === "function") {
        return {
            close: () => maybeSocket.close?.(),
            send: (data) => {
                if (typeof (maybeSocket as { send?: (value: string) => void }).send === "function") {
                    (maybeSocket as { send: (value: string) => void }).send(data);
                }
            },
            addEventListener: (type, listener) => maybeSocket.addEventListener?.(type, listener),
        };
    }

    if (
        typeof maybeSocket.on === "function" &&
        typeof maybeSocket.close === "function" &&
        typeof (maybeSocket as { send?: (value: string) => void }).send === "function"
    ) {
        return {
            close: () => maybeSocket.close?.(),
            send: (data) => (maybeSocket as { send: (value: string) => void }).send(data),
            addEventListener: (type, listener) => {
                if (type === "message") {
                    maybeSocket.on?.("message", (data: unknown) => listener({ data }));
                    return;
                }
                maybeSocket.on?.(type, () => listener({}));
            },
        };
    }

    return null;
}

function resolveWebSocketCtor(): (new (url: string) => unknown) | null {
    const nativeCtor = (globalThis as { WebSocket?: new (url: string) => unknown }).WebSocket;
    if (nativeCtor) return nativeCtor;

    try {
        const wsModule = require("ws") as { WebSocket?: new (url: string) => unknown };
        if (wsModule.WebSocket) return wsModule.WebSocket;
    } catch {
        // Module is optional; if missing we'll surface a clear runtime error.
    }

    return null;
}

class MarketStream {
    private socket: WebSocketLike | null = null;
    private latestBook = new Map<string, BookTickerUpdate>();
    private listeners = new Set<(update: BookTickerUpdate) => void>();
    private reconnectTimer: NodeJS.Timeout | null = null;
    private intentionallyStopped = false;
    private subscriptions = new Set<string>(DEFAULT_SUBSCRIPTIONS);
    private nextRequestId = 1;
    private state: MarketStreamState = {
        status: "stopped",
        url: STREAM_URL,
        connectedAt: null,
        lastMessageAt: null,
        reconnects: 0,
        trackedSymbols: 0,
        isFresh: false,
        lastError: null,
    };

    start(): void {
        if (this.socket || this.state.status === "connecting") return;

        this.intentionallyStopped = false;
        this.state.status = this.state.reconnects > 0 ? "reconnecting" : "connecting";

        const WebSocketCtor = resolveWebSocketCtor();

        if (!WebSocketCtor) {
            this.state.status = "error";
            this.state.lastError = "WebSocket runtime unavailable. Install 'ws' or use Node 18+.";
            return;
        }

        try {
            const rawSocket = new WebSocketCtor(STREAM_URL);
            const socket = toWebSocketLike(rawSocket);

            if (!socket) {
                this.state.status = "error";
                this.state.lastError = "Unsupported WebSocket implementation in current runtime.";
                return;
            }

            this.socket = socket;

            socket.addEventListener("open", () => {
                this.state.status = "connected";
                this.state.connectedAt = new Date().toISOString();
                this.state.lastError = null;
                this.sendSubscriptionRequest(Array.from(this.subscriptions));
            });

            socket.addEventListener("message", async (event) => {
                const message = await this.normalizeMessage(event.data);
                if (!message) return;
                this.handleMessage(message);
            });

            socket.addEventListener("close", () => {
                this.socket = null;
                this.state.status = this.intentionallyStopped ? "stopped" : "reconnecting";
                if (!this.intentionallyStopped) this.scheduleReconnect();
            });

            socket.addEventListener("error", () => {
                this.state.status = "error";
                this.state.lastError = "WebSocket connection error.";
            });
        } catch (error) {
            this.socket = null;
            this.state.status = "error";
            this.state.lastError = error instanceof Error ? error.message : String(error);
            this.scheduleReconnect();
        }
    }

    stop(): void {
        this.intentionallyStopped = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }

        this.socket?.close();
        this.socket = null;
        this.state.status = "stopped";
    }

    getState(): MarketStreamState {
        const lastMessageAt = this.state.lastMessageAt
            ? new Date(this.state.lastMessageAt).getTime()
            : 0;

        return {
            ...this.state,
            trackedSymbols: this.latestBook.size,
            isFresh: lastMessageAt > 0 && Date.now() - lastMessageAt <= STALE_AFTER_MS,
        };
    }

    getBook(symbol: string): BookTickerUpdate | null {
        return this.latestBook.get(symbol.toUpperCase()) ?? null;
    }

    onBookTicker(listener: (update: BookTickerUpdate) => void): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    ensureSymbolSubscribed(symbol: string): void {
        if (!symbol) return;
        const stream = `${symbol.toLowerCase()}@bookTicker`;
        if (this.subscriptions.has(stream)) return;

        this.subscriptions.add(stream);
        this.sendSubscriptionRequest([stream]);
    }

    private handleMessage(message: string): void {
        try {
            const payload = JSON.parse(message) as BinanceBookTickerPayload;
            const bid = Number(payload.b);
            const ask = Number(payload.a);

            if (!payload.s || !Number.isFinite(bid) || !Number.isFinite(ask)) return;

            const update: BookTickerUpdate = {
                symbol: payload.s,
                bid,
                ask,
                eventTime: new Date().toISOString(),
            };

            this.latestBook.set(update.symbol, update);
            this.state.lastMessageAt = update.eventTime;
            this.state.trackedSymbols = this.latestBook.size;

            for (const listener of this.listeners) {
                listener(update);
            }
        } catch {
            this.state.lastError = "Could not parse WebSocket book ticker message.";
        }
    }

    private async normalizeMessage(data: unknown): Promise<string | null> {
        if (typeof data === "string") return data;

        if (data instanceof ArrayBuffer) {
            return Buffer.from(data).toString("utf8");
        }

        if (ArrayBuffer.isView(data)) {
            return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString("utf8");
        }

        const blobCtor = (globalThis as { Blob?: typeof Blob }).Blob;
        if (blobCtor && data instanceof blobCtor) {
            return await data.text();
        }

        return null;
    }

    private scheduleReconnect(): void {
        if (this.reconnectTimer || this.intentionallyStopped) return;

        this.state.reconnects += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.start();
        }, RECONNECT_DELAY_MS);
    }

    private sendSubscriptionRequest(streams: string[]): void {
        if (!this.socket || streams.length === 0) return;

        try {
            this.socket.send(
                JSON.stringify({
                    method: "SUBSCRIBE",
                    params: streams,
                    id: this.nextRequestId++,
                })
            );
        } catch (error) {
            this.state.lastError =
                error instanceof Error ? `Subscription failed: ${error.message}` : "Subscription failed.";
        }
    }
}

export const marketStream = new MarketStream();
