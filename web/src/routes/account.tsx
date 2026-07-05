import { useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, createFileRoute } from '@tanstack/react-router'

import { api, isApiError } from '../lib/api'
import { userKeys } from '../lib/query'
import { setToken } from '../lib/session'
import type { HistoryGame, MeInfo, MyStats } from '../lib/types'

export const Route = createFileRoute('/account')({ component: AccountPage })

function AccountPage() {
  const { data: user, isPending } = useQuery({
    queryKey: userKeys.me,
    queryFn: api.currentUser,
  })

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col gap-5 px-5 py-10">
      <h1>Account</h1>
      {isPending ? (
        <p className="muted">Loading…</p>
      ) : user ? (
        <Profile user={user} />
      ) : (
        <AuthForm />
      )}
      <p>
        <Link to="/play">← Back to play</Link>
      </p>
    </main>
  )
}

/** Login and registration share the same two fields; the button pressed
 *  picks the action. Logging in binds the existing session token to the
 *  account, so any games played anonymously join the account's history.
 *  Exported for tests. */
export function AuthForm() {
  const queryClient = useQueryClient()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(action: 'login' | 'register') {
    setError(null)
    setBusy(true)
    try {
      // Login/register rotate the session token server-side (hardening,
      // not just linking the account) — the old one stops working the
      // moment this resolves, so store the new one before anything else
      // re-reads it.
      const account =
        action === 'login'
          ? await api.login(username.trim(), password)
          : await api.register(username.trim(), password)
      setToken(account.token)
      await queryClient.invalidateQueries({ queryKey: userKeys.all })
    } catch (e) {
      setError(isApiError(e) ? e.message : 'something went wrong')
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <p className="muted">
        Accounts are optional — playing works without one. Log in to keep a
        history of your games, including any played on this device before
        signing up.
      </p>
      <label>
        Username
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          maxLength={32}
          autoComplete="username"
          placeholder="a-z, 0-9, - and _"
        />
      </label>
      <label>
        Password
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={128}
          autoComplete="current-password"
          placeholder="at least 8 characters"
        />
      </label>
      <div className="flex gap-2">
        <button
          type="button"
          className="primary"
          onClick={() => submit('login')}
          disabled={busy || !username.trim() || !password}
        >
          Log in
        </button>
        <button
          type="button"
          onClick={() => submit('register')}
          disabled={busy || !username.trim() || !password}
        >
          Create account
        </button>
      </div>
      {error && <p className="error">{error}</p>}
    </>
  )
}

function Profile({ user }: { user: MeInfo }) {
  const queryClient = useQueryClient()
  const [busy, setBusy] = useState(false)
  const { data: stats } = useQuery({ queryKey: userKeys.stats, queryFn: api.getMyStats })
  const { data: history } = useQuery({ queryKey: userKeys.games, queryFn: api.getMyGames })

  async function onLogout() {
    setBusy(true)
    try {
      // The session token survives logout (and stays seated in its games);
      // only the account binding is dropped.
      await api.logout()
      await queryClient.invalidateQueries({ queryKey: userKeys.all })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="flex items-start justify-between gap-2">
        <div>
          <strong className="font-display text-lg font-extrabold">{user.username}</strong>
          <p className="muted m-0 text-sm">
            Member since {new Date(user.created_at).toLocaleDateString()}
          </p>
        </div>
        <button type="button" className="ghost" onClick={onLogout} disabled={busy}>
          Log out
        </button>
      </div>

      {stats && <StatsRow stats={stats} />}

      <h2>Games</h2>
      {history &&
        (history.games.length === 0 ? (
          <p className="muted">No games yet — go play a hand.</p>
        ) : (
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {history.games.map((game) => (
              <HistoryItem key={game.id} game={game} />
            ))}
          </ul>
        ))}
    </>
  )
}

function StatsRow({ stats }: { stats: MyStats }) {
  const tiles = [
    { label: 'Played', value: String(stats.games_played) },
    { label: 'Won', value: String(stats.wins) },
    { label: 'Avg score', value: stats.average_score === null ? '—' : stats.average_score.toFixed(1) },
    { label: 'Best score', value: stats.best_score === null ? '—' : String(stats.best_score) },
  ]
  return (
    <dl className="m-0 grid grid-cols-4 gap-2">
      {tiles.map((tile) => (
        <div
          key={tile.label}
          className="rounded-lg border-2 border-ink bg-paper p-2.5 text-center shadow-hard-sm"
        >
          <dt className="text-[0.62rem] font-bold uppercase tracking-wider text-mute">
            {tile.label}
          </dt>
          <dd className="m-0 font-display text-xl font-extrabold tabular-nums">{tile.value}</dd>
        </div>
      ))}
    </dl>
  )
}

function HistoryItem({ game }: { game: HistoryGame }) {
  const yourScore =
    game.result && game.your_seat !== null ? game.result.scores[game.your_seat] : null
  const won =
    game.result !== null &&
    game.your_seat !== null &&
    game.result.winner_seats.includes(game.your_seat)

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border-2 border-ink bg-paper px-4 py-3 shadow-hard-sm">
      <div className="min-w-0">
        <Link to="/games/$id" params={{ id: game.id }} className="font-semibold">
          {game.players.join(', ') || 'empty lobby'}
        </Link>
        <p className="muted m-0 text-sm">
          {new Date(game.created_at).toLocaleDateString()} · {game.status.replace('_', ' ')}
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-2">
        {won && (
          <span className="rounded-full border border-ink bg-chip px-2 py-0.5 text-[0.65rem] font-bold uppercase">
            won
          </span>
        )}
        {yourScore !== null && (
          <strong className="font-display text-lg font-extrabold tabular-nums">{yourScore}</strong>
        )}
      </span>
    </li>
  )
}
