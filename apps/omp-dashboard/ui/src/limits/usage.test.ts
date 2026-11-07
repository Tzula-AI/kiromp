import { describe, expect, it } from 'bun:test'
import {
  accountLabel, fmtResetsIn, groupByProvider, limitFraction, severityOf, worstFraction,
  type OmpUsageLimit, type OmpUsageReport,
} from './usage'

const limit = (id: string, used: number, extra: Partial<OmpUsageLimit> = {}): OmpUsageLimit => ({
  id, label: id, amount: { usedFraction: used }, status: used >= 1 ? 'exhausted' : 'ok', ...extra,
})

const report = (provider: string, email: string): OmpUsageReport => ({ provider, metadata: { email }, limits: [] })

describe('severity', () => {
  it('turns amber at 75% and red at 90% or exhausted', () => {
    expect(severityOf(null)).toBe('ok')
    expect(severityOf(0.74)).toBe('ok')
    expect(severityOf(0.75)).toBe('warn')
    expect(severityOf(0.89)).toBe('warn')
    expect(severityOf(0.9)).toBe('danger')
    expect(limitFraction({ id: 'b', label: 'B', status: 'exhausted' })).toBe(1)
    expect(limitFraction({ id: 'c', label: 'C' })).toBeNull()
    expect(worstFraction([{ provider: 'p', limits: [limit('a', 0.2), { id: 'b', label: 'B', status: 'exhausted' }] }])).toBe(1)
    expect(worstFraction([])).toBeNull()
  })
})

describe('grouping and labels', () => {
  it('groups accounts under their provider in first-seen order', () => {
    const groups = groupByProvider([report('anthropic', 'a'), report('openai-codex', 'c'), report('anthropic', 'b')])
    expect(groups.map(g => [g.provider, g.accounts.length])).toEqual([['anthropic', 2], ['openai-codex', 1]])
  })

  it('names an account by email, then org, then a short account id', () => {
    expect(accountLabel({ provider: 'p', metadata: { email: 'a@b', orgName: 'o' } })).toBe('a@b')
    expect(accountLabel({ provider: 'p', metadata: { orgName: 'o' } })).toBe('o')
    expect(accountLabel({ provider: 'p', metadata: { accountId: 'abcdef123456' } })).toBe('abcdef12')
    expect(accountLabel({ provider: 'p' })).toBeNull()
  })
})

describe('fmtResetsIn', () => {
  it('shows the two most significant non-zero parts', () => {
    expect(fmtResetsIn(142 * 60_000)).toBe('2h 22m')
    expect(fmtResetsIn(3 * 86_400_000 + 4 * 3_600_000)).toBe('3d 4h')
    expect(fmtResetsIn(5 * 60_000)).toBe('5m')
    expect(fmtResetsIn(1000)).toBe('1m')
    expect(fmtResetsIn(2 * 3_600_000)).toBe('2h')
  })
})
