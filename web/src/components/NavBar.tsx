import { Link, useMatches } from '@tanstack/react-router'

const linkClass =
  'rounded-md px-3 py-1.5 font-display text-sm font-bold uppercase tracking-wide whitespace-nowrap text-ink hover:no-underline [&.active]:bg-ink [&.active]:text-white'

/** Top-level nav to the standing destinations in the app. Omitted from
 *  the in-game route (`/games/$id`) — that view is a full-screen table and
 *  has its own back-to-lobby affordances. On the long scroll-driven
 *  tutorial it locks to the top of the viewport (z-40: above the tutorial's
 *  pinned sections, which are position-fixed at z-auto and later in the
 *  DOM) so the exit is always one tap away. */
export function NavBar() {
  const onTutorial = useMatches().some((match) => match.routeId === '/how-to-play')

  return (
    <nav
      className={
        onTutorial
          ? 'sticky top-0 z-40 w-full border-b-2 border-ink bg-parch'
          : 'w-full'
      }
    >
      <div className="mx-auto flex w-full max-w-md items-center justify-center gap-2 px-5 pb-3 pt-4">
        {/* Deliberately no direct /play link: the landing page is the front
            door, and its Play button is the only way in. */}
        <Link to="/" activeOptions={{ exact: true }} className={linkClass}>
          Home
        </Link>
        <Link to="/how-to-play" className={linkClass}>
          Rules
        </Link>
        <Link to="/account" className={linkClass}>
          Account
        </Link>
      </div>
    </nav>
  )
}
