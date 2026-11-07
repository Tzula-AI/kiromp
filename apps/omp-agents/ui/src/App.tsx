import { useEffect, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Bot } from 'lucide-react'
import { fmtNumber, useAppApi } from '@kirocrew/app-sdk'
import { Btn, Card, CardTitle, ContentSkeleton, EmptyState, PageHeader, SegmentedControl, StatCard } from '@kirocrew/app-sdk/ui'
import {
  AGENT_WINDOWS, API_BASE, DEFAULT_AGENT_WINDOW, kpisOf, runningRuns, runsInWindow, spawnedRuns, statsByAgent, timelineOf,
  type AgentWindow, type OmpAgentRun, type OmpAgentRunsPayload,
} from './api'
import { AgentDonut, AgentTimeline } from './Charts'
import { AgentTypeTable, RecentRunsTable, RunningList } from './Tables'
import RunDrawer from './RunDrawer'
import { fmtCost, fmtPercent, WINDOW_LABEL } from './labels'
import { CSS } from './styles'

const WINDOW_KEY = 'omp-agents-window'
const RUNS_POLL_MS = 15_000
const RECENT_LIMIT = 100
const MOBILE_QUERY = '(max-width: 767px)'

function readWindow(): AgentWindow {
  try {
    const v = localStorage.getItem(WINDOW_KEY)
    return (AGENT_WINDOWS as readonly string[]).includes(v ?? '') ? (v as AgentWindow) : DEFAULT_AGENT_WINDOW
  } catch {
    return DEFAULT_AGENT_WINDOW
  }
}

function useIsMobile(): boolean {
  const [mobile, setMobile] = useState(() => window.matchMedia(MOBILE_QUERY).matches)
  useEffect(() => {
    const mq = window.matchMedia(MOBILE_QUERY)
    const onChange = () => setMobile(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [])
  return mobile
}

function Section({ label, count }: { label: string; count: number }) {
  return (
    <div className="oa-section">
      {label}
      <span className="oa-count">{fmtNumber(count)}</span>
    </div>
  )
}

export default function OmpAgentsPage() {
  const api = useAppApi()
  const mobile = useIsMobile()
  const [win, setWinState] = useState<AgentWindow>(readWindow)
  const [selected, setSelected] = useState<OmpAgentRun | null>(null)
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['omp-agents', 'runs'],
    queryFn: () => api.get<OmpAgentRunsPayload>(`${API_BASE}/runs`),
    refetchInterval: RUNS_POLL_MS,
  })

  const setWin = (w: AgentWindow) => {
    setWinState(w)
    try { localStorage.setItem(WINDOW_KEY, w) } catch { return }
  }

  const view = useMemo(() => {
    if (!data) return null
    const now = data.now
    const spawned = spawnedRuns(runsInWindow(data.runs, win, now))
    const running = runningRuns(data.runs)
    return {
      now,
      spawned,
      running,
      stats: statsByAgent(spawned),
      kpis: kpisOf(spawned, running.length),
      timeline: timelineOf(spawned, win, now),
      recent: [...spawned].sort((a, b) => b.start - a.start).slice(0, RECENT_LIMIT),
      byKey: new Map(data.runs.map(r => [r.key, r])),
    }
  }, [data, win])

  const open = selected && view ? (view.byKey.get(selected.key) ?? selected) : selected
  const openParent = (key: string) => {
    const parent = view?.byKey.get(key)
    if (parent) setSelected(parent)
  }

  const drawer = open && (
    <RunDrawer run={open} now={view?.now ?? Date.now()} mobile={mobile} onClose={() => setSelected(null)} onOpenParent={openParent} />
  )
  const errorMessage = error ? (error instanceof Error ? error.message : String(error)) : null

  if (mobile && drawer) {
    return <div className="oa-root" data-testid="agents-page"><style>{CSS}</style>{drawer}</div>
  }

  return (
    <div className="oa-root" data-testid="agents-page">
      <style>{CSS}</style>
      <div className="oa-main">
        <div style={{ paddingTop: 12 }}>
          <PageHeader
            title="Agents"
            subtitle="omp subagents spawned across all sessions, plus what is running now"
            actions={
              <SegmentedControl<AgentWindow>
                segments={AGENT_WINDOWS.map(w => ({ key: w, label: WINDOW_LABEL[w] }))}
                value={win}
                onChange={setWin}
                layoutId="omp-agents-window"
                ariaLabel="Time window"
                collapse={false}
              />
            }
          />
        </div>
        <div className="oa-body">
          {errorMessage && <div className="oa-error" data-testid="agents-load-error">Could not load agent runs: {errorMessage}</div>}
          {isLoading && !view && <ContentSkeleton rows={6} />}
          {view && (
            <>
              <div className="oa-kpis" data-testid="agents-kpis">
                <StatCard label="Spawned" value={fmtNumber(view.kpis.spawned)} data-testid="stat-card-spawned" />
                <StatCard
                  label="OK rate"
                  value={view.kpis.okRate == null ? '—' : fmtPercent(view.kpis.okRate)}
                  colorClass={view.kpis.okRate == null ? '' : view.kpis.okRate >= 0.9 ? 'text-ok-text' : view.kpis.okRate >= 0.6 ? 'text-warn-text' : 'text-danger-text'}
                  title="Finished runs that ended OK, over finished runs. Running runs are excluded."
                  delay={40}
                  data-testid="stat-card-ok-rate"
                />
                <StatCard label="Spend" value={fmtCost(view.kpis.cost)} delay={80} data-testid="stat-card-spend" />
                <StatCard label="Agent types" value={fmtNumber(view.kpis.agentTypes)} delay={120} data-testid="stat-card-types" />
                <StatCard label="Running now" value={fmtNumber(view.kpis.running)} accent={view.kpis.running > 0} delay={160} data-testid="stat-card-running" />
              </div>

              {view.spawned.length === 0 && view.running.length === 0 ? (
                <Card>
                  <EmptyState icon={<Bot />} title="No agent runs yet" subtitle="Subagents spawned by omp in this window will show up here." testId="agents-empty" />
                </Card>
              ) : (
                <>
                  <div className="oa-grid2">
                    <Card>
                      <CardTitle>Spawned by type</CardTitle>
                      {view.spawned.length === 0
                        ? <div className="oa-empty">No runs in this window.</div>
                        : <AgentDonut stats={view.stats} total={view.kpis.spawned} />}
                    </Card>
                    <Card>
                      <CardTitle>Spawns over time</CardTitle>
                      <AgentTimeline timeline={view.timeline} />
                    </Card>
                  </div>

                  <Card className="oa-card-flush">
                    <div className="oa-card-title-pad"><CardTitle>By agent type</CardTitle></div>
                    {view.stats.length === 0
                      ? <div className="oa-empty">No runs in this window.</div>
                      : <AgentTypeTable stats={view.stats} now={view.now} />}
                  </Card>

                  <Section label="Running now" count={view.running.length} />
                  <Card className="oa-card-flush">
                    {view.running.length === 0
                      ? <div className="oa-empty" data-testid="agents-running-empty">Nothing is running right now.</div>
                      : <RunningList runs={view.running} now={view.now} selectedKey={open?.key ?? null} onOpen={setSelected} />}
                  </Card>

                  <Section label="Recent runs" count={view.recent.length} />
                  <Card className="oa-card-flush">
                    {view.recent.length === 0
                      ? <div className="oa-empty">No runs in this window.</div>
                      : <RecentRunsTable runs={view.recent} selectedKey={open?.key ?? null} onOpen={setSelected} />}
                  </Card>
                </>
              )}
            </>
          )}
          {error && !view && (
            <EmptyState
              icon={<Bot />}
              title="Could not load agent runs"
              action={<Btn onClick={() => void refetch()}>Refresh</Btn>}
              testId="agents-error-empty"
            />
          )}
        </div>
      </div>
      {drawer}
    </div>
  )
}
