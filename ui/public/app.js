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
const summaryCards = document.querySelectorAll(".summary article");
const tabButtons = document.querySelectorAll(".tabButton");
const tabPanels = document.querySelectorAll(".tabPanel");
const infoButton = document.querySelector("#infoButton");
const infoModal = document.querySelector("#infoModal");
const infoCloseButton = document.querySelector("#infoCloseButton");
const botStartButton = document.querySelector("#botStartButton");
const botStopButton = document.querySelector("#botStopButton");
const botScanButton = document.querySelector("#botScanButton");
const botAutoModeButton = document.querySelector("#botAutoModeButton");
const botCloseButton = document.querySelector("#botCloseButton");
const botConfigForm = document.querySelector("#botConfigForm");
const cfgPositionSize = document.querySelector("#cfgPositionSize");
const cfgScanInterval = document.querySelector("#cfgScanInterval");
const cfgScanLimit = document.querySelector("#cfgScanLimit");
const cfgTimeframe = document.querySelector("#cfgTimeframe");
const cfgTpSteps = document.querySelector("#cfgTpSteps");
const cfgTpFraction = document.querySelector("#cfgTpFraction");
const cfgDipSteps = document.querySelector("#cfgDipSteps");
const cfgDipFractions = document.querySelector("#cfgDipFractions");
const cfgStopLoss = document.querySelector("#cfgStopLoss");
const cfgMaxHold = document.querySelector("#cfgMaxHold");
const botStatus = document.querySelector("#botStatus");
const botPositionSize = document.querySelector("#botPositionSize");
const botExitRules = document.querySelector("#botExitRules");
const marketStreamStatus = document.querySelector("#marketStreamStatus");
const activeTrade = document.querySelector("#activeTrade");
const botLogTitle = document.querySelector("#botLogTitle");
const botLogTokenSelect = document.querySelector("#botLogTokenSelect");
const botLogTimeSelect = document.querySelector("#botLogTimeSelect");
const botLogs = document.querySelector("#botLogs");
const toolbarActions = document.querySelector(".actions");
const appRoot = document.querySelector(".app");
const botViewButtons = document.querySelectorAll(".botViewButton");
const botViewPanels = document.querySelectorAll(".botViewPanel");

const signalText = {
    good_buy: "Good buy",
    watch: "Watch",
    bad_buy: "Bad buy",
};

const spotFeeRate = 0.001;

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

const signalFilterMap = {
    goodCount: "good_buy",
    watchCount: "watch",
    badCount: "bad_buy",
};

const BOT_LOG_DEFAULT_ROWS = 10;
let activeSignalFilter = null;
let latestBotState = null;

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

function formatSignedMoney(value) {
    const sign = value > 0 ? "+" : "";
    return `${sign}${formatMoney(value)}`;
}

function safeNumberArray(value, fallback) {
    if (!Array.isArray(value)) return fallback;
    const numbers = value
        .map((item) => Number(item))
        .filter((item) => Number.isFinite(item));
    return numbers.length ? numbers : fallback;
}

function parseNumberList(value) {
    return String(value ?? "")
        .split(",")
        .map((item) => Number(item.trim()))
        .filter((item) => Number.isFinite(item));
}

function tradeFeeSummary(trade) {
    const buyFee = trade.positionSizeUsdt * spotFeeRate;
    const sellNotional = trade.positionSizeUsdt + trade.pnlUsdt;
    const sellFee = Math.max(0, sellNotional) * spotFeeRate;
    const totalFees = buyFee + sellFee;
    const netProfit = trade.pnlUsdt - totalFees;

    return { buyFee, sellFee, totalFees, netProfit };
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

function formatLocalDateTimeParts(isoTime) {
    const parsedDate = new Date(isoTime);
    return {
        dateText: parsedDate.toLocaleDateString(),
        timeText: parsedDate.toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
            second: "2-digit",
            hour12: true,
        }),
    };
}

function formatDuration(startIso, endIso) {
    if (!startIso || !endIso) return "--";
    const ms = Math.max(0, new Date(endIso).getTime() - new Date(startIso).getTime());
    const totalSeconds = Math.floor(ms / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

function formatMinutesSeconds(ms) {
    const totalSeconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
}

function parseBotLog(log, activeSymbol, tradeHistory) {
    const message = log.message;
    const buyMatch = message.match(/Paper BUY ([A-Z0-9]+) at ([0-9.]+)/);
    const partialSellMatch = message.match(/Paper PARTIAL SELL ([A-Z0-9]+) at ([0-9.]+)/);
    const sellMatch = message.match(/Paper SELL ([A-Z0-9]+) at ([0-9.]+)\. Reason=([a-z_]+), PnL=([-0-9.]+)%/);
    const holdMatch = message.match(/([A-Z0-9]+) not found in scan window/);
    const { dateText, timeText } = formatLocalDateTimeParts(log.time);

    if (sellMatch) {
        const pnlValue = Number(sellMatch[4]);
        const matchedTrade = tradeHistory.find((trade) => {
            if (trade.symbol !== sellMatch[1] || !trade.closedAt) return false;
            const delta = Math.abs(new Date(trade.closedAt).getTime() - new Date(log.time).getTime());
            return delta <= 10_000;
        });
        const reasonText = sellMatch[3]
            .replace(/_/g, " ")
            .replace(/\b\w/g, (letter) => letter.toUpperCase());
        return {
            rawTime: log.time,
            date: dateText,
            time: timeText,
            token: sellMatch[1],
            tradeType: "Sell",
            price: formatMoney(Number(sellMatch[2])),
            pnl: `${sellMatch[4]}%`,
            pnlUsd: matchedTrade ? formatSignedMoney(matchedTrade.pnlUsdt) : "--",
            timeSpent: matchedTrade?.openedAt ? formatDuration(matchedTrade.openedAt, matchedTrade.closedAt) : "--",
            pnlClass: pnlValue >= 0 ? "positivePnl" : "negativePnl",
            reason: reasonText,
            description: `Selling at ${sellMatch[2]} because ${reasonText.toLowerCase()} condition was met.`,
            level: log.level,
        };
    }

    if (buyMatch) {
        const moveMatch = message.match(/5m move:\s*([0-9.]+)\s*->\s*([0-9.]+)\s*\(([-+0-9.]+)%\)/);
        const direction = moveMatch
            ? Number(moveMatch[3]) >= 0
                ? "up"
                : "down"
            : null;
        const moveDescription = moveMatch
            ? `Price moved ${moveMatch[3]}% ${direction} in the last 5 minutes (${moveMatch[1]} -> ${moveMatch[2]}), so entry conditions were met.`
            : message.replace(`Paper BUY ${buyMatch[1]} at ${buyMatch[2]} using $100. `, "");
        return {
            rawTime: log.time,
            date: dateText,
            time: timeText,
            token: buyMatch[1],
            tradeType: "Buy",
            price: formatMoney(Number(buyMatch[2])),
            pnl: "--",
            pnlUsd: "--",
            timeSpent: "--",
            pnlClass: "",
            reason: "Entry",
            description: `Buying at ${buyMatch[2]}. ${moveDescription}`,
            level: log.level,
        };
    }

    if (partialSellMatch) {
        return {
            rawTime: log.time,
            date: dateText,
            time: timeText,
            token: partialSellMatch[1],
            tradeType: "Partial Sell",
            price: formatMoney(Number(partialSellMatch[2])),
            pnl: "--",
            pnlUsd: "--",
            timeSpent: "--",
            pnlClass: "",
            reason: "Partial Take Profit",
            description: `Selling part of position at ${partialSellMatch[2]}. ${message.replace(
                `Paper PARTIAL SELL ${partialSellMatch[1]} at ${partialSellMatch[2]}. `,
                ""
            )}`,
            level: log.level,
        };
    }

    if (holdMatch) {
        return {
            rawTime: log.time,
            date: dateText,
            time: timeText,
            token: holdMatch[1],
            tradeType: "Hold",
            price: "--",
            pnl: "--",
            pnlUsd: "--",
            timeSpent: "--",
            pnlClass: "",
            reason: "Holding",
            description: "Token is outside the current scan window. Continue monitoring exit rules.",
            level: log.level,
        };
    }

    const levelReason = log.level.charAt(0).toUpperCase() + log.level.slice(1);
    return {
        rawTime: log.time,
        date: dateText,
        time: timeText,
        token: activeSymbol ?? "System",
        tradeType: "System",
        price: "--",
        pnl: "--",
        pnlUsd: "--",
        timeSpent: "--",
        pnlClass: "",
        reason: levelReason,
        description: message,
        level: log.level,
    };
}

function logTokenFromMessage(message) {
    const match =
        message.match(/Paper (?:BUY|SELL|PARTIAL SELL) ([A-Z0-9]+)/) ??
        message.match(/([A-Z0-9]+) not found in scan window/);

    return match?.[1] ?? null;
}

function syncLogTokenOptions(state) {
    const previousValue = botLogTokenSelect.value;
    const activeSymbol = state.activeTrade?.symbol;
    const tokens = new Set();

    if (activeSymbol) tokens.add(activeSymbol);
    state.tradeHistory.forEach((trade) => tokens.add(trade.symbol));
    state.logs.forEach((log) => {
        const token = logTokenFromMessage(log.message);
        if (token) tokens.add(token);
    });

    const options = [
        `<option value="all">All tokens</option>`,
        ...Array.from(tokens).map((token) => `<option value="${token}">${token}</option>`),
    ];

    botLogTokenSelect.innerHTML = options.join("");
    botLogTokenSelect.value =
        previousValue && Array.from(botLogTokenSelect.options).some((option) => option.value === previousValue)
            ? previousValue
            : "all";
}

function selectedLogToken(activeSymbol) {
    if (botLogTokenSelect.value === "all") return null;
    return botLogTokenSelect.value;
}

function renderBotLogs(logs, activeSymbol, tradeHistory) {
    const selectedToken = selectedLogToken(activeSymbol);
    const selectedHours = Number(botLogTimeSelect?.value ?? 24);
    const fromTimeMs = Date.now() - selectedHours * 60 * 60 * 1000;
    const relevantLogs = selectedToken
        ? logs.filter((log) => log.message.includes(selectedToken))
        : logs;
    const rows = relevantLogs
        .map((log) => parseBotLog(log, activeSymbol, tradeHistory))
        .filter((row) => new Date(row.rawTime).getTime() >= fromTimeMs)
        .slice(0, BOT_LOG_DEFAULT_ROWS)
        .map((row) => {
            if (
                latestBotState?.activeTrade &&
                row.tradeType === "Buy" &&
                row.token === latestBotState.activeTrade.symbol
            ) {
                return {
                    ...row,
                    pnl: formatSignedPercent(latestBotState.activeTrade.pnlPercent),
                    pnlUsd: formatSignedMoney(latestBotState.activeTrade.pnlUsdt),
                    pnlClass: latestBotState.activeTrade.pnlPercent >= 0 ? "positivePnl" : "negativePnl",
                    timeSpent: formatDuration(
                        latestBotState.activeTrade.openedAt,
                        new Date().toISOString()
                    ),
                };
            }
            return row;
        });

    botLogTitle.textContent = selectedToken
        ? `Trade Activity - ${selectedToken}`
        : "Trade Activity - All Tokens";

    if (rows.length === 0) {
        botLogs.innerHTML = `<div class="emptyTrade">No activity for selected filters.</div>`;
        return;
    }

    botLogs.innerHTML = `
        <div class="logTable" role="table">
            <div class="logTableHeader" role="row">
                <span>Date</span>
                <span>Time</span>
                <span>Token</span>
                <span>Type</span>
                <span>Price</span>
                <span>PnL</span>
                <span>PnL $</span>
                <span>Time Spent</span>
                <span>Reason</span>
                <span>Description</span>
                <span>Charts</span>
            </div>
            ${[
                ...rows,
                ...Array.from(
                    { length: Math.max(0, BOT_LOG_DEFAULT_ROWS - rows.length) },
                    () => ({
                        date: "--",
                        time: "--",
                        token: "--",
                        tradeType: "--",
                        price: "--",
                        pnl: "--",
                        pnlUsd: "--",
                        timeSpent: "--",
                        reason: "--",
                        description: "No activity for this slot.",
                        pnlClass: "",
                        level: "info",
                    })
                ),
            ]
                .map(
                    (row) => `
                        <div class="logTableRow ${row.level}" role="row">
                            <span>${row.date}</span>
                            <span>${row.time}</span>
                            <span>${row.token}</span>
                            <span>${row.tradeType}</span>
                            <span>${row.price}</span>
                            <span class="${row.pnlClass}">${row.pnl}</span>
                            <span class="${row.pnlClass}">${row.pnlUsd}</span>
                            <span>${row.timeSpent}</span>
                            <span>${row.reason}</span>
                            <span>${row.description}</span>
                            <span>${row.token && row.token !== "System" ? `<a href="https://www.binance.com/en/trade/${row.token.replace("USDT", "")}_USDT?type=spot" target="_blank" rel="noopener noreferrer">Binance</a>` : "--"}</span>
                        </div>
                    `
                )
                .join("")}
        </div>
    `;
}


function renderSummary(tokens) {
    goodCount.textContent = tokens.filter((token) => token.signal === "good_buy").length;
    watchCount.textContent = tokens.filter((token) => token.signal === "watch").length;
    badCount.textContent = tokens.filter((token) => token.signal === "bad_buy").length;

    const spread =
        tokens.reduce((total, token) => total + token.spreadPercent, 0) / Math.max(tokens.length, 1);
    avgSpread.textContent = `${spread.toFixed(3)}%`;
}

function updateSummaryFilterUi() {
    summaryCards.forEach((card) => {
        const valueEl = card.querySelector("strong");
        const filterSignal = valueEl ? signalFilterMap[valueEl.id] : null;
        card.classList.toggle("filterActive", filterSignal === activeSignalFilter);
        card.classList.toggle("filterEnabled", Boolean(filterSignal));
        card.title = filterSignal
            ? filterSignal === activeSignalFilter
                ? "Click to clear filter"
                : "Click to filter table"
            : "";
    });
}

function activateBotView(viewId) {
    botViewButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.botView === viewId);
    });
    botViewPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.id === viewId);
    });
}

function activateTab(tabId) {
    tabButtons.forEach((button) => {
        button.classList.toggle("active", button.dataset.tab === tabId);
    });
    tabPanels.forEach((panel) => {
        panel.classList.toggle("active", panel.id === tabId);
    });
    if (toolbarActions) {
        toolbarActions.classList.toggle("hiddenActions", tabId !== "scannerTab");
    }
    if (appRoot) {
        appRoot.classList.toggle("botsActive", tabId === "botsTab");
    }
}

function openInfoModal() {
    infoModal.classList.add("active");
    infoModal.setAttribute("aria-hidden", "false");
}

function closeInfoModal() {
    infoModal.classList.remove("active");
    infoModal.setAttribute("aria-hidden", "true");
}

function renderRows(tokens) {
    const filteredTokens = activeSignalFilter
        ? tokens.filter((token) => token.signal === activeSignalFilter)
        : tokens;
    rows.innerHTML = "";

    filteredTokens.forEach((token, index) => {
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

    if (filteredTokens.length === 0) {
        const tr = document.createElement("tr");
        tr.innerHTML = `<td colspan="10" class="subtle">No tokens match the active summary filter.</td>`;
        rows.appendChild(tr);
    }
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
        updateSummaryFilterUi();
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
        botLogs.innerHTML = `<div class="emptyTrade">Bot API is not available on this running server.</div>`;
        botStartButton.disabled = true;
        botStopButton.disabled = true;
        botScanButton.disabled = true;
        botAutoModeButton.disabled = true;
        botCloseButton.disabled = true;
        return;
    }

    botStatus.textContent = state.status === "running" ? "Running" : "Stopped";
    botStatus.className = state.status === "running" ? "runningText" : "";
    botPositionSize.textContent = formatMoney(state.config.positionSizeUsdt);
    const tpStepsValues = safeNumberArray(state.config.takeProfitStepsPercent, [1.5, 3, 4.5, 6]);
    const dipStepsValues = safeNumberArray(state.config.dipStepsPercent, [10, 20, 30]);
    const dipFractionsValues = safeNumberArray(state.config.dipStepSellFractions, [0.25, 0.5, 1]);
    const tpFractionValue = Number.isFinite(Number(state.config.takeProfitStepSellFraction))
        ? Number(state.config.takeProfitStepSellFraction)
        : 0.25;
    const tpSteps = tpStepsValues.map((step) => `+${step}%`).join(", ");
    const dipSteps = dipStepsValues.map((step) => `${step}%`).join(", ");
    botExitRules.innerHTML =
        `Sell 25% at ${tpSteps}.<br>` +
        `Protect profit if price falls ${dipSteps} from peak.<br>` +
        `Max loss: -${state.config.stopLossPercent}%.`;
    botStartButton.disabled = state.status === "running";
    botStopButton.disabled = state.status !== "running";
    botCloseButton.disabled = !state.activeTrade;
    botAutoModeButton.disabled = false;
    botAutoModeButton.textContent = `Auto: ${state.config.autoMode ? "On" : "Off"}`;
    botAutoModeButton.classList.toggle("secondaryButton", !state.config.autoMode);
    botAutoModeButton.classList.toggle("runningButton", state.config.autoMode);
    syncLogTokenOptions(state);
    latestBotState = state;
    cfgPositionSize.value = state.config.positionSizeUsdt;
    cfgScanInterval.value = state.config.scanIntervalSeconds;
    cfgScanLimit.value = state.config.scanLimit;
    cfgTimeframe.value = state.config.timeframe;
    cfgTpSteps.value = tpStepsValues.join(", ");
    cfgTpFraction.value = tpFractionValue;
    cfgDipSteps.value = dipStepsValues.join(", ");
    cfgDipFractions.value = dipFractionsValues.join(", ");
    cfgStopLoss.value = state.config.stopLossPercent;
    cfgMaxHold.value = state.config.maxHoldMinutes;

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
                <span>Bet / Size</span>
                <strong>${formatMoney(trade.positionSizeUsdt)}</strong>
            </div>
            <div>
                <span>Current</span>
                <strong>${formatMoney(trade.currentPrice)}</strong>
            </div>
            <div>
                <span>PnL</span>
                <strong class="${pnlClass}">${formatSignedPercent(trade.pnlPercent)} (${formatMoney(trade.pnlUsdt)})</strong>
            </div>
            <div>
                <span>Time Spent</span>
                <strong id="activeTradeTimeSpent">${formatDuration(
                    trade.openedAt,
                    new Date().toISOString()
                )}</strong>
            </div>
        `;
    } else {
        activeTrade.className = "emptyTrade";
        activeTrade.textContent = "No open paper trade.";
    }

    renderBotLogs(state.logs, state.activeTrade?.symbol, state.tradeHistory);
}

async function loadBotState() {
    const [botResponse, streamResponse] = await Promise.all([
        fetch("/api/bot/state"),
        fetch("/api/market-stream/state"),
    ]);
    const body = await botResponse.json().catch(() => ({}));
    const streamBody = await streamResponse.json().catch(() => null);

    if (!botResponse.ok) {
        renderBotState(null);
        return;
    }

    renderBotState(body);
    renderMarketStreamState(streamResponse.ok ? streamBody : null);
}

async function postBotAction(path, payload) {
    const response = await fetch(path, {
        method: "POST",
        headers: payload ? { "Content-Type": "application/json" } : undefined,
        body: payload ? JSON.stringify(payload) : undefined,
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        renderBotState(null);
        return;
    }

    renderBotState(body);
}

function renderMarketStreamState(state) {
    if (!state) {
        marketStreamStatus.textContent = "Unavailable";
        marketStreamStatus.title = "Live Binance price stream is unavailable.";
        marketStreamStatus.className = "negativePnl";
        return;
    }

    const freshness = state.isFresh ? "Live" : "Stale";
    marketStreamStatus.textContent = `${freshness} | ${state.trackedSymbols} symbols tracked`;
    marketStreamStatus.title =
        `Connection: ${state.status}. ` +
        `${state.trackedSymbols} means how many symbols currently receive live updates.`;
    marketStreamStatus.className = state.status === "connected" && state.isFresh ? "runningText" : "negativePnl";
}

refreshButton.addEventListener("click", loadSignals);
limitSelect.addEventListener("change", loadSignals);
tableTimeframeSelect.addEventListener("change", loadSignals);
botLogTokenSelect.addEventListener("change", loadBotState);
botLogTimeSelect.addEventListener("change", loadBotState);
tabButtons.forEach((button) => {
    button.addEventListener("click", () => activateTab(button.dataset.tab));
});
summaryCards.forEach((card) => {
    const valueEl = card.querySelector("strong");
    const filterSignal = valueEl ? signalFilterMap[valueEl.id] : null;
    if (!filterSignal) return;

    card.addEventListener("click", () => {
        activeSignalFilter = activeSignalFilter === filterSignal ? null : filterSignal;
        loadSignals();
    });
});
botViewButtons.forEach((button) => {
    button.addEventListener("click", () => {
        activateBotView(button.dataset.botView);
    });
});
infoButton.addEventListener("click", openInfoModal);
infoCloseButton.addEventListener("click", closeInfoModal);
infoModal.addEventListener("click", (event) => {
    if (event.target === infoModal) closeInfoModal();
});
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeInfoModal();
});
botStartButton.addEventListener("click", () => postBotAction("/api/bot/start"));
botStopButton.addEventListener("click", () => postBotAction("/api/bot/stop"));
botScanButton.addEventListener("click", () => postBotAction("/api/bot/scan"));
botAutoModeButton.addEventListener("click", async () => {
    const botResponse = await fetch("/api/bot/state");
    const state = await botResponse.json().catch(() => null);
    const enabled = !(state?.config?.autoMode ?? true);
    await postBotAction("/api/bot/auto-mode", { enabled });
});
botCloseButton.addEventListener("click", () => postBotAction("/api/bot/close"));
botConfigForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    await postBotAction("/api/bot/config", {
        positionSizeUsdt: Number(cfgPositionSize.value),
        scanIntervalSeconds: Number(cfgScanInterval.value),
        scanLimit: Number(cfgScanLimit.value),
        timeframe: cfgTimeframe.value,
        takeProfitStepsPercent: parseNumberList(cfgTpSteps.value),
        takeProfitStepSellFraction: Number(cfgTpFraction.value),
        dipStepsPercent: parseNumberList(cfgDipSteps.value),
        dipStepSellFractions: parseNumberList(cfgDipFractions.value),
        stopLossPercent: Number(cfgStopLoss.value),
        maxHoldMinutes: Number(cfgMaxHold.value),
    });
});

loadSignals();
const initialActiveTab =
    document.querySelector(".tabButton.active")?.dataset.tab ?? "scannerTab";
activateTab(initialActiveTab);
activateBotView("overviewView");
loadBotState();
setInterval(loadBotState, 10_000);
setInterval(() => {
    if (!latestBotState?.activeTrade) return;
    const el = document.querySelector("#activeTradeTimeSpent");
    if (!el) return;
    el.textContent = formatMinutesSeconds(
        Date.now() - new Date(latestBotState.activeTrade.openedAt).getTime()
    );
}, 1000);

if (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1") {
    const devReload = new EventSource("/__dev_reload");
    devReload.onmessage = (event) => {
        // Ignore initial connect handshake to avoid reload loops.
        if (event.data === "connected") return;
        window.location.reload();
    };
    devReload.onerror = () => {
        devReload.close();
    };
}
