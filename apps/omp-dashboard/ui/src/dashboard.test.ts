import { describe, expect, it } from 'bun:test'
import { todayAgents, type OmpAgentRun } from './agents/api'
import { topLimits, type OmpUsageReport } from './limits/usage'
import { DEFAULT_SPEND_WINDOW, isSpendWindow } from './spend/spend'
import { parseTab } from './tabs'

const run = (over: Partial<OmpAgentRun>): OmpAgentRun => ({
  key: 'k', name: 'n', kind: 'subagent', agent: 'scout', parent_key: null, project: 'p', model: 'm',
  start: 0, last_activity: 0, duration_ms: 0, tokens: 0, cost: 0, tools: 0, outcome: 'ok', ...over,
})

describe('topLimits', () => {
  const reports: OmpUsageReport[] = [
    { provider: 'anthropic', metadata: { email: 'a@x' }, limits: [
      { id: 'a5', label: 'Claude 5 Hour', amount: { usedFraction: 0.31 } },
      { id: 'a7', label: 'Claude 7 Day', amount: { usedFraction: 0.78 } },
    ] },
    { provider: 'codex', metadata: { email: 'c@x' }, limits: [
      { id: 'cap', label: 'Spend cap', status: 'exhausted' },
      { id: 'none', label: 'Unreported' },
    ] },
  ]

  it('ranks limits across accounts by used fraction, exhausted first, skipping unreported ones', () => {
    const top = topLimits(reports, 5)
    expect(top.map(t => [t.limit.id, t.fraction])).toEqual([['cap', 1], ['a7', 0.78], ['a5', 0.31]])
    expect(top[0].account).toBe('c@x')
  })

  it('keeps only the requested number and tolerates no data', () => {
    expect(topLimits(reports, 2).map(t => t.limit.id)).toEqual(['cap', 'a7'])
    expect(topLimits(undefined, 3)).toEqual([])
  })
})

describe('todayAgents', () => {
  const now = new Date(2026, 10, 7, 15, 0).getTime()
  const midnight = new Date(2026, 10, 7, 0, 0).getTime()

  it('counts only subagents started since local midnight and their cost, and every running run', () => {
    const today = todayAgents([
      run({ start: midnight + 1, cost: 1.5 }),
      run({ start: midnight, cost: 0.5, outcome: 'running' }),
      run({ start: midnight - 1, cost: 10 }),
      run({ kind: 'main', start: midnight + 5, cost: 100, outcome: 'running' }),
    ], now)
    expect(today).toEqual({ running: 2, runs: 2, cost: 2 })
  })
})

describe('url state helpers', () => {
  it('falls back to overview for an unknown tab', () => {
    expect(parseTab('agents')).toBe('agents')
    expect(parseTab('nope')).toBe('overview')
    expect(parseTab(null)).toBe('overview')
  })

  it('accepts only the four spend windows', () => {
    expect(isSpendWindow('7d')).toBe(true)
    expect(isSpendWindow('1h')).toBe(false)
    expect(isSpendWindow(null)).toBe(false)
    expect(DEFAULT_SPEND_WINDOW).toBe('24h')
  })
})
