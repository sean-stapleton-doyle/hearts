import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'

import { api, isApiError } from './api'
import { userKeys } from './query'

/**
 * Prefill an empty display-name field with the logged-in account's
 * username. The field stays editable — accounts are lightweight, and the
 * per-game name is still whatever the player types.
 */
export function useDefaultDisplayName(setName: (update: (current: string) => string) => void) {
  const { data: user } = useQuery({ queryKey: userKeys.me, queryFn: api.currentUser })
  useEffect(() => {
    if (user) setName((current) => current || user.username)
  }, [user, setName])
}

/** Friendly message for a failed create/join, keyed on the error code. The
 *  join page probes joinability up front, but a game can still go stale
 *  between the probe and the click (or the code is typed straight into
 *  `/play`), so map the join-specific codes here too. */
export function joinErrorMessage(error: unknown, fallback: string): string {
  if (!isApiError(error) || error.kind !== 'server') return fallback
  switch (error.code) {
    case 'name_taken':
      return 'That name is already taken in this game — pick another.'
    case 'not_joinable':
      return 'This game has already started.'
    case 'game_full':
      return 'This game is full (7 players).'
    case 'game_not_found':
      return 'No game with that code.'
    default:
      return error.message
  }
}
