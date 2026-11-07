import { useId, useState } from 'react'
import { fmtDate, fmtDateTime, fmtNumber, fmtTime } from '@kirocrew/app-sdk'
import { agentFill, type AgentTypeStats, type Timeline } from './api'
import { fmtPercent } from '../labels'

const DAY = 86_400_000
const R = 44
const STROKE = 14
const CIRC = 2 * Math.PI * R
const H = 140

export function AgentDonut({ stats, total }: { stats: readonly AgentTypeStats[]; total: number }) {
  const [hover, setHover] = useState<number | null>(null)
  let offset = 0
  const arcs = stats.map((s, i) => {
    const frac = total > 0 ? s.spawned / total : 0
    const arc = { i, s, frac, offset }
    offset += frac
    return arc
  })
  return (
    <div className="oa-donut" data-testid="agents-donut">
      <div className="oa-donut-ring">
        <svg viewBox="0 0 120 120" aria-hidden="true">
          <circle cx="60" cy="60" r={R} fill="none" strokeWidth={STROKE} style={{ stroke: 'var(--bg-hover)' }} />
          {arcs.map(({ i, frac, offset: o }) => frac > 0 && (
            <circle
              key={i}
              cx="60" cy="60" r={R} fill="none"
              strokeWidth={hover === i ? STROKE + 4 : STROKE}
              strokeDasharray={`${frac * CIRC} ${CIRC}`}
              strokeDashoffset={-o * CIRC}
              style={{ stroke: agentFill(i), transition: 'stroke-width .15s' }}
              onMouseEnter={() => setHover(i)}
              onMouseLeave={() => setHover(null)}
            />
          ))}
        </svg>
        <div className="oa-donut-center">
          <span className="oa-donut-total">{fmtNumber(hover == null ? total : arcs[hover].s.spawned)}</span>
          <span className="oa-donut-label">{hover == null ? 'Spawned' : arcs[hover].s.agent}</span>
        </div>
      </div>
      <ul className="oa-legend" aria-label="Spawned by agent type">
        {arcs.map(({ i, s, frac }) => (
          <li
            key={s.agent}
            data-hover={hover === i}
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          >
            <span className="oa-swatch" style={{ background: agentFill(i) }} />
            <span className="oa-legend-name oa-mono">{s.agent}</span>
            <span className="oa-legend-n">{fmtNumber(s.spawned)} · {fmtPercent(frac)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function bucketTitle(t: number, bucketMs: number): string {
  return bucketMs < DAY ? fmtDateTime(t) : fmtDate(t)
}

export function AgentTimeline({ timeline }: { timeline: Timeline }) {
  const { buckets, agents, max, bucketMs } = timeline
  const [hover, setHover] = useState<number | null>(null)
  const id = useId()
  const n = buckets.length
  const w = n > 0 ? 100 / n : 100
  const scale = max > 0 ? (H - 4) / max : 0
  const pad = w * 0.12
  const tick = Math.max(1, Math.ceil(n / 6))
  const hovered = hover != null ? buckets[hover] : null
  return (
    <div style={{ minWidth: 0 }} data-testid="agents-timeline">
      <div className="oa-tl">
        <div className="oa-tl-axis" style={{ height: H }}>
          <span style={{ top: 0 }}>{fmtNumber(max)}</span>
          <span style={{ bottom: 0 }}>{fmtNumber(0)}</span>
        </div>
        <div className="oa-tl-plot" style={{ height: H }} onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 100 ${H}`} preserveAspectRatio="none" aria-labelledby={`${id}-title`}>
            <title id={`${id}-title`}>Spawns over time</title>
            <line x1="0" x2="100" y1={H - 0.5} y2={H - 0.5} style={{ stroke: 'var(--border)' }} strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {buckets.map((b, bi) => {
              let y = H
              return (
                <g
                  key={b.t}
                  onMouseEnter={() => setHover(bi)}
                  style={{ opacity: hover != null && hover !== bi ? 0.6 : 1, transition: 'opacity .12s' }}
                >
                  <title>{bucketTitle(b.t, bucketMs)}: {fmtNumber(b.total)}</title>
                  <rect x={bi * w} y="0" width={w} height={H} fill="transparent" />
                  {b.counts.map((c, ai) => {
                    if (c === 0) return null
                    const h = c * scale
                    y -= h
                    return <rect key={ai} x={bi * w + pad} y={y} width={w - 2 * pad} height={h} style={{ fill: agentFill(ai) }} />
                  })}
                </g>
              )
            })}
          </svg>
          {hovered && (
            <div
              className="oa-tip"
              style={hover != null && hover > n / 2 ? { right: 4 } : { left: 4 }}
              data-testid="agents-timeline-tooltip"
            >
              <div style={{ fontWeight: 500 }}>{bucketTitle(hovered.t, bucketMs)}</div>
              <div className="oa-muted">{fmtNumber(hovered.total)} spawned</div>
              {hovered.counts.map((c, ai) => c > 0 && (
                <div key={ai} className="oa-tip-row">
                  <span className="oa-swatch" style={{ background: agentFill(ai), width: 8, height: 8 }} />
                  <span className="oa-mono">{agents[ai]}</span>
                  <b>{fmtNumber(c)}</b>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="oa-tl-ticks" aria-hidden="true">
        {buckets.map((b, bi) => bi % tick === 0 && (
          <span key={b.t} style={{ left: `${bi * w}%` }}>{bucketMs < DAY ? fmtTime(b.t) : fmtDate(b.t)}</span>
        ))}
      </div>
    </div>
  )
}
