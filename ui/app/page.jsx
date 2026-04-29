"use client";

import { useEffect, useState } from "react";
import { Card, CardContent } from "../components/ui/card";
import { Sidebar } from "../components/layout/Sidebar";
import { HistorySection } from "../components/sections/HistorySection";
import { RunBotSection } from "../components/sections/RunBotSection";
import { ScannerSection } from "../components/sections/ScannerSection";
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
  const { botState, previewScanLoading, loadBotState, runBotAction, startPollingBotState, stopPollingBotState } = useBotStore();
  const { logs, tradeHistory, loadHistory, startPollingHistory, stopPollingHistory } = useHistoryStore();
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
  const { saveBotConfig } = useBotStore();

  useEffect(() => {
    void loadSignals();
  }, [limit, timeframe, loadSignals]);

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
          className={`flex-1 space-y-6 p-4 md:p-6 ${
            activeSection === "history" || activeSection === "wallet"
              ? "pt-[24px] md:pt-[24px]"
              : "pt-[50px] md:pt-[50px]"
          }`}
        >
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
            />
          )}

          {activeSection === "runBot" && (
            <RunBotSection
              botState={botState}
              previewScanLoading={previewScanLoading}
              onAction={runBotAction}
              onSaveConfig={saveBotConfig}
            />
          )}

          {activeSection === "history" && (
            <HistorySection logs={logs} tradeHistory={tradeHistory} activeTrade={botState?.activeTrade ?? null} />
          )}

          {activeSection === "wallet" && (
            <Card className="min-h-[200px] border-[var(--border)] bg-[var(--panel)]">
              <CardContent className="pt-6">
                <p className="text-sm text-[var(--text-muted)]">
                  Wallet — this area will be implemented next.
                </p>
              </CardContent>
            </Card>
          )}
        </section>
      </div>
    </main>
  );
}
