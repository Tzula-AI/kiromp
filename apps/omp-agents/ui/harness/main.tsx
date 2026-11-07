import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import OmpAgentsPage from '../src/App'
import './theme.css'

const theme = new URLSearchParams(location.search).get('theme')
if (theme === 'light') document.documentElement.dataset.theme = 'light'

createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={new QueryClient()}>
    <OmpAgentsPage />
  </QueryClientProvider>,
)
