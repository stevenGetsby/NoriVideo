// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Stage1ScriptAnalysisView } from '@/components/batch-workflow/stages/Stage1ScriptAnalysisView'
import { Stage5ScreeningRoomView } from '@/components/batch-workflow/stages/Stage5ScreeningRoomView'
import type { BatchItemDTO, BatchStageState, OriginalScriptArtifact, VideoGenArtifact } from '@/lib/batch-workflow/types'

vi.mock('@/components/ui/icons', () => ({ AppIcon: () => null }))
vi.mock('@/components/frameos/materials/MaterialPickerDialog', () => ({ MaterialPickerDialog: () => null }))
vi.mock('@/lib/ui/feedback', () => ({ confirmAction: vi.fn(async () => true) }))

function item(id: string): BatchItemDTO {
  return {
    id, batchRunId: 'run-1', index: 0, title: id, currentStage: 'script_analysis', status: 'running',
    inputPayload: { sourceType: 'pasted_script', pastedScript: '原始文本' },
    stageStates: { script_analysis: stageState, script_rewrite: stageState, asset_extraction: stageState, storyboard: stageState, video_gen: stageState }, stageOutputs: {},
    errorMessage: null, hasPendingAsyncTasks: false, createdAt: '2026-01-01', updatedAt: '2026-01-01',
  }
}

const stageState: BatchStageState = { status: 'waiting_review', skillSlug: 's1' }
const artifact: OriginalScriptArtifact = {
  sourceMode: 'pasted_script', title: '标题', summary: '梗概', estimatedDurationSec: 5,
  characters: [], locations: [], props: [], fullScriptText: '原始文本',
  beats: [{ beatIndex: 1, sceneHeading: '开场', visualAction: '画面', dialogue: '原对白' }],
}

function videoArtifact(firstStatus: 'ready' | 'queued' | 'failed'): VideoGenArtifact {
  return {
    modelKey: 'model', aspectRatio: '16:9', resolution: '720p', generateAudio: false, inputMode: 'text',
    readyCount: 1, totalCount: 3, pendingCount: 1, failedCount: 0,
    shots: ['one', 'two', 'three'].map((id, index) => ({
      shotId: id, shotIndex: index + 1, title: id, durationSec: 20, prompt: '提示词', referencedAssetIds: [], selectedTakeIndex: 0,
      takes: [{
        takeIndex: 1, prompt: '提示词', modelKey: 'model', inputMode: 'text', aspectRatio: '16:9', resolution: '720p',
        durationSec: 20, generateAudio: false, status: index === 0 ? firstStatus : index === 1 ? 'failed' : 'ready',
        submittedAt: '2026-01-01', videoUrl: (index === 0 && firstStatus !== 'ready') || index === 1 ? null : `https://example.com/${id}.mp4`,
      }],
    })),
  }
}

describe('stage view local state', () => {
  let root: Root
  let container: HTMLDivElement

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.clearAllMocks()
  })

  it('S1 preserves dirty and shows an inline retry after save rejects', async () => {
    const save = vi.fn(async () => { throw new Error('保存冲突') })
    const dirty = vi.fn()
    await act(async () => root.render(<Stage1ScriptAnalysisView
      item={item('a')} artifact={artifact} isTrialView={false} stageState={stageState}
      running={false} saving={false} canManageSkills={false} onRunStage={vi.fn()}
      onSaveDraft={save} onApproveAndNext={vi.fn()} onDirtyChange={dirty} onNotify={vi.fn()}
    />))
    const input = container.querySelector('input:not([type="file"])')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(input, '用户修改标题')
      input.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(container.textContent).toContain('有未保存修改')
    const saveButton = Array.from(container.querySelectorAll('button')).find((button) => button.textContent?.includes('保存修改'))!
    await act(async () => saveButton.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(save).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('保存冲突')
    expect(container.textContent).toContain('有未保存修改')
    expect(container.textContent).toContain('重试保存')
    expect(dirty).toHaveBeenLastCalledWith(true)
  })

  it('S1 keeps local dirty state when the parent skips the pre-run flush', async () => {
    const runStage = vi.fn(async () => {})
    const dirty = vi.fn()
    const flush = vi.fn(async () => {})
    const notify = vi.fn()
    const render = (running: boolean, stageArtifact: OriginalScriptArtifact | null = artifact) => {
      const stageItem = item('a')
      stageItem.inputPayload = { sourceType: 'video', sourceVideoUrl: 'local.mp4' }
      return root.render(<Stage1ScriptAnalysisView
      item={stageItem} artifact={stageArtifact} isTrialView={false} stageState={stageState}
      running={running} saving={false} canManageSkills={false} onRunStage={runStage}
      onSaveDraft={vi.fn()} onApproveAndNext={vi.fn()} onDirtyChange={dirty} onNotify={notify}
      onFlushBeforeRun={flush}
    />)
    }
    await act(async () => render(false))
    const sceneInput = Array.from(container.querySelectorAll('input:not([type="file"])')).find((element) => (element as HTMLInputElement).value === '开场')!
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(sceneInput, '尚未保存的场景')
      sceneInput.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const rerun = Array.from(container.querySelectorAll<HTMLButtonElement>('button')).find((button) => button.textContent?.includes('重新解析'))!
    expect(rerun.disabled).toBe(false)
    await act(async () => rerun.click())
    expect(flush).toHaveBeenCalledOnce()
    expect(notify).not.toHaveBeenCalled()
    expect(runStage).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('有未保存修改')
    await act(async () => render(true))
    await act(async () => render(false, null))
    expect((sceneInput as HTMLInputElement).value).toBe('尚未保存的场景')
    expect(container.textContent).toContain('有未保存修改')
    expect(dirty).toHaveBeenLastCalledWith(true)
  })

  it('S5 disables queued/failed takes and never navigates to unplayable shots', async () => {
    await act(async () => root.render(<Stage5ScreeningRoomView
      item={item('a')} storyboardArtifact={null} artifact={videoArtifact('ready')} stageState={stageState}
      running={false} materializing={false} onGenerateVideos={vi.fn()} onSelectTake={vi.fn()}
      onMaterializeCanvas={vi.fn()} onJumpToStoryboard={vi.fn()} videoCapabilities={{ minDurationSec: 4, maxDurationSec: 8 }}
    />))
    expect(container.textContent).toContain('模型时长 8s')
    expect(container.querySelectorAll('.wf-take-pill:disabled')).toHaveLength(1)
    const previous = container.querySelector('button[aria-label="上一镜"]') as HTMLButtonElement
    expect(previous.disabled).toBe(true)
    const next = container.querySelector('button[aria-label="下一镜"]') as HTMLButtonElement
    await act(async () => next.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.textContent).toContain('镜头 03 / 03')
    expect(container.querySelectorAll('.wf-screening-seg:disabled')).toHaveLength(1)
    expect((next as HTMLButtonElement).disabled).toBe(true)
  })

  it('S5 resets editor, current shot and pending playback state on item change', async () => {
    const render = (id: string) => root.render(<Stage5ScreeningRoomView
      item={item(id)} storyboardArtifact={null} artifact={videoArtifact('ready')} stageState={stageState}
      running={false} materializing={false} onGenerateVideos={vi.fn()} onSelectTake={vi.fn()}
      onMaterializeCanvas={vi.fn()} onJumpToStoryboard={vi.fn()}
    />)
    await act(async () => render('a'))
    await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('单镜微调'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.wf-reel-reroll textarea')).not.toBeNull()
    await act(async () => render('b'))
    expect(container.querySelector('.wf-reel-reroll')).toBeNull()
    expect(container.textContent).toContain('镜头 01 / 03')
    expect(container.querySelectorAll('video')).toHaveLength(2)
    expect(Array.from(container.querySelectorAll<HTMLVideoElement>('.wf-shot-reel video')).every((video) => video.preload === 'none')).toBe(true)
  })

  it('S5 keeps the reroll editor and exposes the rejection after generation fails', async () => {
    const generate = vi.fn(async () => { throw new Error('视频提交被拒绝') })
    await act(async () => root.render(<Stage5ScreeningRoomView
      item={item('a')} storyboardArtifact={null} artifact={videoArtifact('ready')} stageState={stageState}
      running={false} materializing={false} onGenerateVideos={generate} onSelectTake={vi.fn()}
      onMaterializeCanvas={vi.fn()} onJumpToStoryboard={vi.fn()}
    />))
    await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('单镜微调'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('提交单镜重抽'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(generate).toHaveBeenCalledOnce()
    expect(container.textContent).toContain('视频提交被拒绝')
    expect(container.querySelector('.wf-reel-reroll textarea')).not.toBeNull()
  })

  it('S5 replaces a failed main video with an inline retry and remounts it on retry', async () => {
    await act(async () => root.render(<Stage5ScreeningRoomView
      item={item('a')} storyboardArtifact={null} artifact={videoArtifact('ready')} stageState={stageState}
      running={false} materializing={false} onGenerateVideos={vi.fn()} onSelectTake={vi.fn()}
      onMaterializeCanvas={vi.fn()} onJumpToStoryboard={vi.fn()}
    />))
    const player = container.querySelector<HTMLVideoElement>('.wf-screening-video')!
    await act(async () => player.dispatchEvent(new Event('error', { bubbles: true })))
    expect(container.querySelector('.wf-screening-video')).toBeNull()
    expect(container.textContent).toContain('视频加载失败')
    await act(async () => Array.from(container.querySelectorAll('button')).find((b) => b.textContent?.includes('重试加载'))?.dispatchEvent(new MouseEvent('click', { bubbles: true })))
    expect(container.querySelector('.wf-screening-video')).not.toBeNull()
    expect(container.textContent).not.toContain('重试加载')
  })
})
