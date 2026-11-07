declare module '@kirocrew/app-sdk' {
  export interface AppApi {
    get<T>(path: string, init?: RequestInit): Promise<T>
  }
  export function useAppApi(): AppApi
  export function useAppInfo(): { name: string; active?: boolean }
}

declare module '@kirocrew/app-sdk/ui' {
  import type { ReactNode } from 'react'
  export function PageHeader(props: { title: string; subtitle?: string; children?: ReactNode }): JSX.Element
}

declare module 'lucide-react' {
  import type { ComponentType, SVGProps } from 'react'
  type Icon = ComponentType<SVGProps<SVGSVGElement> & { size?: number | string }>
  export const Loader2: Icon
  export const RefreshCw: Icon
}
