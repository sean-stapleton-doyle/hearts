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

/** Friendly message for a failed create/join, keyed on the error code. */
export function joinErrorMessage(error: unknown, fallback: string): string {
  if (!isApiError(error)) return fallback
  if (error.kind === 'server' && error.code === 'name_taken') {
    return 'That name is already taken in this game — pick another.'
  }
  return error.message
}
