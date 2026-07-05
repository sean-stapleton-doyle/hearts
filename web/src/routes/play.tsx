import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate } from '@tanstack/react-router'

import { api, isApiError } from '../lib/api'
import { gameKeys } from '../lib/query'
import { getDisplayName, setDisplayName } from '../lib/session'
import { joinErrorMessage, useDefaultDisplayName } from '../lib/useDefaultDisplayName'
import type { GameView } from '../lib/types'

export const Route = createFileRoute('/play')({ component: PlayPage })

function PlayPage() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState(getDisplayName())
  useDefaultDisplayName(setName)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // After create/join, prime the cache with the returned view so the game
  // route renders without an extra GET, then navigate.
  function enter(view: GameView) {
    queryClient.setQueryData(gameKeys.detail(view.id), view)
    setDisplayName(name.trim())
    navigate({ to: '/games/$id', params: { id: view.id } })
  }

  async function onCreate() {
    setError(null)
    setBusy(true)
    try {
      enter(await api.createGame(name.trim() || 'player'))
    } catch (e) {
      setError(isApiError(e) ? e.message : 'could not create game')
    } finally {
      setBusy(false)
    }
  }

  async function onJoin() {
    setError(null)
    setBusy(true)
    try {
      enter(await api.joinGame(code.trim(), name.trim() || 'player'))
    } catch (e) {
      setError(joinErrorMessage(e, 'could not join game'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-5 py-10">
      <h1>Hearts</h1>

      <label>
        Display name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="your name" />
      </label>

      <section className="flex flex-col gap-3 rounded-xl border-2 border-ink bg-paper p-4 shadow-hard">
        <h2 className="text-base">Start a table</h2>
        <p className="m-0 text-sm font-medium text-mute">
          You get an invite code to share with the other players.
        </p>
        <button type="button" className="primary" onClick={onCreate} disabled={busy}>
          Create a new game
        </button>
      </section>

      <section className="flex flex-col gap-3 rounded-xl border-2 border-ink bg-paper p-4 shadow-hard">
        <h2 className="text-base">Join with a code</h2>
        <div className="flex gap-2">
          <input
            className="flex-1"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            maxLength={6}
            placeholder="invite code"
          />
          <button type="button" onClick={onJoin} disabled={busy || code.trim().length === 0}>
            Join
          </button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  )
}
