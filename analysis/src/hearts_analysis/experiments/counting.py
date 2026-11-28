"""Counting-ladder ablation: paired-seed edge of each (memory level x
channel) combination over its matched baseline.

Seat 0 varies, three `heuristic` opponents stay fixed on identical seeds
(same decks, same opponent behavior), mirroring `tracking.run_edge`:

- play-channel arms are baselined against an all-`heuristic` table
  (identical bids, only play differs);
- arms that include the bid channel are baselined against `mc_bidder` with
  the same sample count (identical estimator, only knowledge differs).

    uv run python -m hearts_analysis.experiments.counting \
        --games 1500 --mc-samples 200 --seed 8 --workers 8 --out data/counting
"""

from __future__ import annotations

import argparse
import time
from functools import partial
from pathlib import Path

import pandas as pd

from .. import records, runner
from ..paths import safe_out_dir
from ..policies import CountingPolicy, HeuristicPolicy, MCBidderPolicy
from ..policies.counters import LEVELS

USES: tuple[tuple[str, ...], ...] = (("play",), ("bid",), ("bid", "play"))


def _table_candidate(level: str, use: tuple[str, ...], n_samples: int):
    return [CountingPolicy(level, use_for=use, n_samples=n_samples)] + [
        HeuristicPolicy() for _ in range(3)
    ]


def _table_heuristic():
    return [HeuristicPolicy() for _ in range(4)]


def _table_mc(n_samples: int):
    return [MCBidderPolicy(n_samples=n_samples)] + [HeuristicPolicy() for _ in range(3)]


def _seat0_scores(recs, seed: int) -> pd.DataFrame:
    g = records.games_frame(recs, seed).query("seat == 0")
    return g[["game_seed", "final_score"]]


def run(n_games: int, mc_samples: int, seed: int, n_workers: int) -> pd.DataFrame:
    """Tidy frame: one row per (level, use, game) with the candidate's and
    its matched baseline's seat-0 scores and their difference."""
    baselines = {
        "heuristic": _seat0_scores(
            runner.play_games(seed, n_games, _table_heuristic, n_workers=n_workers), seed),
        "mc_bidder": _seat0_scores(
            runner.play_games(seed, n_games, partial(_table_mc, mc_samples),
                              n_workers=n_workers), seed),
    }
    parts = []
    for level in LEVELS:
        for use in USES:
            recs = runner.play_games(
                seed, n_games, partial(_table_candidate, level, use, mc_samples),
                n_workers=n_workers,
            )
            baseline_name = "heuristic" if use == ("play",) else "mc_bidder"
            paired = _seat0_scores(recs, seed).merge(
                baselines[baseline_name], on="game_seed",
                suffixes=("_candidate", "_baseline"),
            )
            paired["edge"] = paired["final_score_candidate"] - paired["final_score_baseline"]
            paired["level"] = level
            paired["use"] = "+".join(use)
            paired["baseline"] = baseline_name
            parts.append(paired)
    return pd.concat(parts, ignore_index=True)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--games", type=int, default=1500)
    ap.add_argument("--mc-samples", type=int, default=200)
    ap.add_argument("--seed", type=int, default=8)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--out", type=Path, default=Path("data/counting"))
    args = ap.parse_args(argv)
    out = safe_out_dir(args.out)

    t0 = time.perf_counter()
    df = run(args.games, args.mc_samples, args.seed, args.workers)
    dt = time.perf_counter() - t0

    out.mkdir(parents=True, exist_ok=True)
    df.to_parquet(out / "ablation.parquet", index=False)
    summary = df.groupby(["level", "use"])["edge"].agg(["mean", "std", "count"])
    print(f"{len(LEVELS)} levels x {len(USES)} channels x {args.games} games "
          f"in {dt:.1f}s -> {out}")
    print(summary.round(3).to_string())


if __name__ == "__main__":
    main()
