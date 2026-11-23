// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CanvasGenerator } from '@/features/canvas/components/CanvasGenerator'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'
import type { CanvasGenerationConfig } from '@/features/canvas/types'

vi.mock('@/hooks/common/useAccountBalance', () => ({
  useAccountBalance: () => ({ generationAllowed: true, generationDisabledReason: null }),
}))

vi.mock('@/components/frameos/materials/MentionPromptEditor', () => ({
  MentionPromptEditor: ({ value, onChange, placeholder }: { value: string; onChange: (value: string) => void; placeholder?: string }) => (
    <textarea aria-label="节点提示词" value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
  ),
}))

vi.mock('@/components/ui/viewport-popover', () => ({
  ViewportPopover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const savedGeneration: CanvasGenerationConfig = {
  modelKey: 'synthetic-video',
  modelLabel: '合成视频模型',
  inputMode: 'firstlastframe',
  aspectRatio: '9:16',
  resolution: '720p',
  duration: 12,
  generateAudio: true,
  count: 1,
  referenceNodeIds: [],
  referenceSummary: [],
  parameters: { fps: 30 },
}

const node = (unhydrated = false): CanvasFlowNode => ({
  id: 'node-1',
  type: 'video',
  position: { x: 0, y: 0 },
  data: {
    title: '合成节点',
    prompt: '保留原有提示词',
    generation: structuredClone(savedGeneration),
    ...(unhydrated ? { __canvasUnhydrated: true } : {}),
  },
})

const configResponse = {
  textModels: [], imageModels: [], audioModels: [], model3dModels: [],
  videoModels: [{
    modelKey: 'synthetic-video', name: '合成视频模型', provider: 'synthetic',
    options: { resolution: ['480p', '720p'], duration: [4, 8, 12], fps: [24, 30] },
    firstLastFrame: false, supportGenerateAudio: false,
    inputSchema: { requiredFields: [], image: { min: 0, max: 9 }, video: { min: 0, max: 1 }, audio: { min: 0, max: 1 } },
  }],
  defaults: {
    textModel: null, imageModel: null, editModel: null, storyboardModel: null,
    videoModel: 'synthetic-video', audioModel: null, model3dModel: null,
    aspectRatio: '16:9', resolution: '480p',
  },
}

describe('canvas generator draft hydration', () => {
  let root: Root
  let container: HTMLDivElement
  let onDraftChange: ReturnType<typeof vi.fn>
  let onClose: ReturnType<typeof vi.fn>
  let currentNode: CanvasFlowNode
  let currentConfig = structuredClone(configResponse)

  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
    onDraftChange = vi.fn()
    onClose = vi.fn()
    currentNode = node(true)
    currentConfig = structuredClone(configResponse)
    vi.stubGlobal('fetch', vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input)
      if (url.includes('/generation-config')) return new Response(JSON.stringify(currentConfig), { status: 200 })
      if (url.includes('/generation-quote')) return new Response(JSON.stringify({ points: 0, costCny: 0 }), { status: 200 })
      if (url.includes('/asset-hub/voices')) return new Response(JSON.stringify({ voices: [] }), { status: 200 })
      throw new Error(`Unexpected synthetic request: ${url}`)
    }))
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    container.remove()
    vi.unstubAllGlobals()
    vi.clearAllMocks()
  })

  function render() {
    root.render(<CanvasGenerator
      projectId="project-1"
      node={currentNode}
      incomingNodes={[]}
      referenceNodes={[]}
      onDraftChange={onDraftChange}
      onGenerate={vi.fn(async () => undefined)}
      onReplace={vi.fn()}
      onClose={onClose}
      onFocus={vi.fn()}
      onSelectLibraryMaterial={vi.fn(() => null)}
      panelWidth={480}
      onPanelWidthChange={vi.fn()}
    />)
  }

  it('does not persist model-default normalization before the user edits', async () => {
    await act(async () => {
      render()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    currentNode = node()
    await act(async () => {
      render()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(onDraftChange).not.toHaveBeenCalled()
    const prompt = container.querySelector('textarea[aria-label="节点提示词"]') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(prompt, '用户明确修改')
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(onDraftChange).toHaveBeenCalled()
    expect(onDraftChange.mock.calls.at(-1)?.[0]).toMatchObject({ prompt: '用户明确修改' })
    expect(onDraftChange.mock.calls.at(-1)?.[0].generation).toMatchObject({ inputMode: 'text', generateAudio: false })
  })

  it('does not write defaults when a fully hydrated node is merely opened', async () => {
    currentNode = node()
    await act(async () => {
      render()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(onDraftChange).not.toHaveBeenCalled()
  })

  it('does not persist a no-op prompt reversal or unrelated generation normalization', async () => {
    currentConfig.videoModels[0].firstLastFrame = true
    currentConfig.videoModels[0].supportGenerateAudio = true
    currentNode = node()
    currentNode.data.generation!.inputSchema = structuredClone(currentConfig.videoModels[0].inputSchema)
    await act(async () => {
      render()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const prompt = container.querySelector('textarea[aria-label="节点提示词"]') as HTMLTextAreaElement
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(prompt, '临时输入')
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(onDraftChange).toHaveBeenCalledTimes(1)
    expect(onDraftChange).toHaveBeenLastCalledWith({ prompt: '临时输入' })
    await act(async () => {
      prompt.dispatchEvent(new Event('input', { bubbles: true }))
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    expect(onDraftChange).toHaveBeenCalledTimes(1)
    expect(onDraftChange).toHaveBeenLastCalledWith({ prompt: '临时输入' })
  })

  it('does not persist normalized defaults on blur, fullscreen, or close', async () => {
    currentNode = node()
    await act(async () => {
      render()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
    const prompt = container.querySelector('textarea[aria-label="节点提示词"]') as HTMLTextAreaElement
    await act(async () => { prompt.dispatchEvent(new FocusEvent('blur', { bubbles: true })) })
    const expand = Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === '展开大编辑器')!
    await act(async () => { expand.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const back = Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === '返回画布')!
    await act(async () => { back.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    const close = Array.from(container.querySelectorAll('button')).find((button) => button.getAttribute('aria-label') === '关闭节点编辑器')!
    await act(async () => { close.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(onDraftChange).not.toHaveBeenCalled()
    expect(onClose).toHaveBeenCalledOnce()
  })
})
