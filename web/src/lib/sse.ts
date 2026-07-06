import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { API_BASE, api } from './api'
import { gameKeys } from './query'
import { GameEventEnvelopeSchema, type GameOutcome, type RoundCompletedEnvelope } from './types'

/** Reconnect backoff: doubles from 1s, capped at 10s. */
const RETRY_BASE_MS = 1000
const RETRY_MAX_MS = 10_000

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

    const onMessage = (event: MessageEvent) => {
      // Any event means the view moved — invalidate before parsing so even
      // a payload this client can't decode (e.g. an event type added by a
      // newer server) still refreshes the cache. `game_resumed` is handled
      // implicitly: the refetch returns the rebuilt view, discarding any
      // local state.
      queryClient.invalidateQueries({ queryKey: gameKeys.detail(id) })
      let raw: unknown
      try {
        raw = JSON.parse(event.data)
      } catch {
        return // malformed payload — the refetch above resyncs the cache
      }
      const parsed = GameEventEnvelopeSchema.safeParse(raw)
      if (!parsed.success) {
        if (import.meta.env.DEV) console.warn('SSE payload failed to parse', parsed.error)
        return // unknown/drifted event shape — degrade to the refetch
      }
      const envelope = parsed.data
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
            ? { kind: 'over', scores: envelope.scores, winners: envelope.winners }
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
        queryClient.invalidateQueries({ queryKey: gameKeys.detail(id) })
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
