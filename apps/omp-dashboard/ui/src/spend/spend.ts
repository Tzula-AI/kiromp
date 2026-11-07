export const SPEND_WINDOWS = ['24h', '3d', '7d', '30d'] as const
export type SpendWindow = (typeof SPEND_WINDOWS)[number]
export const DEFAULT_SPEND_WINDOW: SpendWindow = '24h'

export const SPEND_WINDOW_TITLE: Record<SpendWindow, string> = {
  '24h': '24 hours',
  '3d': '3 days',
  '7d': '7 days',
  '30d': '30 days',
}

export const API_EQUIVALENT_HINT =
  "API-equivalent: what these tokens would cost at list price. Subscription accounts aren't billed this."

export interface WindowTotals {
  cost: number
  requests: number
  tokens: number
  errors: number
}

export interface SpendSummary extends WindowTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cacheHitRate: number | null
  avgTtftMs: number | null
  tokensPerSecond: number | null
}

export interface SpendRow {
  name: string
  provider?: string
  cost: number
  requests: number
  tokens: number
  share: number
}

export interface SpendDay {
  date: string
  cost: number
  requests: number
}

export interface SpendPayload {
  available: boolean
  error: string | null
  generatedAt: number
  window: SpendWindow
  windows?: Record<SpendWindow, WindowTotals>
  summary?: SpendSummary
  byProvider?: SpendRow[]
  byModel?: SpendRow[]
  byAgentType?: SpendRow[]
  daily?: SpendDay[]
}

export function isSpendWindow(value: string | null | undefined): value is SpendWindow {
  return (SPEND_WINDOWS as readonly string[]).includes(value ?? '')
}
