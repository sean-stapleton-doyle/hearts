"""Build first-bidder bid tables: for sampled hands of each round size, the
Monte Carlo optimal bid and its expected value.

    uv run python -m hearts_analysis.experiments.bidding \
        --players 4,6 --rounds 1,2,3 --hands 250 --mc-samples 500 --seed 1

Every hand is evaluated with the seat as the *first* bidder (the dealer),
so no bid is forbidden and every candidate in ``0..cards_dealt`` is legal —
this isolates "what's the right bid for this hand" from the last-bidder
constraint, which is analyzed exactly (closed form) in the notebook instead
of by sampling here (see `docs` in `notebooks/02_bidding.ipynb`).
"""

from __future__ import annotations

import argparse
import time
from pathlib import Path

import numpy as np
import pandas as pd

from .. import cards, estimators


def sample_hand(rng: np.random.Generator, size: int) -> tuple[int, ...]:
    return tuple(sorted(int(c) for c in rng.choice(cards.NUM_CARDS, size=size, replace=False)))


def build_table(
    players: list[int], rounds: list[int], n_hands: int, mc_samples: int, seed: int,
) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    rows = []
    for cards_dealt in rounds:
        for n in players:
            for _ in range(n_hands):
                hand = sample_hand(rng, cards_dealt)
                legal = tuple(range(cards_dealt + 1))
                best, values = estimators.best_bid(
                    hand=hand, seat=0, num_players=n, cards_dealt=cards_dealt, dealer=0,
                    known_bids=[None] * n, legal_bids=legal,
                    n_samples=mc_samples, rng=rng,
                )
                n_hearts = sum(cards.is_trump(c) for c in hand)
                n_high_offsuit = sum(
                    not cards.is_trump(c) and cards.rank_of(c) >= 13 for c in hand
                )
                for bid, value in values.items():
                    rows.append({
                        "cards_dealt": cards_dealt, "num_players": n,
                        "hand": ",".join(cards.card_str(c) for c in hand),
                        "n_hearts": n_hearts, "n_high_offsuit": n_high_offsuit,
                        "bid": bid, "value": value, "best_bid": best,
                    })
    return pd.DataFrame(rows)


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--players", default="4", help="comma list, e.g. 2,4,6")
    ap.add_argument("--rounds", default="1,2,3", help="comma list of cards_dealt")
    ap.add_argument("--hands", type=int, default=200, help="hands sampled per (round, players)")
    ap.add_argument("--mc-samples", type=int, default=500)
    ap.add_argument("--seed", type=int, default=1)
    ap.add_argument("--out", type=Path, default=Path("data/bidding/table"))
    args = ap.parse_args(argv)

    players = [int(p) for p in args.players.split(",")]
    rounds = [int(r) for r in args.rounds.split(",")]
    t0 = time.perf_counter()
    df = build_table(players, rounds, args.hands, args.mc_samples, args.seed)
    dt = time.perf_counter() - t0

    args.out.mkdir(parents=True, exist_ok=True)
    df.to_parquet(args.out / "bid_table.parquet", index=False)
    print(f"{len(df)} rows ({args.hands} hands x {len(rounds)} round sizes x "
          f"{len(players)} table sizes) in {dt:.1f}s -> {args.out}")


if __name__ == "__main__":
    main()
