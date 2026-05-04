import { apiGet, apiPost } from "./client";

export { ApiRequestError } from "./client";

export function fetchSignals(limit, timeframe) {
  const params = new URLSearchParams({ limit: String(limit), timeframe });
  return apiGet(`/api/signals?${params.toString()}`);
}

export function fetchBotState() {
  return apiGet("/api/bot/state");
}

/** @param {{ overrideAddress?: string }} [options] If set, snapshot this mainnet owner instead of bot watch W1/W2. */
export function fetchWalletOnChainSnapshot(key = "w1", options) {
  const k = key === "w2" ? "w2" : "w1";
  const params = new URLSearchParams({ key: k });
  const oa = options && typeof options.overrideAddress === "string" ? options.overrideAddress.trim() : "";
  if (oa) params.set("address", oa);
  return apiGet(`/api/wallet/on-chain-snapshot?${params.toString()}`);
}

export function startBot() {
  return apiPost("/api/bot/start");
}

export function stopBot(closeActiveTrade = false) {
  return apiPost("/api/bot/stop", { closeActiveTrade: Boolean(closeActiveTrade) });
}

export function scanBot() {
  return apiPost("/api/bot/scan");
}

export function previewScanBot(limit, timeframe) {
  return apiPost("/api/bot/preview-scan", { limit, timeframe });
}

/** @param {{ tokenAddress: string; chainId?: string; timeframe?: string }} body */
export function addDexTokenBot(body) {
  return apiPost("/api/bot/add-dex-token", body && typeof body === "object" ? body : {});
}

/** Arm one token for auto mode, or clear. @param {{ symbol?: string; contractAddress?: string; clear?: boolean }} body */
export function setAutoEntryTargetBot(body) {
  return apiPost("/api/bot/auto-entry-target", body && typeof body === "object" ? body : {});
}

export function startTradeBot(payload) {
  return apiPost("/api/bot/start-trade", payload);
}

/** @param {Record<string, unknown>} [strategyConfig] Same shape as save config / merged Bot Settings (optional). */
export function stackManualTradeBot(strategyConfig) {
  return apiPost("/api/bot/stack-manual-trade", strategyConfig && typeof strategyConfig === "object" ? strategyConfig : {});
}

export function closeBotTrade(tradeId) {
  return apiPost("/api/bot/close", tradeId ? { tradeId } : {});
}

export function extendBotTradeTime(extendByMinutes, tradeId) {
  return apiPost("/api/bot/extend-trade-time", {
    extendByMinutes,
    ...(tradeId ? { tradeId } : {})
  });
}

export function setBotAutoMode(enabled) {
  return apiPost("/api/bot/auto-mode", { enabled });
}

export function updateBotConfig(config) {
  return apiPost("/api/bot/config", config);
}

/** Mainnet Jupiter quote preview: USDT → outputMint (default). @param {Record<string, unknown>} payload */
export function fetchJupiterQuotePreview(payload) {
  return apiPost("/api/trading/jupiter-quote", payload);
}

/** Mainnet Jupiter v6 unsigned swap (base64) for wallet signing. @param {Record<string, unknown>} payload */
export function fetchJupiterSwapTx(payload) {
  return apiPost("/api/trading/jupiter-swap-tx", payload);
}

/** Jupiter buy tx for a mainnet leg pending on-chain confirmation (e.g. after Trigger new trade). */
export function fetchJupiterStackBuyTx(payload) {
  return apiPost("/api/trading/jupiter-stack-buy-tx", payload && typeof payload === "object" ? payload : {});
}

/** Record open mainnet leg after a successful Jupiter buy (same exit rules as paper). */
export function registerMainnetOpenBot(payload) {
  return apiPost("/api/bot/register-mainnet-open", payload && typeof payload === "object" ? payload : {});
}

/** Parse a confirmed mainnet swap tx (Solscan signature) into suggested register fields. */
export function inferMainnetBuyFromTx(payload) {
  return apiPost("/api/bot/infer-mainnet-buy-tx", payload && typeof payload === "object" ? payload : {});
}

/** Build unsigned Jupiter sell (token → USDT) for a queued exit. */
export function fetchJupiterSellTx(payload) {
  return apiPost("/api/trading/jupiter-sell-tx", payload && typeof payload === "object" ? payload : {});
}

/** After Phantom confirms stacked / pending mainnet buy: infer tx and attach to open leg. */
export function confirmMainnetStackBuy(payload) {
  return apiPost("/api/bot/mainnet-buy-done", payload && typeof payload === "object" ? payload : {});
}

/** Apply partial/full exit to bot state after Phantom confirms the sell tx. */
export function applyMainnetSellDone(tradeId, txSignature, options) {
  const id = String(tradeId ?? "").trim();
  const sig = typeof txSignature === "string" ? txSignature.trim() : "";
  const raw =
    options && typeof options.inputAmountRaw === "string" ? options.inputAmountRaw.trim() : "";
  return apiPost("/api/bot/mainnet-sell-done", {
    tradeId: id,
    ...(sig ? { txSignature: sig } : {}),
    ...(raw ? { inputAmountRaw: raw } : {})
  });
}

/** Drop pending sell so rules can re-evaluate (e.g. stale quote). */
export function clearMainnetSellBot(tradeId) {
  return apiPost("/api/bot/mainnet-sell-clear", { tradeId: String(tradeId ?? "").trim() });
}

/**
 * On-chain wallet has 0 of the leg mint but the bot still shows open / pending sell — close the leg at mark and clear queue.
 * @param {string} tradeId
 * @param {string} userPublicKey
 */
export function reconcileMainnetFlatBot(tradeId, userPublicKey) {
  return apiPost("/api/bot/mainnet-reconcile-flat", {
    tradeId: String(tradeId ?? "").trim(),
    userPublicKey: String(userPublicKey ?? "").trim()
  });
}

/** Clear pending sells and close mainnet leg at mark without RPC (use when stuck / wallet not connected). */
export function dismissMainnetStuckLegBot(tradeId) {
  return apiPost("/api/bot/mainnet-dismiss-stuck-leg", {
    tradeId: String(tradeId ?? "").trim()
  });
}

/** @returns {Promise<{ messages: Array<{id: string, text: string, receivedAt: string}>, listenerActive: boolean, configured: boolean, lastError: string | null, channel: string }>} */
export function fetchPumpFeed() {
  return apiGet("/api/pump/messages");
}

export function startPumpFeedBot() {
  return apiPost("/api/pump/bot/start", {});
}

export function stopPumpFeedBot() {
  return apiPost("/api/pump/bot/stop", {});
}
