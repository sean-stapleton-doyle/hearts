import { useQuery } from '@tanstack/react-query'
import { createFileRoute } from '@tanstack/react-router'

import { api, isApiError } from '../lib/api'
import { GameTable } from '../components/GameTable'
import { FinishedView } from '../components/FinishedView'
import { Lobby } from '../components/Lobby'
import { gameKeys } from '../lib/query'

export const Route = createFileRoute('/games/$id')({
  // Prime the cache so the page can render immediately; the game route also
  // polls while in the lobby and is kept fresh by the SSE bridge mid-game.
  loader: async ({ context, params }) => {
    await context.queryClient.ensureQueryData({
      queryKey: gameKeys.detail(params.id),
      queryFn: () => api.getGame(params.id),
    })
  },
  errorComponent: ({ error }) => (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-4 px-5 py-10">
      <h2>Couldn’t load that game</h2>
      <p>{isApiError(error) ? error.message : 'unknown error'}</p>
      <a href="/">Back to start</a>
    </main>
  ),
  component: GamePage,
})

function GamePage() {
  const { id } = Route.useParams()
  const { data: view } = useQuery({
    queryKey: gameKeys.detail(id),
    queryFn: () => api.getGame(id),
    // Lobby has no SSE (the server returns 409 `not_started`), so poll for
    // arrivals; stop the moment the game starts — the SSE bridge takes over.
    refetchInterval: (query) => (query.state.data?.status === 'lobby' ? 2000 : false),
  })

  if (!view) return null
  if (view.status === 'lobby') return <Lobby view={view} />
  if (view.status === 'in_progress') return <GameTable view={view} />
  return <FinishedView view={view} />
}
