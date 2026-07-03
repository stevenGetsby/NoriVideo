import * as React from 'react'
import { beforeEach, describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ScriptRepaintCreateForm } from '@/components/frameos/screenwriter/ScriptRepaintCreateForm'
import {
  validateVideoRepaintCreateInput,
} from '@/components/frameos/screenwriter/VideoRepaintCreateForm'
import {
  getScreenwriterTaskNextRoute,
  getVideoRepaintStageRoute,
} from '@/components/frameos/screenwriter/screenwriterRoutes'
import {
  advanceVideoRepaintTask,
  createVideoRepaintTask,
  getVideoRepaintAutoAdvance,
  getVideoRepaintTask,
  listScreenwriterTasks,
  resetScreenwriterMockStore,
} from '@/components/frameos/screenwriter/screenwriterMockStore'

beforeEach(() => {
  resetScreenwriterMockStore()
})

describe('screenwriter interaction routes', () => {
  it('builds stage routes for a video repaint task', () => {
    expect(getVideoRepaintStageRoute('task-1', 'source_settings')).toBe('/screenwriter/video-repaint/task-1/source-settings')
    expect(getVideoRepaintStageRoute('task-1', 'episode_alignment')).toBe('/screenwriter/video-repaint/task-1/episode-alignment')
    expect(getVideoRepaintStageRoute('task-1', 'target_settings')).toBe('/screenwriter/video-repaint/task-1/target-settings')
    expect(getVideoRepaintStageRoute('task-1', 'episode_repaint')).toBe('/screenwriter/video-repaint/task-1/episode-repaint')
    expect(getVideoRepaintStageRoute('task-1', 'target_script')).toBe('/screenwriter/video-repaint/task-1/target-script')
  })

  it('uses the task nextRoute when the script item is clicked', () => {
    const [task] = listScreenwriterTasks()

    expect(task.title).toBe('TEST-海外转绘版')
    expect(getScreenwriterTaskNextRoute(task)).toBe('/screenwriter/video-repaint/demo-oversea-redraw-task/source-settings')
  })
})

describe('screenwriter mock store', () => {
  it('lists current screenwriter tasks with route metadata', () => {
    const tasks = listScreenwriterTasks()

    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({
      activeTaskId: 'demo-oversea-redraw-task',
      currentStage: 'source_settings',
      currentStageStatus: 'waiting_check',
      nextRoute: '/screenwriter/video-repaint/demo-oversea-redraw-task/source-settings',
    })
  })

  it('returns video repaint task detail by task id', () => {
    const task = getVideoRepaintTask('demo-oversea-redraw-task')

    expect(task?.id).toBe('demo-oversea-redraw-task')
    expect(task?.routeByStage.source_settings).toBe('/screenwriter/video-repaint/demo-oversea-redraw-task/source-settings')
    expect(task?.routeByStage.target_script).toBe('/screenwriter/video-repaint/demo-oversea-redraw-task/target-script')
  })

  it('advances checkpoint stages to the next flow page', () => {
    const sourceResult = advanceVideoRepaintTask('demo-oversea-redraw-task', 'source_settings')

    expect(sourceResult).toMatchObject({
      nextStage: 'episode_alignment',
      nextRoute: '/screenwriter/video-repaint/demo-oversea-redraw-task/episode-alignment',
    })
    expect(getVideoRepaintTask('demo-oversea-redraw-task')?.currentStage).toBe('episode_alignment')

    const targetResult = advanceVideoRepaintTask('demo-oversea-redraw-task', 'target_settings')

    expect(targetResult).toMatchObject({
      nextStage: 'episode_repaint',
      nextRoute: '/screenwriter/video-repaint/demo-oversea-redraw-task/episode-repaint',
    })
  })

  it('describes auto advance for non-checkpoint stage pages', () => {
    expect(getVideoRepaintAutoAdvance('demo-oversea-redraw-task', 'episode_alignment')).toMatchObject({
      delayMs: 10000,
      nextStage: 'target_settings',
      nextRoute: '/screenwriter/video-repaint/demo-oversea-redraw-task/target-settings',
    })
    expect(getVideoRepaintAutoAdvance('demo-oversea-redraw-task', 'episode_repaint')).toMatchObject({
      delayMs: 10000,
      nextStage: 'target_script',
      nextRoute: '/screenwriter/video-repaint/demo-oversea-redraw-task/target-script',
    })
    expect(getVideoRepaintAutoAdvance('demo-oversea-redraw-task', 'source_settings')).toBeNull()
  })

  it('adds a submitted video repaint task to the workbench task list', () => {
    const submitted = createVideoRepaintTask({
      title: '夜色债 · 海外转绘版',
      transferForm: 'script',
      uploadMode: 'file',
      sourceAssetName: 'episode-01.mp4',
      requirement: '输出英文版本，保留现代都市设定。',
      checkpoints: { A: true, B: true },
    })

    const tasks = listScreenwriterTasks()
    const newTask = tasks.find((task) => task.activeTaskId === submitted.id)

    expect(submitted.nextRoute).toBe(`/screenwriter/video-repaint/${submitted.id}`)
    expect(newTask).toMatchObject({
      title: '夜色债 · 海外转绘版',
      taskKind: 'video_repaint_2',
      activeTaskLabel: '进行中',
      currentStage: 'auto_split',
      currentStageStatus: 'running',
      nextRoute: `/screenwriter/video-repaint/${submitted.id}`,
    })
    expect(getVideoRepaintTask(submitted.id)?.requirement).toBe('输出英文版本，保留现代都市设定。')
  })
})

describe('video repaint create validation', () => {
  it('rejects missing required create fields before submit', () => {
    const result = validateVideoRepaintCreateInput({
      title: ' ',
      transferForm: 'script',
      uploadMode: 'file',
      sourceAssetName: '',
      requirement: ' ',
      checkpoints: { A: true, B: true },
    })

    expect(result.valid).toBe(false)
    if (!result.valid) {
      expect(result.errors.title).toBe('请输入任务名称')
      expect(result.errors.sourceAssetName).toBe('请先选择参考视频')
      expect(result.errors.requirement).toBe('请输入转绘需求')
    }
  })
})

describe('script repaint create form availability', () => {
  it('keeps unimplemented source input modes disabled with hover hints', () => {
    Reflect.set(globalThis, 'React', React)

    const html = renderToStaticMarkup(
      createElement(ScriptRepaintCreateForm, {
        onBack: () => undefined,
        onStart: () => undefined,
      }),
    )

    expect(html).toContain('data-source-mode="paste"')
    expect(html).not.toContain('data-source-mode="paste" disabled=""')
    expect(html).toContain('data-source-mode="file" disabled=""')
    expect(html).toContain('data-source-mode="workspace" disabled=""')
    expect(html).toContain('title="功能尚未实现"')
  })
})
