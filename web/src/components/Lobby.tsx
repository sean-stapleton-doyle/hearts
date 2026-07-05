import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { api, isApiError } from '../lib/api'
import { gameKeys } from '../lib/query'
import type { GameView } from '../lib/types'

const MAX_PLAYERS = 7

export function Lobby({ view }: { view: GameView }) {
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const me = view.players.find((p) => p.is_you)
  const canStart = Boolean(me?.is_creator) && view.players.length >= 2

  const startMutation = useMutation({
    mutationFn: () => api.startGame(view.id),
    onSuccess: (started) => {
      // startGame returns the now in-progress view; priming the cache here
      // means the game route switches to the table without an extra GET.
      queryClient.setQueryData(gameKeys.detail(view.id), started)
    },
    onError: (error) => setError(isApiError(error) ? error.message : 'could not start'),
  })

  async function copyInvite() {
    try {
      await navigator.clipboard?.writeText(view.invite_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col justify-center gap-5 px-5 py-10">
      <h1>Hearts</h1>
      <p className="m-0 font-semibold text-mute">Share the code so others can join.</p>

      {/* The invite code is the whole point of this screen — it is the hero. */}
      <button
        type="button"
        className="flex flex-col items-center gap-1 rounded-xl border-2 border-ink bg-paper px-4 py-5 shadow-hard"
        onClick={copyInvite}
      >
        <span className="text-xs font-bold uppercase tracking-widest text-mute">Invite code</span>
        <span className="font-display text-5xl font-extrabold tracking-[0.16em] text-trump [font-stretch:118%]">
          {view.invite_code}
        </span>
        <span className="text-sm font-semibold">{copied ? 'Copied!' : 'Copy'}</span>
      </button>

      <ul className="m-0 grid list-none grid-cols-2 gap-2 p-0">
        {view.players.map((p) => (
          <li
            key={p.seat}
            className={`truncate rounded-lg border-2 border-ink px-3 py-2.5 font-semibold shadow-hard-sm ${
              p.is_you ? 'bg-trump text-white' : 'bg-paper'
            }`}
          >
            <span>{p.display_name}</span>
            {p.is_creator && <em className="not-italic opacity-70"> · host</em>}
          </li>
        ))}
        {Array.from({ length: Math.max(0, MAX_PLAYERS - view.players.length) }).map((_, i) => (
          <li
            key={`empty-${i}`}
            className="rounded-lg border-2 border-dashed border-ink/30 px-3 py-2.5 text-sm font-medium text-mute"
          >
            waiting for player…
          </li>
        ))}
      </ul>

      {me?.is_creator ? (
        <button
          type="button"
          className="primary"
          onClick={() => startMutation.mutate()}
          disabled={!canStart || startMutation.isPending}
        >
          {startMutation.isPending ? 'Starting…' : canStart ? 'Start game' : 'Need ≥2 players'}
        </button>
      ) : (
        <p className="m-0 font-medium text-mute">Waiting for the host to start the game…</p>
      )}

      {error && <p className="error">{error}</p>}
    </main>
  )
}
