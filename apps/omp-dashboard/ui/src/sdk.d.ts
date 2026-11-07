declare module '@kirocrew/app-sdk' {
  export interface AppApi {
    get<T = unknown>(path: string, init?: RequestInit): Promise<T>
  }
  export function useAppApi(): AppApi
  export function useAppInfo(): { name: string; active?: boolean }
  export function useNavigate(): (path: string) => void
  type DateInput = Date | string | number | null | undefined
  export function activeLocale(): string
  export function fmtNumber(value: number, options?: Intl.NumberFormatOptions): string
  export function fmtDate(value: DateInput): string
  export function fmtTime(value: DateInput): string
  export function fmtDateTime(value: DateInput): string
  export function fmtRelative(value: DateInput, options?: { now?: Date | number }): string
}

declare module '@kirocrew/app-sdk/ui' {
  import type { ComponentType, ReactNode } from 'react'
  type Div = React.ComponentPropsWithoutRef<'div'>
  export const Card: ComponentType<Div>
  export const CardTitle: ComponentType<React.ComponentPropsWithoutRef<'h3'>>
  export const PageHeader: ComponentType<{ title: ReactNode; subtitle?: string; actions?: ReactNode }>
  export const StatCard: ComponentType<
    { label: string; value?: string | number | null; accent?: boolean; colorClass?: string; delay?: number; title?: string } & Omit<Div, 'title'>
  >
  export const Badge: ComponentType<
    { variant: 'ok' | 'err' | 'warn' | 'aim' | 'muted'; children: ReactNode } & React.ComponentPropsWithoutRef<'span'>
  >
  export const Btn: ComponentType<React.ComponentPropsWithoutRef<'button'>>
  export const EmptyState: ComponentType<{
    icon: ReactNode
    title: string
    subtitle?: string
    action?: ReactNode
    testId?: string
  }>
  export const ContentSkeleton: ComponentType<{ rows?: number }>
  export const SegmentedControl: <T extends string>(props: {
    segments: { key: T; label: string }[]
    value: T
    onChange: (value: T) => void
    layoutId?: string
    ariaLabel?: string
    collapse?: boolean
  }) => ReactNode
}
