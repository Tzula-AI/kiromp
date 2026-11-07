import { Bot } from 'lucide-react'
import { fmtNumber } from '@kirocrew/app-sdk'
import { Card, CardTitle, ContentSkeleton } from '@kirocrew/app-sdk/ui'
import { todayAgents } from './agents/api'
import { useRuns } from './agents/useRuns'
import { fmtCost, fmtPercent } from './labels'
import { fmtAgo, fmtResetsIn, severityOf, topLimits, type OmpUsagePayload, type OmpUsageSeverity } from './limits/usage'
import { ApiEquivalentNote, DailyStrip, SpendTiles } from './spend/SpendBlocks'
import { DEFAULT_SPEND_WINDOW, type SpendWindow } from './spend/spend'
import { useSpend } from './spend/useSpend'

const WATCH_COUNT = 5

const BAR_COLOR: Record<OmpUsageSeverity, string> = { ok: 'var(--ok)', warn: 'var(--warn)', danger: 'var(--danger)' }
const PERCENT_COLOR: Record<OmpUsageSeverity, string> = { ok: 'var(--text)', warn: 'var(--warn)', danger: 'var(--danger)' }

function LimitsToWatch({ usage, now, onOpen }: { usage: OmpUsagePayload | undefined; now: number; onOpen: () => void }) {
  const top = topLimits(usage?.reports, WATCH_COUNT)
  return (
    <Card>
      <div className="od-card-head">
        <CardTitle>Limits to watch</CardTitle>
        <button type="button" className="od-link" onClick={onOpen} data-testid="overview-open-limits">All limits →</button>
      </div>
      {top.length === 0 ? (
        <div className="oa-empty">{usage ? (usage.ok ? 'No limits reported.' : (usage.error ?? 'OMP usage is unavailable.')) : 'Loading limits…'}</div>
      ) : (
        <ul className="od-watch" data-testid="overview-limits">
          {top.map(w => {
            const severity = severityOf(w.fraction)
            const resetsAt = w.limit.window?.resetsAt
            const percent = Math.min(100, Math.round(w.fraction * 100))
            return (
              <li key={w.key}>
                <button type="button" className="od-watch-row" onClick={onOpen}>
                  <span className="od-watch-name">
                    <span className="oa-trunc">{w.limit.label}</span>
                    <span className="oa-muted od-sub">{w.account ?? w.provider}</span>
                  </span>
                  <span className="od-watch-track" role="progressbar" aria-label={w.limit.label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
                    <span style={{ width: `${percent}%`, background: BAR_COLOR[severity] }} />
                  </span>
                  <span className="od-watch-pct" style={{ color: PERCENT_COLOR[severity] }}>{fmtPercent(w.fraction)}</span>
                  <span className="oa-muted od-watch-reset">
                    {resetsAt == null ? '' : resetsAt > now ? `↻ ${fmtResetsIn(resetsAt - now)}` : 'resets now'}
                  </span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
      {usage?.fetchedAt ? <div className="oa-muted od-foot">Fetched {fmtAgo(usage.fetchedAt, now)}</div> : null}
    </Card>
  )
}

function AgentsRow({ onOpen }: { onOpen: () => void }) {
  const { data, error } = useRuns()
  const today = data ? todayAgents(data.runs, data.now) : null
  return (
    <Card>
      <div className="od-card-head">
        <CardTitle>Agents</CardTitle>
        <button type="button" className="od-link" onClick={onOpen} data-testid="overview-open-agents">All agents →</button>
      </div>
      {today ? (
        <div className="od-agents-row" data-testid="overview-agents">
          <div className="od-agents-kpi">
            <span className="od-agents-n" data-active={today.running > 0}>
              {today.running > 0 && <Bot size={16} className="oa-pulse" aria-hidden="true" />} {fmtNumber(today.running)}
            </span>
            <span className="oa-muted">running now</span>
          </div>
          <div className="od-agents-kpi">
            <span className="od-agents-n">{fmtNumber(today.runs)}</span>
            <span className="oa-muted">subagent runs today</span>
          </div>
          <div className="od-agents-kpi" title="API-equivalent cost of today's subagent runs">
            <span className="od-agents-n">{fmtCost(today.cost)}</span>
            <span className="oa-muted">subagent cost today</span>
          </div>
        </div>
      ) : error ? (
        <div className="oa-empty">Could not load agent runs.</div>
      ) : (
        <ContentSkeleton rows={1} />
      )}
    </Card>
  )
}

export default function Overview({ usage, now, onOpenTab, onOpenSpend }: {
  usage: OmpUsagePayload | undefined
  now: number
  onOpenTab: (tab: 'limits' | 'agents') => void
  onOpenSpend: (window: SpendWindow) => void
}) {
  const spend = useSpend(DEFAULT_SPEND_WINDOW)
  const data = spend.data
  return (
    <div className="od-scroll" data-testid="overview-tab">
      {data?.available && data.windows && data.daily ? (
        <>
          <SpendTiles windows={data.windows} onSelect={onOpenSpend} />
          <ApiEquivalentNote />
          <Card>
            <CardTitle>Daily spend · last 14 days</CardTitle>
            <DailyStrip daily={data.daily} />
          </Card>
        </>
      ) : data?.error ? (
        <div className="oa-error">Could not read omp's stats database: {data.error}</div>
      ) : !data ? (
        <ContentSkeleton rows={3} />
      ) : null}
      <div className="od-grid2">
        <LimitsToWatch usage={usage} now={now} onOpen={() => onOpenTab('limits')} />
        <AgentsRow onOpen={() => onOpenTab('agents')} />
      </div>
    </div>
  )
}
