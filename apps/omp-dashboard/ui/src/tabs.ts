export const TABS = [
  { key: 'overview', label: 'Overview' },
  { key: 'spend', label: 'Spend' },
  { key: 'limits', label: 'Limits' },
  { key: 'agents', label: 'Agents' },
] as const
export type TabKey = (typeof TABS)[number]['key']

export function parseTab(value: string | null): TabKey {
  return TABS.find(t => t.key === value)?.key ?? 'overview'
}
