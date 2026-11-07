import UsagePanel from './limits/UsagePanel'
import type { OmpUsageState } from './limits/useOmpUsage'

export default function LimitsTab({ state }: { state: OmpUsageState }) {
  return (
    <div className="od-scroll" data-testid="limits-tab">
      <div style={{ maxWidth: 720 }}>
        <UsagePanel data={state.data} error={state.error} loading={state.loading} refreshing={state.refreshing} onRefresh={state.refresh} />
      </div>
    </div>
  )
}
