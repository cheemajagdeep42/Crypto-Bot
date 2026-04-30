import { createServer, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import path from "node:path";
import { marketStream } from "./marketStream";
import { paperBot } from "./paperBot";
import { buildBotConfigPatch } from "./botConfigPatch";
import { openApiSpec, swaggerUiHtml } from "./openapi";
import {
    parseTimeframe,
    parseTimeframeFromPreviewBody,
    scanTopSignals,
    scanTopTrending
} from "./scanner";

const PORT = Number(process.env.PORT ?? 3001);
const publicDir = path.resolve(__dirname, "..", "..", "ui", "public");
const isDev = process.env.NODE_ENV !== "production";
const reloadClients = new Set<ServerResponse>();
let reloadDebounceTimer: NodeJS.Timeout | null = null;

const contentTypes = new Map<string, string>([
    [".html", "text/html; charset=utf-8"],
    [".css", "text/css; charset=utf-8"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
]);

function sendJson(res: ServerResponse, status: number, body: unknown): void {
    res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify(body));
}

async function readJsonBody(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
    const chunks: Buffer[] = [];
    for await (const chunk of req) {
        chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
    }
    const raw = Buffer.concat(chunks).toString("utf8").trim();
    if (!raw) return {};
    try {
        return JSON.parse(raw) as Record<string, unknown>;
    } catch {
        return {};
    }
}

function pushReloadEvent(): void {
    const payload = `data: ${Date.now()}\n\n`;
    for (const client of reloadClients) {
        client.write(payload);
    }
}

async function serveStatic(pathname: string, res: ServerResponse): Promise<void> {
    const requested = pathname === "/" ? "/index.html" : pathname;
    const safePath = path.normalize(requested).replace(/^(\.\.[/\\])+/, "");
    const filePath = path.join(publicDir, safePath);

    if (!filePath.startsWith(publicDir)) {
        sendJson(res, 403, { error: "Forbidden" });
        return;
    }

    try {
        const data = await readFile(filePath);
        const contentType = contentTypes.get(path.extname(filePath)) ?? "application/octet-stream";
        res.writeHead(200, { "Content-Type": contentType });
        res.end(data);
    } catch {
        sendJson(res, 404, { error: "Not found" });
    }
}

const server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);

    if (url.pathname === "/api/signals") {
        const limit = Number(url.searchParams.get("limit") ?? 20);
        const timeframe = parseTimeframe(url.searchParams.get("timeframe"));

        try {
            const result = await scanTopTrending(limit, timeframe);
            sendJson(res, 200, result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, 502, {
                error: "Could not fetch Binance market data.",
                detail: message,
            });
        }

        return;
    }

    if (url.pathname === "/api/bot/state") {
        sendJson(res, 200, paperBot.getState());
        return;
    }

    if (url.pathname === "/api/openapi.json") {
        sendJson(res, 200, openApiSpec);
        return;
    }

    if (url.pathname === "/api/docs") {
        res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
        res.end(swaggerUiHtml());
        return;
    }

    if (url.pathname === "/api/market-stream/state") {
        sendJson(res, 200, marketStream.getState());
        return;
    }

    if (url.pathname === "/api/bot/start" && req.method === "POST") {
        sendJson(res, 200, paperBot.start());
        return;
    }

    if (url.pathname === "/api/bot/stop" && req.method === "POST") {
        const body = await readJsonBody(req);
        const closeActiveTrade = body.closeActiveTrade === true;
        sendJson(res, 200, paperBot.stop({ closeActiveTrade }));
        return;
    }

    if (url.pathname === "/api/bot/scan" && req.method === "POST") {
        sendJson(res, 200, await paperBot.scanOnce());
        return;
    }

    if (url.pathname === "/api/bot/preview-scan" && req.method === "POST") {
        const body = await readJsonBody(req);
        const timeframe = parseTimeframeFromPreviewBody(body.timeframe);
        sendJson(
            res,
            200,
            await paperBot.previewScan({
                limit: Number(body.limit),
                ...(timeframe ? { timeframe } : {}),
            })
        );
        return;
    }

    if (url.pathname === "/api/bot/start-trade" && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 200, await paperBot.startTrade(String(body.symbol ?? "")));
        return;
    }

    if (url.pathname === "/api/bot/close" && req.method === "POST") {
        sendJson(res, 200, paperBot.closeActiveTrade());
        return;
    }

    if (url.pathname === "/api/bot/extend-trade-time" && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 200, paperBot.extendActiveTradeHold(Number(body.extendByMinutes)));
        return;
    }

    if (url.pathname === "/api/bot/auto-mode" && req.method === "POST") {
        const body = await readJsonBody(req);
        sendJson(res, 200, paperBot.setAutoMode(Boolean(body.enabled)));
        return;
    }

    if (url.pathname === "/api/bot/config" && req.method === "POST") {
        const body = await readJsonBody(req);
        const patch = buildBotConfigPatch(body);

        sendJson(res, 200, paperBot.updateConfig(patch));
        return;
    }

    if (isDev && url.pathname === "/__dev_reload") {
        res.writeHead(200, {
            "Content-Type": "text/event-stream",
            "Cache-Control": "no-cache",
            Connection: "keep-alive",
        });
        res.write("data: connected\n\n");
        reloadClients.add(res);
        req.on("close", () => {
            reloadClients.delete(res);
        });
        return;
    }

    await serveStatic(url.pathname, res);
});

server.listen(PORT, () => {
    marketStream.start();
    console.log(`Crypto signal dashboard: http://localhost:${PORT}`);
});

if (isDev) {
    watch(publicDir, { recursive: true }, (_, filename) => {
        if (!filename) return;
        const changed = filename.toLowerCase();
        if (!changed.endsWith(".html") && !changed.endsWith(".css") && !changed.endsWith(".js")) return;
        // OneDrive and some editors can emit bursty duplicate file events.
        if (reloadDebounceTimer) {
            clearTimeout(reloadDebounceTimer);
        }
        reloadDebounceTimer = setTimeout(() => {
            pushReloadEvent();
            reloadDebounceTimer = null;
        }, 300);
    });
}
