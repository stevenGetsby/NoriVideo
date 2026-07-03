// @vitest-environment jsdom

import * as React from 'react'
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FosScreenwriter } from '@/components/frameos/views/FosScreenwriter'

const routerPush = vi.fn()

vi.mock('@/i18n/navigation', () => ({
  Link: ({
    href,
    children,
    ...props
  }: {
    href: string | { pathname: string }
    children: React.ReactNode
  } & Record<string, unknown>) => {
    const resolvedHref = typeof href === 'string' ? href : href.pathname
    return React.createElement('a', { href: resolvedHref, ...props }, children)
  },
  useRouter: () => ({
    push: routerPush,
  }),
}))

vi.mock('@/components/ui/icons', () => ({
  AppIcon: ({ name, className }: { name: string; className?: string }) => (
    React.createElement('span', {
      'aria-hidden': 'true',
      className,
      'data-icon-name': name,
    })
  ),
}))

vi.mock('@/components/frameos/screenwriter/useScreenwriterTasks', () => ({
  useScreenwriterTasks: () => ({
    tasks: [],
    error: null,
    isLoading: false,
    reload: vi.fn(),
  }),
}))

describe('screenwriter loading states', () => {
  let container: HTMLDivElement
  let root: Root

  beforeEach(() => {
    Reflect.set(globalThis, 'React', React)
    Reflect.set(globalThis, 'IS_REACT_ACT_ENVIRONMENT', true)
    routerPush.mockClear()
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(() => {
    act(() => {
      root.unmount()
    })
    container.remove()
  })

  it('enters route pending state and renders loading UI after the user clicks script repaint', () => {
    act(() => {
      root.render(React.createElement(FosScreenwriter))
    })

    const scriptRepaintButton = container.querySelector<HTMLButtonElement>(
      '[data-mode-key="script-repaint-2"]',
    )
    expect(scriptRepaintButton).not.toBeNull()
    expect(container.querySelector('[data-screenwriter-loading-skeleton="true"]')).toBeNull()

    act(() => {
      scriptRepaintButton?.click()
    })

    expect(routerPush).toHaveBeenCalledTimes(1)
    expect(routerPush).toHaveBeenCalledWith({ pathname: '/screenwriter/script-repaint' })
    expect(container.querySelector('[data-screenwriter-loading-skeleton="true"]')).not.toBeNull()
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull()
    expect(container.textContent).toContain('正在加载编剧工作台')
    expect(container.querySelector('[data-mode-key="script-repaint-2"]')).toBeNull()
  })
})
