import { describe, expect, it } from 'vitest'
import {
  getScreenwriterTaskNextRoute,
  getVideoRepaintStageRoute,
} from '@/components/frameos/screenwriter/screenwriterRoutes'
import {
  getVideoRepaintTask,
  listScreenwriterTasks,
} from '@/components/frameos/screenwriter/screenwriterMockStore'

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
})
