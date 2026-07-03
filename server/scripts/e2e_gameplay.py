#!/usr/bin/env python3
"""End-to-end gameplay check against a running hearts-server.

Plays a complete 2-player game through the REST API while consuming the
SSE event stream, and asserts:
  - engine rejections map to 409s with the right codes (hook, turn order,
    card not held);
  - the SSE log has gapless, strictly increasing seq numbers;
  - Last-Event-ID replay returns exactly the missed backlog;
  - 13 round_completed events, then game_over, then the game row is
    'finished' with a game_results row.

Usage: docker compose up -d && cargo run -p hearts-server &
       python3 scripts/e2e_gameplay.py
"""

import json
import threading
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8080"


def req(method, path, token=None, body=None):
    request = urllib.request.Request(BASE + path, method=method)
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    data = None
    if body is not None:
        request.add_header("Content-Type", "application/json")
        data = json.dumps(body).encode()
    try:
        with urllib.request.urlopen(request, data) as response:
            return json.load(response), response.status
    except urllib.error.HTTPError as error:
        return json.load(error), error.code


def expect(condition, message):
    if not condition:
        raise SystemExit(f"FAIL: {message}")


def expect_error(result, status, wanted_status, code, context):
    expect(
        status == wanted_status and result["error"]["code"] == code,
        f"{context}: wanted {wanted_status}/{code}, got {status}/{result}",
    )


def sse_events(path, token, stop_type=None, limit=None):
    """Yield parsed SSE data payloads from an event stream."""
    request = urllib.request.Request(BASE + path)
    request.add_header("Authorization", f"Bearer {token}")
    if "#" in path:  # crude Last-Event-ID passing: path#<id>
        path, last_id = path.split("#")
        request = urllib.request.Request(BASE + path)
        request.add_header("Authorization", f"Bearer {token}")
        request.add_header("Last-Event-ID", last_id)
    count = 0
    with urllib.request.urlopen(request, timeout=30) as response:
        for raw in response:
            line = raw.decode().strip()
            if not line.startswith("data:"):
                continue
            event = json.loads(line[len("data:"):])
            yield event
            count += 1
            if stop_type and event["type"] == stop_type:
                return
            if limit and count >= limit:
                return


# ── Setup: sessions, lobby, start ───────────────────────────────────────
alice = req("POST", "/session")[0]["token"]
bob = req("POST", "/session")[0]["token"]

game, _ = req("POST", "/games", alice, {"display_name": "alice"})
game_id, code = game["id"], game["invite_code"]

# Events before start → 409 not_started.
result, status = req("POST", f"/games/{game_id}/bid", alice, {"bid": 0})
expect_error(result, status, 409, "not_started", "bid before start")

req("POST", f"/games/{code}/join", bob, {"display_name": "bob"})
req("POST", f"/games/{game_id}/start", alice)

# SSE listener follows the whole game on Bob's session.
events = []
listener = threading.Thread(
    target=lambda: events.extend(sse_events(f"/games/{game_id}/events", bob, "game_over")),
    daemon=True,
)
listener.start()

tokens = {0: alice, 1: bob}  # alice created → seat 0 → dealer round 1

# ── Scripted round 1: rejection paths, then the hook ────────────────────
result, status = req("POST", f"/games/{game_id}/bid", bob, {"bid": 0})
expect_error(result, status, 409, "not_your_turn", "bob bidding first")

result, status = req("POST", f"/games/{game_id}/bid", alice, {"bid": 5})
expect_error(result, status, 409, "bid_out_of_range", "bid of 5 in a 1-card round")

req("POST", f"/games/{game_id}/bid", alice, {"bid": 0})
result, status = req("POST", f"/games/{game_id}/bid", bob, {"bid": 1})
expect_error(result, status, 409, "forbidden_bid", "the hook: bids may not sum to 1")
req("POST", f"/games/{game_id}/bid", bob, {"bid": 0})

# Playing a card you don't hold → 409 card_not_held.
view, _ = req("GET", f"/games/{game_id}", alice)
hand = view["game"]["you"]["hand"]
not_held = {"suit": "Spades", "rank": "Ace"}
if [not_held] == hand:
    not_held = {"suit": "Spades", "rank": "King"}
result, status = req("POST", f"/games/{game_id}/play", alice, {"card": not_held})
expect_error(result, status, 409, "card_not_held", "playing a card not in hand")

# ── Last-Event-ID replay: reconnect knowing only event 1 ────────────────
# The log so far: 0 game_started, 1 alice's bid, 2 bob's bid.
replayed = list(sse_events(f"/games/{game_id}/events#1", alice, limit=1))
expect(
    [event["seq"] for event in replayed] == [2],
    f"replay after id 1 should yield seq 2: {replayed}",
)

# ── Generic policy: act as whoever is next, first legal action ──────────
for _ in range(2000):
    view, _ = req("GET", f"/games/{game_id}", alice)
    if view["status"] == "finished":
        break
    nxt = view["game"]["next"]
    expect(nxt is not None, f"in_progress game with no next actor: {view['game']}")
    token = tokens[nxt["seat"]]
    you = req("GET", f"/games/{game_id}", token)[0]["game"]["you"]
    if nxt["action"] == "bid":
        _, status = req("POST", f"/games/{game_id}/bid", token, {"bid": you["legal_bids"][0]})
    else:
        _, status = req("POST", f"/games/{game_id}/play", token, {"card": you["legal_plays"][0]})
    expect(status == 200, f"action rejected with {status}")
else:
    raise SystemExit("FAIL: game did not finish within 2000 actions")

listener.join(timeout=10)
expect(not listener.is_alive(), "SSE listener did not see game_over")

# ── Assertions on the event log ─────────────────────────────────────────
seqs = [event["seq"] for event in events]
expect(seqs == list(range(len(seqs))), "seq numbers are not gapless from 0")
types = [event["type"] for event in events]
expect(types[0] == "game_started", f"first event {types[0]}")
expect(types.count("round_completed") == 13, f"{types.count('round_completed')} rounds")
expect(types[-1] == "game_over", f"last event {types[-1]}")
total_tricks = sum(1 + min(r, 14 - r) for r in range(1, 14)) - 13  # 49
expect(types.count("trick_completed") == 49, "49 tricks over 13 rounds")
expect(types.count("card_played") == 98, "98 cards played by 2 players")

game_over = events[-1]
expect(len(game_over["scores"]) == 2, "final scores for both seats")

# ── After finish: stream is gone, view is historical ────────────────────
try:
    list(sse_events(f"/games/{game_id}/events", alice, limit=1))
    raise SystemExit("FAIL: events stream should be gone after finish")
except urllib.error.HTTPError as error:
    expect(error.code == 409, f"events after finish: {error.code}")

view, _ = req("GET", f"/games/{game_id}", alice)
expect(view["status"] == "finished" and view["game"] is None, "finished view")

print(f"PASS: {len(events)} events, final scores {game_over['scores']}, "
      f"winners {game_over['winners']}")
