# Parked ideas

## Future: multi-scale-in / runner strategy (low MC token)

**Status:** parked — not implemented.

**Intent (high level):**

- Multiple adds on the same token after early (low MC) entry.
- Remove initial risk (e.g. take cost basis out around ~2×), keep a **runner** if price continues up.
- Hold unless initial is lost or a **time stop** hits.
- **Micro trend / “red” exits:** use short horizon (e.g. 1m) structure — compare recent low/high vs current (e.g. local low 0.3, now 0.4 → treat as upward context; breakdown vs last reference → trim or exit). Re-entry only when rules say uptrend again.
- **Fee-aware:** many on-chain swaps → network + swap costs; need minimum move / churn limits so edge isn’t eaten.

**Build notes (when picked up):**

- Formalize states (flat / scaled-in / core-out / runner / cooldown) and exact definitions of “red”, “dip”, “upward trend” (OHLC source, venue).
- Model round-trip cost (bps) vs target move; consider hysteresis and higher-TF filter to reduce whipsaw.

**Reference:** discussed in chat (strategy + fee tradeoffs only; no spec in code yet).

## Future: follow / mirror this wallet (Solscan)

**Status:** parked — not implemented.

- Track or take signals from on-chain activity for wallet: [4KvoCfgSLPUNKV8WSToWKfWwR76uPxQvaLKaWs6FgYDH on Solscan](https://solscan.io/account/4KvoCfgSLPUNKV8WSToWKfWwR76uPxQvaLKaWs6FgYDH).
- Define scope: read-only alerts vs automated copy-trading; latency, slippage, and fee implications.

## Telegram broadcast signals (template + CA only)

**Status:** **ingest + UI list** in BFF/UI (`pumpTelegramFeed.ts`, Pump Tokens tab). Auto-buy / CA parse not done yet.

**BFF env:** `TELEGRAM_API_ID`, `TELEGRAM_API_HASH` (log in at [my.telegram.org](https://my.telegram.org), then open **[my.telegram.org/apps](https://my.telegram.org/apps)** — *API development tools*, not BotFather; see [core.telegram.org/api/obtaining_api_id](https://core.telegram.org/api/obtaining_api_id)), `TELEGRAM_STRING_SESSION` (run `npx ts-node scripts/gen-telegram-session.ts` in `bff/`), `TELEGRAM_PUMP_CHANNEL` (username without `@`). Optional: `TELEGRAM_PUMP_TRIGGER_SUBSTRING` (default: gem alert line below). `TELEGRAM_PUMP_SHOW_ALL=false` = only messages containing that trigger; **if unset, defaults to showing all channel posts** (testing). The Telegram **user** must be able to read the channel.

**Channel type:** read-only broadcast (no replies) — uses **GramJS** user session; not a Bot API channel admin bot.

**Filter (strict):** only act on messages that contain the exact trigger line, e.g.:

`💎 Exclusive Solana Gem Alert! 💎`

(Keep in sync with the channel if they change wording; prefer a small allowlist of exact strings.)

**Parse:** extract **Solana contract address** from the message body (e.g. line labeled CA / base58 mint). Reject if missing or invalid; optional dex/liquidity pre-check before swap.

**Execution (ties to runner strategy above):** e.g. buy on match → take **initials out ~2×** → let remainder run toward **3–5×** with timeouts / risk floors; fee and slippage guards.

**Caveats:** latency vs other subscribers, edited/deleted posts, rare format drift, and trust/signal quality.

