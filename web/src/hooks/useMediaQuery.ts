import { useEffect, useState } from 'react'

/** Reactive `matchMedia`. Returns false where matchMedia is unavailable
 *  (jsdom), which selects the mobile table layout in tests. */
export function useMediaQuery(query: string): boolean {
  const supported = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  const [matches, setMatches] = useState(() => (supported ? window.matchMedia(query).matches : false))

  useEffect(() => {
    if (!supported) return
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query, supported])

  return matches
}
