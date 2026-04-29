import { apiGet, apiPost } from "./client";

export function fetchSignals(limit, timeframe) {
  const params = new URLSearchParams({ limit: String(limit), timeframe });
  return apiGet(`/api/signals?${params.toString()}`);
}

export function fetchBotState() {
  return apiGet("/api/bot/state");
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

export function startTradeBot(symbol) {
  return apiPost("/api/bot/start-trade", { symbol });
}

export function closeBotTrade() {
  return apiPost("/api/bot/close");
}

export function extendBotTradeTime(extendByMinutes) {
  return apiPost("/api/bot/extend-trade-time", { extendByMinutes });
}

export function setBotAutoMode(enabled) {
  return apiPost("/api/bot/auto-mode", { enabled });
}

export function updateBotConfig(config) {
  return apiPost("/api/bot/config", config);
}
