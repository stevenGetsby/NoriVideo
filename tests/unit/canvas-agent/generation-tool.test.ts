import { expect, it, vi } from 'vitest'
import { createGenerationTools } from '@/features/canvas/agent/tools/generation-tools'
import type { CanvasAgentBridge } from '@/features/canvas/agent/bridge-types'
import type { CanvasFlowNode } from '@/features/canvas/editor-types'

const image = (id: string, prompt: string): CanvasFlowNode => ({ id, type: 'image', position: { x: 0, y: 0 }, data: { title: id, prompt } })

const fixture = () => {
  let nodes = [image('actor', '说明')]
  const generate = vi.fn<CanvasAgentBridge['generate']>(async () => undefined)
  const ctx = {
    bridge: {
      getGraph: () => ({ nodes, edges: [], viewport: { x: 0, y: 0, zoom: 1 } }),
      generate, isWriteLocked: () => false,
      run: async <T,>(fn: () => T | Promise<T>) => await fn(),
      commit: (change: { nodes: CanvasFlowNode[] }) => { nodes = change.nodes },
    } as unknown as CanvasAgentBridge,
    stopped: () => false,
    turn: { quotedPoints: 0 },
    settings: { autonomy: 'confirm_costly' as 'confirm_costly' | 'auto_budget', budgetPoints: 10 },
    loadConfig: vi.fn(async () => ({
      imageModels: [{ modelKey: 'fixture::image', name: '示例', provider: 'fixture', options: {} }],
      textModels: [], videoModels: [],
      defaults: { imageModel: 'fixture::image' },
    })),
    quote: vi.fn(async () => 6 as number | null),
    confirm: vi.fn(async () => true),
    consumeBatchApproval: vi.fn((): 'none' | 'approved' | 'changed' => 'none'),
  }
  return { ctx, generate, tools: createGenerationTools(ctx), replace: (items: CanvasFlowNode[]) => { nodes = items } }
}

it('requires confirmation by default and does not submit a declined generation', async () => {
  const { ctx, generate, tools } = fixture()
  ctx.confirm.mockResolvedValueOnce(false)
  await expect(tools.generate({ node: 'actor', prompt: '保留新提示词', count: 1 })).resolves.toEqual({ status: 'declined' })
  expect(ctx.bridge.getGraph().nodes[0].data.prompt).toBe('保留新提示词')
  expect(generate).not.toHaveBeenCalled()
  await tools.generate({ node: 'actor', count: 1 })
  expect(generate).toHaveBeenCalledWith(expect.objectContaining({ modelKey: 'fixture::image', prompt: '保留新提示词', quotedCostPoints: 6 }), expect.any(Function))
})

it('previews a priced draft without writing, and requires a new confirmation for a changed batch approval even on auto budget', async () => {
  const { ctx, generate, tools } = fixture()
  const preview = await tools.preview({ node: 'actor', prompt: '下一张图', count: 1 })
  expect(preview).toMatchObject({ title: 'actor', points: 6, nodeId: 'actor' })
  expect(ctx.bridge.getGraph().nodes[0].data.prompt).toBe('说明')
  expect(generate).not.toHaveBeenCalled()
  ctx.settings.autonomy = 'auto_budget'
  ctx.consumeBatchApproval.mockReturnValueOnce('changed')
  ctx.confirm.mockResolvedValueOnce(false)
  await expect(tools.generate({ node: 'actor', prompt: '下一张图', count: 1 }, 'queued')).resolves.toEqual({ status: 'declined' })
  expect(ctx.consumeBatchApproval).toHaveBeenCalledWith('queued', expect.objectContaining({ fingerprint: preview.fingerprint }))
  expect(generate).not.toHaveBeenCalled()
})

it('uses read-only details to quote an unhydrated draft and leaves the editor untouched', async () => {
  const { ctx, tools, replace } = fixture()
  const shell = image('actor', '')
  shell.data.__canvasUnhydrated = true
  replace([shell])
  ctx.bridge.readNodeDetails = vi.fn(async () => image('actor', '完整提示词'))
  await expect(tools.preview({ node: 'actor', count: 1 })).resolves.toMatchObject({ points: 6, nodeId: 'actor' })
  expect(ctx.bridge.readNodeDetails).toHaveBeenCalledWith('actor')
  expect(ctx.bridge.getGraph().nodes).toEqual([shell])
})

it('checks the approved fingerprint again after async submission preparation', async () => {
  const { generate, tools, replace } = fixture()
  const submit = vi.fn()
  generate.mockImplementationOnce(async (_request, verify) => {
    await Promise.resolve()
    replace([image('actor', '提交准备期间改写')])
    verify?.()
    submit()
  })
  await expect(tools.generate({ node: 'actor', count: 1 })).rejects.toThrow(/CANVAS_CHANGED/)
  expect(submit).not.toHaveBeenCalled()
})

it('uses the cumulative budget and cannot auto-submit an unpriced or changed request', async () => {
  const { ctx, generate, tools, replace } = fixture()
  ctx.settings.autonomy = 'auto_budget'
  await tools.generate({ node: 'actor', count: 1 })
  expect(ctx.confirm).not.toHaveBeenCalled()
  expect(ctx.turn.quotedPoints).toBe(6)
  ctx.confirm.mockResolvedValueOnce(false)
  await expect(tools.generate({ node: 'actor', count: 1 })).resolves.toEqual({ status: 'declined' })
  expect(ctx.confirm).toHaveBeenCalledOnce()
  ctx.quote.mockResolvedValueOnce(null)
  ctx.confirm.mockImplementationOnce(async () => { replace([image('actor', '已改提示词')]); return true })
  await expect(tools.generate({ node: 'actor', count: 1 })).rejects.toThrow(/CANVAS_CHANGED/)
  expect(generate).toHaveBeenCalledOnce()
})
