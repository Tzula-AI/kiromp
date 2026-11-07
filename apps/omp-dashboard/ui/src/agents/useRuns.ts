import { useQuery } from '@tanstack/react-query'
import { useAppApi } from '@kirocrew/app-sdk'
import { API_BASE } from '../config'
import type { OmpAgentRunsPayload } from './api'

const RUNS_POLL_MS = 15_000

export function useRuns(enabled = true) {
  const api = useAppApi()
  return useQuery({
    queryKey: ['omp-dashboard', 'runs'],
    queryFn: () => api.get<OmpAgentRunsPayload>(`${API_BASE}/runs`),
    refetchInterval: RUNS_POLL_MS,
    enabled,
  })
}
