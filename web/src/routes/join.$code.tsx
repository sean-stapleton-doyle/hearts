import { createFileRoute, useParams } from '@tanstack/react-router'

import { useJoinFlow } from '../hooks/useJoinFlow'

export const Route = createFileRoute('/join/$code')({ component: JoinPage })

function JoinPage() {
  const { code } = useParams({ from: '/join/$code' })
  const { name, setName, busy, error, join } = useJoinFlow()

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
      <button type="button" className="primary" onClick={() => join(code)} disabled={busy}>
        {busy ? 'Joining…' : 'Join'}
      </button>
      {error && <p className="error">{error}</p>}
    </main>
  )
}
