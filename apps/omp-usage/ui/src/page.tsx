import { PageHeader } from '@kirocrew/app-sdk/ui'
import UsagePanel from './UsagePanel'
import { useOmpUsage } from './useOmpUsage'

export default function OmpUsagePage() {
  const { data, error, loading, refreshing, refresh } = useOmpUsage()
  return (
    <>
      <PageHeader title="OMP usage" subtitle="Model-usage limits for every account omp is logged in to" />
      <div style={{ padding: '0 24px 32px', overflowY: 'auto', flex: 1, minHeight: 0 }}>
        <div style={{ maxWidth: 720 }}>
          <UsagePanel data={data} error={error} loading={loading} refreshing={refreshing} onRefresh={refresh} />
        </div>
      </div>
    </>
  )
}
