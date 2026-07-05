"""Graded card-counting policies: how much edge does each level of memory
buy, and through which channel (bidding vs play)?

The ladder, from least to most memory:

1. ``HeuristicPolicy`` — remembers nothing (lower bound, not in this module)
2. ``hearts_count`` — only *how many* hearts have been played
3. ``hearts_exact`` — exactly *which* hearts have been played
4. ``high_cards`` — which high cards (off-suit A/K, hearts 9+) have been played
5. ``DeckTrackerPolicy`` — perfect memory of everything (upper bound)

Each level can apply its memory to **play** (within the current round:
promote cards that nothing still unseen can beat), to **bidding** (across
rounds: the never-reshuffled deck means remembering where tracked cards went
partially predicts future deals — a level-filtered ``DeckModel``), or both,
so the two channels can be ablated independently. Tracking a card's position
through the recycled deck only requires remembering *when* it was played
(its offset in the public play sequence), so a hearts-only counter
legitimately knows heart positions without memorizing other cards.

``hearts_count`` carries no *placeable* cross-round information (a count
can't say which seat gets which card), so its bid channel degenerates to the
plain MC bidder — deliberately kept in the grid to show that.
"""

from __future__ import annotations

from collections.abc import Iterable
from math import comb
from typing import Any

from ..cards import NUM_CARDS, TRUMP, beats, is_trump, rank_of, suit_of, winning_play
from ..observation import Observation
from .deck_tracker import DeckTrackerPolicy

HEARTS = frozenset(range(TRUMP * 13, TRUMP * 13 + 13))
HIGH_CARDS = frozenset(
    c for c in range(NUM_CARDS)
    if rank_of(c) >= 13 or (is_trump(c) and rank_of(c) >= 9)
)

#: level -> which cards this level remembers individually (None = count only).
#: ``full`` remembers every card: its bid channel equals DeckTrackerPolicy
#: and its play channel is the sure-winner logic with perfect memory — the
#: ladder's upper bound on both channels.
TRACKED: dict[str, frozenset[int] | None] = {
    "hearts_count": None,
    "hearts_exact": HEARTS,
    "high_cards": HIGH_CARDS,
    "full": frozenset(range(NUM_CARDS)),
}
LEVELS = tuple(TRACKED)


class CountingPolicy(DeckTrackerPolicy):
    """A ``DeckTrackerPolicy`` whose memory is restricted to one counting
    level, applied to the channels named in ``use_for``.

    - ``"bid"`` in ``use_for``: bids via the MC estimator with the deck
      model's foreseen opponent cards *filtered to the tracked set* (else
      bids like ``HeuristicPolicy``).
    - ``"play"`` in ``use_for``: plays ``HeuristicPolicy``'s rules upgraded
      with confident-winner detection: when a trick is wanted, prefer the
      *cheapest* card whose hypergeometric survival probability against the
      yet-to-act opponents' unknown cards is at least ``sure_threshold``
      (memory removes counted-out threats from the pool, raising that
      probability). Otherwise plays plain ``HeuristicPolicy``.
    """

    def __init__(
        self,
        level: str = "hearts_exact",
        use_for: Iterable[str] = ("bid", "play"),
        n_samples: int = 600,
        sure_threshold: float = 0.9,
    ) -> None:
        super().__init__(n_samples=n_samples)
        if level not in TRACKED:
            raise ValueError(f"unknown level {level!r}; expected one of {LEVELS}")
        self.use_for = frozenset(use_for)
        if not self.use_for or not self.use_for <= {"bid", "play"}:
            raise ValueError(f"use_for must be a non-empty subset of {{'bid','play'}}, got {use_for!r}")
        self.level = level
        self.tracked = TRACKED[level]
        self.sure_threshold = sure_threshold
        self.name = f"count:{level}:{'+'.join(sorted(self.use_for))}"
        self.params: dict[str, Any] = {
            "level": level, "use_for": sorted(self.use_for),
            "n_samples": n_samples, "sure_threshold": sure_threshold,
        }

    # ── Bid channel ─────────────────────────────────────────────────────
    def _known_opponents(self, obs: Observation) -> dict[int, tuple[int, ...]]:
        if self.tracked is None:
            return {}
        known = super()._known_opponents(obs)
        filtered = {s: tuple(c for c in cs if c in self.tracked) for s, cs in known.items()}
        return {s: cs for s, cs in filtered.items() if cs}

    def bid(self, obs: Observation) -> int:
        if "bid" in self.use_for:
            return super().bid(obs)
        return self._play_policy.bid(obs)

    # ── Play channel ────────────────────────────────────────────────────
    def play(self, obs: Observation) -> int:
        if "bid" in self.use_for:
            self._sync_deck(obs)  # keep the incremental replay cheap
        if "play" not in self.use_for:
            return self._play_policy.play(obs)
        return self._counting_play(obs)

    def _possible_unseen(self, obs: Observation) -> set[int]:
        """Cards an opponent *might* still hold this round, given this
        level's memory. A conservative superset: everything not in my hand,
        not on the table, and not remembered as already played."""
        visible = set(obs.hand) | {c for _, c in obs.current_trick}
        pool = set(range(NUM_CARDS)) - visible
        past = [c for _, plays in obs.round_tricks for _, c in plays]
        if self.tracked is not None:
            pool -= {c for c in past if c in self.tracked}
        else:  # hearts_count: only the count survives in memory
            hearts_out = 13 - sum(c in HEARTS for c in past) - sum(c in HEARTS for c in visible)
            if hearts_out == 0:
                pool -= HEARTS
        return pool

    def _p_survives(self, c: int, led_suit: int, pool: set[int], m: int) -> float:
        """P(no yet-to-act opponent holds a card that beats ``c``), treating
        the ``m`` unknown cards those opponents hold as a uniform draw from
        ``pool`` (hypergeometric; ignores voids revealed by off-suit plays).
        Memory shrinks ``pool`` — removing counted-out threats is exactly
        what raises this probability."""
        threats = sum(beats(o, c, led_suit) for o in pool)
        if threats == 0:
            return 1.0
        safe = len(pool) - threats
        if m > safe:
            return 0.0
        return comb(safe, m) / comb(len(pool), m)

    def _counting_play(self, obs: Observation) -> int:
        legal = obs.legal_plays
        if len(legal) == 1:
            return legal[0]
        want_trick = obs.my_tricks < (obs.my_bid or 0)
        if not want_trick:
            return self._play_policy.play(obs)  # memory doesn't help ducking here
        pool = self._possible_unseen(obs)
        hand_size = obs.cards_this_round - len(obs.round_tricks)

        if not obs.current_trick:
            # Leading: take the trick with the *cheapest confident* winner
            # instead of burning the strongest card. (A lead's led suit is
            # the card's own suit, so the threat set is per candidate.)
            m = (obs.num_players - 1) * hand_size
            confident = [
                c for c in legal
                if self._p_survives(c, suit_of(c), pool, m) >= self.sure_threshold
            ]
            if confident:
                return min(confident, key=rank_of)
            return self._play_policy.play(obs)

        led = obs.led_suit
        assert led is not None
        _, best_card = winning_play(obs.current_trick, led)
        winners = [c for c in legal if beats(c, best_card, led)]
        if winners and len(obs.current_trick) < obs.num_players - 1:
            # Not last to play: a merely-cheapest winner can be overtaken;
            # prefer the cheapest winner confident against the remaining
            # actors' unknown cards.
            m = (obs.num_players - 1 - len(obs.current_trick)) * hand_size
            confident = [
                c for c in winners
                if self._p_survives(c, led, pool, m) >= self.sure_threshold
            ]
            if confident:
                return min(confident, key=rank_of)
        return self._play_policy.play(obs)
