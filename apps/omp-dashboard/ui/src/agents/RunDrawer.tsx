import { useEffect, useRef } from 'react'
import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { Activity, ArrowUpLeft, Bot, Terminal, User, Wrench, X } from 'lucide-react'
import { fmtDateTime, fmtNumber, fmtTime, useAppApi } from '@kirocrew/app-sdk'
import { Badge, ContentSkeleton } from '@kirocrew/app-sdk/ui'
import { API_BASE } from '../config'
import { type OmpAgentRun, type OmpAgentSessionPayload, type OmpSessionMessage } from './api'
import { fmtCost, fmtSpan, OUTCOME_BADGE, outcomeLabel } from '../labels'

const TAIL = 200
const SESSION_POLL_MS = 3_000

function MessageRow({ m }: { m: OmpSessionMessage }) {
  if (m.role === 'tool') {
    return (
      <div className="oa-msg" data-testid="agents-msg-tool">
        <Wrench size={13} className="oa-msg-icon oa-muted" aria-label="Tool result" />
        <div className="oa-msg-body">
          <div className="oa-msg-meta">
            {m.tool_name && <span className="oa-mono" style={{ color: 'var(--text)' }}>{m.tool_name}</span>} · {fmtTime(m.ts)}
          </div>
          <pre className="oa-tool-out">{m.text}</pre>
        </div>
      </div>
    )
  }
  const assistant = m.role === 'assistant'
  return (
    <div className="oa-msg" data-testid={assistant ? 'agents-msg-assistant' : 'agents-msg-user'}>
      {assistant
        ? <Bot size={13} className="oa-msg-icon" style={{ color: 'var(--accent)' }} aria-label="Assistant" />
        : <User size={13} className="oa-msg-icon oa-muted" aria-label="User" />}
      <div className="oa-msg-body">
        <div className="oa-msg-meta">{fmtTime(m.ts)}</div>
        {assistant
          ? (
            <div className="oa-msg-text">
              {m.text.split('\n').map((line, i) => line.startsWith('→ ')
                ? <div key={i} className="oa-call"><Terminal size={11} style={{ verticalAlign: '-1px' }} aria-hidden="true" /> {line.slice(2)}</div>
                : <div key={i}>{line}</div>)}
            </div>
          )
          : <div className="oa-msg-text oa-msg-user">{m.text}</div>}
      </div>
    </div>
  )
}

export default function RunDrawer({ run, now, mobile, onClose, onOpenParent }: {
  run: OmpAgentRun
  now: number
  mobile: boolean
  onClose: () => void
  onOpenParent: (key: string) => void
}) {
  const api = useAppApi()
  const running = run.outcome === 'running'
  const { data, error, isLoading, refetch } = useQuery({
    queryKey: ['omp-dashboard', 'session', run.key, TAIL],
    queryFn: () => api.get<OmpAgentSessionPayload>(`${API_BASE}/session?key=${encodeURIComponent(run.key)}&tail=${TAIL}`),
    refetchInterval: running ? SESSION_POLL_MS : false,
    placeholderData: keepPreviousData,
  })
  const scrollRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  const count = data?.messages.length ?? 0

  useEffect(() => {
    const el = scrollRef.current
    if (el && pinnedRef.current) el.scrollTop = el.scrollHeight
  }, [count, run.key])

  const outcome = data?.outcome ?? run.outcome
  return (
    <aside className={`oa-drawer${mobile ? ' oa-drawer-mobile' : ''}`} data-testid="agents-drawer">
      <div className="oa-drawer-head">
        <Bot size={16} style={{ color: 'var(--accent)', flex: 'none' }} />
        <div className="oa-drawer-title" title={run.name}>{run.name}</div>
        {run.parent_key && (
          <button type="button" className="oa-btn" onClick={() => onOpenParent(run.parent_key as string)} data-testid="agents-drawer-parent">
            <ArrowUpLeft size={13} /> Parent
          </button>
        )}
        <button type="button" className="oa-btn" onClick={onClose} aria-label="Close" data-testid="agents-drawer-close">
          <X size={13} />
        </button>
      </div>
      <div className="oa-drawer-meta" data-testid="agents-drawer-meta">
        <Badge variant={OUTCOME_BADGE[outcome] ?? 'muted'} style={{ fontSize: 11, paddingTop: 0, paddingBottom: 0 }}>
          {outcome === 'running' && <Activity size={11} className="oa-pulse" aria-hidden="true" />}
          {outcomeLabel(outcome)}
        </Badge>
        <span className="oa-mono" style={{ color: 'var(--text)' }}>{run.kind === 'main' ? 'main session' : run.agent}</span>
        <span className="oa-mono">{run.model}</span>
        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }} title={run.project}>{run.project}</span>
        <span title={fmtDateTime(run.start)}>{fmtSpan(running ? now - run.start : run.duration_ms)}</span>
        <span>{fmtCost(run.cost)}</span>
      </div>
      <div
        ref={scrollRef}
        className="oa-transcript"
        aria-live={running ? 'polite' : undefined}
        data-testid="agents-drawer-transcript"
        onScroll={e => {
          const el = e.currentTarget
          pinnedRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
      >
        {error && <div className="oa-error" data-testid="agents-drawer-error">Could not load this session: {error instanceof Error ? error.message : String(error)}</div>}
        {isLoading && !data && <ContentSkeleton rows={4} />}
        {data && data.messages.length === 0 && !error && <div className="oa-empty">No messages in this session yet.</div>}
        {data && data.messages.length >= TAIL && (
          <div className="oa-muted" style={{ fontSize: 11, textAlign: 'center' }}>Showing the last {data.messages.length} messages</div>
        )}
        {data?.messages.map((m, i) => <MessageRow key={`${m.ts}-${i}`} m={m} />)}
        {running && data && (
          <div className="oa-live">
            <Activity size={11} className="oa-pulse" style={{ color: 'var(--aim)' }} aria-hidden="true" />
            Live · refreshing every 3 s
            <button type="button" className="oa-btn" onClick={() => void refetch()}>Refresh</button>
          </div>
        )}
        {!running && data && <div className="oa-msg-meta">{fmtNumber(data.messages.length)} messages</div>}
      </div>
    </aside>
  )
}
