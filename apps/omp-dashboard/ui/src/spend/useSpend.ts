import { useQuery } from '@tanstack/react-query'
import { useAppApi } from '@kirocrew/app-sdk'
import { API_BASE } from '../config'
import type { SpendPayload, SpendWindow } from './spend'

const SPEND_POLL_MS = 60_000

export function useSpend(window: SpendWindow, enabled = true) {
  const api = useAppApi()
  return useQuery({
    queryKey: ['omp-dashboard', 'spend', window],
    queryFn: () => api.get<SpendPayload>(`${API_BASE}/spend?window=${window}`),
    refetchInterval: SPEND_POLL_MS,
    enabled,
  })
}
