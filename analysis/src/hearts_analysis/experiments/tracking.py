"""Deck-tracking experiments: how much of a future deal is foreseeable from
public history, and what edge does exploiting that buy.

    uv run python -m hearts_analysis.experiments.tracking information \
        --players 4 --games 500 --seed 1 --out data/tracking/information_4p
    uv run python -m hearts_analysis.experiments.tracking edge \
        --players 4 --games 1500 --mc-samples 200 --seed 2 --out data/tracking/edge_4p
"""

from __future__ import annotations

import argparse
import multiprocessing
import time
from functools import partial
from pathlib import Path

import pandas as pd
import pyhearts

from .. import records, runner, seeds
from ..deck_model import DeckModel
from ..policies import DeckTrackerPolicy, HeuristicPolicy, MCBidderPolicy


class _InformationSpy(HeuristicPolicy):
    """Plays like `HeuristicPolicy`; at each round's first bid decision
    (the dealer's, `bid_position == 0`) records the exact input a deck
    tracker would have used to predict that round's deal."""

    def __init__(self, sink: list) -> None:
        super().__init__()
        self._sink = sink

    def bid(self, obs):
        if obs.my_bid_position == 0:
            self._sink.append((obs.round_index, obs.dealer, obs.game_log))
        return super().bid(obs)


def _play_one_information_game(job: tuple[int, int]) -> list[dict]:
    game_seed, n = job
    captured: list[tuple[int, int, tuple]] = []
    table = [_InformationSpy(captured) for _ in range(n)]
    runner.play_game(table, game_seed)

    rows = []
    for round_index, dealer, game_log in captured:
        model = DeckModel(n)
        model.replay(game_log)
        predicted = model.predict_deal(round_index, dealer)
        d = pyhearts.cards_for_round(round_index)
        for seat in range(n):
            known = sum(c is not None for c in predicted[seat])
            rows.append({
                "round_index": round_index, "cards_dealt": d,
                "seat_offset": (seat - dealer) % n, "known": known,
                "frac_known": known / d,
            })
    return rows


def run_information(players: int, n_games: int, seed: int, n_workers: int) -> pd.DataFrame:
    children = seeds.spawn_game_seeds(seed, n_games)
    jobs = [(seeds.game_seed_of(c), players) for c in children]
    if n_workers <= 1:
        results = [_play_one_information_game(j) for j in jobs]
    else:
        with multiprocessing.Pool(n_workers) as pool:
            results = pool.map(_play_one_information_game, jobs)
    rows = [r for game_rows in results for r in game_rows]
    return pd.DataFrame(rows)


def _table_plain(n_samples: int):
    return [MCBidderPolicy(n_samples=n_samples), HeuristicPolicy(), HeuristicPolicy(), HeuristicPolicy()]


def _table_tracker(n_samples: int):
    return [DeckTrackerPolicy(n_samples=n_samples), HeuristicPolicy(), HeuristicPolicy(), HeuristicPolicy()]


def run_edge(n_games: int, mc_samples: int, seed: int, n_workers: int, out: Path) -> Path:
    """Paired-seed comparison: identical opponent seeds/hands, only seat 0's
    policy differs (MCBidder vs DeckTracker), isolating the tracker's edge."""
    plain = runner.play_games(seed, n_games, partial(_table_plain, mc_samples), n_workers=n_workers)
    tracked = runner.play_games(seed, n_games, partial(_table_tracker, mc_samples), n_workers=n_workers)

    plain_g = records.games_frame(plain, seed).query("seat == 0")
    tracked_g = records.games_frame(tracked, seed).query("seat == 0")
    paired = plain_g[["game_seed", "final_score"]].merge(
        tracked_g[["game_seed", "final_score"]], on="game_seed", suffixes=("_plain", "_tracked"),
    )
    paired["edge"] = paired["final_score_tracked"] - paired["final_score_plain"]

    out.mkdir(parents=True, exist_ok=True)
    paired.to_parquet(out / "paired_games.parquet", index=False)
    records.write_experiment(out / "plain", plain, seed, {"policy": "mc_bidder", "mc_samples": mc_samples})
    records.write_experiment(out / "tracked", tracked, seed, {"policy": "deck_tracker", "mc_samples": mc_samples})
    return out


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)

    info = sub.add_parser("information")
    info.add_argument("--players", type=int, default=4)
    info.add_argument("--games", type=int, default=500)
    info.add_argument("--seed", type=int, default=1)
    info.add_argument("--workers", type=int, default=1)
    info.add_argument("--out", type=Path, default=Path("data/tracking/information"))

    edge = sub.add_parser("edge")
    edge.add_argument("--games", type=int, default=1500)
    edge.add_argument("--mc-samples", type=int, default=200)
    edge.add_argument("--seed", type=int, default=2)
    edge.add_argument("--workers", type=int, default=1)
    edge.add_argument("--out", type=Path, default=Path("data/tracking/edge"))

    args = ap.parse_args(argv)
    t0 = time.perf_counter()
    if args.cmd == "information":
        df = run_information(args.players, args.games, args.seed, args.workers)
        args.out.mkdir(parents=True, exist_ok=True)
        df.to_parquet(args.out / "information.parquet", index=False)
        dt = time.perf_counter() - t0
        print(f"{args.games} games -> {len(df)} rows in {dt:.1f}s -> {args.out}")
        print(df.groupby("round_index")["frac_known"].mean().round(3).to_string())
    else:
        out = run_edge(args.games, args.mc_samples, args.seed, args.workers, args.out)
        dt = time.perf_counter() - t0
        paired = pd.read_parquet(out / "paired_games.parquet")
        print(f"{args.games} paired games in {dt:.1f}s -> {out}")
        print(f"mean edge (tracked - plain): {paired['edge'].mean():+.3f} "
              f"(sd {paired['edge'].std():.3f})")


if __name__ == "__main__":
    main()
