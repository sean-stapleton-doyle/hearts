"""First-dealer edge in 2-player games.

Both seats run the *same* policy and the first dealer is fixed at seat 0,
so any per-game score gap between seat 0 and seat 1 is purely structural
(who deals/bids first and leads the first trick in which rounds). Run with
`heuristic` for the real effect and `random` as a control.

    uv run python -m hearts_analysis.experiments.dealer_edge \
        --games 4000 --seed 7 --workers 8 --out data/dealer_edge
"""

from __future__ import annotations

import argparse
import time
from functools import partial
from pathlib import Path

import pandas as pd

from .. import records, runner
from ..policies import REGISTRY

POLICIES = ("heuristic", "random")


def _table(policy: str):
    return [REGISTRY[policy](), REGISTRY[policy]()]


def run(n_games: int, seed: int, n_workers: int, out: Path) -> Path:
    for policy in POLICIES:
        recs = runner.play_games(
            seed, n_games, partial(_table, policy),
            first_dealer=0, n_workers=n_workers,
        )
        records.write_experiment(
            out / policy, recs, seed,
            {"policy": policy, "players": 2, "games": n_games, "first_dealer": 0},
        )
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--games", type=int, default=4000)
    ap.add_argument("--seed", type=int, default=7)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--out", type=Path, default=Path("data/dealer_edge"))
    args = ap.parse_args(argv)

    t0 = time.perf_counter()
    run(args.games, args.seed, args.workers, args.out)
    dt = time.perf_counter() - t0
    print(f"{len(POLICIES)} policies x {args.games} games in {dt:.1f}s -> {args.out}")
    for policy in POLICIES:
        g = pd.read_parquet(args.out / policy / "games.parquet")
        by_seat = g.groupby("seat")["final_score"].mean()
        print(f"{policy}: seat0 {by_seat[0]:.2f}  seat1 {by_seat[1]:.2f}  "
              f"edge {(by_seat[0] - by_seat[1]):+.2f}")


if __name__ == "__main__":
    main()
