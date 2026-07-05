import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { createFileRoute, useNavigate, useParams } from '@tanstack/react-router'

import { api } from '../lib/api'
import { gameKeys } from '../lib/query'
import { getDisplayName, setDisplayName } from '../lib/session'
import { joinErrorMessage, useDefaultDisplayName } from '../lib/useDefaultDisplayName'
import type { GameView } from '../lib/types'

export const Route = createFileRoute('/join/$code')({ component: JoinPage })

function JoinPage() {
  const { code } = useParams({ from: '/join/$code' })
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState(getDisplayName())
  useDefaultDisplayName(setName)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onJoin() {
    setError(null)
    setBusy(true)
    try {
      const view: GameView = await api.joinGame(code, name.trim() || 'player')
      // join is idempotent if already seated, so retrying a shared link is safe.
      queryClient.setQueryData(gameKeys.detail(view.id), view)
      setDisplayName(name.trim())
      navigate({ to: '/games/$id', params: { id: view.id } })
    } catch (e) {
      setError(joinErrorMessage(e, 'could not join game'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-5 py-10">
      <h1>Join game</h1>

      <div className="rounded-xl border-2 border-ink bg-paper p-4 text-center shadow-hard">
        <p className="m-0 text-xs font-bold uppercase tracking-widest text-mute">Invite code</p>
        <p className="m-0 font-display text-4xl font-extrabold tracking-[0.22em] [font-stretch:118%]">
          {code}
        </p>
      </div>

      <label>
        Display name
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={32} placeholder="your name" />
      </label>
      <button type="button" className="primary" onClick={onJoin} disabled={busy}>
        {busy ? 'Joining…' : 'Join'}
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  )
}
