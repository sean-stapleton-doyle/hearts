-- Display names must be unique (case-insensitively) within a game: identity
-- is still the session token, but two seated players with the same name are
-- indistinguishable at the table. Fails on databases that already contain
-- duplicate names in one game; dedupe those rows by hand before migrating.
CREATE UNIQUE INDEX game_players_game_name_unique
    ON game_players (game_id, lower(display_name));
