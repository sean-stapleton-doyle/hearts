// Server DTOs, mirroring hearts-server/src/gameplay.rs and the CLI's
// api.rs 1:1. See server/docs/api.md §The game view — its examples double
// as the reference for these shapes.
//
// Schemas are the source of truth: every TS type is `z.infer`'d from its
// schema, and the API/SSE boundaries parse with them (api.ts `request`,
// sse.ts `onMessage`), so a wire payload that drifts from these shapes
// fails loudly at the boundary instead of corrupting the cache. Zod's
// default strip-unknown-keys behavior is deliberate — the server may add
// fields without breaking older clients.
import { z } from 'zod'

const seat = z.number().int()

export const SuitSchema = z.enum(['Clubs', 'Diamonds', 'Spades', 'Hearts'])
export type Suit = z.infer<typeof SuitSchema>

export const RankSchema = z.enum([
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Jack',
  'Queen',
  'King',
  'Ace',
])
export type Rank = z.infer<typeof RankSchema>

export const CardSchema = z.object({ suit: SuitSchema, rank: RankSchema })
export type Card = z.infer<typeof CardSchema>

export const GameStatusSchema = z.enum(['lobby', 'in_progress', 'finished', 'abandoned'])
export type GameStatus = z.infer<typeof GameStatusSchema>

export const PhaseSchema = z.enum(['Bidding', 'Playing', 'GameOver'])
export type Phase = z.infer<typeof PhaseSchema>

export const ActionTypeSchema = z.enum(['bid', 'play'])
export type ActionType = z.infer<typeof ActionTypeSchema>

export const TurnRefSchema = z.object({ action: ActionTypeSchema, seat })
export type TurnRef = z.infer<typeof TurnRefSchema>

export const PlayerInfoSchema = z.object({
  seat,
  display_name: z.string(),
  is_you: z.boolean(),
  is_creator: z.boolean(),
})
export type PlayerInfo = z.infer<typeof PlayerInfoSchema>

export const PlayViewSchema = z.object({ seat, card: CardSchema })
export type PlayView = z.infer<typeof PlayViewSchema>

export const TrickViewSchema = z.object({ leader: seat, plays: z.array(PlayViewSchema) })
export type TrickView = z.infer<typeof TrickViewSchema>

/** A completed trick — all seats have played, so the winner is known. */
export const CompletedTrickViewSchema = TrickViewSchema.extend({ winner: seat })
export type CompletedTrickView = z.infer<typeof CompletedTrickViewSchema>

export const RoundViewSchema = z.object({
  cards_dealt: z.number().int(),
  dealer: seat,
  bids: z.array(z.number().int().nullable()),
  tricks_won: z.array(z.number().int()),
  current_trick: TrickViewSchema.nullable(),
  /** Every completed trick this round, in play order — empty at the start
   *  of a round. The latest entry is shown while `current_trick` is still
   *  empty so the showdown stays visible; the full list backs the tricks
   *  history panel. */
  tricks: z.array(CompletedTrickViewSchema),
})
export type RoundView = z.infer<typeof RoundViewSchema>

export const YouViewSchema = z.object({
  seat,
  hand: z.array(CardSchema),
  /** Non-null exactly when it's this viewer's bid. */
  legal_bids: z.array(z.number().int()).nullable(),
  /** Non-null exactly when it's this viewer's play. */
  legal_plays: z.array(CardSchema).nullable(),
})
export type YouView = z.infer<typeof YouViewSchema>

/** The recap data for a held-open round, carried by the engine view. */
export const PendingRecapSchema = z.object({
  round_index: z.number().int(),
  bids: z.array(z.number().int()),
  tricks_won: z.array(z.number().int()),
  deltas: z.array(z.number().int()),
  scores: z.array(z.number().int()),
  next_round_index: z.number().int().nullable(),
  next_dealer: seat.nullable(),
  /** The completed round's tricks, captured before the engine advanced —
   *  the round itself is gone by the time the recap shows. Null only if
   *  the server restarted while the gate was up. */
  tricks: z.array(CompletedTrickViewSchema).nullable(),
})
export type PendingRecap = z.infer<typeof PendingRecapSchema>

export const EngineViewSchema = z.object({
  phase: PhaseSchema,
  round_index: z.number().int(),
  scores: z.array(z.number().int()),
  next: TurnRefSchema.nullable(),
  away: z.array(z.boolean()),
  turn_deadline_in_secs: z.number(),
  /** Non-null when the just-completed round is held open on the recap
   *  gate, awaiting host acknowledgement. Drives the round-end overlay
   *  (server-authoritative, so it survives reloads). */
  pending_ack: z.number().int().nullable(),
  /** The recap payload for the held-open round (same shape as
   *  `round_completed` minus `type`/`seq`/`next`). Null when no round is
   *  pending. Carried by the view so the gate renders immediately without
   *  waiting for the SSE event. */
  pending_recap: PendingRecapSchema.nullable(),
  round: RoundViewSchema.nullable(),
  you: YouViewSchema.nullable(),
})
export type EngineView = z.infer<typeof EngineViewSchema>

export const GameViewSchema = z.object({
  id: z.string(),
  invite_code: z.string(),
  status: GameStatusSchema,
  players: z.array(PlayerInfoSchema),
  created_at: z.string().optional(),
  started_at: z.string().nullable().optional(),
  /** null unless status === 'in_progress'. */
  game: EngineViewSchema.nullable(),
})
export type GameView = z.infer<typeof GameViewSchema>

// ── SSE events ──────────────────────────────────────────────────────────
// The server serializes its `Envelope { seq, event }` with the event
// flattened in, so each `data:` payload is the event fields plus a top-level
// `seq`. The SSE `id:` line carries the same seq for Last-Event-ID resume.

const next = TurnRefSchema.nullable()

export const RoundCompletedSchema = z.object({
  type: z.literal('round_completed'),
  round_index: z.number().int(),
  bids: z.array(z.number().int()),
  tricks_won: z.array(z.number().int()),
  deltas: z.array(z.number().int()),
  scores: z.array(z.number().int()),
  next_round_index: z.number().int().nullable(),
  next_dealer: seat.nullable(),
  next,
})

export const GameEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('game_started'),
    players: z.array(z.string()),
    round_index: z.number().int(),
    cards_dealt: z.number().int(),
    dealer: seat,
    next,
  }),
  z.object({
    type: z.literal('bid_placed'),
    seat,
    bid: z.number().int(),
    auto: z.boolean(),
    next,
  }),
  z.object({
    type: z.literal('card_played'),
    seat,
    card: CardSchema,
    auto: z.boolean(),
    next,
  }),
  z.object({ type: z.literal('trick_completed'), winner: seat, next }),
  RoundCompletedSchema,
  z.object({
    type: z.literal('round_acknowledged'),
    round_index: z.number().int(),
    auto: z.boolean(),
    next,
  }),
  z.object({
    type: z.literal('game_over'),
    scores: z.array(z.number().int()),
    winners: z.array(seat),
  }),
  z.object({
    type: z.literal('game_resumed'),
    round_index: z.number().int(),
    cards_dealt: z.number().int(),
    dealer: seat,
    scores: z.array(z.number().int()),
    next,
  }),
  z.object({ type: z.literal('game_abandoned'), reason: z.string() }),
])
export type GameEvent = z.infer<typeof GameEventSchema>

/** A parsed SSE `data:` payload: the event plus its log position. */
export const GameEventEnvelopeSchema = GameEventSchema.and(
  z.object({ seq: z.number().int() }),
)
export type GameEventEnvelope = z.infer<typeof GameEventEnvelopeSchema>

/** The `round_completed` payload as captured for the round-end summary
 *  overlay; `seq` distinguishes one round's summary from the next.
 *  (Named for the event envelope — the RoundSummary *component* renders
 *  the PendingRecap, a different shape.) */
export const RoundCompletedEnvelopeSchema = RoundCompletedSchema.extend({
  seq: z.number().int(),
})
export type RoundCompletedEnvelope = z.infer<typeof RoundCompletedEnvelopeSchema>

/** The terminal outcome, captured from the `game_over`/`game_abandoned`
 *  SSE events — the finished GET view has no engine section, so this is
 *  the only place the result exists client-side. Never crosses the wire
 *  in this shape (the events do, and they're schema-parsed), so a plain
 *  type suffices. */
export type GameOutcome =
  | { kind: 'over'; scores: number[]; winners: number[] }
  | { kind: 'abandoned'; reason: string }

export const CreatedSessionSchema = z.object({
  token: z.string(),
  expires_at: z.string(),
})
export type CreatedSession = z.infer<typeof CreatedSessionSchema>

export const SessionInfoSchema = z.object({
  user_id: z.string().nullable(),
  expires_at: z.string(),
})
export type SessionInfo = z.infer<typeof SessionInfoSchema>

export const ActionAckSchema = z.object({ seq: z.number().int() })
export type ActionAck = z.infer<typeof ActionAckSchema>

// ── Accounts (docs/api.md §Accounts) ────────────────────────────────────

export const AccountInfoSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  /** A fresh session token: register/login rotate the session's token as
   *  a hardening measure, so the caller must store this in place of
   *  whatever it had before (the old one stops working immediately). */
  token: z.string(),
})
export type AccountInfo = z.infer<typeof AccountInfoSchema>

export const MeInfoSchema = z.object({
  user_id: z.string(),
  username: z.string(),
  created_at: z.string(),
})
export type MeInfo = z.infer<typeof MeInfoSchema>

export const GameResultSchema = z.object({
  scores: z.array(z.number().int()),
  winner_seats: z.array(seat),
})
export type GameResult = z.infer<typeof GameResultSchema>

export const HistoryGameSchema = z.object({
  id: z.string(),
  status: GameStatusSchema,
  created_at: z.string(),
  started_at: z.string().nullable(),
  finished_at: z.string().nullable(),
  created_by_you: z.boolean(),
  your_seat: seat.nullable(),
  players: z.array(z.string()),
  /** null unless finished. */
  result: GameResultSchema.nullable(),
})
export type HistoryGame = z.infer<typeof HistoryGameSchema>

export const MyGamesSchema = z.object({ games: z.array(HistoryGameSchema) })
export type MyGames = z.infer<typeof MyGamesSchema>

/** Hearts scores low: `best_score` is the minimum. Averages/bests are
 *  null until the account has a finished game. */
export const MyStatsSchema = z.object({
  games_played: z.number().int(),
  games_finished: z.number().int(),
  wins: z.number().int(),
  average_score: z.number().nullable(),
  best_score: z.number().nullable(),
})
export type MyStats = z.infer<typeof MyStatsSchema>
