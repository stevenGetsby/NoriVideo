import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { SuperQuickParameters } from '@/components/super-agent/SuperQuickParameters'
import { DEFAULT_PARAMETERS } from '@/components/super-agent/super-agent-ui'
import type { AgentCreativeParameters } from '@/lib/super-agent/types'

describe('SuperQuickParameters', () => {
  it('renders every visible creative parameter before planning', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(SuperQuickParameters, {
        executionMode: 'mock',
        parameters: DEFAULT_PARAMETERS,
        disabled: false,
        onExecutionModeChange: vi.fn(),
        onParameterChange: vi.fn() as <K extends keyof AgentCreativeParameters>(
          key: K,
          value: AgentCreativeParameters[K],
        ) => void,
      }),
    )

    expect(html).toContain('执行模式')
    expect(html).toContain('时长（秒）')
    expect(html).toContain('旁白')
    expect(html).toContain('镜头数')
    expect(html).toContain('单镜头分镜数')
    expect(html).toContain('目标受众')
    expect(html).toContain('语气')
    expect(html).toContain('卖点')
    expect(html).toContain('行动号召')
    expect(html).toContain('Mock Prompt')
    expect(html).toContain('本地生成可编辑的项目')
  })
})
