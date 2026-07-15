import { createFileRoute, useParams } from '@tanstack/react-router'
import { useQuery } from '@tanstack/react-query'

import { api, isApiError } from '../lib/api'
import { useJoinFlow } from '../hooks/useJoinFlow'
import type { GameJoinStatus } from '../lib/types'

export const Route = createFileRoute('/join/$code')({ component: JoinPage })

/** What the join page should offer for a given probe result. `action` present
 *  means an actionable button ('join' collects a name; 'enter' just opens the
 *  game you already sit at); `message` is the reason a stale game can't be
 *  joined. */
export function resolveJoinState(
  status: GameJoinStatus | undefined,
  error: unknown,
): { action: 'join' | 'enter' | null; message: string | null } {
  if (error) {
    const code = isApiError(error) && error.kind === 'server' ? error.code : null
    return {
      action: null,
      message: code === 'game_not_found' ? 'No game with that code.' : 'Couldn’t check that game.',
    }
  }
  if (!status) return { action: null, message: null }
  // A member can always re-enter, whatever the game's phase.
  if (status.seated) return { action: 'enter', message: null }
  switch (status.status) {
    case 'lobby':
      return status.full
        ? { action: null, message: 'This game is full (7 players).' }
        : { action: 'join', message: null }
    case 'in_progress':
      return { action: null, message: 'This game has already started.' }
    case 'finished':
      return { action: null, message: 'This game is over.' }
    case 'abandoned':
      return { action: null, message: 'This game was abandoned.' }
  }
}

function JoinPage() {
  const { code } = useParams({ from: '/join/$code' })
  const { name, setName, busy, error, join } = useJoinFlow()

  // Probe joinability up front so a stale invite link shows the reason instead
  // of a dead Join button that only errors on click.
  const {
    data: status,
    error: probeError,
    isLoading,
  } = useQuery({
    queryKey: ['invite', code],
    queryFn: () => api.getJoinStatus(code),
    retry: false,
  })

  const { action, message } = resolveJoinState(status, probeError)

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-5 py-10">
      <h1>Join game</h1>

      <div className="rounded-xl border-2 border-ink bg-paper p-4 text-center shadow-hard">
        <p className="m-0 text-xs font-bold uppercase tracking-widest text-mute">Invite code</p>
        <p className="m-0 font-display text-4xl font-extrabold tracking-[0.22em] [font-stretch:118%]">
          {code}
        </p>
      </div>

      {isLoading && <p className="m-0 text-center font-medium text-mute">Checking game…</p>}

      {message && <p className="m-0 text-center font-semibold text-mute">{message}</p>}

      {action === 'join' && (
        <>
          <label>
            Display name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={32}
              placeholder="your name"
            />
          </label>
          <button type="button" className="primary" onClick={() => join(code)} disabled={busy}>
            {busy ? 'Joining…' : 'Join'}
          </button>
        </>
      )}

      {action === 'enter' && (
        <button type="button" className="primary" onClick={() => join(code)} disabled={busy}>
          {busy ? 'Opening…' : 'Enter game'}
        </button>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  )
}
