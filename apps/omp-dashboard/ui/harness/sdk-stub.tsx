export interface AppApi {
  get<T = unknown>(path: string, init?: RequestInit): Promise<T>
}

const api: AppApi = {
  async get<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(path, init)
    if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`)
    return res.json() as Promise<T>
  },
}

export const useAppApi = () => api
export const useAppInfo = () => ({ name: 'omp-dashboard', active: true })
export const useNavigate = () => (path: string) => { location.assign(path) }
export const activeLocale = () => 'en-US'
export const fmtNumber = (value: number, options?: Intl.NumberFormatOptions) =>
  Number.isFinite(value) ? new Intl.NumberFormat('en-US', options).format(value) : '—'

type DateInput = Date | string | number | null | undefined
const dt = (v: DateInput, o: Intl.DateTimeFormatOptions) => (v == null ? '—' : new Intl.DateTimeFormat('en-US', o).format(new Date(v)))
export const fmtDate = (v: DateInput) => dt(v, { dateStyle: 'medium' })
export const fmtTime = (v: DateInput) => dt(v, { timeStyle: 'short' })
export const fmtDateTime = (v: DateInput) => dt(v, { dateStyle: 'medium', timeStyle: 'short' })

export function fmtRelative(v: DateInput, options?: { now?: Date | number }): string {
  if (v == null) return '—'
  const now = options?.now instanceof Date ? options.now.getTime() : (options?.now ?? Date.now())
  const s = (new Date(v).getTime() - now) / 1000
  const abs = Math.abs(s)
  const rtf = new Intl.RelativeTimeFormat('en-US', { style: 'narrow' })
  if (abs < 60) return rtf.format(Math.round(s), 'second')
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute')
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour')
  return rtf.format(Math.round(s / 86400), 'day')
}
