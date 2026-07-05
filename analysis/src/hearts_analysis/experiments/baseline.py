"""Baseline Monte Carlo experiment: play N games with simple bots and write
the games/rounds(/plays) tables.

    uv run python -m hearts_analysis.experiments.baseline \
        --players 4 --games 20000 --bots heuristic --seed 1 --workers 8

``--bots`` is either one name (self-play) or a comma list, one per seat.
Output goes to ``data/baseline/<bots>_<players>p`` unless ``--out`` is given.
"""

from __future__ import annotations

import argparse
import time
from functools import partial
from pathlib import Path

from .. import records, runner
from ..policies import REGISTRY


def _make_table(names: tuple[str, ...]):
    return [REGISTRY[n]() for n in names]


def run(args: argparse.Namespace) -> Path:
    names = args.bots.split(",")
    if len(names) == 1:
        names = names * args.players
    if len(names) != args.players:
        raise SystemExit(f"--bots gives {len(names)} seats but --players is {args.players}")
    unknown = [n for n in names if n not in REGISTRY]
    if unknown:
        raise SystemExit(f"unknown bots {unknown}; known: {sorted(REGISTRY)}")

    out = args.out or Path("data/baseline") / f"{'-'.join(names)}_{args.players}p"
    t0 = time.perf_counter()
    recs = runner.play_games(
        args.seed, args.games, partial(_make_table, tuple(names)),
        rotate_first_dealer=not args.fixed_dealer,
        record_plays=args.record_plays,
        n_workers=args.workers,
    )
    dt = time.perf_counter() - t0
    out = records.write_experiment(out, recs, args.seed, vars(args) | {"out": str(out)})

    games = records.games_frame(recs, args.seed)
    summary = games.groupby("policy")["final_score"].agg(["mean", "std", "count"])
    winrate = games.groupby("policy")["is_winner"].mean()
    print(f"{args.games} games ({args.players}p, {'-'.join(names)}) in {dt:.1f}s -> {out}")
    print(summary.join(winrate.rename("win_rate")).round(3).to_string())
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--players", type=int, default=4)
    ap.add_argument("--games", type=int, default=10_000)
    ap.add_argument("--bots", default="heuristic")
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", type=Path, default=None)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--record-plays", action="store_true")
    ap.add_argument("--fixed-dealer", action="store_true",
                    help="always seat 0 as first dealer (default: rotate by game index)")
    run(ap.parse_args(argv))


if __name__ == "__main__":
    main()
