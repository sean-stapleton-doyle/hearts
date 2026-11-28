#!/usr/bin/env python3
"""End-to-end account + history checks against a running hearts-server.

Covers: register/login/logout lifecycle and validation, the anonymous →
account backfill, /me/games history with results, and the snapshots
endpoint (participants only, finished games only).
"""

import json
import random
import secrets
import string
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


def session():
    return req("POST", "/session")[0]["token"]


def play_out(game_id, tokens):
    for _ in range(2000):
        view, _ = req("GET", f"/games/{game_id}", tokens[0])
        if view["status"] != "in_progress":
            return view
        # A completed round holds the table open until the host (seat 0,
        # per this suite's games) acknowledges it — otherwise every
        # bid/play 409s with round_pending_ack.
        if view["game"]["pending_ack"] is not None:
            req("POST", f"/games/{game_id}/continue", tokens[0])
            continue
        nxt = view["game"]["next"]
        token = tokens[nxt["seat"]]
        you = req("GET", f"/games/{game_id}", token)[0]["game"]["you"]
        if nxt["action"] == "bid":
            req("POST", f"/games/{game_id}/bid", token, {"bid": you["legal_bids"][0]})
        else:
            req("POST", f"/games/{game_id}/play", token, {"card": you["legal_plays"][0]})
    raise SystemExit("FAIL: game did not finish")


suffix = "".join(random.choices(string.ascii_lowercase + string.digits, k=8))
username = f"sean-{suffix}"
# Generated per run rather than a literal, so no credential-shaped string
# lives in the repo. The deliberately bad inputs below ("short",
# "wrong-password") stay literal: they're what's under test.
password = secrets.token_urlsafe(16)

# ── Register / login lifecycle ──────────────────────────────────────────
alice = session()

result, status = req("POST", "/account/register", alice,
                     {"username": "x", "password": password})
expect_error(result, status, 400, "invalid_username", "short username")
result, status = req("POST", "/account/register", alice,
                     {"username": username, "password": "short"})
expect_error(result, status, 400, "invalid_password", "short password")

result, status = req("POST", "/account/register", alice,
                     {"username": username.upper(), "password": password})
expect(status == 201, f"register: {status}/{result}")
expect(result["username"] == username, "username normalized to lowercase")
user_id = result["user_id"]
# Register rotates the session token — the one used to make this call is
# dead the moment it returns; everything from here on must use the new one.
alice = result["token"]

me, status = req("GET", "/me", alice)
expect(status == 200 and me["username"] == username, f"/me after register: {me}")

result, status = req("POST", "/account/register", alice,
                     {"username": f"other-{suffix}", "password": password})
expect_error(result, status, 409, "already_logged_in", "second register on session")

other = session()
result, status = req("POST", "/account/register", other,
                     {"username": username, "password": password})
expect_error(result, status, 409, "username_taken", "duplicate username")

req("POST", "/account/logout", alice)
_, status = req("GET", "/me", alice)
expect(status == 401, "me after logout should be 401")

result, status = req("POST", "/account/login", alice,
                     {"username": username, "password": "wrong-password"})
expect_error(result, status, 401, "invalid_credentials", "wrong password")
result, status = req("POST", "/account/login", alice,
                     {"username": f"ghost-{suffix}", "password": "wrong-password"})
expect_error(result, status, 401, "invalid_credentials", "unknown user")

result, status = req("POST", "/account/login", alice,
                     {"username": username, "password": password})
expect(status == 200 and result["user_id"] == user_id, f"login: {result}")
alice = result["token"]  # login also rotates

# ── A finished game while logged in → history with result ───────────────
bob = session()  # stays anonymous
game, _ = req("POST", "/games", alice, {"display_name": "alice"})
req("POST", f"/games/{game['invite_code']}/join", bob, {"display_name": "bob"})

# Display names are unique (case-insensitively) within a game; rejoining
# under your own name stays idempotent.
eve = session()
result, status = req("POST", f"/games/{game['invite_code']}/join", eve, {"display_name": "BOB"})
expect_error(result, status, 409, "name_taken", "duplicate display name")
_, status = req("POST", f"/games/{game['invite_code']}/join", bob, {"display_name": "bob"})
expect(status == 200, f"rejoin with own name: {status}")

req("POST", f"/games/{game['id']}/start", alice)

# Snapshots while in progress → 409 even for a participant.
result, status = req("GET", f"/games/{game['id']}/snapshots", alice)
expect_error(result, status, 409, "snapshots_unavailable", "snapshots mid-game")

play_out(game["id"], {0: alice, 1: bob})

history, _ = req("GET", "/me/games", alice)
entry = next(g for g in history["games"] if g["id"] == game["id"])
expect(entry["status"] == "finished", f"history status: {entry['status']}")
expect(entry["created_by_you"] is True, "created_by_you")
expect(entry["your_seat"] == 0, f"your_seat: {entry['your_seat']}")
expect(entry["players"] == ["alice", "bob"], f"players: {entry['players']}")
expect(entry["result"] is not None and len(entry["result"]["scores"]) == 2, "result present")

# ── Aggregate stats over the account's single finished game ─────────────
_, status = req("GET", "/me/stats", bob)
expect(status == 401, "stats for anonymous session should be 401")
stats, status = req("GET", "/me/stats", alice)
expect(status == 200, f"/me/stats: {status}/{stats}")
score = entry["result"]["scores"][0]
won = 0 in entry["result"]["winner_seats"]
expect(stats["games_played"] == 1 and stats["games_finished"] == 1,
       f"stats counts: {stats}")
expect(stats["wins"] == (1 if won else 0), f"stats wins: {stats}")
expect(stats["average_score"] == score and stats["best_score"] == score,
       f"stats scores: {stats}")

# ── Snapshots: finished game, participants only ─────────────────────────
snaps, status = req("GET", f"/games/{game['id']}/snapshots", alice)
expect(status == 200, f"snapshots for creator: {status}")
indexes = [s["round_index"] for s in snaps["snapshots"]]
expect(indexes == list(range(1, 15)), f"snapshot indexes: {indexes}")
final_state = snaps["snapshots"][-1]["state"]
expect(len(final_state["history"]) == 13, "final snapshot embeds 13-round history")

snaps, status = req("GET", f"/games/{game['id']}/snapshots", bob)
expect(status == 200, "anonymous participant can read snapshots")
_, status = req("GET", f"/games/{game['id']}/snapshots", other)
expect(status == 404, "non-participant gets 404")

# ── Backfill: anonymous game claimed on login ───────────────────────────
carol = session()
dave = session()
game2, _ = req("POST", "/games", carol, {"display_name": "carol"})
req("POST", f"/games/{game2['invite_code']}/join", dave, {"display_name": "dave"})
req("POST", f"/games/{game2['id']}/start", carol)
play_out(game2["id"], {0: carol, 1: dave})

carol_name = f"carol-{suffix}"
result, _ = req("POST", "/account/register", carol, {"username": carol_name, "password": password})
carol = result["token"]
history, _ = req("GET", "/me/games", carol)
entry = next((g for g in history["games"] if g["id"] == game2["id"]), None)
expect(entry is not None, "anonymous game claimed by registration")
expect(entry["created_by_you"] is True and entry["your_seat"] == 0, f"backfill: {entry}")

print(f"PASS: accounts + history ({username}, {len(history['games'])} games in history)")
