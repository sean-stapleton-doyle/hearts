-- Initial schema, per docs/server-design.md.

CREATE TYPE game_status AS ENUM ('lobby', 'in_progress', 'finished', 'abandoned');

-- Lite accounts: username + password only, no email stored.
CREATE TABLE users (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username      text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now()
);

-- Anonymous by default; user_id is bound on login.
CREATE TABLE sessions (
    token        bytea PRIMARY KEY,
    user_id      uuid REFERENCES users (id) ON DELETE CASCADE,
    created_at   timestamptz NOT NULL DEFAULT now(),
    last_seen_at timestamptz NOT NULL DEFAULT now(),
    expires_at   timestamptz NOT NULL
);

CREATE TABLE games (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    invite_code        text NOT NULL UNIQUE,
    status             game_status NOT NULL DEFAULT 'lobby',
    -- No FK: an audit value, must survive session expiry/cleanup.
    created_by_session bytea NOT NULL,
    created_by_user_id uuid REFERENCES users (id) ON DELETE SET NULL,
    seed               bigint,      -- set at start (engine u64, stored as bits)
    created_at         timestamptz NOT NULL DEFAULT now(),
    started_at         timestamptz,
    finished_at        timestamptz,
    -- Joins/starts bump this; lobbies idle > 20 min become 'abandoned'.
    last_activity_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX games_status_idx ON games (status);
CREATE INDEX games_created_by_user_idx ON games (created_by_user_id)
    WHERE created_by_user_id IS NOT NULL;

CREATE TABLE game_players (
    game_id       uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    seat          int NOT NULL,
    session_token bytea NOT NULL,
    user_id       uuid REFERENCES users (id) ON DELETE SET NULL,
    display_name  text NOT NULL,
    joined_at     timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, seat),
    UNIQUE (game_id, session_token)
);

CREATE INDEX game_players_session_idx ON game_players (session_token);

-- Full hearts_core::Game serialized at game start and after each completed
-- round; the latest row per game is the recovery point.
CREATE TABLE game_snapshots (
    game_id     uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    round_index int NOT NULL,
    state       jsonb NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (game_id, round_index)
);

-- Denormalized from the final snapshot so history queries skip JSONB.
CREATE TABLE game_results (
    game_id      uuid PRIMARY KEY REFERENCES games (id) ON DELETE CASCADE,
    scores       int[] NOT NULL,
    winner_seats int[] NOT NULL
);
