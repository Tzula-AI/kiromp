import { useNavigate } from '@kirocrew/app-sdk'
import { PAGE_ROUTE } from './config'
import UsagePanel from './limits/UsagePanel'
import { useOmpUsage } from './limits/useOmpUsage'

export default function OmpUsageControl({ onClose }: { onClose?: () => void }) {
  const { data, error, loading, refreshing, refresh } = useOmpUsage()
  const navigate = useNavigate()
  return (
    <div style={{ display: 'flex', flexDirection: 'column' }}>
      <UsagePanel compact data={data} error={error} loading={loading} refreshing={refreshing} onRefresh={refresh} />
      <div style={{ padding: '8px 12px', borderTop: '1px solid var(--border)' }}>
        <button
          type="button"
          data-testid="open-limits"
          onClick={() => { onClose?.(); navigate(`${PAGE_ROUTE}?tab=limits`) }}
          style={{ padding: 0, border: 0, background: 'none', color: 'var(--accent)', font: 'inherit', fontSize: 12, cursor: 'pointer' }}
        >
          Open Limits →
        </button>
      </div>
    </div>
  )
}
