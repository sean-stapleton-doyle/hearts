#!/usr/bin/env python3
"""Drive the real TUI through a full game.

Runs `hearts-cli create` in a pty as alice (with an isolated $HOME so her
session doesn't touch your real config), joins bob over plain HTTP, starts
the game by pressing `s`, and plays alice's turns by pressing Enter (the
selection defaults to the first legal choice — the same policy the other
e2e scripts use). Bob plays over HTTP. Asserts the game finishes, the CLI
exits cleanly, and the post-TUI summary line appears.

Usage: cargo build -p hearts-cli && cargo run -p hearts-server &
       python3 scripts/e2e_tui.py
"""

import json
import os
import pty
import re
import select
import subprocess
import sys
import tempfile
import time
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:8080"
CLI = "target/debug/hearts-cli"


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


class TuiPlayer:
    def __init__(self, args, home):
        self.master, slave = pty.openpty()
        env = dict(os.environ, HOME=home, TERM="xterm-256color")
        self.process = subprocess.Popen(
            [CLI, *args], stdin=slave, stdout=slave, stderr=slave, env=env,
            close_fds=True,
        )
        os.close(slave)
        self.output = b""

    def drain(self):
        while True:
            ready, _, _ = select.select([self.master], [], [], 0)
            if not ready:
                return
            try:
                chunk = os.read(self.master, 4096)
            except OSError:
                return
            if not chunk:
                return
            self.output += chunk

    def send(self, keys):
        os.write(self.master, keys.encode())

    def wait_for(self, pattern, timeout=15):
        deadline = time.time() + timeout
        while time.time() < deadline:
            self.drain()
            match = re.search(pattern, self.output.decode(errors="replace"))
            if match:
                return match
            time.sleep(0.1)
        raise SystemExit(f"FAIL: never saw /{pattern}/ in CLI output")


home = tempfile.mkdtemp(prefix="hearts-tui-")
alice = TuiPlayer(["create", "--name", "alice"], home)

code = alice.wait_for(r"invite code: ([A-Z2-9]{6})").group(1)
print(f"invite code: {code}")

# Alice's session token, from her isolated config (macOS config dir).
config_path = os.path.join(home, "Library", "Application Support", "hearts", "config.json")
for _ in range(50):
    if os.path.exists(config_path):
        break
    time.sleep(0.1)
with open(config_path) as handle:
    config = json.load(handle)
alice_token = config["token"]
game_id = config["last_game"]

# Bob joins over HTTP and the TUI's lobby shows him via its 2s poll.
bob = req("POST", "/session")[0]["token"]
view, status = req("POST", f"/games/{code}/join", bob, {"display_name": "bob"})
expect(status == 200, f"bob join: {status}")

time.sleep(1)
alice.send("s")  # creator starts

deadline = time.time() + 20
while time.time() < deadline:
    view, _ = req("GET", f"/games/{game_id}", alice_token)
    if view["status"] == "in_progress":
        break
    time.sleep(0.3)
expect(view["status"] == "in_progress", f"game did not start: {view['status']}")
print("game started")

# Play: alice = Enter keypresses into the TUI, bob = HTTP.
start = time.time()
while time.time() - start < 120:
    alice.drain()
    view, _ = req("GET", f"/games/{game_id}", alice_token)
    if view["status"] != "in_progress":
        break
    nxt = view["game"]["next"]
    if nxt is None:
        time.sleep(0.2)
        continue
    if nxt["seat"] == 0:
        alice.send("\r")  # confirm the first legal choice
        time.sleep(0.25)
    else:
        you = req("GET", f"/games/{game_id}", bob)[0]["game"]["you"]
        if nxt["action"] == "bid":
            req("POST", f"/games/{game_id}/bid", bob, {"bid": you["legal_bids"][0]})
        else:
            req("POST", f"/games/{game_id}/play", bob, {"card": you["legal_plays"][0]})

expect(view["status"] == "finished", f"game did not finish: {view['status']}")
print("game finished on server")

# The TUI should be on the game-over screen; quit and check the summary.
time.sleep(1)
alice.send("q")
for _ in range(50):
    if alice.process.poll() is not None:
        break
    alice.drain()
    time.sleep(0.1)
expect(alice.process.poll() == 0, f"CLI exit code {alice.process.poll()}")
alice.drain()
tail = alice.output.decode(errors="replace")
expect("final scores:" in tail, "summary line missing after TUI restore")
summary = [line for line in tail.splitlines() if "final scores:" in line][-1]
print(f"PASS: {summary.strip()}")
