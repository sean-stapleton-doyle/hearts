import { useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'

import { useJoinFlow } from '../hooks/useJoinFlow'

export const Route = createFileRoute('/play')({ component: PlayPage })

function PlayPage() {
  const { name, setName, busy, error, create, join } = useJoinFlow()
  const [code, setCode] = useState('')

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
        <button type="button" className="primary" onClick={create} disabled={busy}>
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
          <button type="button" onClick={() => join(code)} disabled={busy || code.trim().length === 0}>
            Join
          </button>
        </div>
      </section>

      {error && <p className="error">{error}</p>}
    </main>
  )
}
