import { useState, type ComponentPropsWithoutRef, type ReactNode } from 'react'

const card: React.CSSProperties = {
  background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8,
  padding: '14px 16px', marginBottom: 16, boxShadow: 'inset 0 1px 0 var(--card-hl)',
}

export function Card({ children, className = '', style, ...rest }: ComponentPropsWithoutRef<'div'>) {
  return <div className={className} style={{ ...card, ...style }} {...rest}>{children}</div>
}

export function CardTitle({ children }: ComponentPropsWithoutRef<'h3'>) {
  return <h3 style={{ margin: '0 0 12px', fontSize: 13, fontWeight: 600, color: 'var(--text-strong)' }}>{children}</h3>
}

export function PageHeader({ title, subtitle, actions }: { title: ReactNode; subtitle?: string; actions?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', justifyContent: 'space-between', gap: 8, padding: '8px 24px 12px' }}>
      <div>
        <div style={{ fontSize: 24, fontWeight: 700, color: 'var(--text-strong)' }}>{title}</div>
        {subtitle && <div style={{ color: 'var(--muted)', fontSize: 14, marginTop: 4 }}>{subtitle}</div>}
      </div>
      {actions}
    </div>
  )
}

export function StatCard({ label, value, accent, colorClass: _c, delay: _d, title, ...rest }: {
  label: string; value?: string | number | null; accent?: boolean; colorClass?: string; delay?: number; title?: string
} & Omit<ComponentPropsWithoutRef<'div'>, 'title'>) {
  return (
    <div style={{ ...card, marginBottom: 0 }} title={title} {...rest}>
      <div style={{ color: 'var(--muted)', fontSize: 13, fontWeight: 500, textTransform: 'uppercase', letterSpacing: '.04em' }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 700, marginTop: 6, color: accent ? 'var(--accent)' : 'var(--text-strong)' }}>{value ?? '—'}</div>
    </div>
  )
}

const BADGE: Record<string, [string, string]> = {
  ok: ['var(--ok-subtle)', 'var(--ok)'],
  err: ['var(--danger-subtle)', 'var(--danger)'],
  aim: ['var(--aim-subtle)', 'var(--aim)'],
  warn: ['var(--warn-subtle)', 'var(--warn)'],
  muted: ['var(--bg-hover)', 'var(--muted)'],
}

export function Badge({ variant, children, style, ...rest }: {
  variant: 'ok' | 'err' | 'warn' | 'aim' | 'muted'; children: ReactNode
} & ComponentPropsWithoutRef<'span'>) {
  const [bg, fg] = BADGE[variant]
  return (
    <span
      style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '2px 8px', borderRadius: 999, fontSize: 13, fontWeight: 500, whiteSpace: 'nowrap', background: bg, color: fg, ...style }}
      {...rest}
    >
      {children}
    </span>
  )
}

export function Btn({ children, ...rest }: ComponentPropsWithoutRef<'button'>) {
  return (
    <button
      type="button"
      style={{ padding: '4px 10px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--card)', color: 'var(--text)', cursor: 'pointer' }}
      {...rest}
    >
      {children}
    </button>
  )
}

export function EmptyState({ icon, title, subtitle, action }: {
  icon: ReactNode; title: string; subtitle?: string; action?: ReactNode; testId?: string
}) {
  return (
    <div style={{ textAlign: 'center', padding: 32, color: 'var(--muted)' }}>
      <div style={{ marginBottom: 8 }}>{icon}</div>
      <div style={{ color: 'var(--text-strong)', fontWeight: 600 }}>{title}</div>
      {subtitle && <div style={{ fontSize: 13, marginTop: 4 }}>{subtitle}</div>}
      {action && <div style={{ marginTop: 12 }}>{action}</div>}
    </div>
  )
}

export function ContentSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} style={{ height: 16, margin: '10px 0', borderRadius: 4, background: 'var(--bg-hover)' }} />
      ))}
    </div>
  )
}

export function SegmentedControl<T extends string>({ segments, value, onChange, ariaLabel }: {
  segments: { key: T; label: string }[]; value: T; onChange: (v: T) => void; layoutId?: string; ariaLabel?: string; collapse?: boolean
}) {
  const [hover, setHover] = useState<T | null>(null)
  return (
    <div role="radiogroup" aria-label={ariaLabel} style={{ display: 'inline-flex', padding: 2, gap: 2, borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
      {segments.map(s => (
        <button
          key={s.key}
          type="button"
          role="radio"
          aria-checked={s.key === value}
          onClick={() => onChange(s.key)}
          onMouseEnter={() => setHover(s.key)}
          onMouseLeave={() => setHover(null)}
          style={{
            padding: '3px 10px', border: 0, borderRadius: 6, fontSize: 13, cursor: 'pointer',
            background: s.key === value ? 'var(--accent-subtle)' : hover === s.key ? 'var(--bg-hover)' : 'transparent',
            color: s.key === value ? 'var(--accent)' : 'var(--text)',
          }}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
