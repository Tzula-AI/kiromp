import { Loader2, RefreshCw } from 'lucide-react'
import type { CSSProperties } from 'react'
import {
  accountLabel, fmtAgo, fmtNumber, fmtPercent, fmtResetsIn, groupByProvider, limitFraction, severityOf,
  type OmpUsageLimit, type OmpUsagePayload, type OmpUsageReport, type OmpUsageSeverity,
} from './usage'

const SEVERITY_COLOR: Record<OmpUsageSeverity, string> = {
  ok: 'var(--ok)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
}

const PERCENT_COLOR: Record<OmpUsageSeverity, string> = {
  ok: 'var(--text)',
  warn: 'var(--warn)',
  danger: 'var(--danger)',
}

const muted: CSSProperties = { color: 'var(--muted)' }
const ellipsis: CSSProperties = { overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }
const spin: CSSProperties = { animation: 'omp-usage-spin 1s linear infinite' }
const KEYFRAMES = '@keyframes omp-usage-spin{to{transform:rotate(360deg)}}@media (prefers-reduced-motion:reduce){[data-omp-usage-spin]{animation:none!important}}'

function LimitRow({ limit, now, compact }: { limit: OmpUsageLimit; now: number; compact: boolean }) {
  const fraction = limitFraction(limit)
  const severity = severityOf(fraction)
  const percent = fraction == null ? 0 : Math.min(100, Math.round(fraction * 100))
  const amount = limit.amount
  const showAmount = amount?.used != null && amount.limit != null && amount.unit !== 'percent'
  const resetsAt = limit.window?.resetsAt
  const upcoming = resetsAt != null && resetsAt > now
  const resetText = resetsAt == null ? '' : upcoming ? `↻ ${fmtResetsIn(resetsAt - now)}` : 'Resets momentarily'
  const amountText = showAmount
    ? `${fmtNumber(amount.used!)} / ${fmtNumber(amount.limit!)} ${amount.unit ?? ''}`.trim()
    : ''
  const columns = compact ? 'minmax(0,1fr) 48px 38px 64px' : 'minmax(0,1fr) 120px 48px 76px'
  return (
    <li
      data-testid="omp-usage-limit"
      title={upcoming ? `Resets in ${fmtResetsIn(resetsAt! - now)}` : undefined}
      style={{ display: 'grid', gridTemplateColumns: columns, alignItems: 'center', columnGap: 12, padding: '4px 0' }}
    >
      <span style={{ minWidth: 0, display: 'flex', flexDirection: 'column' }}>
        <span style={{ ...ellipsis, fontSize: 13, color: 'var(--text)' }}>{limit.label}</span>
        {amountText && <span style={{ ...muted, ...ellipsis, fontSize: 11, fontVariantNumeric: 'tabular-nums' }}>{amountText}</span>}
      </span>
      <span
        role="progressbar"
        aria-label={limit.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
        data-severity={severity}
        style={{ height: 8, borderRadius: 4, background: 'var(--bg-hover)', overflow: 'hidden' }}
      >
        <span style={{ display: 'block', height: '100%', width: `${percent}%`, background: SEVERITY_COLOR[severity], borderRadius: 4 }} />
      </span>
      <span style={{ fontSize: 13, fontWeight: 600, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: PERCENT_COLOR[severity] }}>
        {fraction == null ? '—' : fmtPercent(fraction)}
      </span>
      <span style={{ ...muted, fontSize: 11.5, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>{resetText}</span>
    </li>
  )
}

function AccountBlock({ report, now, compact }: { report: OmpUsageReport; now: number; compact: boolean }) {
  const name = accountLabel(report)
  const plan = report.metadata?.planType
  const limits = report.limits ?? []
  return (
    <div
      data-testid="omp-usage-account"
      style={{ display: 'flex', flexDirection: 'column', gap: 6, borderRadius: 8, background: 'var(--bg-elevated)', border: '1px solid var(--border)', padding: '10px 12px' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
        {name && <span title={name} style={{ ...ellipsis, fontSize: 13, fontWeight: 600, color: 'var(--text)' }}>{name}</span>}
        {plan && <span style={{ ...muted, flexShrink: 0, fontSize: 10.5, padding: '0 6px', borderRadius: 4, border: '1px solid var(--border)' }}>{plan}</span>}
        {report.fetchedAt != null && <span style={{ ...muted, marginLeft: 'auto', flexShrink: 0, fontSize: 11 }}>{fmtAgo(report.fetchedAt, now)}</span>}
      </div>
      {limits.length === 0
        ? <p style={{ ...muted, margin: 0, fontSize: 12 }}>No usage data</p>
        : (
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column' }}>
            {limits.map(l => <LimitRow key={l.id} limit={l} now={now} compact={compact} />)}
          </ul>
        )}
    </div>
  )
}

export interface UsagePanelProps {
  data: OmpUsagePayload | undefined
  error: string | null
  loading: boolean
  refreshing: boolean
  onRefresh: () => void
  compact?: boolean
  now?: number
}

export default function UsagePanel({ data, error, loading, refreshing, onRefresh, compact = false, now = Date.now() }: UsagePanelProps) {
  const groups = groupByProvider(data?.reports)
  const failure = error ?? (data && !data.ok ? (data.error ?? 'OMP usage is unavailable.') : null)
  return (
    <div data-testid="omp-usage-panel" style={{ display: 'flex', flexDirection: 'column' }}>
      <style>{KEYFRAMES}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: compact ? '10px 12px' : '0 0 12px', borderBottom: compact ? '1px solid var(--border)' : undefined }}>
        {compact && <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text)' }}>OMP usage</span>}
        {data?.fetchedAt ? <span style={{ ...muted, fontSize: 11.5 }}>Fetched {fmtAgo(data.fetchedAt, now)}</span> : null}
        <button
          type="button"
          aria-label="Refresh usage"
          title="Refresh usage"
          onClick={onRefresh}
          disabled={refreshing}
          style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 26, height: 26, borderRadius: 6, border: '1px solid var(--border)', background: 'transparent', color: 'var(--muted)', cursor: refreshing ? 'default' : 'pointer' }}
        >
          {refreshing ? <Loader2 size={13} style={spin} data-omp-usage-spin="" /> : <RefreshCw size={13} />}
        </button>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16, padding: compact ? 12 : '12px 0', maxHeight: compact ? 'min(70vh, 520px)' : undefined, overflowY: compact ? 'auto' : undefined }}>
        {failure && (
          <div role="alert" style={{ borderRadius: 8, padding: '10px 12px', background: 'var(--danger-subtle)', border: '1px solid var(--danger)', color: 'var(--text)', fontSize: 12.5 }}>
            <strong style={{ display: 'block', marginBottom: 2 }}>Couldn't load OMP usage</strong>
            {failure}
          </div>
        )}
        {loading && !data && (
          <div role="status" style={{ ...muted, display: 'flex', alignItems: 'center', gap: 8, fontSize: 11.5 }}>
            <Loader2 size={13} style={spin} data-omp-usage-spin="" aria-hidden="true" />
            Loading usage…
          </div>
        )}
        {data && groups.length === 0 && !failure && <p style={{ ...muted, margin: 0, fontSize: 11.5 }}>No accounts reported usage.</p>}
        {groups.map(g => (
          <section key={g.provider} data-testid="omp-usage-provider" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <h3 style={{ ...muted, margin: 0, display: 'flex', alignItems: 'baseline', gap: 6, fontSize: 11.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              <span>{g.provider}</span>
              <span style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 'normal' }}>· {g.accounts.length}</span>
            </h3>
            {g.accounts.map((r, i) => (
              <AccountBlock key={`${r.metadata?.accountId ?? r.metadata?.email ?? ''}:${i}`} report={r} now={now} compact={compact} />
            ))}
          </section>
        ))}
      </div>
    </div>
  )
}
