import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import OmpDashboardPage from '../src/page'
import OmpUsageControl from '../src/control'
import './theme.css'

const params = new URLSearchParams(location.search)
if (params.get('theme') === 'light') document.documentElement.dataset.theme = 'light'
const chip = params.get('view') === 'control'

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}>
    {chip ? (
      <div style={{ width: 340, margin: '40px auto', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--card)', boxShadow: 'var(--shadow-lg)', overflow: 'hidden' }}>
        <OmpUsageControl onClose={() => undefined} />
      </div>
    ) : (
      <OmpDashboardPage />
    )}
  </QueryClientProvider>,
)
