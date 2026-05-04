"use client";

import { useCallback, useEffect, useState } from "react";
import { CircleHelp, Info } from "lucide-react";
import { Card, CardContent } from "../ui/card";
import { Button } from "../ui/button";
import { toast } from "../../lib/toast";
import { ApiRequestError, fetchPumpFeed, startPumpFeedBot, stopPumpFeedBot } from "../../lib/api/dashboardApi";

const MAX_MESSAGES = 20;

const PUMP_BOT_INFO =
  "This bot follows the TG channel SolHouse Signal (configurable via BFF env) and listens for gem alerts containing a fixed trigger phrase. The BFF must have Telegram credentials — see bff/scripts/gen-telegram-session.ts. Messages are not auto-traded yet; they appear below for up to 20 recent alerts.";

function formatReceivedAt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "2-digit",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true
  });
}

export function PumpTokensSection() {
  /** @type {Array<{ id: string; text: string; receivedAt: string }>} */
  const [messages, setMessages] = useState([]);
  const [listenerActive, setListenerActive] = useState(false);
  const [configured, setConfigured] = useState(false);
  const [lastError, setLastError] = useState(null);
  const [channel, setChannel] = useState("");
  const [showAllChannelMessages, setShowAllChannelMessages] = useState(true);
  const [tipOpen, setTipOpen] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const data = await fetchPumpFeed();
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
      setListenerActive(Boolean(data?.listenerActive));
      setConfigured(Boolean(data?.configured));
      setLastError(typeof data?.lastError === "string" ? data.lastError : null);
      setChannel(typeof data?.channel === "string" ? data.channel : "");
      setShowAllChannelMessages(data?.showAllChannelMessages !== false);
    } catch (e) {
      if (e instanceof ApiRequestError) {
        setLastError(e.message);
      }
    }
  }, []);

  useEffect(() => {
    void refresh();
    const t = setInterval(() => void refresh(), 4000);
    return () => clearInterval(t);
  }, [refresh]);

  const togglePumpBot = async () => {
    setActionBusy(true);
    try {
      if (listenerActive) {
        await stopPumpFeedBot();
        toast.info("Pump Telegram listener stopped.");
      } else {
        await startPumpFeedBot();
        toast.success("Pump Telegram listener started.");
      }
      await refresh();
    } catch (e) {
      const msg = e instanceof ApiRequestError ? e.message : e instanceof Error ? e.message : String(e);
      toast.error(msg);
      await refresh();
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card className="border-[var(--border)] bg-[var(--panel)]">
        <CardContent className="space-y-4 p-4 md:p-5">
          {!configured ? (
            <p className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
              Telegram is not configured on the BFF. Add{" "}
              <code className="rounded bg-black/10 px-1 dark:bg-white/10">TELEGRAM_API_ID</code>,{" "}
              <code className="rounded bg-black/10 px-1 dark:bg-white/10">TELEGRAM_API_HASH</code>,{" "}
              <code className="rounded bg-black/10 px-1 dark:bg-white/10">TELEGRAM_STRING_SESSION</code>,{" "}
              <code className="rounded bg-black/10 px-1 dark:bg-white/10">TELEGRAM_PUMP_CHANNEL</code>{" "}
              to <code className="rounded bg-black/10 px-1 dark:bg-white/10">bff/.env</code>, then run{" "}
              <code className="rounded bg-black/10 px-1 dark:bg-white/10">
                npx ts-node scripts/gen-telegram-session.ts
              </code>{" "}
              once to create the session string.
            </p>
          ) : null}

          {configured && showAllChannelMessages ? (
            <p className="rounded-md border border-[var(--border)] bg-[var(--panel-muted)]/80 px-3 py-2 text-[11px] text-[var(--text-muted)]">
              <span className="font-medium text-[var(--text)]">Testing mode:</span> showing{" "}
              <strong>all</strong> posts from this channel (up to {MAX_MESSAGES}). Set{" "}
              <code className="rounded bg-black/10 px-1 dark:bg-white/10">TELEGRAM_PUMP_SHOW_ALL=false</code> in{" "}
              <code className="rounded bg-black/10 px-1 dark:bg-white/10">bff/.env</code> for gem-alert-only.
            </p>
          ) : null}

          {lastError && configured ? (
            <p className="rounded-md border border-[#e50914]/40 bg-[#e50914]/10 px-3 py-2 text-xs text-[#e50914]">
              {lastError}
            </p>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              size="sm"
              className="h-9 rounded-md px-4 text-xs font-medium"
              disabled={actionBusy || !configured}
              title={!configured ? "Configure Telegram env on the BFF first" : undefined}
              onClick={() => void togglePumpBot()}
            >
              {actionBusy ? "…" : listenerActive ? "Stop bot" : "Run Bot"}
            </Button>
            <div className="relative inline-flex items-center gap-1.5 text-[var(--text-muted)]">
              <span className="text-xs font-medium text-[var(--text)]">
                SolHouse Signal{channel ? ` (@${channel})` : ""}
              </span>
              <button
                type="button"
                className="inline-flex rounded p-0.5 text-[var(--text-muted)] hover:text-[var(--text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--panel)]"
                aria-expanded={tipOpen}
                aria-label="Pump bot info"
                onClick={(e) => {
                  e.preventDefault();
                  setTipOpen((v) => !v);
                }}
              >
                <CircleHelp className="h-4 w-4 shrink-0" aria-hidden />
              </button>
              {tipOpen ? (
                <div
                  className="absolute left-0 top-full z-20 mt-2 max-w-[min(24rem,calc(100vw-2rem))] rounded-md border border-[var(--border)] bg-[var(--panel)] p-3 text-xs leading-relaxed text-[var(--text)] shadow-lg"
                  role="tooltip"
                >
                  <p className="flex gap-2">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-[var(--brand)]" aria-hidden />
                    <span>{PUMP_BOT_INFO}</span>
                  </p>
                </div>
              ) : null}
            </div>
            {listenerActive ? (
              <span className="text-[11px] text-emerald-600 dark:text-emerald-400">Listening…</span>
            ) : (
              <span className="text-[11px] text-[var(--text-muted)]">Idle</span>
            )}
          </div>

          <div className="rounded-lg border border-[var(--border)]/80 bg-[var(--panel-muted)]/40">
            <div className="border-b border-[var(--border)]/60 px-3 py-2">
              <p className="text-xs font-medium text-[var(--text)]">Recent alerts</p>
              <p className="text-[11px] text-[var(--text-muted)]">Up to {MAX_MESSAGES} messages (newest first)</p>
            </div>
            <ul className="max-h-[min(28rem,60vh)] divide-y divide-[var(--border)]/50 overflow-y-auto">
              {messages.length === 0 ? (
                <li className="px-3 py-8 text-center text-xs text-[var(--text-muted)]">
                  {configured && listenerActive
                    ? showAllChannelMessages
                      ? "No messages yet from this channel. Wait for the next post or check TELEGRAM_PUMP_CHANNEL matches the channel username."
                      : "No matching gem alerts yet. Posts must include the trigger phrase (see TELEGRAM_PUMP_TRIGGER_SUBSTRING on the BFF), or set TELEGRAM_PUMP_SHOW_ALL=true."
                    : "Start the bot (and ensure your Telegram user is joined to the channel) to see alerts here."}
                </li>
              ) : (
                messages.slice(0, MAX_MESSAGES).map((m) => (
                  <li key={m.id} className="px-3 py-2.5 text-left">
                    <p className="text-[10px] text-[var(--text-muted)]">{formatReceivedAt(m.receivedAt)}</p>
                    <p className="mt-1 whitespace-pre-wrap text-xs text-[var(--text)]">{m.text}</p>
                  </li>
                ))
              )}
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
