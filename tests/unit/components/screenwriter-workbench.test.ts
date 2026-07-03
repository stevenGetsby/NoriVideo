import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { ScreenwriterWorkbench } from '@/components/frameos/screenwriter/ScreenwriterWorkbench'
import { emptyScreenwriterModeCards, screenwriterDemoScripts } from '@/components/frameos/screenwriter/screenwriterDemoData'

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
    return createElement('a', { href: resolvedHref, ...props }, children)
  },
}))

describe('ScreenwriterWorkbench', () => {
  it('renders the in-progress workbench with mode cards, script tabs, and an empty canvas hint', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(ScreenwriterWorkbench, {
        scripts: screenwriterDemoScripts,
        onModeSelect: () => undefined,
      }),
    )

    expect(html).toContain('视频转绘')
    expect(html).toContain('剧本转绘')
    expect(html).toContain('分镜转绘')
    expect(html).toContain('我的剧本')
    expect(html).toContain('草稿')
    expect(html).toContain('TEST-海外转绘版')
    expect(html).toContain('剧本转绘2.0任务')
    expect(html).toContain('进行中')
    expect(html).toContain('请从左侧选择一份剧本开始编辑')
  })

  it('keeps the no-script entry state when there is no script data', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(ScreenwriterWorkbench, {
        scripts: [],
        onModeSelect: () => undefined,
      }),
    )

    expect(html).toContain('视频转绘2.0')
    expect(html).toContain('视频转剧本')
    expect(html).not.toContain('我的剧本')
    expect(html).not.toContain('请从左侧选择一份剧本开始编辑')
  })

  it('routes the no-script script repaint entry to the script repaint create page', () => {
    const scriptRepaintCard = emptyScreenwriterModeCards.find((card) => card.title === '剧本转绘')

    expect(scriptRepaintCard?.key).toBe('script-repaint-2')
  })
})
