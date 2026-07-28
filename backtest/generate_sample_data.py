#!/usr/bin/env python3
"""
Generates sample_data/EURUSD_H1_sample.csv — a SYNTHETIC hourly EURUSD-like
series (seeded random walk with regime shifts) so the backtester runs out of
the box. This is fake data for exercising the tooling, NOT for judging any
strategy — export real candles from TradingView/MetaTrader for that.
"""

import csv
import math
import os
import random
from datetime import datetime, timedelta

random.seed(42)  # deterministic — regenerating produces the same file

out_dir = os.path.join(os.path.dirname(__file__), "sample_data")
os.makedirs(out_dir, exist_ok=True)
path = os.path.join(out_dir, "EURUSD_H1_sample.csv")

price = 1.0850
t = datetime(2026, 1, 5, 0, 0)
rows = []
drift = 0.0
for i in range(2000):
    if i % 250 == 0:  # regime shift every ~250 hours so crossovers happen
        drift = random.uniform(-0.00004, 0.00004)
    o = price
    step = random.gauss(drift, 0.0009)
    c = max(0.5, o + step)
    spread = abs(random.gauss(0, 0.0006))
    h = max(o, c) + spread
    l = min(o, c) - spread
    rows.append((t.strftime("%Y-%m-%d %H:%M"), f"{o:.5f}", f"{h:.5f}", f"{l:.5f}", f"{c:.5f}"))
    price = c
    t += timedelta(hours=1)

with open(path, "w", newline="") as f:
    w = csv.writer(f)
    w.writerow(["time", "open", "high", "low", "close"])
    w.writerows(rows)

print(f"Wrote {len(rows)} candles to {path}")
