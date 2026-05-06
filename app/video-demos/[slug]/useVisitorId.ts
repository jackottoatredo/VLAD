'use client'

import { useSyncExternalStore } from 'react'

const STORAGE_KEY = 'vlad_visitor_id'

// Module-level cache so getSnapshot is stable across calls (required by
// useSyncExternalStore). Visitor ID is created lazily on first client
// access and never changes after that, so a single read suffices.
let cached: string | null | undefined

function readVisitorId(): string | null {
  if (cached !== undefined) return cached
  try {
    let v = localStorage.getItem(STORAGE_KEY)
    if (!v || !/^[a-f0-9-]{16,64}$/i.test(v)) {
      v = crypto.randomUUID()
      localStorage.setItem(STORAGE_KEY, v)
    }
    cached = v
  } catch {
    // localStorage unavailable (private browsing, older iOS Safari).
    // Degrade silently — server-side dedup falls back to ip_hash.
    cached = null
  }
  return cached
}

function subscribe(): () => void {
  // Visitor ID never changes after creation; nothing to subscribe to.
  return () => {}
}

function serverSnapshot(): null {
  return null
}

// Read or generate a stable per-browser visitor ID from localStorage.
// Used to distinguish multiple coworkers behind the same NAT IP — the
// dashboard's "unique visitors" metric prefers visitor_id over ip_hash
// when available. Returns null during SSR and when localStorage is
// unavailable.
export function useVisitorId(): string | null {
  return useSyncExternalStore(subscribe, readVisitorId, serverSnapshot)
}
