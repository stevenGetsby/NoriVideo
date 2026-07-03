import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { VideoRepaintCreateForm } from '@/components/frameos/screenwriter/VideoRepaintCreateForm'
import { VideoRepaintFlowShell } from '@/components/frameos/screenwriter/VideoRepaintFlowShell'
import { videoRepaintDemoTask } from '@/components/frameos/screenwriter/screenwriterDemoData'

describe('VideoRepaintFlowShell', () => {
  it('renders the six-stage task shell with task title and requirement action', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(
        VideoRepaintFlowShell,
        {
          task: videoRepaintDemoTask,
          currentStage: 'source_settings',
          onBack: () => undefined,
          children: createElement('div', null, '阶段内容'),
        },
      ),
    )

    expect(html).toContain('返回编剧工作台')
    expect(html).toContain('自动拆集')
    expect(html).toContain('事实卡提取')
    expect(html).toContain('设定提炼')
    expect(html).toContain('逐集对齐')
    expect(html).toContain('目标设定')
    expect(html).toContain('逐集转绘')
    expect(html).toContain('剧本转绘 2.0')
    expect(html).toContain('TEST-海外转绘版')
    expect(html).toContain('检查点 A')
    expect(html).toContain('查看转绘需求')
    expect(html).toContain('阶段内容')
  })
})

describe('VideoRepaintCreateForm', () => {
  it('renders the upgraded create form inside the flow system', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(VideoRepaintCreateForm, {
        onBack: () => undefined,
        onStart: () => undefined,
      }),
    )

    expect(html).toContain('新建视频转绘 2.0 任务')
    expect(html).toContain('视频转译形式')
    expect(html).toContain('参考视频')
    expect(html).toContain('上传视频文件')
    expect(html).toContain('转绘需求')
    expect(html).toContain('检查点配置')
    expect(html).toContain('开始运行')
  })
})
