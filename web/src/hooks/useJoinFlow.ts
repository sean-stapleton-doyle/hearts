import { useState, type Dispatch, type SetStateAction } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'

import { api } from '../lib/api'
import { gameKeys } from '../lib/query'
import { getDisplayName, setDisplayName } from '../lib/session'
import { joinErrorMessage, useDefaultDisplayName } from '../lib/useDefaultDisplayName'
import type { GameView } from '../lib/types'

/**
 * The shared entry scaffolding for the create/join routes (`/play`,
 * `/join/:code`): display-name state seeded from the last game and the
 * account username, the busy/error envelope, and the create-or-join →
 * prime-cache → navigate flow. Routes keep their own JSX.
 */
export function useJoinFlow(): {
  name: string
  setName: Dispatch<SetStateAction<string>>
  busy: boolean
  error: string | null
  create(): Promise<void>
  join(code: string): Promise<void>
} {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [name, setName] = useState(getDisplayName())
  useDefaultDisplayName(setName)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // After create/join, prime the cache with the returned view so the game
  // route renders without an extra GET, then navigate. (join is idempotent
  // if already seated, so retrying a shared link is safe.)
  function enter(view: GameView) {
    queryClient.setQueryData(gameKeys.detail(view.id), view)
    setDisplayName(name.trim())
    navigate({ to: '/games/$id', params: { id: view.id } })
  }

  async function run(action: () => Promise<GameView>, fallback: string) {
    setError(null)
    setBusy(true)
    try {
      enter(await action())
    } catch (e) {
      setError(joinErrorMessage(e, fallback))
    } finally {
      setBusy(false)
    }
  }

  return {
    name,
    setName,
    busy,
    error,
    create: () => run(() => api.createGame(name.trim() || 'player'), 'could not create game'),
    join: (code: string) =>
      run(() => api.joinGame(code.trim(), name.trim() || 'player'), 'could not join game'),
  }
}
