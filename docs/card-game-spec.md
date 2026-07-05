# Card Game — Backend Specification

> A trick-taking, relative-bidding card game (in the *Oh Hell / Oh Pshaw* family) with two
> distinctive twists: **hearts are permanent trump**, and the **deck is never reshuffled** —
> played cards return to the bottom in order, so card distribution is deterministic across rounds.

This document is the source of truth for implementing the game engine. Anything marked
**[DECISION]** is a rule the engine must fix but that the game's inventor has not pinned down;
defaults are proposed so the backend is fully specified, but confirm them before launch.

---

## 1. Glossary

| Term | Meaning |
|------|---------|
| **Showdown / Trick** | One cycle in which every player plays exactly one card; one player wins it. Used interchangeably. |
| **Round** | A full deal: bidding, then `cards_dealt` showdowns, then scoring. |
| **Bridge round** | The round in which 7 cards are dealt (round 7). Purely a name; no special rule. |
| **Bid / Guess** | A player's prediction of how many tricks they will win that round. |
| **Hook** | The constraint that the last bidder may not make total bids equal the number of tricks. |
| **Trump** | Hearts. A heart beats any non-heart regardless of rank. |
| **Led suit** | The suit of the first card played in a showdown. |

---

## 2. Components

### 2.1 Deck
- Standard **52-card** deck. Four suits: clubs (♣), diamonds (♦), spades (♠), hearts (♥).
- Ranks, low → high: `2 3 4 5 6 7 8 9 10 J Q K A` (**ace high**).
- No jokers.
- **Hearts are permanent trump.**
- The deck is modeled as an **ordered queue**: deal from the **top**, return spent cards to the **bottom**. It is shuffled **exactly once**, at game start, and never again.
- Invariant: between rounds the deck always holds all 52 cards (every dealt card is returned each round).

### 2.2 Players
- `2` to `7` players. (At the bridge round, `7 cards × 7 players = 49 ≤ 52`, so 7 is the hard max.)
- Seated in a fixed cyclic order (treat as clockwise). All rotation — dealing, bidding, play — follows this order.

---

## 3. Game Structure

The game is **13 rounds**. Cards dealt per player climb to 7, then descend:

| Round  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13 |
|--------|---|---|---|---|---|---|---|---|---|----|----|----|----|
| Cards  | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 6 | 5 | 4  | 3  | 2  | 1  |
| Note   |   |   |   |   |   |   |**bridge**|   |   |    |    |    |    |

- For any round, **number of showdowns = number of tricks = cards dealt**.
- `cards(r)`: `r ≤ 7 → r`; `r > 7 → 14 − r`.

---

## 4. The Deck & Determinism (read carefully — this is the unusual part)

Because the deck is never reshuffled, the engine must be **deterministic** about two procedures.
Both are **[DECISION]** points; the proposed defaults are internally consistent and simple.

### 4.1 Dealing — [DECISION]
**Proposed default:** deal one card at a time, starting with the player to the dealer's left,
proceeding in seat order, repeating until each player has `cards(r)` cards. Cards come off the
**top** of the deck.

> This matters: with a fixed deck order, "one at a time around the table" vs. "whole hand to each
> player in turn" produces different hands. Confirm which the inventor uses.

### 4.2 Returning cards — [DECISION]
**Proposed default:** after the round, append cards to the bottom of the deck **trick by trick in
the order tricks were completed**, and within each trick **in the order they were played** (starting
from that trick's leader).

> The collection order fully determines future deals, so it must be fixed and reproducible.

### 4.3 First dealer — [DECISION]
**Proposed default:** chosen randomly at game start (or by table convention). After round 1 the
dealer is determined by round scoring (§7).

---

## 5. Round Lifecycle

Each round runs through four phases in order: **Deal → Bid → Play → Score**.

### 5.1 Deal
Deal `cards(r)` cards to each player per §4.1. The remaining deck stays face-down and is **not**
used this round (no separate trump card is flipped — trump is always hearts).

### 5.2 Bidding

- **Order:** the **dealer bids first**, then proceeds in seat order. The **last player to bid** is
  the player reached last in the rotation (the one seated immediately before the dealer).
- **Range:** each bid is an integer in `[0, cards(r)]`.
- **The Hook (last bidder only):** the last bidder may not choose a bid that makes the sum of all
  bids equal `cards(r)`. Only this final player is constrained; everyone else bids freely.

```
forbidden = cards(r) - sum(previous_bids)
if 0 <= forbidden <= cards(r):
    last bidder may pick any v in [0, cards(r)] with v != forbidden
else:
    last bidder is unconstrained over [0, cards(r)]
```

Consequence: the total of all bids can never equal the number of tricks, so at least one player is
guaranteed to miss every round.

**Examples (round 5, `cards = 5`, players A=dealer..D):**
- A=2, B=3, C=0 → previous sum 5 → `forbidden = 0` → D may bid 1–5 (not 0).
- A=2, B=1, C=1 → previous sum 4 → `forbidden = 1` → D may bid 0,2,3,4,5 (not 1).
- A=4, B=4, C=4 → previous sum 12 → `forbidden = -7` → out of range → D bids freely 0–5.

### 5.3 Play (showdowns)

- **First showdown:** the **dealer leads** (plays the first card).
- **Subsequent showdowns:** the **winner of the previous showdown leads**.
- **Following suit:** a player **must** play a card of the led suit if they hold one. If void in the
  led suit, they may play **any** card (a heart/trump, or any off-suit card).
- **Leading hearts:** permitted at any time. *(No "trump must be broken" restriction — **[DECISION]**, confirm.)*

**Winner of a showdown:**

```
function showdown_winner(plays, led_suit):
    hearts = plays where card.suit == HEARTS
    if hearts is non-empty:
        return play with the highest-ranked heart
    else:
        led = plays where card.suit == led_suit   # always non-empty: the lead is in led_suit
        return play with the highest-ranked card of led_suit
```

- Any heart beats any non-heart. Among multiple hearts, highest rank wins.
- With no hearts, the highest card of the led suit wins.
- Off-suit, non-heart cards can never win.
- A winner always exists: the leader's own card is in the led suit, so the led set is never empty.

The winner of each showdown takes the trick (increment their `tricks_won` for the round) and leads the next one.

### 5.4 Scoring (per player, at round end)

Let `b` = bid, `t` = tricks won.

```
if b == t:  delta = t + 1      # made the bid: tricks plus a 1-point bonus
else:       delta = -abs(b - t)  # missed: lose the gap, in either direction
```

- Exact bid of 0 made → `delta = +1`.
- Bid 2, won 2 → `+3`. Bid 2, won 1 → `-1`. Bid 2, won 3 → `-1`.
- Scores are cumulative across rounds and **may go negative**.

### 5.5 Round resolution

1. Add each player's `delta` to their cumulative score.
2. **Next dealer** = the player with the **most points scored in this round** (highest `delta`).
   - **[DECISION] Tie-break:** if multiple players tie for the highest round delta, default to the
     tied player who comes first in seat order starting from the current dealer's left. Confirm.
3. Return all played cards to the bottom of the deck per §4.2.
4. Advance to the next round, or end the game after round 13.

---

## 6. Game End & Winner

- The game ends after **round 13** (the final 1-card round).
- **Winner:** highest cumulative score.
- **[DECISION] Tie-break for overall winner:** unspecified — e.g., most rounds with an exact bid, or
  a shared win. Confirm.

---

## 7. Suggested Data Model

```
Game
  id
  players: [Player]            # fixed seat order
  deck: [Card]                 # ordered queue (top = index 0)
  round_index: int             # 1..13
  dealer_seat: int
  phase: enum                  # see §8
  rng_seed                     # for reproducible shuffles/tests

Player
  id
  seat: int
  cumulative_score: int

Round
  index: int
  cards_dealt: int             # = cards(round_index)
  dealer_seat: int
  hands: { seat: [Card] }
  bids: { seat: int }
  bid_order: [seat]            # dealer first
  tricks: [Trick]
  tricks_won: { seat: int }
  deltas: { seat: int }

Trick
  leader_seat: int
  led_suit: Suit | null        # set when first card is played
  plays: [{ seat, card }]      # in play order
  winner_seat: int | null

Card
  suit: enum {CLUBS, DIAMONDS, SPADES, HEARTS}
  rank: int                    # 2..14 (J=11, Q=12, K=13, A=14)
```

---

## 8. State Machine

```
                 ┌─────────────┐
   game start →  │   DEALING   │
                 └──────┬──────┘
                        ▼
                 ┌─────────────┐
                 │   BIDDING   │  (dealer first → … → last bidder w/ hook)
                 └──────┬──────┘
                        ▼
                 ┌─────────────┐
            ┌──▶ │   PLAYING   │  (one trick; repeat cards_dealt times)
            │    └──────┬──────┘
   more tricks         ▼
   this round?  ──── trick resolved ──── no ──┐
            ▲                                  ▼
            └── yes ──────────────      ┌─────────────┐
                                        │   SCORING   │
                                        └──────┬──────┘
                                               ▼
                                   more rounds? ── yes ─▶ DEALING (next round)
                                               │
                                               no
                                               ▼
                                        ┌─────────────┐
                                        │  GAME_OVER  │
                                        └─────────────┘
```

Transition guards:
- `DEALING → BIDDING`: every player has `cards_dealt` cards.
- `BIDDING → PLAYING`: every player has submitted a valid bid (hook satisfied for the last bidder).
- `PLAYING → PLAYING`: a trick completed and `tricks_played < cards_dealt`.
- `PLAYING → SCORING`: `tricks_played == cards_dealt`.
- `SCORING → DEALING`: `round_index < 13`.
- `SCORING → GAME_OVER`: `round_index == 13`.

---

## 9. Server-Side Validation Rules

Reject (don't trust the client on) any action that violates these:

**Bidding**
1. It is this player's turn to bid (correct position in `bid_order`).
2. Bid is an integer in `[0, cards_dealt]`.
3. If this is the last bidder and `forbidden` is in range, bid `!= forbidden`.

**Playing a card**
4. It is this player's turn (correct position relative to the trick leader).
5. The player actually holds the card.
6. If the played card's suit `!= led_suit`, the player holds **no** card of `led_suit` (follow-suit enforced). The leader sets `led_suit` freely.

**General**
7. The action matches the current `phase`.

---

## 10. Edge Cases

- **1-card rounds (1 and 13):** exactly one showdown. Bidding still applies the hook (e.g., 2 players, 1 card: if the dealer bids 0, the last bidder may not bid 1).
- **Hearts led:** `led_suit = HEARTS`; the hearts branch of `showdown_winner` handles it (highest heart wins). Players must follow with hearts if able.
- **Everyone void but the leader:** others may dump any card; only hearts among them can beat the lead, otherwise the lead wins.
- **All non-heart, off-suit plays:** impossible to have zero led-suit cards, since the lead itself is the led suit — a winner always exists.
- **Negative cumulative scores:** allowed; do not clamp at zero.
- **Tie for highest round delta:** see §5.5 [DECISION].
- **Max table:** 7 players × 7 cards = 49 cards dealt at the bridge; 3 cards remain undealt that round.

---

## 11. Worked Example (round 5, 4 players, `cards = 5`)

1. **Deal:** A (dealer), B, C, D each receive 5 cards (one at a time, B first, per §4.1 default).
2. **Bid:** A=2, B=1, C=1 → previous sum 4 → `forbidden = 1` → D may not bid 1; D bids 2.
   Total bids = 6 ≠ 5 ✓. (Someone will miss.)
3. **Play:** A leads showdown 1. Suppose A leads ♠10; B plays ♠K; C is void in spades and plays ♥3;
   D plays ♠2. A heart was played → highest heart wins → **C wins** with ♥3 and leads showdown 2.
   …repeat for 5 showdowns. Suppose final `tricks_won`: A=2, B=1, C=1, D=1 (sums to 5 ✓).
4. **Score:**
   - A: bid 2, won 2 → **+3**
   - B: bid 1, won 1 → **+2**
   - C: bid 1, won 1 → **+2**
   - D: bid 2, won 1 → **−1**
5. **Resolve:** A has the highest round delta (+3) → **A deals next round (round 6, 6 cards)**.
   Collect the round's cards to the deck bottom (§4.2) and continue.

---

## 12. Open Questions to Confirm With the Inventor

| # | Topic | Default assumed | §  |
|---|-------|-----------------|----|
| 1 | Dealing procedure (one-at-a-time vs. whole-hand) | one card at a time, dealer's left first | 4.1 |
| 2 | Card-collection order returned to deck | trick order, then play order within trick | 4.2 |
| 3 | First dealer of the game | random | 4.3 |
| 4 | Can hearts be led before being "broken"? | yes, no restriction | 5.3 |
| 5 | Tie-break for next dealer (round delta tie) | first in seat order from dealer's left | 5.5 |
| 6 | Tie-break for overall winner | unspecified | 6 |

Lock these down and the rules above are complete and deterministic — ready to implement.
