import { Activity } from 'lucide-react'
import { fmtDateTime, fmtNumber, fmtRelative } from '@kirocrew/app-sdk'
import { Badge } from '@kirocrew/app-sdk/ui'
import { agentFill, type AgentTypeStats, type OmpAgentRun } from './api'
import { fmtCompact, fmtCost, fmtPercent, fmtSpan, OUTCOME_BADGE, outcomeLabel } from '../labels'

function RunName({ run, onOpen }: { run: OmpAgentRun; onOpen: (run: OmpAgentRun) => void }) {
  return (
    <button
      type="button"
      className="oa-name"
      onClick={e => { e.stopPropagation(); onOpen(run) }}
      aria-label={`Open run ${run.name}`}
      title={run.key}
    >
      {run.name}
    </button>
  )
}

function OutcomeBadge({ run }: { run: OmpAgentRun }) {
  return (
    <Badge variant={OUTCOME_BADGE[run.outcome] ?? 'muted'} style={{ fontSize: 11, paddingTop: 0, paddingBottom: 0 }}>
      {run.outcome === 'running' && <Activity size={11} className="oa-pulse" aria-hidden="true" />}
      {outcomeLabel(run.outcome)}
    </Badge>
  )
}

export function AgentTypeTable({ stats, now }: { stats: readonly AgentTypeStats[]; now: number }) {
  return (
    <table className="oa-table" data-testid="agents-type-table">
      <thead>
        <tr>
          <th>Agent</th>
          <th className="num">Spawned</th>
          <th className="num">OK rate</th>
          <th className="num">Errors</th>
          <th className="num">Aborted</th>
          <th className="num">Cost</th>
          <th className="num">Tokens</th>
          <th className="num">Median duration</th>
          <th className="num">Tools / run</th>
          <th>Models</th>
          <th>Last used</th>
        </tr>
      </thead>
      <tbody>
        {stats.map((s, i) => (
          <tr key={s.agent} data-testid={`agents-type-row-${s.agent}`}>
            <td>
              <span className="oa-inline">
                <span className="oa-swatch" style={{ background: agentFill(i) }} aria-hidden="true" />
                <span className="oa-mono" style={{ color: 'var(--text-strong)' }}>{s.agent}</span>
                {s.running > 0 && (
                  <Badge variant="aim" style={{ fontSize: 11, paddingTop: 0, paddingBottom: 0 }}>{fmtNumber(s.running)} running</Badge>
                )}
              </span>
            </td>
            <td className="num">{fmtNumber(s.spawned)}</td>
            <td className="num">{s.okRate == null ? '—' : fmtPercent(s.okRate)}</td>
            <td className="num" style={{ color: s.error > 0 ? 'var(--danger)' : 'var(--muted)' }}>{fmtNumber(s.error)}</td>
            <td className="num" style={{ color: s.aborted > 0 ? 'var(--danger)' : 'var(--muted)' }}>{fmtNumber(s.aborted)}</td>
            <td className="num">
              <span>{fmtCost(s.cost)}</span>
              <span className="oa-muted" style={{ display: 'block', fontSize: 11 }}>{fmtCost(s.spawned > 0 ? s.cost / s.spawned : 0)} / run</span>
            </td>
            <td className="num">{fmtCompact(s.tokens)}</td>
            <td className="num">{fmtSpan(s.medianDurationMs)}</td>
            <td className="num">{fmtNumber(s.spawned > 0 ? s.tools / s.spawned : 0, { maximumFractionDigits: 1 })}</td>
            <td>
              <span className="oa-models">
                {s.models.slice(0, 3).map(m => (
                  <Badge key={m.model} variant="muted" className="oa-mono" style={{ fontSize: 11, paddingTop: 0, paddingBottom: 0 }} title={fmtNumber(m.count)}>{m.model}</Badge>
                ))}
              </span>
            </td>
            <td className="oa-muted" title={fmtDateTime(s.lastUsed)}>{fmtRelative(s.lastUsed, { now })}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

interface RunTableProps {
  runs: readonly OmpAgentRun[]
  selectedKey: string | null
  onOpen: (run: OmpAgentRun) => void
}

export function RunningList({ runs, now, selectedKey, onOpen }: RunTableProps & { now: number }) {
  return (
    <table className="oa-table" data-testid="agents-running-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Agent</th>
          <th>Project</th>
          <th>Model</th>
          <th className="num">Elapsed</th>
          <th className="num">Cost</th>
        </tr>
      </thead>
      <tbody>
        {runs.map(r => (
          <tr key={r.key} className="oa-click" data-selected={r.key === selectedKey} onClick={() => onOpen(r)} data-testid="agents-running-row">
            <td>
              <span className="oa-inline">
                <Activity size={13} className="oa-pulse" style={{ color: 'var(--aim)', flex: 'none' }} aria-hidden="true" />
                <RunName run={r} onOpen={onOpen} />
              </span>
            </td>
            <td className="oa-mono">{r.kind === 'main' ? 'main session' : r.agent}</td>
            <td className="oa-muted"><span className="oa-trunc" title={r.project}>{r.project}</span></td>
            <td className="oa-mono oa-muted">{r.model}</td>
            <td className="num">{fmtSpan(now - r.start)}</td>
            <td className="num">{fmtCost(r.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}

export function RecentRunsTable({ runs, selectedKey, onOpen }: RunTableProps) {
  return (
    <table className="oa-table" data-testid="agents-recent-table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Agent</th>
          <th>Outcome</th>
          <th>Project</th>
          <th>Model</th>
          <th>Started</th>
          <th className="num">Duration</th>
          <th className="num">Tokens</th>
          <th className="num">Tools</th>
          <th className="num">Cost</th>
        </tr>
      </thead>
      <tbody>
        {runs.map(r => (
          <tr key={r.key} className="oa-click" data-selected={r.key === selectedKey} onClick={() => onOpen(r)} data-testid="agents-recent-row">
            <td><RunName run={r} onOpen={onOpen} /></td>
            <td className="oa-mono">{r.agent}</td>
            <td><OutcomeBadge run={r} /></td>
            <td className="oa-muted"><span className="oa-trunc" title={r.project}>{r.project}</span></td>
            <td className="oa-mono oa-muted">{r.model}</td>
            <td className="oa-muted">{fmtDateTime(r.start)}</td>
            <td className="num">{fmtSpan(r.duration_ms)}</td>
            <td className="num">{fmtCompact(r.tokens)}</td>
            <td className="num">{fmtNumber(r.tools)}</td>
            <td className="num">{fmtCost(r.cost)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
