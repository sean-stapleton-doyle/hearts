import { QueryClient } from '@tanstack/react-query'
import { isApiError } from './api'

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
  // The latest round_completed payload, stashed by the SSE bridge so the
  // table can show a round-end summary before revealing the next round.
  // Deliberately NOT nested under detail(id): the summary is read by an
  // *active* query while the table is mounted, and every detail(id)
  // invalidation (SSE bridge, play/bid mutations) prefix-matches children —
  // it would refetch the stash's null queryFn and wipe the payload.
  roundSummary: (id: string) => ['round-summary', id] as const,
  // Every round_completed seen so far, accumulated by the SSE bridge (the
  // stream replays the full log on a fresh connection, so this rebuilds
  // after a reload). Same non-nesting rationale as roundSummary.
  roundHistory: (id: string) => ['round-history', id] as const,
}

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
