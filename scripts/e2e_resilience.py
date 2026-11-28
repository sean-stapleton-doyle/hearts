#!/usr/bin/env python3
"""Resilience checks: turn timeouts, lobby expiry, snapshot recovery.

Subcommands (orchestrated from the shell, with server restarts between):

  timeouts      needs TURN_TIMEOUT_SECS=2 on the server. Verifies a slow
                player is auto-acted for (auto: true), then that a game
                where everyone idles is abandoned.
  lobby-expiry  needs LOBBY_EXPIRY_SECS<=5. Verifies an idle lobby is
                abandoned within ~expiry + sweep interval.
  setup         (default timeouts) plays a game into round 3 and saves
                tokens/game id to /tmp/hearts_e2e_state.json.
  resume        after a server restart: verifies the game came back at
                round 3's bidding phase, then plays it to completion.
"""

import json
import sys
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8080"
STATE_FILE = "/tmp/hearts_e2e_state.json"


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


def first_sse_event(path, token, timeout=10):
    request = urllib.request.Request(BASE + path)
    request.add_header("Authorization", f"Bearer {token}")
    with urllib.request.urlopen(request, timeout=timeout) as response:
        for raw in response:
            line = raw.decode().strip()
            if line.startswith("data:"):
                return json.loads(line[len("data:"):])
    return None


def new_started_game():
    alice = req("POST", "/session")[0]["token"]
    bob = req("POST", "/session")[0]["token"]
    game, _ = req("POST", "/games", alice, {"display_name": "alice"})
    req("POST", f"/games/{game['invite_code']}/join", bob, {"display_name": "bob"})
    req("POST", f"/games/{game['id']}/start", alice)
    return game["id"], {0: alice, 1: bob}


def act_once(game_id, tokens, as_seat=None):
    """Perform the next pending action (optionally only if it's as_seat's)."""
    view, _ = req("GET", f"/games/{game_id}", tokens[0])
    if view["status"] != "in_progress":
        return view, False
    # A completed round holds the table until the host (seat 0, alice in
    # new_started_game) acknowledges it; until then every bid/play 409s with
    # round_pending_ack. Acknowledging is the host's move.
    if view["game"]["pending_ack"] is not None:
        if as_seat not in (None, 0):
            return view, False
        req("POST", f"/games/{game_id}/continue", tokens[0])
        return view, True
    nxt = view["game"]["next"]
    if nxt is None or (as_seat is not None and nxt["seat"] != as_seat):
        return view, False
    token = tokens[nxt["seat"]]
    you = req("GET", f"/games/{game_id}", token)[0]["game"]["you"]
    if nxt["action"] == "bid":
        req("POST", f"/games/{game_id}/bid", token, {"bid": you["legal_bids"][0]})
    else:
        req("POST", f"/games/{game_id}/play", token, {"card": you["legal_plays"][0]})
    return view, True


def cmd_timeouts():
    # Part 1: alice acts, bob idles → server auto-acts for bob, game moves on.
    game_id, tokens = new_started_game()
    saw_auto_for_bob = False
    deadline = time.time() + 30
    actions = 0
    while time.time() < deadline and actions < 6:
        view, acted = act_once(game_id, tokens, as_seat=0)
        if acted:
            actions += 1
        if view["status"] != "in_progress":
            break
        away = view["game"]["away"]
        if away == [False, True]:
            saw_auto_for_bob = True
        if view["game"]["next"] and view["game"]["next"]["seat"] == 1:
            time.sleep(1)  # bob's turn: let the sweeper handle it
    expect(saw_auto_for_bob, "bob never marked away while alice stayed active")
    view, _ = req("GET", f"/games/{game_id}", tokens[0])
    expect(view["status"] == "in_progress", "game should continue with one active player")

    # Part 2: a fresh game where nobody acts → both away → abandoned.
    game_id, tokens = new_started_game()
    deadline = time.time() + 30
    while time.time() < deadline:
        view, _ = req("GET", f"/games/{game_id}", tokens[0])
        if view["status"] == "abandoned":
            break
        time.sleep(1)
    expect(view["status"] == "abandoned", f"idle game not abandoned: {view['status']}")
    print("PASS: timeouts (auto-act keeps game alive; full idle abandons)")


def cmd_lobby_expiry():
    alice = req("POST", "/session")[0]["token"]
    game, _ = req("POST", "/games", alice, {"display_name": "alice"})
    deadline = time.time() + 30
    status = "lobby"
    while time.time() < deadline:
        view, _ = req("GET", f"/games/{game['id']}", alice)
        status = view["status"]
        if status == "abandoned":
            break
        time.sleep(2)
    expect(status == "abandoned", f"idle lobby not expired: {status}")
    print("PASS: lobby expiry")


def cmd_setup():
    game_id, tokens = new_started_game()
    # Play until round 3 begins, then one bid into it (which recovery loses).
    for _ in range(200):
        view, _ = req("GET", f"/games/{game_id}", tokens[0])
        if view["game"]["round_index"] == 3:
            break
        act_once(game_id, tokens)
    else:
        raise SystemExit("FAIL: never reached round 3")
    act_once(game_id, tokens)  # one round-3 bid, to be discarded by recovery
    with open(STATE_FILE, "w") as handle:
        json.dump({"game_id": game_id, "tokens": tokens}, handle)
    print(f"PASS: setup — game {game_id} parked in round 3 with one bid placed")


def cmd_resume():
    with open(STATE_FILE) as handle:
        saved = json.load(handle)
    game_id = saved["game_id"]
    tokens = {int(seat): token for seat, token in saved["tokens"].items()}

    view, status = req("GET", f"/games/{game_id}", tokens[0])
    expect(status == 200, f"view after restart: {status}")
    expect(view["status"] == "in_progress", f"status after restart: {view['status']}")
    game = view["game"]
    expect(game["round_index"] == 3, f"resumed at round {game['round_index']}, wanted 3")
    expect(game["phase"] == "Bidding", f"resumed in {game['phase']}, wanted Bidding")
    bids = game["round"]["bids"]
    expect(bids == [None, None], f"round-3 bids should be reset, got {bids}")
    expect(len(game["you"]["hand"]) == 3, "3 cards in hand in round 3")

    event = first_sse_event(f"/games/{game_id}/events", tokens[0])
    expect(event["type"] == "game_resumed" and event["seq"] == 0,
           f"log should open with game_resumed/0: {event}")

    for _ in range(2000):
        view, acted = act_once(game_id, tokens)
        if view["status"] == "finished":
            break
    expect(view["status"] == "finished", f"game did not finish: {view['status']}")
    print("PASS: resume — recovered at round 3 and played to completion")


if __name__ == "__main__":
    commands = {
        "timeouts": cmd_timeouts,
        "lobby-expiry": cmd_lobby_expiry,
        "setup": cmd_setup,
        "resume": cmd_resume,
    }
    if len(sys.argv) != 2 or sys.argv[1] not in commands:
        raise SystemExit(f"usage: {sys.argv[0]} {{{'|'.join(commands)}}}")
    commands[sys.argv[1]]()
