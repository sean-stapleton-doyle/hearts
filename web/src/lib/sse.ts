import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { API_BASE, api } from './api'
import { gameKeys } from './query'
import {
  GameEventEnvelopeSchema,
  type ChatMessage,
  type CompletedTrickView,
  type GameEvent,
  type GameOutcome,
  type PlayView,
  type RoundCompletedEnvelope,
} from './types'

/** Reconnect backoff: doubles from 1s, capped at 10s. */
const RETRY_BASE_MS = 1000
const RETRY_MAX_MS = 10_000

/** Running state for reconstructing the game's final trick from the event
 *  stream. The final round is exempt from the recap gate (the server jumps
 *  straight to GameOver), so its last showdown never rides a fetched view —
 *  we rebuild it from `card_played`/`trick_completed` events so the finished
 *  screen can reveal it. Pure and exported so it can be tested without a live
 *  EventSource; folding the replayed log on reconnect yields the same trick,
 *  so it stays idempotent. */
export interface TrickAccumulator {
  plays: PlayView[]
  last: CompletedTrickView | null
}

export const emptyTrickAccumulator = (): TrickAccumulator => ({ plays: [], last: null })

export function accumulateTrick(acc: TrickAccumulator, event: GameEvent): TrickAccumulator {
  if (event.type === 'card_played') {
    return { ...acc, plays: [...acc.plays, { seat: event.seat, card: event.card }] }
  }
  if (event.type === 'trick_completed') {
    // The leader is whoever played first this trick.
    const last =
      acc.plays.length > 0
        ? { leader: acc.plays[0].seat, plays: acc.plays, winner: event.winner }
        : acc.last
    return { plays: [], last }
  }
  return acc
}

/** Most recent chat messages held in the stash — older ones scroll out of
 *  reach anyway, and the history GET can page further back if ever needed. */
const CHAT_STASH_CAP = 100

/** Append a chat message to the log stash, deduped by `id` and kept sorted by
 *  `id`. A reconnect replays every `chat_message` over SSE while the history
 *  GET returns the same rows, so dedup-by-id keeps the merge idempotent;
 *  returning `prev` unchanged on a duplicate avoids a needless re-render. Pure
 *  and exported so it can be tested without a live EventSource. */
export function mergeChat(prev: ChatMessage[], message: ChatMessage): ChatMessage[] {
  if (prev.some((m) => m.id === message.id)) return prev
  const next = [...prev, message].sort((a, b) => a.id - b.id)
  return next.length > CHAT_STASH_CAP ? next.slice(next.length - CHAT_STASH_CAP) : next
}

/**
 * Subscribe to a game's SSE event log and keep the TanStack Query cache in
 * sync. On each message we invalidate the game query (invalidate-and-refetch,
 * matching the CLI's `App::refresh()` after every event); terminal events
 * close the stream.
 *
 * The stream authenticates with a single-use ticket (the session token must
 * never ride in a URL), which costs us EventSource's built-in reconnect: the
 * browser would retry the same spent-ticket URL and 401. So this hook owns
 * the reconnect loop — fresh ticket, capped exponential backoff. A manual
 * reconnect loses `Last-Event-ID` and replays the game's full event log,
 * which is fine: every write below is replay-idempotent (history rows
 * overwrite by round_index; everything else is an invalidation).
 *
 * Pass `gameId = undefined` (e.g. while the game is still in the lobby, where
 * the server returns 409 `not_started`) to leave the stream closed.
 */
export function useGameEvents(gameId: string | undefined): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!gameId) return
    const id = gameId
    let cancelled = false
    let done = false // terminal event seen — never reconnect
    let es: EventSource | null = null
    let retryTimer: ReturnType<typeof setTimeout> | undefined
    let attempt = 0

    // Accumulates the running trick so we can reconstruct the game's final
    // showdown (see `accumulateTrick`). Reset when the effect re-runs; the
    // reconnect replay re-derives the same trick.
    let trick = emptyTrickAccumulator()

    const invalidate = () => queryClient.invalidateQueries({ queryKey: gameKeys.detail(id) })

    const onMessage = (event: MessageEvent) => {
      // Parse first so chat — which changes no game state — can skip the game
      // refetch every other event triggers. The safety net is preserved: any
      // payload this client can't decode (malformed, or an event type added by
      // a newer server) falls through to `invalidate()`, so the view still
      // resyncs. `game_resumed` is handled implicitly by that refetch,
      // discarding any local state.
      let raw: unknown
      try {
        raw = JSON.parse(event.data)
      } catch {
        invalidate() // malformed payload — resync from the authoritative view
        return
      }
      const parsed = GameEventEnvelopeSchema.safeParse(raw)
      if (!parsed.success) {
        if (import.meta.env.DEV) console.warn('SSE payload failed to parse', parsed.error)
        invalidate() // unknown/drifted event shape — degrade to the refetch
        return
      }
      const envelope = parsed.data
      // Chat is data, not a state change: append it to the log stash and skip
      // the refetch (the GET view carries no chat). Dedup-by-id in `mergeChat`
      // absorbs the reconnect replay.
      if (envelope.type === 'chat_message') {
        queryClient.setQueryData<ChatMessage[]>(gameKeys.chat(id), (prev) =>
          mergeChat(prev ?? [], envelope),
        )
        return
      }
      // Every other event means the view moved — refetch the authoritative GET.
      invalidate()
      // Track the running trick so we can reconstruct the game's final
      // showdown (see `accumulateTrick`).
      trick = accumulateTrick(trick, envelope)
      if (envelope.type === 'round_completed') {
        // Accumulate the per-round history for the scoreboard and the
        // round-end recap overlay. Replayed and duplicate events just
        // overwrite their round's row.
        queryClient.setQueryData<RoundCompletedEnvelope[]>(gameKeys.roundHistory(id), (prev) =>
          [...(prev ?? []).filter((r) => r.round_index !== envelope.round_index), envelope].sort(
            (a, b) => a.round_index - b.round_index,
          ),
        )
      }
      // Terminal events also seed the finished screen, whose GET view has no
      // engine/scores — the outcome only arrives via this stream.
      if (envelope.type === 'game_over' || envelope.type === 'game_abandoned') {
        const outcome: GameOutcome =
          envelope.type === 'game_over'
            ? {
                kind: 'over',
                scores: envelope.scores,
                winners: envelope.winners,
                finalTrick: trick.last,
              }
            : { kind: 'abandoned', reason: envelope.reason }
        queryClient.setQueryData(gameKeys.result(id), outcome)
        done = true
        es?.close()
      }
    }

    function scheduleRetry() {
      if (cancelled || done) return
      const delay = Math.min(RETRY_BASE_MS * 2 ** attempt, RETRY_MAX_MS)
      attempt += 1
      retryTimer = setTimeout(() => void connect(), delay)
    }

    async function connect(): Promise<void> {
      let ticket: string
      try {
        ;({ ticket } = await api.createEventsTicket(id))
      } catch {
        // 409 not_started / transport blip — retry with backoff; the game
        // route's polling keeps the lobby view fresh meanwhile.
        scheduleRetry()
        return
      }
      if (cancelled || done) return
      es = new EventSource(
        `${API_BASE}/games/${id}/events?ticket=${encodeURIComponent(ticket)}`,
      )
      es.onopen = () => {
        attempt = 0
      }
      es.addEventListener('message', onMessage)
      es.addEventListener('error', () => {
        // Refetch on any blip so the cache reflects reality. The browser's
        // native retry would 401 on the spent ticket; once it gives up
        // (CLOSED) we reconnect ourselves with a fresh one.
        invalidate()
        if (es?.readyState === EventSource.CLOSED) {
          es = null
          scheduleRetry()
        }
      })
    }

    void connect()
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
      es?.close()
    }
  }, [gameId, queryClient])
}
