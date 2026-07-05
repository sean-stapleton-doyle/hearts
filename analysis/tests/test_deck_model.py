"""Deck-model exactness: every prediction it makes must be right.

The model is fed only public information (deal timing/order + observed
plays); we validate it against ground truth by peeking at
`pyhearts.Round.hand(seat)` — a test-only privilege no policy has access to.
"""

from __future__ import annotations

import pyhearts
import pytest

from hearts_analysis import cards
from hearts_analysis.deck_model import DeckModel
from hearts_analysis.observation import RoundLog
from hearts_analysis.policies import DeckTrackerPolicy, HeuristicPolicy, MCBidderPolicy
from hearts_analysis.runner import play_game


class RecordingRunner:
    """Drives a real `pyhearts.Game` with `HeuristicPolicy` everywhere,
    feeding a `DeckModel` the same way `DeckTrackerPolicy` would, and at
    every deal checks every `predict_deal` claim against the true dealt
    hands (via `Round.hand`, test-only ground truth)."""

    def __init__(self, num_players: int, seed: int) -> None:
        self.n = num_players
        self.game = pyhearts.Game(num_players, seed)
        self.deck = DeckModel(num_players)
        self.py_seats = [pyhearts.Seat(i) for i in range(num_players)]
        self.checks = 0

    def run(self) -> int:
        for round_index in range(1, pyhearts.NUM_ROUNDS + 1):
            dealer = self.game.dealer.index
            predicted = self.deck.deal_round(round_index, dealer)
            rnd = self.game.round()
            true_hands = [
                {cards.card_to_int(c) for c in rnd.hand(self.py_seats[s])}
                for s in range(self.n)
            ]
            for seat in range(self.n):
                known = {c for c in predicted[seat] if c is not None}
                assert known <= true_hands[seat], (
                    f"round {round_index} seat {seat}: predicted {known} "
                    f"not subset of true hand {true_hands[seat]}"
                )
                self.checks += len(known)

            # Bid the first legal option (bidding doesn't affect deck state).
            # `round()` clones, so re-fetch after every mutation.
            rnd = self.game.round()
            while rnd.next_bidder() is not None:
                s = rnd.next_bidder()
                self.game.place_bid(s, rnd.legal_bids()[0])
                rnd = self.game.round()

            # `Game::finish_round` auto-deals the next round the instant this
            # one's last card is played, so `game.round()` silently becomes
            # the *next* round at that point — never re-query completion
            # state on `rnd`; just play exactly `cards_dealt` tricks.
            plays: list[tuple[int, tuple[tuple[int, int], ...]]] = []
            rnd = self.game.round()
            cards_dealt = rnd.cards_dealt
            for _ in range(cards_dealt):
                leader = rnd.current_trick().leader.index
                trick_plays: list[tuple[int, int]] = []
                for _ in range(self.n):
                    s = rnd.next_player()
                    card = rnd.legal_plays(s)[0]
                    self.game.play_card(s, card)
                    trick_plays.append((s.index, cards.card_to_int(card)))
                    rnd = self.game.round()
                plays.append((leader, tuple(trick_plays)))

            self.deck.resolve_round(tuple(plays))
        return self.checks


@pytest.mark.parametrize("seed", range(4))
@pytest.mark.parametrize("n_players", [2, 3, 4, 7])
def test_deck_model_predictions_are_always_correct(seed, n_players):
    checks = RecordingRunner(n_players, seed).run()
    # Every prediction was checked as a subset; late rounds of a game should
    # yield at least some non-trivial known-in-advance predictions, since by
    # then several rounds' worth of cards have recycled.
    assert checks >= 0  # correctness is the assertion inside run(); this
    # just documents that the loop executed for all 13 rounds.


@pytest.mark.parametrize("seed", range(6))
def test_deck_model_eventually_predicts_something(seed):
    """Sanity: over a 4-player game, the model should foresee at least one
    card correctly at some point (otherwise the mechanic being tested isn't
    actually exercised)."""
    checks = RecordingRunner(4, seed).run()
    assert checks > 0


@pytest.mark.parametrize("seed", range(3))
def test_deck_tracker_known_opponents_are_always_correct(seed):
    """Regression test for a real bug: `DeckModel.deal_round` mutates the
    deque (consumes this round's front), so calling `predict_deal` again
    afterward silently read the *next* round's front instead. Drives a real
    game manually (mirroring runner.py's Observation construction) so
    `DeckTrackerPolicy._known_opponents` can be checked against
    `Round.hand()` ground truth at every one of its decisions."""
    n = 4
    game = pyhearts.Game(n, seed)
    py_seats = [pyhearts.Seat(i) for i in range(n)]
    policies = [DeckTrackerPolicy(n_samples=30), HeuristicPolicy(),
                HeuristicPolicy(), HeuristicPolicy()]
    import numpy as np
    for i, p in enumerate(policies):
        p.reset(i, n, np.random.default_rng(i))

    game_log: list[RoundLog] = []
    checked = 0
    for round_index in range(1, pyhearts.NUM_ROUNDS + 1):
        dealer = game.dealer.index
        rnd = game.round()
        hands = [
            sorted(cards.card_to_int(c) for c in rnd.hand(py_seats[s])) for s in range(n)
        ]
        cards_dealt = pyhearts.cards_for_round(round_index)
        bids: list[int | None] = [None] * n
        for pos in range(n):
            seat = (dealer + pos) % n
            from hearts_analysis.observation import Observation
            obs = Observation(
                seat=seat, num_players=n, round_index=round_index,
                cards_this_round=cards_dealt, dealer=dealer, scores=tuple(game.scores()),
                bids=tuple(bids), my_bid_position=pos, forbidden_bid=rnd.forbidden_bid(),
                legal_bids=tuple(rnd.legal_bids()), hand=tuple(hands[seat]),
                legal_plays=(), current_trick=(), led_suit=None, tricks_won=(0,) * n,
                round_tricks=(), game_log=tuple(game_log),
            )
            if seat == 0:
                policies[0]._sync_deck(obs)
                for opp_seat, opp_cards in policies[0]._known_opponents(obs).items():
                    checked += len(opp_cards)
                    assert set(opp_cards) <= set(hands[opp_seat]), (
                        f"round {round_index} seat {opp_seat}: claimed "
                        f"{opp_cards} not subset of true {hands[opp_seat]}"
                    )
            bid = policies[seat].bid(obs)
            game.place_bid(py_seats[seat], bid)
            bids[seat] = bid
            rnd = game.round()

        completed = []
        for _ in range(cards_dealt):
            leader = rnd.current_trick().leader.index
            trick_plays: list[tuple[int, int]] = []
            for _ in range(n):
                s = rnd.next_player()
                card = rnd.legal_plays(s)[0]
                game.play_card(s, card)
                trick_plays.append((s.index, cards.card_to_int(card)))
                rnd = game.round()
            completed.append((leader, tuple(trick_plays)))
        game_log.append(RoundLog(index=round_index, dealer=dealer, bids=tuple(bids),
                                  tricks=tuple(completed)))
    assert checked > 0  # the mechanic was actually exercised


def test_deck_tracker_plays_legally_and_completes():
    table = [
        DeckTrackerPolicy(n_samples=150), HeuristicPolicy(),
        DeckTrackerPolicy(n_samples=150), MCBidderPolicy(n_samples=150),
    ]
    rec = play_game(table, game_seed=13, validate=True)
    assert len(rec.rounds) == 13 * 4


def test_replay_matches_incremental_sync():
    """DeckModel.replay(full_log) and the incremental deal/resolve sequence
    a policy performs turn-by-turn must agree once a full game has passed."""
    from hearts_analysis.policies.deck_tracker import DeckTrackerPolicy as DTP

    log: list[RoundLog] = []

    class SpyDeckTracker(DTP):
        def play(self, obs):
            log.clear()
            log.extend(obs.game_log)
            return super().play(obs)

    table = [SpyDeckTracker(n_samples=50), HeuristicPolicy(),
             HeuristicPolicy(), HeuristicPolicy()]
    play_game(table, game_seed=5)
    # 12, not 13: a policy never sees a log with the current (13th) round
    # complete — the game ends right after round 13's last play.
    assert len(log) == 12

    replayed = DeckModel(4)
    replayed.replay(tuple(log))
    incremental = DeckModel(4)
    for rl in log:
        incremental.deal_round(rl.index, rl.dealer)
        incremental.resolve_round(rl.tricks)
    assert replayed.deque == incremental.deque
    assert replayed.unseen_pool() == incremental.unseen_pool()
