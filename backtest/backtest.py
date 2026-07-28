#!/usr/bin/env python3
"""
WayneTrade backtester (Phase 2 item from the build guide).

Replays historical OHLC candles (CSV) through a strategy and the SAME risk
rules the live risk engine enforces (src/services/riskEngine.js):
  - fixed position sizing (lots)
  - hard stop-loss on every trade — a trade without a stop is not taken
  - optional take-profit

Deliberately dependency-free (Python stdlib only) so it runs on any team
machine without pip installs. The guide suggests vectorbt/backtrader — this
is the "validate before going live" step in its simplest honest form; swap
in vectorbt later if you need vectorized parameter sweeps.

Included strategy: SMA crossover (fast crosses above slow = long, below =
short). Replace `generate_signals` with your own logic, or export your
TradingView strategy's entries and adapt.

CSV format (header required):  time,open,high,low,close
`time` can be anything sortable (ISO date, unix ts) — it's carried through.

Usage:
  python backtest.py data.csv                       # defaults: 10/30 SMA
  python backtest.py data.csv --fast 20 --slow 50 --lots 0.10 \
      --stop-pct 0.5 --tp-pct 1.0 --contract-size 100000

P&L is reported in account currency assuming a linear contract:
  pnl = (exit - entry) * lots * contract_size  (sign-flipped for shorts)
That's right for forex majors quoted in the account currency and for most
CFDs; check your instrument's contract spec before trusting absolute numbers.
"""

import argparse
import csv
import sys
from dataclasses import dataclass


@dataclass
class Candle:
    time: str
    open: float
    high: float
    low: float
    close: float


@dataclass
class Trade:
    side: str  # "long" | "short"
    entry_time: str
    entry: float
    stop: float
    take_profit: float | None
    exit_time: str = ""
    exit: float = 0.0
    exit_reason: str = ""
    pnl: float = 0.0


def load_candles(path):
    candles = []
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        required = {"time", "open", "high", "low", "close"}
        if reader.fieldnames is None or not required.issubset({c.strip().lower() for c in reader.fieldnames}):
            sys.exit(f"CSV must have header columns: {', '.join(sorted(required))}")
        for row in reader:
            row = {k.strip().lower(): v for k, v in row.items()}
            try:
                candles.append(
                    Candle(
                        time=row["time"],
                        open=float(row["open"]),
                        high=float(row["high"]),
                        low=float(row["low"]),
                        close=float(row["close"]),
                    )
                )
            except (ValueError, KeyError):
                continue  # skip malformed rows rather than dying mid-file
    if len(candles) < 2:
        sys.exit("Not enough valid candles in the CSV.")
    return candles


def sma(values, period, i):
    """SMA of values[i-period+1 .. i], or None until enough history."""
    if i + 1 < period:
        return None
    return sum(values[i - period + 1 : i + 1]) / period


def generate_signals(candles, fast, slow):
    """
    Yields (index, "buy"|"sell") on SMA crossovers, evaluated on closes.
    The signal fires on the close of candle i; entry is simulated at the
    OPEN of candle i+1 — no lookahead.
    """
    closes = [c.close for c in candles]
    prev_diff = None
    for i in range(len(candles)):
        f, s = sma(closes, fast, i), sma(closes, slow, i)
        if f is None or s is None:
            continue
        diff = f - s
        if prev_diff is not None:
            if prev_diff <= 0 < diff:
                yield i, "buy"
            elif prev_diff >= 0 > diff:
                yield i, "sell"
        prev_diff = diff


def run_backtest(candles, signals, lots, stop_pct, tp_pct, contract_size):
    """
    One position at a time. A new opposite signal closes the current
    position at the next open and flips. Stops/TPs are checked intrabar
    against high/low; if both could have hit in one candle, the stop is
    assumed to hit first (pessimistic, the honest choice).
    """
    signal_at = dict(signals)
    trades = []
    position = None

    def close(pos, time, price, reason):
        pos.exit_time, pos.exit, pos.exit_reason = time, price, reason
        direction = 1 if pos.side == "long" else -1
        pos.pnl = (price - pos.entry) * direction * lots * contract_size
        trades.append(pos)

    for i in range(1, len(candles)):
        c = candles[i]

        # 1. Manage the open position: stop first (pessimistic), then TP.
        if position:
            if position.side == "long":
                if c.low <= position.stop:
                    close(position, c.time, position.stop, "stop-loss")
                    position = None
                elif position.take_profit and c.high >= position.take_profit:
                    close(position, c.time, position.take_profit, "take-profit")
                    position = None
            else:
                if c.high >= position.stop:
                    close(position, c.time, position.stop, "stop-loss")
                    position = None
                elif position.take_profit and c.low <= position.take_profit:
                    close(position, c.time, position.take_profit, "take-profit")
                    position = None

        # 2. Act on a signal that fired on the previous close → enter at this open.
        side = signal_at.get(i - 1)
        if side:
            if position:
                close(position, c.time, c.open, "flip")
                position = None
            entry = c.open
            # Hard stop-loss rule mirrored from the live risk engine: the
            # stop always exists, derived from --stop-pct. No stop, no trade.
            if side == "buy":
                position = Trade(
                    side="long",
                    entry_time=c.time,
                    entry=entry,
                    stop=entry * (1 - stop_pct / 100),
                    take_profit=entry * (1 + tp_pct / 100) if tp_pct else None,
                )
            else:
                position = Trade(
                    side="short",
                    entry_time=c.time,
                    entry=entry,
                    stop=entry * (1 + stop_pct / 100),
                    take_profit=entry * (1 - tp_pct / 100) if tp_pct else None,
                )

    if position:
        close(position, candles[-1].time, candles[-1].close, "end-of-data")

    return trades


def report(trades, lots, stop_pct, tp_pct):
    if not trades:
        print("No trades were generated — not enough data or no crossovers.")
        return

    wins = [t for t in trades if t.pnl > 0]
    losses = [t for t in trades if t.pnl <= 0]
    total = sum(t.pnl for t in trades)
    gross_win = sum(t.pnl for t in wins)
    gross_loss = -sum(t.pnl for t in losses)

    equity, peak, max_dd = 0.0, 0.0, 0.0
    for t in trades:
        equity += t.pnl
        peak = max(peak, equity)
        max_dd = max(max_dd, peak - equity)

    print(f"Trades: {len(trades)}  (lots={lots}, stop={stop_pct}%, tp={tp_pct or 'off'})")
    print(f"Win rate:        {len(wins) / len(trades) * 100:6.1f}%  ({len(wins)}W / {len(losses)}L)")
    print(f"Total P&L:       {total:12.2f}")
    print(f"Avg per trade:   {total / len(trades):12.2f}")
    print(f"Profit factor:   {gross_win / gross_loss:12.2f}" if gross_loss > 0 else "Profit factor:            inf")
    print(f"Max drawdown:    {max_dd:12.2f}")
    print()
    exits = {}
    for t in trades:
        exits[t.exit_reason] = exits.get(t.exit_reason, 0) + 1
    print("Exits: " + ", ".join(f"{k} x{v}" for k, v in sorted(exits.items())))
    print()
    print("REMINDER: a good backtest is necessary, not sufficient. Slippage,")
    print("spread, and commissions are NOT modeled here. Validate on a demo")
    print("account (Phase 1) before any real capital (guide, Section 3).")


def main():
    p = argparse.ArgumentParser(description="WayneTrade SMA-crossover backtester")
    p.add_argument("csv", help="OHLC CSV: time,open,high,low,close")
    p.add_argument("--fast", type=int, default=10, help="fast SMA period (default 10)")
    p.add_argument("--slow", type=int, default=30, help="slow SMA period (default 30)")
    p.add_argument("--lots", type=float, default=0.01, help="fixed lot size, mirrors risk_profiles.fixed_lots")
    p.add_argument("--stop-pct", type=float, default=0.5, help="hard stop-loss %% from entry (default 0.5)")
    p.add_argument("--tp-pct", type=float, default=None, help="optional take-profit %% from entry")
    p.add_argument("--contract-size", type=float, default=100000, help="units per lot (forex standard 100000)")
    p.add_argument("--trades", action="store_true", help="also print every trade")
    args = p.parse_args()

    if args.fast >= args.slow:
        sys.exit("--fast must be smaller than --slow")
    if args.stop_pct <= 0:
        sys.exit("--stop-pct must be positive — the hard stop-loss rule is not optional")

    candles = load_candles(args.csv)
    signals = list(generate_signals(candles, args.fast, args.slow))
    trades = run_backtest(candles, signals, args.lots, args.stop_pct, args.tp_pct, args.contract_size)

    if args.trades:
        for t in trades:
            print(
                f"{t.side:5} {t.entry_time} @ {t.entry:.5f} → {t.exit_time} @ {t.exit:.5f}"
                f"  [{t.exit_reason}]  pnl {t.pnl:.2f}"
            )
        print()

    report(trades, args.lots, args.stop_pct, args.tp_pct)


if __name__ == "__main__":
    main()
