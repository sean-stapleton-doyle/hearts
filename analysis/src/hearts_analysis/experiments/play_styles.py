"""Play-style tournament: each style (and a few phase-switching combos)
plays seat 0 against `adaptive` opponents on the same seeded games, with
per-card play records for trick-level analysis.

    uv run python -m hearts_analysis.experiments.play_styles \
        --players 4 --games 800 --seed 6 --workers 8 --out data/play_styles/4p
"""

from __future__ import annotations

import argparse
import time
from functools import partial
from pathlib import Path

import pandas as pd

from .. import records, runner
from ..paths import safe_out_dir
from ..policies import PhasedPolicy, StyledPlayPolicy


def _styled(style: str):
    return StyledPlayPolicy(style)


def _phased_round(early: str, mid: str, late: str, label: str):
    return PhasedPolicy(
        StyledPlayPolicy(early), StyledPlayPolicy(mid), StyledPlayPolicy(late),
        boundary="round", label=label,
    )


def _phased_trick(early: str, mid: str, late: str, label: str):
    return PhasedPolicy(
        StyledPlayPolicy(early), StyledPlayPolicy(mid), StyledPlayPolicy(late),
        boundary="trick", label=label,
    )


#: label -> zero-arg policy factory (top-level partials: picklable).
CANDIDATES = {
    "adaptive": partial(_styled, "adaptive"),
    "hearts_first": partial(_styled, "hearts_first"),
    "high_first": partial(_styled, "high_first"),
    "low_first": partial(_styled, "low_first"),
    # Round-phased: fixed styles early/late around the adaptive midgame.
    "phased_round:low,adaptive,hearts": partial(
        _phased_round, "low_first", "adaptive", "hearts_first",
        "phased_round:low,adaptive,hearts"),
    "phased_round:hearts,adaptive,low": partial(
        _phased_round, "hearts_first", "adaptive", "low_first",
        "phased_round:hearts,adaptive,low"),
    # Trick-phased within each round.
    "phased_trick:high,adaptive,low": partial(
        _phased_trick, "high_first", "adaptive", "low_first",
        "phased_trick:high,adaptive,low"),
    "phased_trick:low,adaptive,high": partial(
        _phased_trick, "low_first", "adaptive", "high_first",
        "phased_trick:low,adaptive,high"),
}


def _table(label: str, players: int):
    return [CANDIDATES[label]()] + [_styled("adaptive") for _ in range(players - 1)]


def run(players: int, n_games: int, seed: int, n_workers: int, out: Path) -> Path:
    """One `records.write_experiment` directory per candidate under ``out``
    (plays recorded), so notebooks get games/rounds/plays per style."""
    for label in CANDIDATES:
        recs = runner.play_games(
            seed, n_games, partial(_table, label, players),
            n_workers=n_workers, record_plays=True,
        )
        safe = label.replace(":", "_").replace(",", "-")
        records.write_experiment(
            out / safe, recs, seed,
            {"candidate": label, "players": players, "games": n_games},
        )
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--players", type=int, default=4)
    ap.add_argument("--games", type=int, default=800)
    ap.add_argument("--seed", type=int, default=6)
    ap.add_argument("--workers", type=int, default=1)
    ap.add_argument("--out", type=Path, default=Path("data/play_styles"))
    args = ap.parse_args(argv)
    out = safe_out_dir(args.out)

    t0 = time.perf_counter()
    run(args.players, args.games, args.seed, args.workers, out)
    dt = time.perf_counter() - t0

    rows = []
    for label in CANDIDATES:
        safe = label.replace(":", "_").replace(",", "-")
        g = pd.read_parquet(out / safe / "games.parquet")
        rows.append({"candidate": label,
                     "mean_score": g.query("seat == 0")["final_score"].mean()})
    print(f"{len(CANDIDATES)} candidates x {args.games} games in {dt:.1f}s -> {out}")
    print(pd.DataFrame(rows).sort_values("mean_score", ascending=False).round(2).to_string(index=False))


if __name__ == "__main__":
    main()
