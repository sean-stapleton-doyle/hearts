import { Link } from '@tanstack/react-router'

const linkClass =
  'rounded-md px-3 py-1.5 font-display text-sm font-bold uppercase tracking-wide text-ink hover:no-underline [&.active]:bg-ink [&.active]:text-white'

/** Top-level nav to the two standing destinations in the app. Omitted from
 *  the in-game route (`/games/$id`) — that view is a full-screen table and
 *  has its own back-to-lobby affordances. */
export function NavBar() {
  return (
    <nav className="mx-auto flex w-full max-w-md items-center justify-center gap-2 px-5 pt-4">
      <Link to="/play" className={linkClass}>
        Play
      </Link>
      <Link to="/account" className={linkClass}>
        Account
      </Link>
    </nav>
  )
}
