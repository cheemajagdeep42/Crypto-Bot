"use client";

import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "../components/ui/card";
import { Sidebar } from "../components/layout/Sidebar";
import { HistorySection } from "../components/sections/HistorySection";
import { WalletSection } from "../components/sections/WalletSection";
import { RunBotSection } from "../components/sections/RunBotSection";
import { ScannerSection } from "../components/sections/ScannerSection";
import { PumpTokensSection } from "../components/sections/PumpTokensSection";
import { useBotStore } from "../stores/useBotStore";
import { useHistoryStore } from "../stores/useHistoryStore";
import { useScannerStore } from "../stores/useScannerStore";
import { useUiStore } from "../stores/useUiStore";

export default function Page() {
  const [theme, setTheme] = useState("light");

  const applyTheme = (nextTheme) => {
    const root = document.documentElement;
    root.setAttribute("data-theme", nextTheme);
    root.classList.toggle("dark", nextTheme === "dark");
    root.style.colorScheme = nextTheme === "dark" ? "dark" : "light";
    window.localStorage.setItem("ui-theme", nextTheme);
  };

  const { activeSection, setActiveSection } = useUiStore();
  const {
    botState,
    botStateError,
    previewScanLoading,
    loadBotState,
    runBotAction,
    startPollingBotState,
    stopPollingBotState,
    saveBotConfig
  } = useBotStore();
  const {
    logs,
    tradeHistory,
    historyLoading,
    loadHistory,
    startPollingHistory,
    stopPollingHistory
  } = useHistoryStore();
  const {
    signals,
    signalsLoading,
    statusText,
    limit,
    timeframe,
    signalFilter,
    page,
    pageSize,
    setLimit,
    setTimeframe,
    setSignalFilter,
    setPage,
    loadSignals
  } = useScannerStore();
  const signalsMarketSource = botState?.config?.marketSource;

  const activeTradesList = useMemo(() => {
    const list = botState?.activeTrades;
    if (Array.isArray(list) && list.length > 0) return list;
    return botState?.activeTrade ? [botState.activeTrade] : [];
  }, [botState?.activeTrades, botState?.activeTrade]);

  useEffect(() => {
    void loadSignals();
  }, [limit, timeframe, signalsMarketSource, loadSignals]);

  useEffect(() => {
    void loadBotState();
    startPollingBotState();
    return stopPollingBotState;
  }, [loadBotState, startPollingBotState, stopPollingBotState]);

  useEffect(() => {
    if (activeSection !== "history") return undefined;
    void loadHistory();
    startPollingHistory();
    return stopPollingHistory;
  }, [activeSection, loadHistory, startPollingHistory, stopPollingHistory]);

  useEffect(() => {
    const savedTheme = window.localStorage.getItem("ui-theme");
    if (savedTheme === "dark" || savedTheme === "light") {
      setTheme(savedTheme);
      applyTheme(savedTheme);
      return;
    }
    applyTheme("light");
  }, []);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  const filteredSignals =
    signalFilter === "all" ? signals : signals.filter((token) => token.signal === signalFilter);
  const showPairAgeColumn =
    signalsMarketSource === "dexscreener" &&
    filteredSignals.some((t) => t.pairListedAtMs != null && Number.isFinite(Number(t.pairListedAtMs)));
  const totalPages = Math.max(1, Math.ceil(filteredSignals.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const paginatedSignals = filteredSignals.slice((safePage - 1) * pageSize, safePage * pageSize);

  useEffect(() => {
    if (safePage !== page) setPage(safePage);
  }, [page, safePage, setPage]);

  return (
    <main className="min-h-screen bg-transparent text-[var(--text)]">
      <div className="flex min-h-screen w-full gap-0">
        <Sidebar
          activeSection={activeSection}
          onSelect={setActiveSection}
          theme={theme}
          onToggleTheme={() => setTheme((prev) => (prev === "dark" ? "light" : "dark"))}
        />

        <section
          className={`min-w-0 flex-1 space-y-6 p-4 md:p-6 ${
            activeSection === "history" || activeSection === "wallet"
              ? "pt-[24px] md:pt-[24px]"
              : "pt-[50px] md:pt-[50px]"
          }`}
        >
          {botStateError ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[11px] leading-snug text-amber-900 dark:text-amber-100">
              {botState ? (
                <>
                  <span className="font-medium text-[var(--text)]">Could not refresh bot state</span> — showing the
                  last loaded snapshot. Check BFF on port 3001.{" "}
                </>
              ) : (
                <>
                  <span className="font-medium text-[var(--text)]">BFF not reachable</span> — live bot state and
                  saved configs will load when the API responds.{" "}
                </>
              )}
              <span className="text-[var(--text-muted)]">{botStateError}</span>
            </p>
          ) : null}
          {activeSection === "scanner" && (
            <ScannerSection
              signals={paginatedSignals}
              statusText={statusText}
              limit={limit}
              timeframe={timeframe}
              signalFilter={signalFilter}
              onSignalFilterChange={setSignalFilter}
              loading={signalsLoading}
              page={safePage}
              totalPages={totalPages}
              onLimitChange={setLimit}
              onTimeframeChange={setTimeframe}
              onPageChange={setPage}
              showPairAgeColumn={showPairAgeColumn}
            />
          )}

          {activeSection === "configs" && (
            <RunBotSection
              view="configs"
              botState={botState}
              previewScanLoading={previewScanLoading}
              onAction={runBotAction}
              onSaveConfig={saveBotConfig}
            />
          )}

          {activeSection === "runBot" && (
            <RunBotSection
              view="run"
              botState={botState}
              previewScanLoading={previewScanLoading}
              onAction={runBotAction}
              onSaveConfig={saveBotConfig}
            />
          )}

          {activeSection === "pumpTokens" && <PumpTokensSection />}

          {activeSection === "history" && (
            <HistorySection
              logs={logs}
              tradeHistory={tradeHistory}
              historyLoading={historyLoading}
              activeTrade={botState?.activeTrade ?? null}
              activeTrades={activeTradesList}
              botState={botState}
            />
          )}

          {activeSection === "wallet" && (
            <WalletSection
              tradeHistory={botState?.tradeHistory ?? []}
              activeTrade={botState?.activeTrade ?? null}
              activeTrades={activeTradesList}
              watchWalletAddressW1={botState?.config?.watchWalletAddress ?? ""}
              watchWalletAddressW2={botState?.config?.watchWalletAddressW2 ?? ""}
            />
          )}
        </section>
      </div>
    </main>
  );
}
