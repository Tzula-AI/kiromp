import UsagePanel from './UsagePanel'
import { useOmpUsage } from './useOmpUsage'

export default function OmpUsageControl() {
  const { data, error, loading, refreshing, refresh } = useOmpUsage()
  return <UsagePanel compact data={data} error={error} loading={loading} refreshing={refreshing} onRefresh={refresh} />
}
