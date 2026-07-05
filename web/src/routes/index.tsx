import { Link, createFileRoute } from '@tanstack/react-router'

import { PlayingCard } from '../components/Card'

export const Route = createFileRoute('/')({ component: HomePage })

function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-6 px-5 py-10 text-center">
      {/* Static route: these decorative cards are outside any Flip scope,
          so wrapper transforms are safe here. */}
      <div aria-hidden="true" className="flex items-end justify-center pb-2">
        <span className="translate-y-2 -rotate-12">
          <PlayingCard card={{ suit: 'Spades', rank: 'Queen' }} size="lg" />
        </span>
        <span className="z-10 -mx-4">
          <PlayingCard card={{ suit: 'Hearts', rank: 'Ace' }} size="lg" />
        </span>
        <span className="translate-y-2 rotate-12">
          <PlayingCard card={{ suit: 'Diamonds', rank: 'Ten' }} size="lg" />
        </span>
      </div>

      <div>
        <h1 className="text-5xl">Hearts</h1>
        <p className="mt-2 font-semibold text-mute">Bid, take tricks, hit your number exactly.</p>
      </div>

      <Link
        to="/play"
        className="rounded-lg border-2 border-ink bg-trump px-10 py-3 font-display text-lg font-extrabold uppercase tracking-wider text-white shadow-hard hover:bg-trump-deep hover:no-underline"
      >
        Play
      </Link>

      <p className="text-sm font-semibold text-mute">
        <Link to="/account">Account &amp; history</Link>
      </p>
    </main>
  )
}
