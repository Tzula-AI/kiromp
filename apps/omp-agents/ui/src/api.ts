export type OmpRunKind = 'main' | 'subagent'

export type OmpRunOutcome = 'running' | 'ok' | 'error' | 'aborted' | 'unfinished' | 'no data'

export interface OmpAgentRun {
  key: string
  name: string
  kind: OmpRunKind
  agent: string
  parent_key: string | null
  project: string
  model: string
  start: number
  last_activity: number
  duration_ms: number
  tokens: number
  cost: number
  tools: number
  outcome: OmpRunOutcome
}

export interface OmpAgentRunsPayload {
  now: number
  runs: OmpAgentRun[]
}

export type OmpSessionRole = 'user' | 'assistant' | 'tool'

export interface OmpSessionMessage {
  ts: number
  role: OmpSessionRole
  tool_name: string | null
  text: string
}

export interface OmpAgentSessionPayload {
  key: string
  name: string
  kind: OmpRunKind
  agent: string
  model: string
  project: string
  outcome: OmpRunOutcome
  start: number
  last_activity: number
  messages: OmpSessionMessage[]
}

export const API_BASE = '/apps/omp-agents/api'

export const AGENT_WINDOWS = ['1h', '3h', '6h', '12h', '24h', '7d', '30d', 'all'] as const
export type AgentWindow = (typeof AGENT_WINDOWS)[number]
export const DEFAULT_AGENT_WINDOW: AgentWindow = '24h'

const HOUR = 3_600_000
const DAY = 24 * HOUR

export const WINDOW_MS: Record<AgentWindow, number | null> = {
  '1h': HOUR,
  '3h': 3 * HOUR,
  '6h': 6 * HOUR,
  '12h': 12 * HOUR,
  '24h': DAY,
  '7d': 7 * DAY,
  '30d': 30 * DAY,
  all: null,
}

export function bucketMs(window: AgentWindow, spanMs: number): number {
  switch (window) {
    case '1h':
    case '3h': return 10 * 60_000
    case '6h': return 15 * 60_000
    case '12h': return 30 * 60_000
    case '24h': return HOUR
    case '7d':
    case '30d': return DAY
    case 'all': return spanMs > 60 * DAY ? 7 * DAY : DAY
  }
}

export function runsInWindow(runs: readonly OmpAgentRun[], window: AgentWindow, now: number): OmpAgentRun[] {
  const len = WINDOW_MS[window]
  if (len == null) return [...runs]
  const since = now - len
  return runs.filter(r => r.start >= since)
}

export function spawnedRuns(runs: readonly OmpAgentRun[]): OmpAgentRun[] {
  return runs.filter(r => r.kind === 'subagent')
}

export interface AgentTypeStats {
  agent: string
  spawned: number
  ok: number
  error: number
  aborted: number
  running: number
  okRate: number | null
  cost: number
  tokens: number
  tools: number
  medianDurationMs: number | null
  models: { model: string; count: number }[]
  lastUsed: number
}

export interface AgentKpis {
  spawned: number
  finished: number
  ok: number
  okRate: number | null
  cost: number
  agentTypes: number
  running: number
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

export function runningRuns(runs: readonly OmpAgentRun[]): OmpAgentRun[] {
  return runs.filter(r => r.outcome === 'running').sort((a, b) => b.last_activity - a.last_activity)
}

export function kpisOf(spawned: readonly OmpAgentRun[], running: number): AgentKpis {
  let ok = 0
  let finished = 0
  let cost = 0
  const types = new Set<string>()
  for (const r of spawned) {
    types.add(r.agent)
    cost += r.cost
    if (r.outcome === 'running') continue
    finished += 1
    if (r.outcome === 'ok') ok += 1
  }
  return {
    spawned: spawned.length,
    finished,
    ok,
    okRate: finished > 0 ? ok / finished : null,
    cost,
    agentTypes: types.size,
    running,
  }
}

export function statsByAgent(spawned: readonly OmpAgentRun[]): AgentTypeStats[] {
  const acc = new Map<string, { s: AgentTypeStats; durations: number[]; models: Map<string, number> }>()
  for (const r of spawned) {
    let e = acc.get(r.agent)
    if (!e) {
      e = {
        s: {
          agent: r.agent, spawned: 0, ok: 0, error: 0, aborted: 0, running: 0, okRate: null,
          cost: 0, tokens: 0, tools: 0, medianDurationMs: null, models: [], lastUsed: 0,
        },
        durations: [],
        models: new Map(),
      }
      acc.set(r.agent, e)
    }
    const s = e.s
    s.spawned += 1
    s.cost += r.cost
    s.tokens += r.tokens
    s.tools += r.tools
    if (r.start > s.lastUsed) s.lastUsed = r.start
    switch (r.outcome) {
      case 'ok': s.ok += 1; break
      case 'error': s.error += 1; break
      case 'aborted': s.aborted += 1; break
      case 'running': s.running += 1; break
    }
    if (r.duration_ms > 0) e.durations.push(r.duration_ms)
    if (r.model) e.models.set(r.model, (e.models.get(r.model) ?? 0) + 1)
  }
  const out: AgentTypeStats[] = []
  for (const { s, durations, models } of acc.values()) {
    const finished = s.spawned - s.running
    s.okRate = finished > 0 ? s.ok / finished : null
    s.medianDurationMs = median(durations)
    s.models = [...models.entries()].map(([model, count]) => ({ model, count })).sort((a, b) => b.count - a.count)
    out.push(s)
  }
  return out.sort((a, b) => b.spawned - a.spawned || a.agent.localeCompare(b.agent))
}

export interface TimelineBucket {
  t: number
  counts: number[]
  total: number
}

export interface Timeline {
  agents: string[]
  buckets: TimelineBucket[]
  bucketMs: number
  max: number
}

export function timelineOf(spawned: readonly OmpAgentRun[], window: AgentWindow, now: number): Timeline {
  const agents = statsByAgent(spawned).map(s => s.agent)
  const index = new Map(agents.map((a, i) => [a, i]))
  const len = WINDOW_MS[window]
  let since: number
  if (len != null) since = now - len
  else {
    since = now
    for (const r of spawned) if (r.start < since) since = r.start
  }
  const width = bucketMs(window, now - since)
  const align = (t: number) => {
    if (width < DAY) return Math.floor(t / width) * width
    const d = new Date(t)
    d.setHours(0, 0, 0, 0)
    if (width > DAY) d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
    return d.getTime()
  }
  const first = align(since)
  const buckets: TimelineBucket[] = []
  const at = new Map<number, TimelineBucket>()
  for (let t = first; t <= now; t = width < DAY ? t + width : nextDayBucket(t, width)) {
    const b: TimelineBucket = { t, counts: new Array<number>(agents.length).fill(0), total: 0 }
    buckets.push(b)
    at.set(t, b)
  }
  let max = 0
  for (const r of spawned) {
    const b = at.get(align(r.start))
    if (!b) continue
    const i = index.get(r.agent)
    if (i === undefined) continue
    b.counts[i] += 1
    b.total += 1
    if (b.total > max) max = b.total
  }
  return { agents, buckets, bucketMs: width, max }
}

function nextDayBucket(t: number, width: number): number {
  const d = new Date(t)
  d.setDate(d.getDate() + Math.round(width / DAY))
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

const AGENT_HUES = [
  'var(--ctx-src-skill)',
  'var(--ctx-src-memory)',
  'var(--ctx-src-history)',
  'var(--ctx-src-lessons)',
  'var(--ctx-src-sys)',
  'var(--ctx-src-skillidx)',
  'var(--ctx-src-tool)',
]
const AGENT_MUTE = 'var(--ctx-src-mute, var(--muted))'

export function agentFill(rank: number): string {
  return AGENT_HUES[rank] ?? AGENT_MUTE
}
