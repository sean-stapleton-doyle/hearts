# Python bindings for `hearts-core` via PyO3

## Context

`hearts-core` is a pure Rust domain model (no I/O, no async, serde behind a feature
flag). Its own lib docstring anticipates being "wrapped by ... language bindings
(e.g. PyO3) without modification." We want to drive the exact same game engine from
Python so we can do statistical / probabilistic analysis of the game — and, later,
train and run an AI bot — without reimplementing the rules in Python (and risking
divergence from the authoritative Rust engine).

Goal: an importable `pyhearts` package exposing the core types and the `Game`
driver loop, deterministic per seed, with JSON snapshotting and typed stubs for
notebook/IDE ergonomics.

## Decisions

- **Layout:** new `crates/hearts-py` crate depending on `hearts-core`. `hearts-core`
  stays pure — no PyO3 dependency added to it.
- **Python package name:** `pyhearts` (`import pyhearts`).
- **Type stubs:** ship hand-written `.pyi` + `py.typed`.
- **Build tool:** `maturin` (standard for PyO3), abi3 wheels.

## New crate layout

```
crates/hearts-py/
  Cargo.toml
  pyproject.toml
  src/
    lib.rs        # #[pymodule] fn pyhearts — registers classes/enums/functions
    card.rs       # Suit, Rank, Card wrappers
    game.rs       # Game, Phase, PlayOutcome, RoundResult wrappers
    round.rs      # Seat, Deck, Trick, Round wrappers
    error.rs      # GameError -> Python exception mapping
  pyhearts.pyi    # hand-written stubs — named after the module; maturin
                  # auto-detects this and installs it as __init__.pyi inside
                  # the package (an explicitly `include`d file would instead
                  # land at the wheel root)
  py.typed        # PEP 561 marker
  tests/
    test_pyhearts.py
```

Add `crates/hearts-py` to `members` in the workspace `Cargo.toml`. It builds as
a `cdylib` and is not pulled in by the server/cli builds.

## Cargo / build config

`crates/hearts-py/Cargo.toml`:
- `[lib] name = "pyhearts"`, `crate-type = ["cdylib"]`.
- `hearts-core = { workspace = true, features = ["serde"] }` — enables JSON methods.
- `serde_json = { workspace = true }` for `to_json`/`from_json`.
- `pyo3 = { version = "<latest 0.2x>", features = ["extension-module", "abi3-py39"] }`.
  abi3 → one wheel across Python 3.9+. (Workspace is edition 2024 / resolver 3, which
  needs a recent Rust + recent PyO3 — pin the newest 0.2x at implementation time.)
  `extension-module` leaves Python symbols unresolved at link time (normally
  satisfied by the interpreter's dynamic loader on import) — correct for the
  wheel, but it means a plain `cargo build`/`cargo test` at the workspace root
  needs the linker to tolerate those unresolved symbols too. `build.rs` passes
  `-Wl,-undefined,dynamic_lookup` on macOS for this (Linux's default linker
  already tolerates undefined symbols in a `cdylib`). The crate has no unit
  tests, so those symbols are never actually called by `cargo test`.

`crates/hearts-py/pyproject.toml`:
- `[build-system] requires = ["maturin>=1"]`, `build-backend = "maturin"`.
- `[project] name = "pyhearts"`.
- `[tool.maturin]` — module name `pyhearts`; include `pyhearts.pyi` and `py.typed`
  so they land beside the compiled extension in the wheel.

## Binding design

Two patterns, chosen per Rust type:

**Newtype wrappers** (hold the inner core value) — for structs and the driver:
`Seat`, `Card`, `Deck`, `Trick`, `Round`, `Game`, `RoundResult`. Each is
`#[pyclass]` holding `hearts_core::T`, with getters that **clone borrowed slices
into owned Python lists** (`hand`, `bids`, `scores`, `history`, `tricks`, `plays`,
`deck.iter`).

**Mirrored PyO3 enums** (orphan rule blocks `#[pyclass]` on foreign enums) — define
a local enum mirroring the core one plus `From` conversions both directions:
- `Suit`, `Rank`, `Phase` → simple `#[pyclass(eq, eq_int)]` enums. `Rank`
  discriminants match core (`Two = 2 .. Ace = 14`).
- `PlayOutcome` → PyO3 **complex enum** so variants surface as
  `PlayOutcome.TrickComplete { winner }`, `PlayOutcome.RoundComplete { deltas }`, etc.

### Type-by-type surface

- **`Suit`** — enum (`Clubs/Diamonds/Spades/Hearts`); `is_trump()`; `ALL` as classattr.
- **`Rank`** — enum `Two..Ace`; `.value` (2..14); `ALL`.
- **`Card`** — `Card(suit, rank)`, `.suit`, `.rank`, `beats(other, led_suit)`,
  `__repr__`/`__str__` (e.g. `A♥`), `__eq__`, `__hash__`.
- **`Seat`** — `Seat(index: int)`, `.index`, `next(num_players)`,
  `offset(by, num_players)`, ordering, `__hash__`, `__repr__`. Game/Round methods
  accept a `Seat`.
- **`Deck`** — `Deck.standard()`, `Deck.shuffled(seed)`, `len()`/`__len__`,
  `is_empty()`, `cards() -> list[Card]`.
- **`Trick`** — read-only (`new`/`add_play` are `pub(crate)`): `.leader`,
  `led_suit()`, `plays() -> list[tuple[Seat, Card]]`, `next_seat()`, `is_complete()`,
  `winning_play()`, `winner()`.
- **`Round`** — `Round(index, dealer, hands)` (core `new` is public, validates hands →
  raises on error) for setting up arbitrary positions; plus all accessors:
  `index`, `cards_dealt`, `dealer`, `num_players`, `hand(seat)`, `bids()`,
  `next_bidder()`, `bidding_complete()`, `forbidden_bid()`, `legal_bids()`,
  `place_bid(seat, bid)`, `tricks()`, `current_trick()`, `next_player()`,
  `legal_plays(seat)`, `is_complete()`, `tricks_won(seat)`, `deltas()`.
- **`Game`** (main entry) — `Game(num_players, seed)`,
  `Game.with_first_dealer(num_players, seed, first_dealer)`; `num_players`, `seed`,
  `deck()`, `round_index`, `dealer`, `scores()`, `round()`, `history()`, `phase()`,
  `winners()`, `place_bid(seat, bid)`, `play_card(seat, card) -> PlayOutcome`;
  plus `to_json() -> str` and `Game.from_json(str) -> Game` (serde_json).
- **`RoundResult`** — getters for the public fields `index`, `dealer`, `bids`,
  `tricks_won`, `deltas`.
- **Module-level** — constants `MIN_PLAYERS`, `MAX_PLAYERS`, `NUM_ROUNDS`;
  functions `score_delta(bid, tricks)` and `cards_for_round(round_index)` —
  **`cards_for_round` must validate `1..=13` and raise `ValueError`** rather than let
  the core `panic!` cross the FFI boundary.

### Error handling

Define a Python exception `pyhearts.GameError` via PyO3's `create_exception!`, and
`impl From<hearts_core::GameError> for PyErr` using the core `Display` impl for the
message. Every wrapped fallible method uses `?` so refused actions raise
`GameError` in Python. Panic-capable inputs (`cards_for_round`) are guarded to raise
`ValueError` instead.

## Example usage (Python)

```python
import pyhearts

game = pyhearts.Game(num_players=4, seed=1)
while game.phase() != pyhearts.Phase.GameOver:
    rnd = game.round()
    if game.phase() == pyhearts.Phase.Bidding:
        seat = rnd.next_bidder()
        game.place_bid(seat, rnd.legal_bids()[0])
    else:  # Playing
        seat = rnd.next_player()
        game.play_card(seat, rnd.legal_plays(seat)[0])

print("winners:", game.winners())
print("scores:", game.scores())

# Snapshot / restore
blob = game.to_json()
restored = pyhearts.Game.from_json(blob)
```

## Files to create / modify

- **Modify** the workspace `Cargo.toml` — add `crates/hearts-py` to `members`.
- **Create** the `crates/hearts-py/` tree above (Cargo.toml, pyproject.toml,
  `src/*.rs`, `pyhearts.pyi`, `py.typed`, `tests/test_pyhearts.py`).

Reuse: no new game logic is written — every method delegates to existing
`hearts-core` functions (`Game::new`, `Game::place_bid`, `Game::play_card`,
`Round::legal_plays`, `Deck::shuffled`, etc.). The bindings are a thin, cloning
translation layer only.

## Verification

1. **Rust builds:** `cargo build -p hearts-py` from the repo root (confirms cdylib +
   PyO3 link). `cargo build` for the whole workspace still succeeds.
2. **Python build & import:** in a venv, `cd crates/hearts-py && maturin develop`,
   then `python -c "import pyhearts; print(pyhearts.Game(4, 1).phase())"`.
3. **`tests/test_pyhearts.py`** (run with `pytest`) mirrors the canonical Rust driver
   loop and asserts:
   - A full 4-player game plays to `Phase.GameOver` using `next_bidder`/`legal_bids`
     and `next_player`/`legal_plays`; `winners()` is non-empty.
   - **Determinism:** two games with the same seed + same actions produce equal
     `scores()` / `to_json()`.
   - **JSON round-trip:** `Game.from_json(g.to_json())` reproduces state and is still
     playable.
   - **Errors:** an illegal action (e.g. wrong seat, or a card not in hand) raises
     `pyhearts.GameError`; `cards_for_round(0)` raises `ValueError`.
   - **Stubs:** `pyhearts.pyi` covers every exported symbol (spot-check with an
     import + `dir()` diff).
4. Cross-check parity against `crates/hearts-core/tests/full_game.rs` and
   `serde_roundtrip.rs` — the Python results should match the Rust engine's.
5. Per `CLAUDE.md`, run `graphify update .` after adding the Rust source files.
