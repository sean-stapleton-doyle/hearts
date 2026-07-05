import { describe, expect, it } from 'vitest'
import type { Card } from './types'
import { cardId, displayKey, formatCard, isRedSuit, sortHand, suitToken } from './cards'

const card = (rank: Card['rank'], suit: Card['suit']): Card => ({ rank, suit })

describe('displayKey', () => {
  it('orders suits clubs, diamonds, spades, hearts (trump last)', () => {
    expect(displayKey(card('Two', 'Clubs'))[0]).toBe(0)
    expect(displayKey(card('Two', 'Diamonds'))[0]).toBe(1)
    expect(displayKey(card('Two', 'Spades'))[0]).toBe(2)
    expect(displayKey(card('Two', 'Hearts'))[0]).toBe(3)
  })

  it('ranks low to high, Two=2 .. Ace=14 (matches hearts_core::Rank::value)', () => {
    expect(displayKey(card('Two', 'Clubs'))[1]).toBe(2)
    expect(displayKey(card('Ten', 'Clubs'))[1]).toBe(10)
    expect(displayKey(card('Jack', 'Clubs'))[1]).toBe(11)
    expect(displayKey(card('Ace', 'Clubs'))[1]).toBe(14)
  })
})

describe('sortHand', () => {
  it('groups by suit then rank, does not mutate input', () => {
    const input = [
      card('Ace', 'Hearts'),
      card('Three', 'Spades'),
      card('Two', 'Clubs'),
      card('King', 'Hearts'),
      card('Two', 'Diamonds'),
    ]
    const sorted = sortHand(input)
    expect(sorted.map(cardId)).toEqual([
      'Two-Clubs',
      'Two-Diamonds',
      'Three-Spades',
      'King-Hearts',
      'Ace-Hearts',
    ])
    // input untouched
    expect(input[0]).toEqual(card('Ace', 'Hearts'))
  })
})

describe('formatting', () => {
  it('formatCard matches the CLI log form', () => {
    expect(formatCard(card('Ten', 'Spades'))).toBe('10♠')
    expect(formatCard(card('Queen', 'Hearts'))).toBe('Q♥')
  })

  it('marks diamonds and hearts red, clubs/spades black', () => {
    expect(isRedSuit('Diamonds')).toBe(true)
    expect(isRedSuit('Hearts')).toBe(true)
    expect(isRedSuit('Clubs')).toBe(false)
    expect(isRedSuit('Spades')).toBe(false)
  })

  it('exposes a lowercase suit token for CSS', () => {
    expect(suitToken('Hearts')).toBe('hearts')
  })

  it('cardId is a stable identity', () => {
    expect(cardId(card('Ten', 'Spades'))).toBe('Ten-Spades')
  })
})
