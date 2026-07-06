// Server DTOs, mirroring hearts-server/src/gameplay.rs and the CLI's
// api.rs 1:1. See server/docs/api.md §The game view — its examples double
// as the reference for these shapes.

export type Suit = 'Clubs' | 'Diamonds' | 'Spades' | 'Hearts'

export type Rank =
  | 'Two'
  | 'Three'
  | 'Four'
  | 'Five'
  | 'Six'
  | 'Seven'
  | 'Eight'
  | 'Nine'
  | 'Ten'
  | 'Jack'
  | 'Queen'
  | 'King'
  | 'Ace'

export interface Card {
  suit: Suit
  rank: Rank
}

export type GameStatus = 'lobby' | 'in_progress' | 'finished' | 'abandoned'

export type Phase = 'Bidding' | 'Playing' | 'GameOver'

export type ActionType = 'bid' | 'play'

export interface TurnRef {
  action: ActionType
  seat: number
}

export interface PlayerInfo {
  seat: number
  display_name: string
  is_you: boolean
  is_creator: boolean
}

export interface PlayView {
  seat: number
  card: Card
}

export interface TrickView {
  leader: number
  plays: PlayView[]
}

/** A completed trick — all seats have played, so the winner is known. */
export interface CompletedTrickView extends TrickView {
  winner: number
}

export interface RoundView {
  cards_dealt: number
  dealer: number
  bids: (number | null)[]
  tricks_won: number[]
  current_trick: TrickView | null
  /** The most recently completed trick this round, or null before the
   *  first trick resolves (and at the start of every round). Shown while
   *  `current_trick` is still empty so the showdown stays visible. */
  last_trick: CompletedTrickView | null
}

export interface YouView {
  seat: number
  hand: Card[]
  /** Non-null exactly when it's this viewer's bid. */
  legal_bids: number[] | null
  /** Non-null exactly when it's this viewer's play. */
  legal_plays: Card[] | null
}

export interface EngineView {
  phase: Phase
  round_index: number
  scores: number[]
  next: TurnRef | null
  away: boolean[]
  turn_deadline_in_secs: number
  /** Non-null when the just-completed round is held open on the recap
   *  gate, awaiting host acknowledgement. Drives the round-end overlay
   *  (server-authoritative, so it survives reloads). */
  pending_ack: number | null
  /** The recap payload for the held-open round (same shape as
   *  `round_completed` minus `type`/`seq`/`next`). Null when no round is
   *  pending. Carried by the view so the gate renders immediately without
   *  waiting for the SSE event. */
  pending_recap: PendingRecap | null
  round: RoundView | null
  you: YouView | null
}

/** The recap data for a held-open round, carried by the engine view. */
export interface PendingRecap {
  round_index: number
  bids: number[]
  tricks_won: number[]
  deltas: number[]
  scores: number[]
  next_round_index: number | null
  next_dealer: number | null
}

export interface GameView {
  id: string
  invite_code: string
  status: GameStatus
  players: PlayerInfo[]
  created_at?: string
  started_at?: string | null
  /** null unless status === 'in_progress'. */
  game: EngineView | null
}

// ── SSE events ──────────────────────────────────────────────────────────
// The server serializes its `Envelope { seq, event }` with the event
// flattened in, so each `data:` payload is the event fields plus a top-level
// `seq`. The SSE `id:` line carries the same seq for Last-Event-ID resume.

export type GameEvent =
  | {
      type: 'game_started'
      players: string[]
      round_index: number
      cards_dealt: number
      dealer: number
      next: TurnRef | null
    }
  | { type: 'bid_placed'; seat: number; bid: number; auto: boolean; next: TurnRef | null }
  | { type: 'card_played'; seat: number; card: Card; auto: boolean; next: TurnRef | null }
  | { type: 'trick_completed'; winner: number; next: TurnRef | null }
  | {
      type: 'round_completed'
      round_index: number
      bids: number[]
      tricks_won: number[]
      deltas: number[]
      scores: number[]
      next_round_index: number | null
      next_dealer: number | null
      next: TurnRef | null
    }
  | {
      type: 'round_acknowledged'
      round_index: number
      auto: boolean
      next: TurnRef | null
    }
  | { type: 'game_over'; scores: number[]; winners: number[] }
  | {
      type: 'game_resumed'
      round_index: number
      cards_dealt: number
      dealer: number
      scores: number[]
      next: TurnRef | null
    }
  | { type: 'game_abandoned'; reason: string }

/** A parsed SSE `data:` payload: the event plus its log position. */
export type GameEventEnvelope = GameEvent & { seq: number }

/** The `round_completed` payload as captured for the round-end summary
 *  overlay; `seq` distinguishes one round's summary from the next. */
export type RoundSummary = Extract<GameEvent, { type: 'round_completed' }> & { seq: number }

export interface CreatedSession {
  token: string
  expires_at: string
}

export interface SessionInfo {
  user_id: string | null
  expires_at: string
}

export interface ActionAck {
  seq: number
}

// ── Accounts (docs/api.md §Accounts) ────────────────────────────────────

export interface AccountInfo {
  user_id: string
  username: string
  /** A fresh session token: register/login rotate the session's token as
   *  a hardening measure, so the caller must store this in place of
   *  whatever it had before (the old one stops working immediately). */
  token: string
}

export interface MeInfo {
  user_id: string
  username: string
  created_at: string
}

export interface GameResult {
  scores: number[]
  winner_seats: number[]
}

export interface HistoryGame {
  id: string
  status: GameStatus
  created_at: string
  started_at: string | null
  finished_at: string | null
  created_by_you: boolean
  your_seat: number | null
  players: string[]
  /** null unless finished. */
  result: GameResult | null
}

export interface MyGames {
  games: HistoryGame[]
}

/** Hearts scores low: `best_score` is the minimum. Averages/bests are
 *  null until the account has a finished game. */
export interface MyStats {
  games_played: number
  games_finished: number
  wins: number
  average_score: number | null
  best_score: number | null
}
