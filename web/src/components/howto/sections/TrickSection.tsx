import { useRef } from 'react'

import { useScrollScene } from '../../../lib/scroll-anim'
import type { Card } from '../../../lib/types'
import { PlayingCard } from '../../Card'
import { CardBack } from '../CardBack'
import { DemoFelt } from '../DemoFelt'
import { HowToSection } from '../HowToSection'
import { SeatChip } from '../SeatChip'

interface Play {
  name: string
  card: Card
  /** Flight offset back toward this player's seat. */
  from: { x: number; y: number }
  winner?: boolean
}

/** Flight deltas per seat position (top/left/bottom/right of the felt). */
const FROM = {
  bottom: { x: 0, y: 150 },
  left: { x: -170, y: 0 },
  top: { x: 0, y: -150 },
  right: { x: 170, y: 0 },
}
const SCATTER = [-7, 5, -3, 8]

/**
 * A trick playing out on a pinned felt: four cards fly in from their
 * seats, the verdict lands as captions, the winning card lifts with the
 * gold ring, and the trick sweeps away to the winner's seat. Shared by
 * the hearts-in-play and no-hearts variants of Rule 06 — same table,
 * different arithmetic.
 */
function TrickDemo({
  plays,
  pileSeat,
  verdict,
  leadCap,
  idPrefix,
}: {
  plays: Play[]
  /** Which seat collects the trick (where the face-down pile appears). */
  pileSeat: 'top' | 'left'
  verdict: string
  leadCap: string
  idPrefix: string
}) {
  const scope = useRef<HTMLDivElement>(null)
  const winner = plays.find((p) => p.winner)

  useScrollScene(
    scope,
    (tl) => {
      plays.forEach(({ from }, i) => {
        tl.from(
          `[data-play="${i}"]`,
          { ...from, autoAlpha: 0, duration: 0.45, ease: 'power2.out' },
          i * 0.55,
        )
        tl.from(`[data-play-cap="${i}"]`, { autoAlpha: 0, duration: 0.25 }, i * 0.55 + 0.2)
      })
      tl.from('[data-verdict]', { autoAlpha: 0, y: 8, duration: 0.35 }, '+=0.2')
        .to('[data-winner]', { y: -12, scale: 1.1, duration: 0.35, ease: 'back.out(1.7)' })
        .from(
          '[data-winner-ring]',
          { scale: 0, autoAlpha: 0, duration: 0.35, ease: 'back.out(2)' },
          '<',
        )
        // The winner takes the trick: the cluster shrinks away toward their
        // seat and a face-down pile appears there in its place.
        .to('[data-trick-cluster]', {
          ...(winner?.from ?? FROM.top),
          scale: 0.4,
          autoAlpha: 0,
          duration: 0.5,
          ease: 'power2.in',
          delay: 0.3,
        })
        .from('[data-won-pile]', { autoAlpha: 0, scale: 0.6, duration: 0.3, ease: 'back.out(1.7)' })
        .from('[data-lead-cap]', { autoAlpha: 0, y: 8, duration: 0.3 })
    },
    { pin: true, end: '+=160%' },
  )

  const pile = (
    <span data-won-pile className="relative block h-[30px] w-[46px]">
      {[0, 1, 2].map((i) => (
        <CardBack
          key={i}
          size="xs"
          className="absolute top-0"
          style={{ left: i * 8, transform: `rotate(${(i - 1) * 6}deg)` }}
        />
      ))}
    </span>
  )

  return (
    <div ref={scope}>
      <DemoFelt className="h-96">
        <div aria-hidden="true" className="absolute inset-0">
          {/* Seats around the cluster */}
          <div className="absolute left-1/2 top-3 flex -translate-x-1/2 flex-col items-center gap-2">
            <SeatChip name="Cleo" />
            {pileSeat === 'top' ? pile : null}
          </div>
          <div className="absolute left-3 top-1/2 flex -translate-y-1/2 flex-col items-center gap-2">
            <SeatChip name="Ben" />
            {pileSeat === 'left' ? pile : null}
          </div>
          <span className="absolute right-3 top-1/2 -translate-y-1/2">
            <SeatChip name="Dee" />
          </span>
          <span className="absolute bottom-3 left-1/2 -translate-x-1/2">
            <SeatChip name="Ava" dealer />
          </span>

          {/* The trick cluster */}
          <div
            data-trick-cluster
            className="absolute left-1/2 top-[46%] -translate-x-1/2 -translate-y-1/2"
          >
            <div className="flex items-end">
              {plays.map(({ name, card, winner: isWinner }, i) => (
                <div
                  key={i}
                  data-play={i}
                  data-winner={isWinner ? '' : undefined}
                  className={`relative flex flex-col items-center gap-1 ${i === 0 ? '' : '-ml-2'}`}
                  style={{ transform: `rotate(${SCATTER[i]}deg)`, zIndex: isWinner ? 10 : i }}
                >
                  {isWinner ? (
                    <span
                      data-winner-ring
                      className="absolute -inset-1 rounded-xl border-[3px] border-chip"
                    />
                  ) : null}
                  <PlayingCard card={card} size="sm" flipId={`${idPrefix}-${i}`} />
                  <span
                    data-play-cap={i}
                    className="font-display text-[0.55rem] font-bold uppercase tracking-wider text-paper/80"
                  >
                    {name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Verdict captions */}
          <div className="absolute inset-x-4 bottom-12 flex flex-col items-center gap-1 text-center">
            <p
              data-verdict
              className="font-display text-[0.7rem] font-bold uppercase tracking-widest text-chip"
            >
              {verdict}
            </p>
            <p
              data-lead-cap
              className="font-display text-[0.65rem] font-bold uppercase tracking-widest text-paper/80"
            >
              {leadCap}
            </p>
          </div>
        </div>
      </DemoFelt>
    </div>
  )
}

/** The spec's worked trick: 10♠ led, K♠ over it, a void hand's 3♥, a 2♠ —
 *  and the tiny heart takes it. */
export function TrickSection() {
  return (
    <HowToSection
      kicker="Rule 06"
      title="Winning the trick"
      lead={
        <>
          <p>
            Everyone plays one card; best card takes the trick. <strong>Any heart played?
            Highest heart wins.</strong> No hearts? Highest card of the led suit wins. Off-suit
            junk never wins anything.
          </p>
          <p>The winner collects the trick — and leads the next one.</p>
        </>
      }
    >
      <TrickDemo
        idPrefix="howto-trick"
        plays={[
          { name: 'Ava', card: { suit: 'Spades', rank: 'Ten' }, from: FROM.bottom },
          { name: 'Ben', card: { suit: 'Spades', rank: 'King' }, from: FROM.left },
          { name: 'Cleo', card: { suit: 'Hearts', rank: 'Three' }, from: FROM.top, winner: true },
          { name: 'Dee', card: { suit: 'Spades', rank: 'Two' }, from: FROM.right },
        ]}
        pileSeat="top"
        verdict="A heart hit the table — highest heart wins. 3♥ beats them all."
        leadCap="Cleo takes the trick and leads the next one."
      />
    </HowToSection>
  )
}

/** The same trick with Cleo's heart kept home: nothing trumps, so the
 *  highest card of the led suit wins and her off-suit dump goes nowhere. */
export function TrickNoHeartSection() {
  return (
    <HowToSection
      kicker="Rule 06 · continued"
      title="No heart? Led suit wins"
      lead={
        <>
          <p>
            Same trick, but Cleo holds her heart back and dumps the 7♦ instead. Nothing trumps,
            so the <strong>highest card of the led suit</strong> — Ben's K♠ — takes it.
          </p>
          <p>
            Cleo's diamond may outrank a 2♠, but off-suit cards can never win. A discard is a
            discard.
          </p>
        </>
      }
    >
      <TrickDemo
        idPrefix="howto-trick2"
        plays={[
          { name: 'Ava', card: { suit: 'Spades', rank: 'Ten' }, from: FROM.bottom },
          { name: 'Ben', card: { suit: 'Spades', rank: 'King' }, from: FROM.left, winner: true },
          { name: 'Cleo', card: { suit: 'Diamonds', rank: 'Seven' }, from: FROM.top },
          { name: 'Dee', card: { suit: 'Spades', rank: 'Two' }, from: FROM.right },
        ]}
        pileSeat="left"
        verdict="No hearts this time — highest spade wins. K♠ takes it."
        leadCap="Ben collects the trick and leads the next one."
      />
    </HowToSection>
  )
}
