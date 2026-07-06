import type { QueryClient } from '@tanstack/react-query'
import { QueryClientProvider } from '@tanstack/react-query'
import { Outlet, createRootRouteWithContext, useMatches } from '@tanstack/react-router'
import { TanStackDevtools } from '@tanstack/react-devtools'
import { TanStackRouterDevtoolsPanel } from '@tanstack/react-router-devtools'

import { ensureSession } from '../lib/api'
import { queryClient } from '../lib/query'
import { NavBar } from '../components/NavBar'

import '../styles.css'

interface RouterContext {
  queryClient: QueryClient
}

export const Route = createRootRouteWithContext<RouterContext>()({
  // Anonymous by default: guarantee a session token exists before any child
  // route loads its data, mirroring hearts-cli's token bootstrap. Idempotent
  // after the first load (returns the cached token).
  beforeLoad: async () => {
    await ensureSession()
  },
  component: RootComponent,
})

function RootComponent() {
  // The in-game route is a full-screen table with its own back-to-lobby
  // affordances; a persistent nav bar there would just eat into that layout.
  const inGame = useMatches().some((match) => match.routeId === '/games/$id')

  return (
    <QueryClientProvider client={queryClient}>
      {!inGame && <NavBar />}
      <Outlet />
      {/* Dev-only: `import.meta.env.DEV` is statically false in production
          builds, so the devtools JSX (and its imports) are tree-shaken out
          of the bundle entirely. */}
      {import.meta.env.DEV && (
        <TanStackDevtools
          config={{ position: 'bottom-right' }}
          plugins={[{ name: 'TanStack Router', render: <TanStackRouterDevtoolsPanel /> }]}
        />
      )}
    </QueryClientProvider>
  )
}
