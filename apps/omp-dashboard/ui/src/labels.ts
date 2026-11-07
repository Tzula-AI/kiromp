import { activeLocale } from '@kirocrew/app-sdk'
import type { AgentWindow, OmpRunOutcome } from './agents/api'

export const WINDOW_LABEL: Record<AgentWindow, string> = {
  '1h': '1h',
  '3h': '3h',
  '6h': '6h',
  '12h': '12h',
  '24h': '24h',
  '7d': '7d',
  '30d': '30d',
  all: 'All',
}

export const OUTCOME_LABEL: Record<OmpRunOutcome, string> = {
  running: 'Running',
  ok: 'OK',
  error: 'Error',
  aborted: 'Aborted',
  unfinished: 'Unfinished',
  'no data': 'No data',
}

export const OUTCOME_BADGE: Record<OmpRunOutcome, 'ok' | 'err' | 'warn' | 'aim' | 'muted'> = {
  running: 'aim',
  ok: 'ok',
  error: 'err',
  aborted: 'err',
  unfinished: 'warn',
  'no data': 'muted',
}

export function outcomeLabel(outcome: OmpRunOutcome): string {
  return OUTCOME_LABEL[outcome] ?? OUTCOME_LABEL['no data']
}

export function fmtCost(value: number): string {
  const digits = value === 0 ? 2 : value < 0.1 ? 4 : 2
  return new Intl.NumberFormat(activeLocale(), {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: value === 0 || value >= 0.1 ? undefined : digits,
    maximumFractionDigits: digits,
  }).format(value)
}

export function fmtPercent(fraction: number): string {
  return new Intl.NumberFormat(activeLocale(), { style: 'percent', maximumFractionDigits: 0 }).format(fraction)
}

export function fmtCompact(value: number): string {
  return new Intl.NumberFormat(activeLocale(), { notation: 'compact', maximumFractionDigits: 1 }).format(value)
}

export function fmtSpan(ms: number | null | undefined): string {
  if (ms == null || ms <= 0) return '—'
  const total = Math.round(ms / 1000)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

export function fmtCostWhole(value: number): string {
  return new Intl.NumberFormat(activeLocale(), { style: 'currency', currency: 'USD', maximumFractionDigits: value >= 100 ? 0 : 2 }).format(value)
}

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null) return '—'
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`
}
