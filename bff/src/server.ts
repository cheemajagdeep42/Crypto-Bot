import "./loadEnv";
import { createServer, ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { watch } from "node:fs";
import Decimal from "decimal.js";
import path from "node:path";
import { marketStream } from "./marketStream";
import { normalizePendingMainnetSells, paperBot } from "./paperBot";
import { buildBotConfigPatch } from "./botConfigPatch";
import { openApiSpec, swaggerUiHtml } from "./openapi";
import { normalizeDexScreenerPairId, scanTopSignalsDexscreener } from "./dexscreenerScan";
import {
    parseTimeframe,
    parseTimeframeFromPreviewBody,
    scanTopSignals,
    scanTopTrending
} from "./scanner";
import { inferMainnetBuyFromTxSignature } from "./solanaInferSwapFromTx";
import { fetchSplTokenRawBalanceForOwner } from "./solanaSplTokenBalance";
import { solanaSignatureNetworkFeeUsdt } from "./solanaTxNetworkFee";
import { fetchOnChainWalletSnapshot, type BotKnownTokenMeta } from "./solanaOnChainSnapshot";
import { normalizeWatchWalletAddress } from "./watchWalletAddress";
import { jupiterQuotePreviewForUsdcBuy } from "./trading/jupiterQuote";
import { jupiterSwapTxForTokenSell, jupiterSwapTxForUsdcBuy, tokenUiAmountToRawExactIn } from "./trading/jupiterSwap";
import {
    getPumpFeedState,
    startPumpTelegramListener,
    stopPumpTelegramListener,
} from "./pumpTelegramFeed";

/** SPL mints from mainnet / recorded legs so the wallet snapshot can show balances beyond SOL + USDT. */
function collectBotKnownSolanaMints(state: {
    activeTrades: Array<{ solanaOutputMint?: string; symbol?: string }>;
    tradeHistory: Array<{ solanaOutputMint?: string; symbol?: string }>;
}): BotKnownTokenMeta[] {
    const out: BotKnownTokenMeta[] = [];
    const seen = new Set<string>();
    const push = (mint: string | undefined, symbol: string | undefined) => {
        const m = String(mint ?? "").trim();
        if (!m) return;
        if (seen.has(m)) return;
        seen.add(m);
        const sym = String(symbol ?? "Token").trim();
        out.push({ mint: m, symbol: sym || "Token" });
    };
    for (const t of state.activeTrades ?? []) {
        push(t.solanaOutputMint, t.symbol);
    }
    for (const t of state.tradeHistory ?? []) {
        push(t.solanaOutputMint, t.symbol);
    }
    return out;
}

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
            const cfg = paperBot.getState().config;
            const safeLimit = Math.max(1, Math.min(20, Number.isFinite(limit) ? limit : 20));
            const result =
                cfg.marketSource === "dexscreener"
                    ? await scanTopSignalsDexscreener(safeLimit, timeframe, {
                          liquidityGuard: cfg.liquidityGuard,
                          minFiveMinuteFlowUsdt: cfg.minFiveMinuteFlowUsdt,
                          liquidityCheckRequired: cfg.liquidityCheckRequired,
                          minMarketCapUsd: cfg.minMarketCapUsd,
                          maxMarketCapUsd: cfg.maxMarketCapUsd,
                          dexMinPairAgeMinutes: cfg.dexMinPairAgeMinutes,
                          minEntryChartTimeframes: cfg.minEntryChartTimeframes,
                      })
                    : await scanTopTrending(safeLimit, timeframe);
            sendJson(res, 200, result);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, 502, {
                error: "Could not fetch market data.",
                detail: message,
            });
        }

        return;
    }

    if (url.pathname === "/api/bot/state") {
        sendJson(res, 200, paperBot.getState());
        return;
    }

    if (url.pathname === "/api/wallet/on-chain-snapshot" && req.method === "GET") {
        const cfg = paperBot.getState().config;
        const key = url.searchParams.get("key") === "w2" ? "w2" : "w1";
        const overrideRaw = url.searchParams.get("address")?.trim() ?? "";
        const override = normalizeWatchWalletAddress(overrideRaw);
        const addrFromCfg =
            key === "w2" ? (cfg.watchWalletAddressW2?.trim() ?? "") : (cfg.watchWalletAddress?.trim() ?? "");
        const addr = override || addrFromCfg;
        if (overrideRaw && !override) {
            sendJson(res, 400, { error: "Invalid Solana address for address= query parameter." });
            return;
        }
        const botKnown = collectBotKnownSolanaMints(paperBot.getState());
        const snapshot = await fetchOnChainWalletSnapshot(addr, { botKnownTokens: botKnown });
        sendJson(res, 200, { ...snapshot, key, addressOverride: Boolean(override) });
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

    if (url.pathname === "/api/bot/auto-entry-target" && req.method === "POST") {
        try {
            const body = (await readJsonBody(req)) as Record<string, unknown>;
            if (body.clear === true) {
                sendJson(res, 200, paperBot.setAutoEntryTarget({ clear: true }));
                return;
            }
            const symbol = String(body.symbol ?? "").trim();
            if (!symbol) {
                sendJson(res, 400, { error: "symbol is required unless clear is true" });
                return;
            }
            const contractAddress =
                typeof body.contractAddress === "string" ? body.contractAddress.trim() : undefined;
            sendJson(
                res,
                200,
                paperBot.setAutoEntryTarget({
                    symbol,
                    ...(contractAddress ? { contractAddress } : {}),
                })
            );
        } catch (e) {
            const message = e instanceof Error ? e.message : String(e);
            sendJson(res, 400, { error: message });
        }
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

    if (url.pathname === "/api/bot/add-dex-token" && req.method === "POST") {
        try {
            const body = (await readJsonBody(req)) as Record<string, unknown>;
            const tokenAddress = String(body?.tokenAddress ?? "").trim();
            const chainId = typeof body?.chainId === "string" ? body.chainId.trim() : undefined;
            const timeframe = parseTimeframeFromPreviewBody(body.timeframe);
            sendJson(
                res,
                200,
                await paperBot.addDexTokenByAddress({
                    tokenAddress,
                    ...(chainId ? { chainId } : {}),
                    ...(timeframe ? { timeframe } : {}),
                })
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, 400, { error: message });
        }
        return;
    }

    if (url.pathname === "/api/bot/start-trade" && req.method === "POST") {
        const body = (await readJsonBody(req)) as Record<string, unknown>;
        const symbol = String(body?.symbol ?? "");
        const { symbol: _omitSymbol, ...rest } = body ?? {};
        const patch = buildBotConfigPatch(rest);
        sendJson(res, 200, await paperBot.startTrade(symbol, patch));
        return;
    }

    if (url.pathname === "/api/bot/stack-manual-trade" && req.method === "POST") {
        try {
            const body = (await readJsonBody(req)) as Record<string, unknown>;
            const patch = buildBotConfigPatch(body ?? {});
            sendJson(res, 200, await paperBot.stackManualTrade(patch));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, 400, { error: message });
        }
        return;
    }

    if (url.pathname === "/api/bot/close" && req.method === "POST") {
        const body = await readJsonBody(req);
        const tradeId = typeof body?.tradeId === "string" ? body.tradeId : undefined;
        sendJson(res, 200, paperBot.closeActiveTrade("manual", tradeId));
        return;
    }

    if (url.pathname === "/api/bot/extend-trade-time" && req.method === "POST") {
        const body = await readJsonBody(req);
        const tradeId = typeof body?.tradeId === "string" ? body.tradeId : undefined;
        sendJson(
            res,
            200,
            paperBot.extendActiveTradeHold(Number(body.extendByMinutes), tradeId)
        );
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

    if (url.pathname === "/api/trading/jupiter-quote" && req.method === "POST") {
        const body = await readJsonBody(req);
        const outputMint = String(body?.outputMint ?? "").trim();
        const amountUsd = Number(body?.amountUsd);
        const maxSlippagePercent = Number(body?.maxSlippagePercent ?? 2);
        const inputMint = typeof body?.inputMint === "string" ? body.inputMint.trim() : undefined;
        const outputDecimals =
            body?.outputDecimals != null && body.outputDecimals !== ""
                ? Number(body.outputDecimals)
                : undefined;

        const result = await jupiterQuotePreviewForUsdcBuy({
            outputMint,
            amountUsd,
            maxSlippagePercent,
            ...(inputMint ? { inputMint } : {}),
            ...(outputDecimals != null && Number.isFinite(outputDecimals) ? { outputDecimals } : {}),
        });
        if (!result.ok) {
            sendJson(res, result.status && result.status >= 400 ? result.status : 400, {
                error: result.error,
            });
            return;
        }
        sendJson(res, 200, { preview: result.preview });
        return;
    }

    if (url.pathname === "/api/bot/infer-mainnet-buy-tx" && req.method === "POST") {
        const body = await readJsonBody(req);
        const signature = String(body?.signature ?? "").trim();
        const result = await inferMainnetBuyFromTxSignature(signature);
        if (!result.ok) {
            sendJson(res, 400, { error: result.error });
            return;
        }
        sendJson(res, 200, { inferred: result.inferred });
        return;
    }

    if (url.pathname === "/api/bot/register-mainnet-open" && req.method === "POST") {
        try {
            const body = await readJsonBody(req);
            const symbol = String(body?.symbol ?? "").trim();
            const baseAsset = String(body?.baseAsset ?? symbol).trim();
            const entryPriceUsd = Number(body?.entryPriceUsd);
            const quantityTokens = Number(body?.quantityTokens);
            const positionSizeUsdt = Number(body?.positionSizeUsdt);
            const outputMint = String(body?.outputMint ?? "").trim();
            const tokenDecimals = Number(body?.tokenDecimals);
            const txSignature = typeof body?.txSignature === "string" ? body.txSignature.trim() : undefined;
            const chartUrl = typeof body?.chartUrl === "string" ? body.chartUrl.trim() : undefined;
            const dexChainId = typeof body?.dexChainId === "string" ? body.dexChainId.trim() : "";
            const dexPairAddressRaw = typeof body?.dexPairAddress === "string" ? body.dexPairAddress.trim() : "";
            const dexPairAddress = normalizeDexScreenerPairId(dexPairAddressRaw);
            const dexPaperPriceRef =
                dexChainId && dexPairAddress ? { chainId: dexChainId, pairAddress: dexPairAddress } : undefined;

            let buyNetworkFeeUsdt: number | null = null;
            if (txSignature) {
                try {
                    buyNetworkFeeUsdt = await solanaSignatureNetworkFeeUsdt(txSignature);
                } catch {
                    buyNetworkFeeUsdt = null;
                }
            }

            sendJson(
                res,
                200,
                paperBot.registerMainnetOpenTrade({
                    symbol,
                    baseAsset,
                    entryPriceUsd,
                    quantityTokens,
                    positionSizeUsdt,
                    outputMint,
                    tokenDecimals,
                    ...(txSignature ? { txSignature } : {}),
                    buyNetworkFeeUsdt,
                    ...(dexPaperPriceRef ? { dexPaperPriceRef } : {}),
                    ...(chartUrl ? { chartUrl } : {}),
                })
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, 400, { error: message });
        }
        return;
    }

    if (url.pathname === "/api/bot/mainnet-sell-done" && req.method === "POST") {
        const body = await readJsonBody(req);
        const tradeId = String(body?.tradeId ?? "").trim();
        const txSignature = typeof body?.txSignature === "string" ? body.txSignature.trim() : "";
        let networkFeeUsdt: number | null = null;
        if (txSignature) {
            try {
                networkFeeUsdt = await solanaSignatureNetworkFeeUsdt(txSignature);
            } catch {
                networkFeeUsdt = null;
            }
        }
        const inputAmountRaw =
            typeof body?.inputAmountRaw === "string" && body.inputAmountRaw.trim().length > 0
                ? body.inputAmountRaw.trim()
                : undefined;
        const state = await paperBot.applyMainnetSellExecuted(tradeId, {
            txSignature: txSignature || undefined,
            networkFeeUsdt,
            ...(inputAmountRaw ? { inputAmountRaw } : {}),
        });
        sendJson(res, 200, state);
        return;
    }

    if (url.pathname === "/api/bot/mainnet-sell-clear" && req.method === "POST") {
        const body = await readJsonBody(req);
        const tradeId = String(body?.tradeId ?? "").trim();
        sendJson(res, 200, paperBot.clearPendingMainnetSell(tradeId));
        return;
    }

    if (url.pathname === "/api/bot/mainnet-reconcile-flat" && req.method === "POST") {
        const body = await readJsonBody(req);
        const tradeId = String(body?.tradeId ?? "").trim();
        const userPublicKey = String(body?.userPublicKey ?? "").trim();
        try {
            const state = await paperBot.reconcileMainnetOpenLegIfWalletEmpty(tradeId, userPublicKey);
            sendJson(res, 200, state);
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, 400, { error: message });
        }
        return;
    }

    if (url.pathname === "/api/bot/mainnet-dismiss-stuck-leg" && req.method === "POST") {
        const body = await readJsonBody(req);
        const tradeId = String(body?.tradeId ?? "").trim();
        try {
            sendJson(res, 200, paperBot.forceDismissMainnetStuckLeg(tradeId));
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, 400, { error: message });
        }
        return;
    }

    if (url.pathname === "/api/bot/mainnet-buy-done" && req.method === "POST") {
        const body = await readJsonBody(req);
        const tradeId = String(body?.tradeId ?? "").trim();
        const txSignature = String(body?.txSignature ?? "").trim();
        if (!txSignature) {
            sendJson(res, 400, { error: "txSignature is required." });
            return;
        }
        const infer = await inferMainnetBuyFromTxSignature(txSignature);
        if (!infer.ok) {
            sendJson(res, 400, { error: infer.error });
            return;
        }
        let buyNetworkFeeUsdt: number | null = null;
        try {
            buyNetworkFeeUsdt = await solanaSignatureNetworkFeeUsdt(txSignature);
        } catch {
            buyNetworkFeeUsdt = null;
        }
        try {
            sendJson(
                res,
                200,
                paperBot.attachMainnetBuyToOpenTrade(tradeId, txSignature, infer.inferred, buyNetworkFeeUsdt)
            );
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            sendJson(res, 400, { error: message });
        }
        return;
    }

    if (url.pathname === "/api/trading/jupiter-sell-tx" && req.method === "POST") {
        const body = await readJsonBody(req);
        const tradeId = String(body?.tradeId ?? "").trim();
        const userPublicKey = String(body?.userPublicKey ?? "").trim();
        const maxSlippagePercent = Number(body?.maxSlippagePercent ?? 2);

        const st = paperBot.getState();
        const trade = st.activeTrades.find((t) => t.id === tradeId);
        const sellQueue = trade ? normalizePendingMainnetSells(trade) : [];
        if (!trade || trade.executionChannel !== "mainnet" || sellQueue.length === 0) {
            sendJson(res, 400, { error: "No pending mainnet sell for this trade." });
            return;
        }
        const mint = trade.solanaOutputMint?.trim() ?? "";
        const dec = trade.tokenDecimals;
        if (!mint || dec == null || !Number.isFinite(dec)) {
            sendJson(res, 400, { error: "Trade is missing solanaOutputMint or tokenDecimals." });
            return;
        }

        const pending = sellQueue[0];
        const frac = pending.exitKind === "close_full" ? 1 : Math.min(1, Math.max(0.05, pending.sellFraction));
        const qtyUi = new Decimal(trade.quantity).mul(frac).toNumber();
        const computedRawStr = tokenUiAmountToRawExactIn(qtyUi, dec);
        let computedRaw: bigint;
        try {
            computedRaw = BigInt(computedRawStr);
        } catch {
            sendJson(res, 400, { error: "Computed sell amount is invalid." });
            return;
        }
        if (computedRaw <= 0n) {
            sendJson(res, 400, { error: "Computed sell amount is zero." });
            return;
        }

        const walletBal = await fetchSplTokenRawBalanceForOwner(userPublicKey, mint);
        if (!walletBal.ok) {
            sendJson(res, 400, { error: `Could not read wallet token balance: ${walletBal.error}` });
            return;
        }
        if (walletBal.raw <= 0n) {
            sendJson(res, 400, {
                error:
                    "No tokens left for this mint in the connected wallet — the sell may already be on-chain while the dashboard still shows a pending alert. Use “Mark flat (no tokens)” below, or POST /api/bot/mainnet-reconcile-flat with this tradeId and wallet.",
                zeroTokenBalance: true,
                tradeId,
            });
            return;
        }

        let amountRaw = computedRaw;
        let sellAmountCappedToWallet = false;
        if (computedRaw > walletBal.raw) {
            amountRaw = walletBal.raw;
            sellAmountCappedToWallet = true;
        }
        const amountRawStr = amountRaw.toString();

        const result = await jupiterSwapTxForTokenSell({
            inputMint: mint,
            amountRaw: amountRawStr,
            maxSlippagePercent,
            userPublicKey,
        });
        if (!result.ok) {
            sendJson(res, result.status && result.status >= 400 ? result.status : 400, { error: result.error });
            return;
        }
        sendJson(res, 200, {
            swapTransaction: result.swapTransaction,
            amountRaw: amountRawStr,
            ...(sellAmountCappedToWallet ? { sellAmountCappedToWallet: true } : {}),
            ...(result.lastValidBlockHeight != null ? { lastValidBlockHeight: result.lastValidBlockHeight } : {}),
        });
        return;
    }

    if (url.pathname === "/api/trading/jupiter-swap-tx" && req.method === "POST") {
        const body = await readJsonBody(req);
        const outputMint = String(body?.outputMint ?? "").trim();
        const amountUsd = Number(body?.amountUsd);
        const maxSlippagePercent = Number(body?.maxSlippagePercent ?? 2);
        const userPublicKey = String(body?.userPublicKey ?? "").trim();
        const inputMint = typeof body?.inputMint === "string" ? body.inputMint.trim() : undefined;

        const result = await jupiterSwapTxForUsdcBuy({
            outputMint,
            amountUsd,
            maxSlippagePercent,
            userPublicKey,
            ...(inputMint ? { inputMint } : {}),
        });
        if (!result.ok) {
            sendJson(res, result.status && result.status >= 400 ? result.status : 400, {
                error: result.error,
            });
            return;
        }
        sendJson(res, 200, {
            swapTransaction: result.swapTransaction,
            ...(result.lastValidBlockHeight != null
                ? { lastValidBlockHeight: result.lastValidBlockHeight }
                : {}),
        });
        return;
    }

    /** Jupiter USDT → token buy for an open mainnet leg that has no buy tx yet (stacked leg). */
    if (url.pathname === "/api/trading/jupiter-stack-buy-tx" && req.method === "POST") {
        const body = await readJsonBody(req);
        const tradeId = String(body?.tradeId ?? "").trim();
        const userPublicKey = String(body?.userPublicKey ?? "").trim();
        const maxSlippagePercent = Number(body?.maxSlippagePercent ?? 2);

        const st = paperBot.getState();
        const trade = st.activeTrades.find((t) => t.id === tradeId);
        if (!trade || trade.executionChannel !== "mainnet") {
            sendJson(res, 400, { error: "Not a mainnet open trade." });
            return;
        }
        if (trade.mainnetBuyTxSignature) {
            sendJson(res, 400, { error: "This leg already has a confirmed on-chain buy." });
            return;
        }
        if (normalizePendingMainnetSells(trade).length > 0) {
            sendJson(res, 400, { error: "Complete or clear pending sells before signing a buy." });
            return;
        }
        const mint = trade.solanaOutputMint?.trim() ?? "";
        const amountUsd = Number(trade.positionSizeUsdt);
        if (!mint) {
            sendJson(res, 400, { error: "Trade has no output mint." });
            return;
        }
        if (!Number.isFinite(amountUsd) || amountUsd < 0.01) {
            sendJson(res, 400, { error: "Invalid bet size for Jupiter buy." });
            return;
        }

        const slip = Number.isFinite(maxSlippagePercent) ? maxSlippagePercent : 2;
        const result = await jupiterSwapTxForUsdcBuy({
            outputMint: mint,
            amountUsd,
            maxSlippagePercent: slip,
            userPublicKey,
        });
        if (!result.ok) {
            sendJson(res, result.status && result.status >= 400 ? result.status : 400, {
                error: result.error,
            });
            return;
        }
        sendJson(res, 200, {
            swapTransaction: result.swapTransaction,
            ...(result.lastValidBlockHeight != null
                ? { lastValidBlockHeight: result.lastValidBlockHeight }
                : {}),
        });
        return;
    }

    if (url.pathname === "/api/pump/messages" && req.method === "GET") {
        sendJson(res, 200, getPumpFeedState());
        return;
    }

    if (url.pathname === "/api/pump/bot/start" && req.method === "POST") {
        const result = await startPumpTelegramListener();
        if (!result.ok) {
            sendJson(res, 400, { error: result.error ?? "Could not start pump Telegram listener." });
            return;
        }
        sendJson(res, 200, getPumpFeedState());
        return;
    }

    if (url.pathname === "/api/pump/bot/stop" && req.method === "POST") {
        await stopPumpTelegramListener();
        sendJson(res, 200, getPumpFeedState());
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
