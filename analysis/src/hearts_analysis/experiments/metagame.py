"""Empirical meta-game across the policy zoo: for every pair of policies,
play 4-seat games with 2 seats each and record the mean score gap.

    uv run python -m hearts_analysis.experiments.metagame \
        --games 800 --seed 1 --workers 8 --out data/metagame
"""

from __future__ import annotations

import argparse
import time
from functools import partial
from itertools import combinations_with_replacement
from pathlib import Path

import numpy as np
import pandas as pd

from .. import records, runner
from ..policies import REGISTRY

POLICIES = ["random", "heuristic", "mc_bidder", "deck_tracker"]
N_SAMPLES = {"mc_bidder": 200, "deck_tracker": 200}


def _make_policy(name: str):
    kwargs = {"n_samples": N_SAMPLES[name]} if name in N_SAMPLES else {}
    return REGISTRY[name](**kwargs)


def _table(a: str, b: str):
    return [_make_policy(a), _make_policy(b), _make_policy(a), _make_policy(b)]


def run_matchup(a: str, b: str, n_games: int, seed: int, n_workers: int) -> tuple[float, float]:
    recs = runner.play_games(seed, n_games, partial(_table, a, b), n_workers=n_workers)
    g = records.games_frame(recs, seed)
    mean_a = g[g["policy"] == a]["final_score"].mean()
    mean_b = g[g["policy"] == b]["final_score"].mean()
    return mean_a, mean_b


def build_payoff_matrix(n_games: int, seed: int, n_workers: int) -> pd.DataFrame:
    payoff = pd.DataFrame(index=POLICIES, columns=POLICIES, dtype=float)
    for a, b in combinations_with_replacement(POLICIES, 2):
        mean_a, mean_b = run_matchup(a, b, n_games, seed, n_workers)
        payoff.loc[a, b] = mean_a
        payoff.loc[b, a] = mean_b
    return payoff


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--games", type=int, default=800)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--out", type=Path, default=Path("data/metagame"))
    args = ap.parse_args(argv)

    t0 = time.perf_counter()
    payoff = build_payoff_matrix(args.games, args.seed, args.workers)
    dt = time.perf_counter() - t0

    args.out.mkdir(parents=True, exist_ok=True)
    payoff.to_parquet(args.out / "payoff_matrix.parquet")
    print(f"{len(POLICIES)}x{len(POLICIES)} matchups, {args.games} games each, in {dt:.1f}s")
    print(payoff.round(2).to_string())


if __name__ == "__main__":
    main()
