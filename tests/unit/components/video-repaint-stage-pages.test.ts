import * as React from 'react'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { EpisodeProgressGrid } from '@/components/frameos/screenwriter/EpisodeProgressGrid'
import { SettingsReviewPage } from '@/components/frameos/screenwriter/SettingsReviewPage'
import { TargetScriptReview } from '@/components/frameos/screenwriter/TargetScriptReview'
import {
  videoRepaintDemoTask,
  videoRepaintTargetScriptEpisodes,
} from '@/components/frameos/screenwriter/screenwriterDemoData'

describe('SettingsReviewPage', () => {
  it('renders the source settings checkpoint with source outline, name index, issues, and feedback actions', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(SettingsReviewPage, {
        review: videoRepaintDemoTask.sourceSettings,
        confirmLabel: '确认设定总纲，继续',
        regenerateLabel: '重新提炼',
      }),
    )

    expect(html).toContain('设定总纲')
    expect(html).toContain('故事核与主冲突')
    expect(html).toContain('统一名索引')
    expect(html).toContain('苏晚卿')
    expect(html).toContain('建议复核点')
    expect(html).toContain('E25')
    expect(html).toContain('修改反馈')
    expect(html).toContain('重新提炼')
    expect(html).toContain('确认设定总纲，继续')
  })

  it('renders the target settings checkpoint with target outline and mapping panel', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(SettingsReviewPage, {
        review: videoRepaintDemoTask.targetSettings,
        confirmLabel: '确认锁定，开始转绘',
        regenerateLabel: '重新生成',
      }),
    )

    expect(html).toContain('目标设定总纲')
    expect(html).toContain('Alpha Billionaire')
    expect(html).toContain('角色 / 场景 / 关键道具映射')
    expect(html).toContain('Sophia Vance')
    expect(html).toContain('待确认问题')
    expect(html).toContain('关于全剧权力世界的尺度与合规包装')
    expect(html).toContain('确认锁定，开始转绘')
  })
})

describe('EpisodeProgressGrid', () => {
  it('renders all episode cards with progress count and retry affordance', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(EpisodeProgressGrid, {
        title: '逐集对齐',
        description: '系统正在按已确认的源设定总纲整理跨集人物、地点和道具称呼。',
        episodes: videoRepaintDemoTask.alignmentEpisodes,
      }),
    )

    expect(html).toContain('逐集对齐')
    expect(html).toContain('0 / 30 集完成')
    expect(html).toContain('EP01')
    expect(html).toContain('EP30')
    expect(html).toContain('整理中')
    expect(html).toContain('重试')
  })
})

describe('TargetScriptReview', () => {
  it('renders target script episode list and editor actions', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(TargetScriptReview, {
        episodes: videoRepaintTargetScriptEpisodes,
      }),
    )

    expect(html).toContain('目标剧本')
    expect(html).toContain('EP01')
    expect(html).toContain('Rain Escape')
    expect(html).toContain('Sophia')
    expect(html).toContain('保存编辑')
    expect(html).toContain('进入后续分镜')
  })
})
