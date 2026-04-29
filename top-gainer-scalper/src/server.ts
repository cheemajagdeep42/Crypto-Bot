import { createServer, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { paperBot } from "./paperBot";
import { parseTimeframe, scanTopSignals } from "./scanner";

const PORT = Number(process.env.PORT ?? 3000);
const publicDir = path.resolve(process.cwd(), "public");

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
            const result = await scanTopSignals(limit, timeframe);
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

    if (url.pathname === "/api/bot/start" && req.method === "POST") {
        sendJson(res, 200, paperBot.start());
        return;
    }

    if (url.pathname === "/api/bot/stop" && req.method === "POST") {
        sendJson(res, 200, paperBot.stop());
        return;
    }

    if (url.pathname === "/api/bot/scan" && req.method === "POST") {
        sendJson(res, 200, await paperBot.scanOnce());
        return;
    }

    if (url.pathname === "/api/bot/close" && req.method === "POST") {
        sendJson(res, 200, paperBot.closeActiveTrade());
        return;
    }

    await serveStatic(url.pathname, res);
});

server.listen(PORT, () => {
    console.log(`Crypto signal dashboard: http://localhost:${PORT}`);
});
