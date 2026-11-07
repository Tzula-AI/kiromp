import { fmtDate, fmtNumber } from '@kirocrew/app-sdk'
import { fmtCompact, fmtCost, fmtCostWhole, fmtMs, fmtPercent } from '../labels'
import {
  API_EQUIVALENT_HINT, SPEND_WINDOWS, SPEND_WINDOW_TITLE,
  type SpendDay, type SpendPayload, type SpendRow, type SpendSummary, type SpendWindow, type WindowTotals,
} from './spend'

export function SpendTiles({ windows, selected, onSelect }: {
  windows: Record<SpendWindow, WindowTotals>
  selected?: SpendWindow
  onSelect: (window: SpendWindow) => void
}) {
  return (
    <div className="od-tiles" data-testid="spend-tiles">
      {SPEND_WINDOWS.map(w => {
        const t = windows[w]
        return (
          <button
            key={w}
            type="button"
            className="od-tile"
            data-selected={selected === w}
            data-testid={`spend-tile-${w}`}
            title={API_EQUIVALENT_HINT}
            onClick={() => onSelect(w)}
          >
            <span className="od-tile-label">{SPEND_WINDOW_TITLE[w]}</span>
            <span className="od-tile-cost">{fmtCostWhole(t.cost)}</span>
            <span className="od-tile-sub">{fmtNumber(t.requests)} requests · {fmtCompact(t.tokens)} tokens</span>
          </button>
        )
      })}
    </div>
  )
}

export function ApiEquivalentNote({ inline = false }: { inline?: boolean }) {
  return (
    <div className={inline ? 'od-note' : 'od-note od-note-block'} title={API_EQUIVALENT_HINT}>
      API-equivalent cost · list price, not billed on subscription accounts
    </div>
  )
}

export function DailyStrip({ daily }: { daily: readonly SpendDay[] }) {
  const max = Math.max(...daily.map(d => d.cost), 0)
  const todayIndex = daily.length - 1
  return (
    <div className="od-strip" data-testid="spend-daily" role="img" aria-label="Daily API-equivalent spend, last 14 days">
      <div className="od-strip-bars">
        {daily.map((d, i) => (
          <div
            key={d.date}
            className="od-strip-col"
            title={`${fmtDate(`${d.date}T12:00:00`)} · ${fmtCost(d.cost)} · ${fmtNumber(d.requests)} requests`}
          >
            <div
              className="od-strip-bar"
              data-today={i === todayIndex}
              data-testid="spend-daily-bar"
              style={{ height: `${max > 0 ? Math.max(d.cost > 0 ? 3 : 0, (d.cost / max) * 100) : 0}%` }}
            />
          </div>
        ))}
      </div>
      <div className="od-strip-axis">
        <span>{fmtDate(`${daily[0].date}T12:00:00`)}</span>
        <span>peak {fmtCostWhole(max)}</span>
        <span>today</span>
      </div>
    </div>
  )
}

function ShareBar({ share }: { share: number }) {
  return (
    <span className="od-share">
      <span className="od-share-track"><span className="od-share-fill" style={{ width: `${Math.min(100, Math.max(0, share * 100))}%` }} /></span>
      <span className="od-share-pct">{fmtPercent(share)}</span>
    </span>
  )
}

export function BreakdownTable({ rows, nameLabel, testId }: { rows: readonly SpendRow[]; nameLabel: string; testId: string }) {
  if (rows.length === 0) return <div className="oa-empty">No requests in this window.</div>
  return (
    <table className="oa-table" data-testid={testId}>
      <thead>
        <tr>
          <th>{nameLabel}</th>
          <th className="num" title={API_EQUIVALENT_HINT}>Cost</th>
          <th className="num">Requests</th>
          <th className="num">Tokens</th>
          <th>Share</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(r => (
          <tr key={`${r.provider ?? ''}/${r.name}`}>
            <td>
              <span className="oa-trunc" title={r.provider ? `${r.provider} / ${r.name}` : r.name}>{r.name}</span>
              {r.provider && <span className="oa-muted od-sub">{r.provider}</span>}
            </td>
            <td className="num">{fmtCost(r.cost)}</td>
            <td className="num">{fmtNumber(r.requests)}</td>
            <td className="num">{fmtCompact(r.tokens)}</td>
            <td><ShareBar share={r.share} /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function SpendStats({ summary }: { summary: SpendSummary }) {
  const items: { label: string; value: string; hint: string }[] = [
    { label: 'API-equivalent cost', value: fmtCost(summary.cost), hint: API_EQUIVALENT_HINT },
    { label: 'Requests', value: fmtNumber(summary.requests), hint: `${fmtNumber(summary.errors)} ended in an error` },
    { label: 'Tokens', value: fmtCompact(summary.tokens), hint: `${fmtCompact(summary.inputTokens)} input · ${fmtCompact(summary.outputTokens)} output · ${fmtCompact(summary.cacheReadTokens)} cache read · ${fmtCompact(summary.cacheWriteTokens)} cache write` },
    { label: 'Cache hit rate', value: summary.cacheHitRate == null ? '—' : fmtPercent(summary.cacheHitRate), hint: 'Cache-read tokens over all prompt tokens (input + cache read + cache write)' },
    { label: 'Avg TTFT', value: fmtMs(summary.avgTtftMs), hint: 'Mean time to first token' },
    { label: 'Tokens / s', value: summary.tokensPerSecond == null ? '—' : fmtNumber(summary.tokensPerSecond, { maximumFractionDigits: 0 }), hint: 'Output tokens over generation time, summed across requests' },
    { label: 'Errors', value: fmtNumber(summary.errors), hint: 'Requests whose stop reason is "error"' },
  ]
  return (
    <div className="od-stats" data-testid="spend-stats">
      {items.map(i => (
        <div key={i.label} className="od-stat" title={i.hint}>
          <div className="od-stat-label">{i.label}</div>
          <div className="od-stat-value">{i.value}</div>
        </div>
      ))}
    </div>
  )
}

export function SpendUnavailable({ payload }: { payload: SpendPayload | undefined }) {
  return (
    <div className="oa-empty" data-testid="spend-unavailable">
      {payload?.error ? `Could not read omp's stats database: ${payload.error}` : 'omp has no stats database here yet, so there is no spend to show.'}
    </div>
  )
}
