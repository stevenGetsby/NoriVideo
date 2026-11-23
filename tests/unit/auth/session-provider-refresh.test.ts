import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { Providers } from '@/app/[locale]/providers'

const route = vi.hoisted(() => ({ pathname: '' }))
vi.mock('next/navigation', () => ({ usePathname: () => route.pathname }))
vi.mock('next-auth/react', () => ({
  SessionProvider: ({ refetchInterval, refetchOnWindowFocus }: { refetchInterval: number; refetchOnWindowFocus: boolean }) =>
    React.createElement('div', { 'data-interval': refetchInterval, 'data-refetch-on-focus': refetchOnWindowFocus }),
}))
vi.mock('@/contexts/ToastContext', () => ({ ToastProvider: () => null }))
vi.mock('@/components/providers/QueryProvider', () => ({ QueryProvider: () => null }))
vi.mock('@/components/OldBrowserNotice', () => ({ OldBrowserNotice: () => null }))

describe('account session refresh', () => {
  it('refreshes changed staff roles without requiring a manual page reload', () => {
    route.pathname = '/zh/works'
    const html = renderToStaticMarkup(React.createElement(Providers, { children: null }))
    expect(html).toContain('data-interval="300"')
    expect(html).toContain('data-refetch-on-focus="true"')
  })

  it('does not poll for sessions on the public login page', () => {
    route.pathname = '/zh/auth/signin'
    const html = renderToStaticMarkup(React.createElement(Providers, { children: null }))
    expect(html).toContain('data-interval="0"')
    expect(html).toContain('data-refetch-on-focus="false"')
  })
})
