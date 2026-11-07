export type OmpUsageStatus = 'ok' | 'warning' | 'exhausted' | 'unknown' | (string & {})

export interface OmpUsageAmount {
  used?: number
  limit?: number
  remaining?: number
  usedFraction?: number
  remainingFraction?: number
  unit?: string
}

export interface OmpUsageLimit {
  id: string
  label: string
  window?: { id?: string; label?: string; durationMs?: number; resetsAt?: number }
  amount?: OmpUsageAmount
  status?: OmpUsageStatus
}

export interface OmpUsageReport {
  provider: string
  fetchedAt?: number
  limits?: OmpUsageLimit[]
  metadata?: { email?: string; orgName?: string; accountId?: string; planType?: string }
}

export interface OmpUsageAlert {
  provider: string
  account?: string | null
  limitId: string
  label: string
  usedFraction: number
  resetsAt?: number | null
  status: OmpUsageStatus
}

export interface OmpUsagePayload {
  ok: boolean
  error: string | null
  fetchedAt: number | null
  reports: OmpUsageReport[]
  alerts: OmpUsageAlert[]
}

export const OMP_USAGE_WARN_FRACTION = 0.75
export const OMP_USAGE_DANGER_FRACTION = 0.9
export const OMP_USAGE_POLL_MS = 60_000

export type OmpUsageSeverity = 'ok' | 'warn' | 'danger'

export function limitFraction(limit: OmpUsageLimit): number | null {
  if (limit.status === 'exhausted') return 1
  const f = limit.amount?.usedFraction
  return typeof f === 'number' && Number.isFinite(f) ? Math.max(0, f) : null
}

export function severityOf(fraction: number | null): OmpUsageSeverity {
  if (fraction == null) return 'ok'
  if (fraction >= OMP_USAGE_DANGER_FRACTION) return 'danger'
  if (fraction >= OMP_USAGE_WARN_FRACTION) return 'warn'
  return 'ok'
}

export function worstFraction(reports: readonly OmpUsageReport[] | undefined): number | null {
  let worst: number | null = null
  for (const r of reports ?? []) {
    for (const l of r.limits ?? []) {
      const f = limitFraction(l)
      if (f != null && (worst == null || f > worst)) worst = f
    }
  }
  return worst
}

export function accountLabel(report: OmpUsageReport): string | null {
  const m = report.metadata
  if (m?.email) return m.email
  if (m?.orgName) return m.orgName
  if (m?.accountId) return m.accountId.slice(0, 8)
  return null
}

export interface OmpUsageProviderGroup {
  provider: string
  accounts: OmpUsageReport[]
}

export function groupByProvider(reports: readonly OmpUsageReport[] | undefined): OmpUsageProviderGroup[] {
  const groups = new Map<string, OmpUsageProviderGroup>()
  for (const r of reports ?? []) {
    let g = groups.get(r.provider)
    if (!g) {
      g = { provider: r.provider, accounts: [] }
      groups.set(r.provider, g)
    }
    g.accounts.push(r)
  }
  return [...groups.values()]
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

export function fmtPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`
}

export function fmtNumber(n: number): string {
  return n.toLocaleString('en-US', { maximumFractionDigits: 1 })
}

export function fmtResetsIn(ms: number): string {
  if (ms >= DAY_MS) return joinParts([[Math.floor(ms / DAY_MS), 'd'], [Math.floor((ms % DAY_MS) / HOUR_MS), 'h']])
  if (ms >= HOUR_MS) return joinParts([[Math.floor(ms / HOUR_MS), 'h'], [Math.floor((ms % HOUR_MS) / MINUTE_MS), 'm']])
  return `${Math.max(1, Math.floor(ms / MINUTE_MS))}m`
}

function joinParts(parts: [number, string][]): string {
  return parts.filter(([n]) => n > 0).map(([n, u]) => `${n}${u}`).join(' ')
}

export function fmtAgo(ts: number, now: number): string {
  const ms = Math.max(0, now - ts)
  if (ms < MINUTE_MS) return 'just now'
  if (ms < HOUR_MS) return `${Math.floor(ms / MINUTE_MS)}m ago`
  if (ms < DAY_MS) return `${Math.floor(ms / HOUR_MS)}h ago`
  return `${Math.floor(ms / DAY_MS)}d ago`
}
