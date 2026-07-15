-- In-game chat. Ephemeral to the game's play but persisted so the log
-- survives reloads and server restarts (unlike the in-memory event log).
CREATE TABLE chat_messages (
    id           bigserial PRIMARY KEY,
    game_id      uuid NOT NULL REFERENCES games (id) ON DELETE CASCADE,
    seat         int  NOT NULL,
    -- 'text' = a spoken message (bubble + scrollback log); 'react' = a
    -- transient emoji reaction (floats over the seat, kept out of the log).
    -- CHECK over a text column (not an enum) so new kinds need no ALTER TYPE.
    kind         text NOT NULL DEFAULT 'text' CHECK (kind IN ('text', 'react')),
    -- Denormalized: the display name is per-game, per-seat (game_players),
    -- and a message should read the same forever even if a seat is reused.
    display_name text NOT NULL,
    body         text NOT NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

-- Backs both the history query (WHERE game_id ORDER BY id) and the `?after=`
-- cursor. `id` is globally monotonic, so it doubles as the client dedup key.
CREATE INDEX chat_messages_game_idx ON chat_messages (game_id, id);
