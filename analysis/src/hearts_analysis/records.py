"""Record schemas and parquet IO.

Three long-format tables per experiment, written to
``data/<experiment>/{games,rounds,plays}.parquet`` plus ``manifest.json``:

- **games** — one row per seat per game: final score, rank, winner flag.
- **rounds** — one row per seat per round: bid, tricks won, delta, bidding
  position, forbidden-bid context.
- **plays** — one row per card played (only when ``record_plays=True``).
"""

from __future__ import annotations

import json
import platform
import subprocess
import sys
from dataclasses import dataclass, field
from datetime import datetime, timezone
from importlib import metadata
from pathlib import Path

import pandas as pd


@dataclass(frozen=True, slots=True)
class RoundSeatRow:
    round_index: int
    cards_dealt: int
    dealer: int
    seat: int
    bid: int
    tricks_won: int
    delta: int
    bid_position: int  # 0 = dealer (bids first)
    was_last_bidder: bool
    forbidden_bid: int | None  # the bid denied to the last bidder, if any
    n_hearts: int  # trumps dealt to this seat
    n_high_offsuit: int  # off-suit aces + kings dealt to this seat


@dataclass(frozen=True, slots=True)
class PlayRow:
    round_index: int
    trick_index: int
    play_index: int
    seat: int
    card: int
    led_suit: int
    trick_winner: int


@dataclass(frozen=True, slots=True)
class GameRecord:
    game_seed: int
    num_players: int
    first_dealer: int
    policy_names: tuple[str, ...]
    final_scores: tuple[int, ...]
    winners: tuple[int, ...]  # seats tied at max score
    rounds: list[RoundSeatRow] = field(default_factory=list)
    plays: list[PlayRow] | None = None


def games_frame(records: list[GameRecord], experiment_seed: int) -> pd.DataFrame:
    rows = []
    for g in records:
        ranks = _ranks(g.final_scores)
        for seat in range(g.num_players):
            rows.append({
                "experiment_seed": experiment_seed,
                "game_seed": g.game_seed,
                "num_players": g.num_players,
                "first_dealer": g.first_dealer,
                "seat": seat,
                "seat_offset": (seat - g.first_dealer) % g.num_players,
                "policy": g.policy_names[seat],
                "final_score": g.final_scores[seat],
                "rank": ranks[seat],
                "is_winner": seat in g.winners,
                "n_winners": len(g.winners),
            })
    return pd.DataFrame(rows)


def rounds_frame(records: list[GameRecord], experiment_seed: int) -> pd.DataFrame:
    rows = []
    for g in records:
        for r in g.rounds:
            rows.append({
                "experiment_seed": experiment_seed,
                "game_seed": g.game_seed,
                "num_players": g.num_players,
                "policy": g.policy_names[r.seat],
                "round_index": r.round_index,
                "cards_dealt": r.cards_dealt,
                "dealer": r.dealer,
                "seat": r.seat,
                "bid": r.bid,
                "tricks_won": r.tricks_won,
                "delta": r.delta,
                "made_bid": r.bid == r.tricks_won,
                "bid_position": r.bid_position,
                "was_last_bidder": r.was_last_bidder,
                "forbidden_bid": r.forbidden_bid,
                "n_hearts": r.n_hearts,
                "n_high_offsuit": r.n_high_offsuit,
            })
    return pd.DataFrame(rows)


def plays_frame(records: list[GameRecord], experiment_seed: int) -> pd.DataFrame:
    rows = []
    for g in records:
        for p in g.plays or []:
            rows.append({
                "experiment_seed": experiment_seed,
                "game_seed": g.game_seed,
                "round_index": p.round_index,
                "trick_index": p.trick_index,
                "play_index": p.play_index,
                "seat": p.seat,
                "policy": g.policy_names[p.seat],
                "card": p.card,
                "led_suit": p.led_suit,
                "trick_winner": p.trick_winner,
            })
    return pd.DataFrame(rows)


def _ranks(scores: tuple[int, ...]) -> list[int]:
    """Competition rank per seat (1 = best, ties share)."""
    return [1 + sum(other > s for other in scores) for s in scores]


def write_experiment(
    out_dir: Path | str,
    records: list[GameRecord],
    experiment_seed: int,
    args: dict,
) -> Path:
    """Write parquet tables + manifest.json; returns the experiment dir."""
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    games_frame(records, experiment_seed).to_parquet(out / "games.parquet", index=False)
    rounds_frame(records, experiment_seed).to_parquet(out / "rounds.parquet", index=False)
    plays = plays_frame(records, experiment_seed)
    if not plays.empty:
        plays.to_parquet(out / "plays.parquet", index=False)
    manifest = {
        "experiment_seed": experiment_seed,
        "n_games": len(records),
        "args": args,
        "created_utc": datetime.now(timezone.utc).isoformat(),
        "git_commit": _git_commit(),
        "python": sys.version,
        "platform": platform.platform(),
        "packages": {
            name: _version(name)
            for name in ("pyhearts", "hearts-analysis", "numpy", "pandas")
        },
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    return out


def load_experiment(out_dir: Path | str) -> dict[str, pd.DataFrame]:
    out = Path(out_dir)
    frames = {}
    for name in ("games", "rounds", "plays"):
        path = out / f"{name}.parquet"
        if path.exists():
            frames[name] = pd.read_parquet(path)
    return frames


def _git_commit() -> str | None:
    try:
        return subprocess.run(
            ["git", "rev-parse", "HEAD"], capture_output=True, text=True, check=True,
            cwd=Path(__file__).parent,
        ).stdout.strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return None


def _version(package: str) -> str | None:
    try:
        return metadata.version(package)
    except metadata.PackageNotFoundError:
        return None
