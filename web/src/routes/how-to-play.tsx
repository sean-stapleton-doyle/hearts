import { createFileRoute } from '@tanstack/react-router'

import { BiddingSection } from '../components/howto/sections/BiddingSection'
import { CtaSection } from '../components/howto/sections/CtaSection'
import { DealSection } from '../components/howto/sections/DealSection'
import { DeckLoopSection } from '../components/howto/sections/DeckLoopSection'
import { FollowSuitSection } from '../components/howto/sections/FollowSuitSection'
import { HeroSection } from '../components/howto/sections/HeroSection'
import { RoundLadderSection } from '../components/howto/sections/RoundLadderSection'
import { ScoringSection } from '../components/howto/sections/ScoringSection'
import { TrickNoHeartSection, TrickSection } from '../components/howto/sections/TrickSection'
import { TrumpSection } from '../components/howto/sections/TrumpSection'

export const Route = createFileRoute('/how-to-play')({ component: HowToPlayPage })

/**
 * Scroll-driven rules tutorial. Sections are ordered the way a round
 * actually plays out — deal, bid, play, score — with the deterministic-deck
 * twist as the finale. Each section owns its own ScrollTrigger scene
 * (lib/scroll-anim.ts) and renders complete without one.
 */
function HowToPlayPage() {
  // Block flow + margins on <main>, NOT flex/gap: ScrollTrigger's
  // pin-spacers reserve the pin distance with padding, which flex layout
  // ignores — under a flex column every pinned section's neighbors slid up
  // and stacked on top of it.
  return (
    <main className="mx-auto w-full max-w-2xl space-y-24 px-5 pb-24 pt-6">
      <HeroSection />
      <RoundLadderSection />
      <DealSection />
      <BiddingSection />
      <TrumpSection />
      <FollowSuitSection />
      <TrickSection />
      <TrickNoHeartSection />
      <ScoringSection />
      <DeckLoopSection />
      <CtaSection />
    </main>
  )
}
