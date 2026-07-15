import { QueryClient, queryOptions } from '@tanstack/react-query'
import { api, isApiError } from './api'
import type { ChatMessage, GameOutcome, RoundCompletedEnvelope } from './types'

// The game query cache is the single source of truth for a game's view.
// Route loaders prime it (ensureQueryData), pages read it (useQuery),
// mutations invalidate it, and the SSE bridge invalidates it on every event
// — matching the CLI's `refresh()`-after-everything discipline.

export const gameKeys = {
  all: ['games'] as const,
  detail: (id: string) => ['games', id] as const,
  // The final outcome (scores/winners or abandon reason), captured from the
  // terminal SSE event — the finished `GameView` has no engine section, so
  // the result is stashed here for the finished screen to read.
  result: (id: string) => ['games', id, 'result'] as const,
  // Every round_completed seen so far, accumulated by the SSE bridge (the
  // stream replays the full log on a fresh connection, so this rebuilds
  // after a reload). Deliberately NOT nested under detail(id): the history
  // is read by an *active* query while the table is mounted, and every
  // detail(id) invalidation (SSE bridge, play/bid mutations) prefix-matches
  // children — it would refetch the stash's empty queryFn and wipe the data.
  roundHistory: (id: string) => ['round-history', id] as const,
  // In-game chat, seeded from the history GET and appended to by the SSE
  // bridge. A sibling of `detail` (not nested) for the same reason as
  // `roundHistory`: a `detail(id)` invalidation must not prefix-match and wipe
  // this active query.
  chat: (id: string) => ['chat', id] as const,
}

// ── SSE-fed stashes ─────────────────────────────────────────────────────
// Read-handles for state the SSE bridge pushes with setQueryData: the
// queryFn returns the empty value and staleTime is Infinity, so the query
// never refetches — the bridge is the only writer. This is client state
// living in the Query cache on purpose (one cache, one devtool, no second
// store); these helpers are the single home for that footgun.

/** Per-round history rows for the scoreboard (rebuilt by event replay). */
export const roundHistoryOptions = (id: string) =>
  queryOptions<RoundCompletedEnvelope[]>({
    queryKey: gameKeys.roundHistory(id),
    queryFn: async () => [],
    staleTime: Infinity,
    initialData: [],
  })

/** The terminal outcome for the finished screen. */
export const gameResultOptions = (id: string) =>
  queryOptions<GameOutcome | null>({
    queryKey: gameKeys.result(id),
    queryFn: async () => null,
    staleTime: Infinity,
    initialData: null,
  })

/** Chat log for a game. Unlike the other stashes this has a *real* queryFn —
 *  chat is persisted, so the history loads on mount; the SSE bridge is the
 *  only writer thereafter (it appends live messages with `setQueryData`, so
 *  `staleTime: Infinity` keeps the mount fetch from being refetched over it). */
export const chatOptions = (id: string) =>
  queryOptions<ChatMessage[]>({
    queryKey: gameKeys.chat(id),
    queryFn: () => api.getChatHistory(id),
    staleTime: Infinity,
    initialData: [],
  })

// Account-scoped queries. Invalidate `userKeys.all` after login/register/
// logout — the token never changes (login *binds* the session), only what
// user_id-derived views should show.
export const userKeys = {
  all: ['user'] as const,
  me: ['user', 'me'] as const,
  games: ['user', 'games'] as const,
  stats: ['user', 'stats'] as const,
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Game state is evergreen server-side; freshness comes from SSE
      // invalidations and explicit refetches, not wall-clock staleness.
      staleTime: 0,
      refetchOnWindowFocus: false,
      // Retry transient transport blips, but never structured server errors
      // (a 401/404/409 is real and should surface, not get hammered).
      retry: (failureCount, error) =>
        isApiError(error) && error.kind === 'transport' && failureCount < 2,
    },
    mutations: {
      // Mutations own their error handling (e.g. 409 → invalidate+refetch);
      // no silent retries.
      retry: false,
    },
  },
})
