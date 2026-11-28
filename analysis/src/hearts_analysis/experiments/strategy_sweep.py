"""EV sweep over the feature-bidder family (plus registry baselines).

Every candidate plays seat 0 of the *same* seeded games against a fixed
opponent policy in the other seats, so per-game scores are directly
comparable across candidates (paired by ``game_seed``).

    uv run python -m hearts_analysis.experiments.strategy_sweep \
        --players 4 --opponent heuristic --games 1000 --seed 5 \
        --workers 8 --out data/strategy_sweep/vs_heuristic_4p
"""

from __future__ import annotations

import argparse
import time
from functools import partial
from pathlib import Path

import pandas as pd

from .. import records, runner
from ..paths import safe_out_dir
from ..policies import REGISTRY
from ..policies.feature_bidder import PRESETS, FeatureBidderPolicy, grid

#: label -> ("feature", weights) | ("registry", name)
CandidateSpec = tuple[str, dict[str, float] | str]


def candidates(include_grid: bool = True) -> dict[str, CandidateSpec]:
    out: dict[str, CandidateSpec] = {
        "random": ("registry", "random"),
        "heuristic": ("registry", "heuristic"),
    }
    for label, weights in PRESETS.items():
        out[f"fb:{label}"] = ("feature", weights)
    if include_grid:
        for label, weights in grid().items():
            out[f"fb:{label}"] = ("feature", weights)
    return out


def _make_candidate(label: str, spec: CandidateSpec):
    kind, payload = spec
    if kind == "registry":
        return REGISTRY[payload]()
    return FeatureBidderPolicy(payload, label=label.removeprefix("fb:"))


def _table(label: str, spec: CandidateSpec, opponent: str, players: int):
    return [_make_candidate(label, spec)] + [REGISTRY[opponent]() for _ in range(players - 1)]


def run(
    players: int, opponent: str, n_games: int, seed: int, n_workers: int,
    include_grid: bool = True,
) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Returns ``(games, rounds)`` tidy frames, seat 0 only, with a
    ``candidate`` column."""
    game_parts, round_parts = [], []
    for label, spec in candidates(include_grid).items():
        recs = runner.play_games(
            seed, n_games, partial(_table, label, spec, opponent, players),
            n_workers=n_workers,
        )
        g = records.games_frame(recs, seed).query("seat == 0").copy()
        r = records.rounds_frame(recs, seed).query("seat == 0").copy()
        g["candidate"] = label
        r["candidate"] = label
        game_parts.append(g)
        round_parts.append(r)
    return pd.concat(game_parts, ignore_index=True), pd.concat(round_parts, ignore_index=True)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--players", type=int, default=4)
    ap.add_argument("--opponent", choices=("heuristic", "random"), default="heuristic")
    ap.add_argument("--games", type=int, default=1000)
    ap.add_argument("--seed", type=int, default=5)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--no-grid", action="store_true", help="presets and baselines only")
    ap.add_argument("--out", type=Path, default=Path("data/strategy_sweep"))
    args = ap.parse_args(argv)
    out = safe_out_dir(args.out)

    t0 = time.perf_counter()
    games, rounds = run(
        args.players, args.opponent, args.games, args.seed, args.workers,
        include_grid=not args.no_grid,
    )
    dt = time.perf_counter() - t0

    out.mkdir(parents=True, exist_ok=True)
    games.to_parquet(out / "games.parquet", index=False)
    rounds.to_parquet(out / "rounds.parquet", index=False)
    summary = games.groupby("candidate")["final_score"].agg(["mean", "std", "count"])
    print(f"{games['candidate'].nunique()} candidates x {args.games} games in {dt:.1f}s -> {out}")
    print(summary.sort_values("mean", ascending=False).round(2).to_string())


if __name__ == "__main__":
    main()
