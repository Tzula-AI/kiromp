import { useAppApi, useAppInfo } from '@kirocrew/app-sdk'
import { useCallback, useEffect, useRef, useState } from 'react'
import { OMP_USAGE_POLL_MS, type OmpUsagePayload } from './usage'

const USAGE_PATH = '/apps/omp-usage/api/usage'

export interface OmpUsageState {
  data: OmpUsagePayload | undefined
  error: string | null
  loading: boolean
  refreshing: boolean
  refresh: () => void
}

// Paints the backend's cached snapshot at once, then asks it to run `omp usage` (`?refresh=1`,
// seconds-slow). While visible it re-reads the cache every minute.
export function useOmpUsage(): OmpUsageState {
  const api = useAppApi()
  const apiRef = useRef(api)
  apiRef.current = api
  const { active } = useAppInfo()
  const visible = active !== false
  const [data, setData] = useState<OmpUsagePayload>()
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const alive = useRef(true)
  const inflight = useRef(false)

  useEffect(() => {
    alive.current = true
    return () => { alive.current = false }
  }, [])

  const read = useCallback(async (force: boolean) => {
    try {
      const payload = await apiRef.current.get<OmpUsagePayload>(force ? `${USAGE_PATH}?refresh=1` : USAGE_PATH)
      if (!alive.current) return
      setData(payload)
      setError(null)
    } catch (e) {
      if (alive.current) setError(e instanceof Error ? e.message : String(e))
    } finally {
      if (alive.current) setLoading(false)
    }
  }, [])

  const refresh = useCallback(() => {
    if (inflight.current) return
    inflight.current = true
    setRefreshing(true)
    void read(true).finally(() => {
      inflight.current = false
      if (alive.current) setRefreshing(false)
    })
  }, [read])

  useEffect(() => {
    if (!visible) return
    void read(false).then(() => refresh())
    const id = setInterval(() => { void read(false) }, OMP_USAGE_POLL_MS)
    return () => clearInterval(id)
  }, [visible, read, refresh])

  return { data, error, loading, refreshing, refresh }
}
