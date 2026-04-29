const rows = document.querySelector("#tokenRows");
const statusEl = document.querySelector("#status");
const updatedAt = document.querySelector("#updatedAt");
const refreshButton = document.querySelector("#refreshButton");
const limitSelect = document.querySelector("#limitSelect");
const tableTimeframeSelect = document.querySelector("#tableTimeframeSelect");
const goodCount = document.querySelector("#goodCount");
const watchCount = document.querySelector("#watchCount");
const badCount = document.querySelector("#badCount");
const avgSpread = document.querySelector("#avgSpread");
const tabButtons = document.querySelectorAll(".tabButton");
const tabPanels = document.querySelectorAll(".tabPanel");
const botStartButton = document.querySelector("#botStartButton");
const botStopButton = document.querySelector("#botStopButton");
const botScanButton = document.querySelector("#botScanButton");
const botCloseButton = document.querySelector("#botCloseButton");
const botStatus = document.querySelector("#botStatus");
const botPositionSize = document.querySelector("#botPositionSize");
const botExitRules = document.querySelector("#botExitRules");
const activeTrade = document.querySelector("#activeTrade");
const botLogs = document.querySelector("#botLogs");

const signalText = {
    good_buy: "Good buy",
    watch: "Watch",
    bad_buy: "Bad buy",
};

const timeframeLabels = {
    "30m": "Last 30 minutes",
    "1h": "Last 1 hour",
    "3h": "Last 3 hours",
    "6h": "Last 6 hours",
    "12h": "Last 12 hours",
    "24h": "Last 24 hours",
    "3d": "Last 3 days",
    "1w": "Last 1 week",
    "1mo": "Last 1 month",
};

function formatMoney(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: value >= 1 ? 2 : 8,
    }).format(value);
}

function formatCompactMoney(value) {
    return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        notation: "compact",
        maximumFractionDigits: 2,
    }).format(value);
}

function formatPercent(value) {
    if (value === null || Number.isNaN(value)) return "n/a";
    return `${value.toFixed(2)}%`;
}

function formatSignedPercent(value) {
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
}

function fallbackCoinMarketCapUrl(baseAsset) {
    const knownSlugs = {
        BTC: "bitcoin",
        ETH: "ethereum",
        BNB: "bnb",
        SOL: "solana",
        XRP: "xrp",
        DOGE: "dogecoin",
        ADA: "cardano",
        AVAX: "avalanche",
        LINK: "chainlink",
        TON: "toncoin",
    };
    const slug = knownSlugs[baseAsset];

    if (slug) return `https://coinmarketcap.com/currencies/${slug}/`;
    return `https://coinmarketcap.com/search/?q=${encodeURIComponent(baseAsset)}`;
}

function tokenLinks(token) {
    return {
        coinMarketCap: token.links?.coinMarketCap ?? fallbackCoinMarketCapUrl(token.baseAsset),
        binance: token.links?.binance ?? `https://www.binance.com/en/trade/${token.baseAsset}_USDT`,
    };
}

function activeTradeLinks(trade) {
    return {
        coinMarketCap: fallbackCoinMarketCapUrl(trade.baseAsset),
        binance: `https://www.binance.com/en/trade/${trade.baseAsset}_USDT`,
    };
}

function renderSummary(tokens) {
    goodCount.textContent = tokens.filter((token) => token.signal === "good_buy").length;
    watchCount.textContent = tokens.filter((token) => token.signal === "watch").length;
    badCount.textContent = tokens.filter((token) => token.signal === "bad_buy").length;

    const spread =
        tokens.reduce((total, token) => total + token.spreadPercent, 0) / Math.max(tokens.length, 1);
    avgSpread.textContent = `${spread.toFixed(3)}%`;
}

function activateTab(tabId) {
    tabButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === tabId);
    });
    tabPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.id === tabId);
    });
}

function renderRows(tokens) {
    rows.innerHTML = "";

    tokens.forEach((token, index) => {
        const tr = document.createElement("tr");
        const links = tokenLinks(token);
        const scorePercent = Math.min(100, Math.max(0, (token.score / 12) * 100));
        const factors = token.factors
            .map(
                (factor) =>
                    `<span class="chip ${factor.status}" title="${factor.note}">${factor.name}: ${factor.value}</span>`
            )
            .join("");

        tr.innerHTML = `
            <td class="rankCol"><span class="rank">${index + 1}</span></td>
            <td>
                <div class="token">
                    <strong>${token.baseAsset}</strong>
                    <span>${token.symbol}</span>
                    <span class="links">
                        <a href="${links.coinMarketCap}" target="_blank" rel="noopener noreferrer">CMC</a>
                        <a href="${links.binance}" target="_blank" rel="noopener noreferrer">Binance</a>
                    </span>
                </div>
            </td>
            <td><span class="badge ${token.signal}">${signalText[token.signal]}</span></td>
            <td>
                <div class="scoreCell">
                    <strong>${token.score}/12</strong>
                    <div class="scoreTrack"><span style="width: ${scorePercent}%"></span></div>
                    <div class="subtle">${token.confidence} confidence</div>
                </div>
            </td>
            <td class="numeric gainValue">${formatPercent(token.gainPercent)}</td>
            <td class="numeric">${formatPercent(token.pullbackPercent)}</td>
            <td class="numeric">${token.spreadPercent.toFixed(3)}%</td>
            <td class="numeric">${formatCompactMoney(token.quoteVolume)}<div class="subtle">${token.trades.toLocaleString()} trades</div></td>
            <td class="numeric">${formatMoney(token.ask)}</td>
            <td><div class="factors">${factors}</div></td>
        `;

        rows.appendChild(tr);
    });
}

async function loadSignals() {
    refreshButton.disabled = true;
    statusEl.className = "status";
    statusEl.textContent = "Loading market data...";

    try {
        const params = new URLSearchParams({
            limit: limitSelect.value,
            timeframe: tableTimeframeSelect.value,
        });
        const response = await fetch(`/api/signals?${params.toString()}`);
        const body = await response.json();

        if (!response.ok) {
            throw new Error(body.detail || body.error || "Unknown API error");
        }

        renderSummary(body.tokens);
        renderRows(body.tokens);
        const timeframeLabel =
            body.timeframeLabel ?? timeframeLabels[tableTimeframeSelect.value] ?? "Selected window";
        updatedAt.textContent = `Updated ${new Date(body.updatedAt).toLocaleString()}`;
        statusEl.textContent = body.tokens.length
            ? `Showing the top ${body.tokens.length} positive USDT gainers for ${timeframeLabel.toLowerCase()} with buy-quality scoring.`
            : "No tokens passed the current filters.";
    } catch (error) {
        statusEl.className = "status error";
        statusEl.textContent = `Market data failed: ${error.message}`;
    } finally {
        refreshButton.disabled = false;
    }
}

function renderBotState(state) {
    if (!state?.config) {
        botStatus.textContent = "Backend old";
        botStatus.className = "negativePnl";
        activeTrade.className = "emptyTrade";
        activeTrade.textContent = "Restart the server to load the bot API.";
        botLogs.innerHTML = `<div class="logLine error"><span>API</span>Bot API is not available on this running server.</div>`;
        botStartButton.disabled = true;
        botStopButton.disabled = true;
        botScanButton.disabled = true;
        botCloseButton.disabled = true;
        return;
    }

    botStatus.textContent = state.status === "running" ? "Running" : "Stopped";
    botStatus.className = state.status === "running" ? "runningText" : "";
    botPositionSize.textContent = formatMoney(state.config.positionSizeUsdt);
    botExitRules.textContent = `+${state.config.takeProfitPercent}% / -${state.config.stopLossPercent}%`;
    botStartButton.disabled = state.status === "running";
    botStopButton.disabled = state.status !== "running";
    botCloseButton.disabled = !state.activeTrade;

    if (state.activeTrade) {
        const trade = state.activeTrade;
        const links = activeTradeLinks(trade);
        const pnlClass = trade.pnlPercent >= 0 ? "positivePnl" : "negativePnl";
        activeTrade.className = "activeTrade";
        activeTrade.innerHTML = `
            <div>
                <strong>${trade.symbol}</strong>
                <span>${new Date(trade.openedAt).toLocaleTimeString()}</span>
                <span class="links">
                    <a href="${links.binance}" target="_blank" rel="noopener noreferrer">Binance chart</a>
                    <a href="${links.coinMarketCap}" target="_blank" rel="noopener noreferrer">CMC</a>
                </span>
            </div>
            <div>
                <span>Entry</span>
                <strong>${formatMoney(trade.entryPrice)}</strong>
            </div>
            <div>
                <span>Current</span>
                <strong>${formatMoney(trade.currentPrice)}</strong>
            </div>
            <div>
                <span>PnL</span>
                <strong class="${pnlClass}">${formatSignedPercent(trade.pnlPercent)} (${formatMoney(trade.pnlUsdt)})</strong>
            </div>
        `;
    } else {
        activeTrade.className = "emptyTrade";
        activeTrade.textContent = "No open paper trade.";
    }

    botLogs.innerHTML = state.logs.length
        ? state.logs
              .slice(0, 8)
              .map(
                  (log) =>
                      `<div class="logLine ${log.level}"><span>${new Date(log.time).toLocaleTimeString()}</span>${log.message}</div>`
              )
              .join("")
        : `<div class="logLine"><span>--</span>No bot activity yet.</div>`;
}

async function loadBotState() {
    const response = await fetch("/api/bot/state");
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        renderBotState(null);
        return;
    }

    renderBotState(body);
}

async function postBotAction(path) {
    const response = await fetch(path, { method: "POST" });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        renderBotState(null);
        return;
    }

    renderBotState(body);
}

refreshButton.addEventListener("click", loadSignals);
limitSelect.addEventListener("change", loadSignals);
tableTimeframeSelect.addEventListener("change", loadSignals);
tabButtons.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
});
botStartButton.addEventListener("click", () => postBotAction("/api/bot/start"));
botStopButton.addEventListener("click", () => postBotAction("/api/bot/stop"));
botScanButton.addEventListener("click", () => postBotAction("/api/bot/scan"));
botCloseButton.addEventListener("click", () => postBotAction("/api/bot/close"));

loadSignals();
loadBotState();
setInterval(loadBotState, 10_000);
