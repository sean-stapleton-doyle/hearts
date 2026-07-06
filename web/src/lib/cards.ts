// Card display helpers. `displayKey` is a faithful port of `display_key`
// from hearts-cli/src/app.rs:351 — suit groups (trump last), low→high within
// a suit — and is the sole sort order used for hands.
import type { Card, Rank, Suit } from './types'

const SUIT_ORDER: Record<Suit, number> = {
  Clubs: 0,
  Diamonds: 1,
  Spades: 2,
  Hearts: 3, // permanent trump, always sorted last
}

// Matches hearts_core::Rank::value (Two=2 .. Ace=14).
const RANK_VALUE: Record<Rank, number> = {
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
  Six: 6,
  Seven: 7,
  Eight: 8,
  Nine: 9,
  Ten: 10,
  Jack: 11,
  Queen: 12,
  King: 13,
  Ace: 14,
}

export function displayKey(card: Card): [number, number] {
  return [SUIT_ORDER[card.suit], RANK_VALUE[card.rank]]
}

/** A new array, sorted in display order (mutates nothing). */
export function sortHand(cards: readonly Card[]): Card[] {
  return [...cards].sort((a, b) => {
    const [sa, ra] = displayKey(a)
    const [sb, rb] = displayKey(b)
    return sa - sb || ra - rb
  })
}

export const SUIT_GLYPH: Record<Suit, string> = {
  Clubs: '♣',
  Diamonds: '♦',
  Spades: '♠',
  Hearts: '♥',
}

export const RANK_LABEL: Record<Rank, string> = {
  Two: '2',
  Three: '3',
  Four: '4',
  Five: '5',
  Six: '6',
  Seven: '7',
  Eight: '8',
  Nine: '9',
  Ten: '10',
  Jack: 'J',
  Queen: 'Q',
  King: 'K',
  Ace: 'A',
}

/** Compact single-token form, e.g. `10♠` — matches the CLI's log lines. */
export function formatCard(card: Card): string {
  return `${RANK_LABEL[card.rank]}${SUIT_GLYPH[card.suit]}`
}

/** Stable identity for a card, useful for React keys and Flip targeting. */
export function cardId(card: Card): string {
  return `${card.rank}-${card.suit}`
}

const SUIT_NAME: Record<Suit, string> = {
  Clubs: 'clubs',
  Diamonds: 'diamonds',
  Spades: 'spades',
  Hearts: 'hearts',
}

/** Lowercase suit token for CSS class generation (e.g. `suit-hearts`). */
export function suitToken(suit: Suit): string {
  return SUIT_NAME[suit]
}
