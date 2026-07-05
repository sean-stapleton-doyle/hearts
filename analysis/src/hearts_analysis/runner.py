"""Drive ``pyhearts.Game`` with policies, minimizing pyo3 traffic.

The bindings clone on every accessor (``game.round()`` returns a snapshot),
so the runner mirrors game state locally — hands, bids, tricks, scores — and
touches the engine only to fetch each round's deal and to submit actions. The
``PlayOutcome`` returned by ``play_card`` drives trick/round transitions
without re-querying. Local bookkeeping is cross-checked against the engine at
every round boundary (always) and at every decision (``validate=True``).
"""

from __future__ import annotations

import multiprocessing
from collections.abc import Callable, Sequence

import numpy as np
import pyhearts

from . import cards, seeds
from .observation import Observation, RoundLog, TrickRecord
from .policy import Policy
from .records import GameRecord, PlayRow, RoundSeatRow

NUM_ROUNDS = pyhearts.NUM_ROUNDS

_EMPTY: tuple = ()


class EngineMismatch(AssertionError):
    """Local bookkeeping diverged from the engine — a runner bug."""


def play_game(
    policies: Sequence[Policy],
    game_seed: int,
    *,
    first_dealer: int | None = None,
    seed_seq: np.random.SeedSequence | None = None,
    record_plays: bool = False,
    validate: bool = False,
) -> GameRecord:
    """Play one full game; returns its record. Deterministic given
    ``(game_seed, seed_seq, policies)``."""
    n = len(policies)
    py_seats = [pyhearts.Seat(i) for i in range(n)]
    if first_dealer is None:
        game = pyhearts.Game(n, game_seed)
        first_dealer = 0
    else:
        game = pyhearts.Game.with_first_dealer(n, game_seed, py_seats[first_dealer])

    if seed_seq is None:
        seed_seq = seeds.replay_seed_seq(game_seed)
    for i, (policy, rng) in enumerate(zip(policies, seeds.policy_rngs(seed_seq, n))):
        policy.reset(i, n, rng)

    scores = [0] * n
    game_log: list[RoundLog] = []
    round_rows: list[RoundSeatRow] = []
    play_rows: list[PlayRow] = []

    for round_index in range(1, NUM_ROUNDS + 1):
        dealer = game.dealer.index
        rnd = game.round()
        hands = [sorted(cards.card_to_int(c) for c in rnd.hand(py_seats[s])) for s in range(n)]
        dealt_stats = [
            (sum(cards.is_trump(c) for c in hand),
             sum(not cards.is_trump(c) and cards.rank_of(c) >= 13 for c in hand))
            for hand in hands
        ]
        cards_dealt = pyhearts.cards_for_round(round_index)
        scores_t = tuple(scores)
        log_t = tuple(game_log)
        zeros = (0,) * n

        # ── Bidding: dealer first, then around the table ────────────────
        bids: list[int | None] = [None] * n
        for pos in range(n):
            seat = (dealer + pos) % n
            if pos == n - 1:
                would_even = cards_dealt - sum(b for b in bids if b is not None)
                forbidden = would_even if 0 <= would_even <= cards_dealt else None
            else:
                forbidden = None
            legal_bids = tuple(b for b in range(cards_dealt + 1) if b != forbidden)
            if validate:
                _check_bid_state(game, py_seats[seat], legal_bids)
            obs = Observation(
                seat=seat, num_players=n, round_index=round_index,
                cards_this_round=cards_dealt, dealer=dealer, scores=scores_t,
                bids=tuple(bids), my_bid_position=pos, forbidden_bid=forbidden,
                legal_bids=legal_bids, hand=tuple(hands[seat]), legal_plays=_EMPTY,
                current_trick=_EMPTY, led_suit=None, tricks_won=zeros,
                round_tricks=_EMPTY, game_log=log_t,
            )
            bid = policies[seat].bid(obs)
            game.place_bid(py_seats[seat], bid)  # engine raises GameError if illegal
            bids[seat] = bid

        bids_t = tuple(bids)

        # ── Play: dealer leads the first trick, winner leads the next ───
        tricks_won = [0] * n
        completed: list[TrickRecord] = []
        deltas: list[int] | None = None
        leader = dealer
        for trick_index in range(cards_dealt):
            trick_plays: list[tuple[int, int]] = []
            led_suit: int | None = None
            winner: int | None = None
            tricks_won_t = tuple(tricks_won)
            completed_t = tuple(completed)
            for play_pos in range(n):
                seat = (leader + play_pos) % n
                legal = cards.legal_plays(hands[seat], led_suit)
                if validate:
                    _check_play_state(game, py_seats[seat], legal)
                obs = Observation(
                    seat=seat, num_players=n, round_index=round_index,
                    cards_this_round=cards_dealt, dealer=dealer, scores=scores_t,
                    bids=bids_t, my_bid_position=(seat - dealer) % n,
                    forbidden_bid=None, legal_bids=_EMPTY,
                    hand=tuple(hands[seat]), legal_plays=legal,
                    current_trick=tuple(trick_plays), led_suit=led_suit,
                    tricks_won=tricks_won_t, round_tricks=completed_t, game_log=log_t,
                )
                card = policies[seat].play(obs)
                outcome = game.play_card(py_seats[seat], cards.INT_TO_CARD[card])
                hands[seat].remove(card)  # ValueError = policy played a card it lacks
                trick_plays.append((seat, card))
                if led_suit is None:
                    led_suit = card // 13
                if isinstance(outcome, pyhearts.PlayOutcome.TrickComplete):
                    winner = outcome.winner.index
                elif isinstance(
                    outcome, (pyhearts.PlayOutcome.RoundComplete, pyhearts.PlayOutcome.GameOver)
                ):
                    winner = outcome.trick_winner.index
                    deltas = list(outcome.deltas)
            assert winner is not None and led_suit is not None
            tricks_won[winner] += 1
            completed.append((leader, tuple(trick_plays)))
            if record_plays:
                for play_pos, (seat, card) in enumerate(trick_plays):
                    play_rows.append(PlayRow(
                        round_index=round_index, trick_index=trick_index,
                        play_index=play_pos, seat=seat, card=card,
                        led_suit=led_suit, trick_winner=winner,
                    ))
            leader = winner

        # ── Round end: engine already scored and re-dealt via play_card ─
        assert deltas is not None
        engine_result = game.history()[round_index - 1]
        if (list(engine_result.tricks_won) != tricks_won
                or list(engine_result.bids) != list(bids_t)
                or list(engine_result.deltas) != deltas):
            raise EngineMismatch(
                f"round {round_index}: local (bids={bids_t}, tricks={tricks_won}, "
                f"deltas={deltas}) vs engine ({engine_result.bids}, "
                f"{engine_result.tricks_won}, {engine_result.deltas})"
            )
        for seat in range(n):
            pos = (seat - dealer) % n
            round_rows.append(RoundSeatRow(
                round_index=round_index, cards_dealt=cards_dealt, dealer=dealer,
                seat=seat, bid=bids[seat], tricks_won=tricks_won[seat],
                delta=deltas[seat], bid_position=pos,
                was_last_bidder=pos == n - 1,
                forbidden_bid=forbidden if pos == n - 1 else None,
                n_hearts=dealt_stats[seat][0],
                n_high_offsuit=dealt_stats[seat][1],
            ))
        scores = [s + d for s, d in zip(scores, deltas)]
        game_log.append(RoundLog(index=round_index, dealer=dealer, bids=bids_t,
                                 tricks=tuple(completed)))

    if game.phase() != pyhearts.Phase.GameOver:
        raise EngineMismatch("13 rounds played but engine phase is not GameOver")
    if game.scores() != scores:
        raise EngineMismatch(f"final scores: local {scores} vs engine {game.scores()}")
    winners = sorted(s.index for s in (game.winners() or []))

    return GameRecord(
        game_seed=game_seed, num_players=n, first_dealer=first_dealer,
        policy_names=tuple(p.name for p in policies),
        final_scores=tuple(scores), winners=tuple(winners),
        rounds=round_rows, plays=play_rows if record_plays else None,
    )


def _check_bid_state(game: pyhearts.Game, seat: pyhearts.Seat, legal_bids: tuple[int, ...]) -> None:
    rnd = game.round()
    if rnd.next_bidder() != seat:
        raise EngineMismatch(f"next bidder: local {seat} vs engine {rnd.next_bidder()}")
    if tuple(rnd.legal_bids()) != legal_bids:
        raise EngineMismatch(f"legal bids: local {legal_bids} vs engine {rnd.legal_bids()}")


def _check_play_state(game: pyhearts.Game, seat: pyhearts.Seat, legal: tuple[int, ...]) -> None:
    rnd = game.round()
    if rnd.next_player() != seat:
        raise EngineMismatch(f"next player: local {seat} vs engine {rnd.next_player()}")
    engine_legal = sorted(cards.card_to_int(c) for c in rnd.legal_plays(seat))
    if engine_legal != sorted(legal):
        raise EngineMismatch(f"legal plays: local {sorted(legal)} vs engine {engine_legal}")


# ── Batch runner ────────────────────────────────────────────────────────────

PolicyFactory = Callable[[], Sequence[Policy]]


def play_games(
    experiment_seed: int,
    n_games: int,
    policy_factory: PolicyFactory,
    *,
    first_dealer: int | None = None,
    rotate_first_dealer: bool = False,
    record_plays: bool = False,
    validate: bool = False,
    n_workers: int = 1,
) -> list[GameRecord]:
    """Play ``n_games`` independent games; reproducible from
    ``experiment_seed``. ``policy_factory`` must be picklable (a top-level
    function) when ``n_workers > 1``. ``rotate_first_dealer`` cycles the
    first dealer by game index (for seat-effect studies)."""
    children = seeds.spawn_game_seeds(experiment_seed, n_games)
    jobs = [
        (child, i, policy_factory, first_dealer, rotate_first_dealer, record_plays, validate)
        for i, child in enumerate(children)
    ]
    if n_workers <= 1:
        return [_run_one(job) for job in jobs]
    with multiprocessing.Pool(n_workers) as pool:
        return pool.map(_run_one, jobs, chunksize=max(1, n_games // (n_workers * 8)))


def _run_one(job) -> GameRecord:
    child, index, policy_factory, first_dealer, rotate, record_plays, validate = job
    policies = policy_factory()
    if rotate:
        first_dealer = index % len(policies)
    return play_game(
        policies, seeds.game_seed_of(child),
        first_dealer=first_dealer, seed_seq=child,
        record_plays=record_plays, validate=validate,
    )
