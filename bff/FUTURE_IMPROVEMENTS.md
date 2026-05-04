# Future Improvements Roadmap

This file tracks high-impact upgrades for the crypto scanner + paper bot.

## 1) Strategy upgrades (highest priority)

- [ ] Multi-stage take-profit ladder (example: 25% at +1.5%, +3.0%, +4.5%, +6.0%)
- [ ] Peak drawdown ladder exits (sell in steps as dip from peak deepens)
- [ ] Fee-aware minimum net-profit filter before any partial exit
- [ ] Re-entry logic after full exit (reclaim + volume confirmation)
- [ ] Cooldown after stop-loss to avoid immediate whipsaw re-entry

## 2) Risk controls

- [ ] Per-trade max risk guardrail (hard cap enforcement with slippage buffer)
- [ ] Daily max drawdown stop (pause bot after X% day loss)
- [ ] Daily max trades limit
- [ ] Consecutive-loss circuit breaker

## 3) Market data and execution quality

- [ ] **Live Solana:** Jupiter `POST /swap` + wallet sign + RPC send; persist tx sig; devnet toggle + safer defaults
- [ ] Dynamic WebSocket subscriptions for top scanned symbols (subscribe/unsubscribe set)
- [ ] Stream heartbeat + latency monitoring + stale-data fallback behavior
- [ ] Local price cache health metrics (update frequency, gaps, delay)
- [ ] Optional REST fallback for active trade price when stream stale

## 4) Scanner and selection quality

- [ ] Volatility/chop filter to avoid noisy tokens
- [ ] Trend-strength filter (multi-timeframe)
- [ ] Liquidity + spread hard guards by token tier
- [ ] News/event risk flag (optional)

## 5) UI and observability

- [x] **Run Bot config split (UI):** Two accordions — **Bot Settings** (trade params + auto/save/run row) and **Scanner Settings** — inside one form so Save still sends the full config.
- [ ] **In-trade sell steppers:** Allow changing steppers for partial sells (upward / downward TP ladders, etc.) while a trade is in progress — tune exits on the fly without only relying on config saved before entry.
- [ ] Strategy config panel (no-code param tuning from dashboard)
- [ ] Per-trade timeline (entry, partials, exits, reasons)
- [ ] Net PnL chart (gross vs fees)
- [ ] Bot health panel (stream freshness, reconnects, scan state)

## 6) Backtesting and validation

- [ ] Paper-trade replay mode on historical candles
- [ ] Basic backtest runner for parameter sweeps
- [ ] Win-rate / expectancy / max drawdown reporting
- [ ] Compare strategy versions (A/B parameter sets)

## Current baseline (implemented)

- WebSocket-based market stream is active and reconnect-capable.
- Single active trade at a time (paper mode).
- Partial TP + trailing/breakeven + red-dip exits are available.
- Broad scanner calls are skipped while a trade is active.
