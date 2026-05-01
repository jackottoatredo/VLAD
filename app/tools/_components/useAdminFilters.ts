'use client'

import { useCallback, useSyncExternalStore } from 'react'
import {
  decodeFiltersFromApi,
  EMPTY_FILTERS,
  type AdminFilters,
} from './filters'

// Tiny localStorage-backed store. Pages pass their own storage key so
// usage and engagement filters persist independently. useSyncExternalStore
// gives us SSR-safe reads + stable references, sidestepping the
// set-state-in-effect lint rule that fires on the more obvious
// "useEffect → setState from localStorage" pattern.

const cache: Record<string, AdminFilters> = {}
const initialized = new Set<string>()
const subscribers = new Set<() => void>()

function subscribe(cb: () => void): () => void {
  subscribers.add(cb)
  return () => {
    subscribers.delete(cb)
  }
}

function readSnapshot(key: string): AdminFilters {
  if (typeof window === 'undefined') return EMPTY_FILTERS
  if (!initialized.has(key)) {
    cache[key] = decodeFiltersFromApi(localStorage.getItem(key))
    initialized.add(key)
  }
  return cache[key]
}

function getServerSnapshot(): AdminFilters {
  return EMPTY_FILTERS
}

export function useAdminFilters(
  storageKey: string,
): [AdminFilters, (next: AdminFilters) => void] {
  const filters = useSyncExternalStore(
    subscribe,
    () => readSnapshot(storageKey),
    getServerSnapshot,
  )

  const setFilters = useCallback(
    (next: AdminFilters) => {
      cache[storageKey] = next
      initialized.add(storageKey)
      try {
        if (next.include.length === 0 && next.exclude.length === 0) {
          localStorage.removeItem(storageKey)
        } else {
          localStorage.setItem(storageKey, JSON.stringify(next))
        }
      } catch {
        /* localStorage unavailable — degrade silently */
      }
      subscribers.forEach((cb) => cb())
    },
    [storageKey],
  )

  return [filters, setFilters]
}
