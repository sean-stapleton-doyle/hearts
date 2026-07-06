import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { API_BASE } from './api'
import { gameKeys } from './query'
import { getToken } from './session'
import { GameEventEnvelopeSchema, type GameOutcome, type RoundCompletedEnvelope } from './types'

/**
 * Subscribe to a game's SSE event log and keep the TanStack Query cache in
 * sync. On each message we invalidate the game query (invalidate-and-refetch,
 * matching the CLI's `App::refresh()` after every event); terminal events
 * close the stream.
 *
 * Pass `gameId = undefined` (e.g. while the game is still in the lobby, where
 * the server returns 409 `not_started`) to leave the stream closed.
 */
export function useGameEvents(gameId: string | undefined): void {
  const queryClient = useQueryClient()

  useEffect(() => {
    if (!gameId) return
    const token = getToken()
    if (!token) return

    const url = `${API_BASE}/games/${gameId}/events?token=${encodeURIComponent(token)}`
    const es = new EventSource(url)

    const onMessage = (event: MessageEvent) => {
      // Any event means the view moved — invalidate before parsing so even
      // a payload this client can't decode (e.g. an event type added by a
      // newer server) still refreshes the cache. `game_resumed` is handled
      // implicitly: the refetch returns the rebuilt view, discarding any
      // local state.
      queryClient.invalidateQueries({ queryKey: gameKeys.detail(gameId) })
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
      // Stash the round summary for the table's round-end overlay. The final
      // round is skipped — game_over lands right behind it and FinishedView
      // takes over. A newer summary simply replaces an undismissed one.
      // Only a *live* summary counts: a fresh page's stream replays the whole
      // event log, and the cached view (fetched before the stream opened) has
      // already advanced past those rounds — resurfacing them would show a
      // stale summary on every reload.
      if (envelope.type === 'round_completed') {
        // Accumulate the per-round history for the scoreboard and the
        // round-end recap overlay. Replayed and duplicate events just
        // overwrite their round's row.
        queryClient.setQueryData<RoundCompletedEnvelope[]>(gameKeys.roundHistory(gameId), (prev) =>
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
        queryClient.setQueryData(gameKeys.result(gameId), outcome)
        es.close()
      }
    }

    // EventSource auto-reconnects on transient drops and replays via
    // Last-Event-ID automatically; a final 409 (game over) makes it give up.
    // On either kind of blip, invalidate so the cache reflects reality.
    const onError = () => {
      queryClient.invalidateQueries({ queryKey: gameKeys.detail(gameId) })
    }

    es.addEventListener('message', onMessage)
    es.addEventListener('error', onError)

    return () => {
      es.removeEventListener('message', onMessage)
      es.removeEventListener('error', onError)
      es.close()
    }
  }, [gameId, queryClient])
}
