#!/usr/bin/env python3
"""End-to-end account + history checks against a running hearts-server.

Covers: register/login/logout lifecycle and validation, the anonymous →
account backfill, /me/games history with results, and the snapshots
endpoint (participants only, finished games only).
"""

import json
import random
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

# ── Register / login lifecycle ──────────────────────────────────────────
alice = session()

result, status = req("POST", "/account/register", alice,
                     {"username": "x", "password": "longenough"})
expect_error(result, status, 400, "invalid_username", "short username")
result, status = req("POST", "/account/register", alice,
                     {"username": username, "password": "short"})
expect_error(result, status, 400, "invalid_password", "short password")

result, status = req("POST", "/account/register", alice,
                     {"username": username.upper(), "password": "hunter2hunter2"})
expect(status == 201, f"register: {status}/{result}")
expect(result["username"] == username, "username normalized to lowercase")
user_id = result["user_id"]

me, status = req("GET", "/me", alice)
expect(status == 200 and me["username"] == username, f"/me after register: {me}")

result, status = req("POST", "/account/register", alice,
                     {"username": f"other-{suffix}", "password": "hunter2hunter2"})
expect_error(result, status, 409, "already_logged_in", "second register on session")

other = session()
result, status = req("POST", "/account/register", other,
                     {"username": username, "password": "hunter2hunter2"})
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
                     {"username": username, "password": "hunter2hunter2"})
expect(status == 200 and result["user_id"] == user_id, f"login: {result}")

# ── A finished game while logged in → history with result ───────────────
bob = session()  # stays anonymous
game, _ = req("POST", "/games", alice, {"display_name": "alice"})
req("POST", f"/games/{game['invite_code']}/join", bob, {"display_name": "bob"})
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
req("POST", "/account/register", carol, {"username": carol_name, "password": "hunter2hunter2"})
history, _ = req("GET", "/me/games", carol)
entry = next((g for g in history["games"] if g["id"] == game2["id"]), None)
expect(entry is not None, "anonymous game claimed by registration")
expect(entry["created_by_you"] is True and entry["your_seat"] == 0, f"backfill: {entry}")

print(f"PASS: accounts + history ({username}, {len(history['games'])} games in history)")
