import { useEffect, useRef, useState } from 'react'

/**
 * Copy-with-feedback: `copy(text)` writes to the clipboard and raises
 * `copied` for `resetMs`. Clipboard failures (insecure context, permission)
 * are swallowed — the button just doesn't flash, which is the right UX for
 * an optional convenience.
 */
export function useCopyToClipboard(resetMs = 1500): {
  copied: boolean
  copy: (text: string) => Promise<void>
} {
  const [copied, setCopied] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)

  useEffect(() => () => clearTimeout(timer.current), [])

  async function copy(text: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), resetMs)
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return { copied, copy }
}
