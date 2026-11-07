import { useEffect, useState } from 'react'
import { PageHeader } from '@kirocrew/app-sdk/ui'
import AgentsTab from './AgentsTab'
import LimitsTab from './LimitsTab'
import Overview from './Overview'
import SpendTab from './SpendTab'
import { useOmpUsage } from './limits/useOmpUsage'
import { DEFAULT_SPEND_WINDOW, isSpendWindow, type SpendWindow } from './spend/spend'
import { useSpend } from './spend/useSpend'
import { CSS } from './styles'
import { parseTab, TABS, type TabKey } from './tabs'

function readUrl(): { tab: TabKey; window: SpendWindow } {
  const params = new URLSearchParams(location.search)
  const w = params.get('window')
  return { tab: parseTab(params.get('tab')), window: isSpendWindow(w) ? w : DEFAULT_SPEND_WINDOW }
}

function writeUrl(tab: TabKey, window: SpendWindow): void {
  const params = new URLSearchParams(location.search)
  params.set('tab', tab)
  if (tab === 'spend') params.set('window', window)
  else params.delete('window')
  history.replaceState(history.state, '', `${location.pathname}?${params}${location.hash}`)
}

export default function OmpDashboardPage() {
  const [{ tab: requested, window: spendWindow }, setNav] = useState(readUrl)
  const usage = useOmpUsage()
  const spendProbe = useSpend(DEFAULT_SPEND_WINDOW)
  const spendHidden = !!spendProbe.data && !spendProbe.data.available && !spendProbe.data.error
  const tabs = spendHidden ? TABS.filter(t => t.key !== 'spend') : TABS
  const tab = requested === 'spend' && spendHidden ? 'overview' : requested

  useEffect(() => {
    const onPop = () => setNav(readUrl())
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  const go = (next: TabKey, w: SpendWindow = spendWindow) => {
    setNav({ tab: next, window: w })
    writeUrl(next, w)
  }

  useEffect(() => { writeUrl(tab, spendWindow) }, [tab, spendWindow])

  return (
    <div className="od-root" data-testid="omp-dashboard">
      <style>{CSS}</style>
      <PageHeader title="OMP Dashboard" subtitle="Spend, limits and agents for the omp coding agent" />
      <div className="od-tabs" role="tablist" aria-label="OMP Dashboard sections">
        {tabs.map(t => (
          <button
            key={t.key}
            type="button"
            role="tab"
            id={`od-tab-${t.key}`}
            aria-selected={t.key === tab}
            aria-controls="od-panel"
            className="od-tab"
            data-testid={`tab-${t.key}`}
            onClick={() => go(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>
      <div className="od-content" id="od-panel" role="tabpanel" aria-labelledby={`od-tab-${tab}`}>
        {tab === 'overview' && (
          <Overview
            usage={usage.data}
            now={Date.now()}
            onOpenTab={k => go(k)}
            onOpenSpend={w => go('spend', w)}
          />
        )}
        {tab === 'spend' && <SpendTab window={spendWindow} onWindow={w => go('spend', w)} />}
        {tab === 'limits' && <LimitsTab state={usage} />}
        {tab === 'agents' && <AgentsTab />}
      </div>
    </div>
  )
}
