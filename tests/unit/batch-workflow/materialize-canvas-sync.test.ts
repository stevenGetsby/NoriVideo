import { describe, expect, it } from 'vitest'
import {
  buildBatchItemCanvasGraph,
  canvasFingerprintFromSnapshot,
  computeBatchItemCanvasFingerprint,
  mergeBatchItemCanvasSync,
} from '@/lib/batch-workflow/materialize-canvas'
import type { BatchItemDTO } from '@/lib/batch-workflow/types'

function item(): BatchItemDTO {
  return {
    id: 'item-1', batchRunId: 'run-1', index: 0, title: '测试', inputPayload: {},
    currentStage: 'video_gen', status: 'waiting_review', stageStates: {}, errorMessage: null,
    createdAt: '', updatedAt: '', revision: 0,
    stageOutputs: {
      asset_extraction: {
        styleBible: '', colorPalette: '', lightingDirection: '', readyCount: 1, totalCount: 1, pendingCount: 0, failedCount: 0,
        items: [{
          id: 'asset-1', kind: 'character', name: '甲', aliases: [], roleOrUsage: '', description: '',
          imagePrompt: 'image prompt', aspectRatio: '9:16', status: 'ready', materialId: 'mat-1', imageUrl: 'old.png',
          selectedVersionIndex: 0,
          versions: [{ versionIndex: 0, imageUrl: 'a.png', prompt: '', aspectRatio: '9:16', source: 'generated', status: 'ready', createdAt: '' }],
        }],
      },
      storyboard: {
        aspectRatio: '9:16', totalDurationSec: 5, pacingStyle: '', videoModelKey: '', supportsFirstLastFrame: false,
        allowedDurationRange: { min: 1, max: 10 },
        shots: [{ shotId: 'shot-1', shotIndex: 1, sceneIndex: 1, title: '开场', durationSec: 5, shotType: '', cameraMovement: '', visualDescription: '', videoPrompt: 'old prompt', referencedAssetIds: ['asset-1'], referencedAssetNames: [], inputMode: 'text', negativeConstraints: '' }],
      },
      video_gen: {
        modelKey: '', aspectRatio: '9:16', resolution: '720p', generateAudio: true, inputMode: 'text', readyCount: 1, totalCount: 1, pendingCount: 0, failedCount: 0,
        shots: [{ shotId: 'shot-1', shotIndex: 1, title: '开场', durationSec: 5, prompt: '', referencedAssetIds: ['asset-1'], selectedTakeIndex: 0,
          takes: [{ takeIndex: 0, videoUrl: 'a.mp4', prompt: '', modelKey: '', inputMode: 'text', aspectRatio: '9:16', resolution: '720p', durationSec: 5, generateAudio: true, status: 'ready', submittedAt: '' }] }],
      },
    },
  } as unknown as BatchItemDTO
}

describe('canvas materialization fingerprint and graph', () => {
  it('is stable for equivalent state and ignores unrelated fields', () => {
    const first = item()
    const second = structuredClone(first)
    second.title = '无关标题'
    second.stageOutputs.script_analysis = { title: '新标题' } as never
    second.stageOutputs.video_gen!.shots[0].takes[0].submittedAt = 'later'
    expect(computeBatchItemCanvasFingerprint(first)).toBe(computeBatchItemCanvasFingerprint(second))
    expect(computeBatchItemCanvasFingerprint(first)).toMatch(/^[a-f0-9]{64}$/)
  })

  it('changes when selected take, asset version, duration, or order changes', () => {
    const original = item()
    const take = structuredClone(original)
    take.stageOutputs.video_gen!.shots[0].takes[0].videoUrl = 'b.mp4'
    expect(computeBatchItemCanvasFingerprint(take)).not.toBe(computeBatchItemCanvasFingerprint(original))
    const asset = structuredClone(original)
    asset.stageOutputs.asset_extraction!.items[0].versions[0].imageUrl = 'b.png'
    expect(computeBatchItemCanvasFingerprint(asset)).not.toBe(computeBatchItemCanvasFingerprint(original))
    const duration = structuredClone(original)
    duration.stageOutputs.storyboard!.shots[0].durationSec = 6
    expect(computeBatchItemCanvasFingerprint(duration)).not.toBe(computeBatchItemCanvasFingerprint(original))
  })

  it('writes ownership metadata and fingerprint, and never writes unavailable URLs', () => {
    const current = item()
    const unavailable = structuredClone(current)
    unavailable.stageOutputs.video_gen!.shots[0].takes[0].status = 'processing'
    unavailable.stageOutputs.asset_extraction!.items[0].versions[0].status = 'failed'
    const graph = buildBatchItemCanvasGraph({ canvasId: 'canvas-1', item: unavailable })
    expect(graph.skippedShots).toEqual([{ shotId: 'shot-1', reason: 'not_ready' }])
    expect(graph.nodes.filter((node) => node.type === 'image')).toHaveLength(0)
    const shot = graph.nodes.find((node) => node.data?.sourceMetadata && (node.data.sourceMetadata as never as { shotId?: string }).shotId === 'shot-1')!
    expect(shot.data?.videoUrl).toBeNull()
    expect(shot.data?.contentUrl).toBeNull()
    const playlist = graph.nodes.find((node) => node.type === 'playlist')!
    expect(playlist.data?.playlistItems).toEqual([])
    const fingerprint = canvasFingerprintFromSnapshot({ nodes: graph.nodes })
    expect(fingerprint).toBe(computeBatchItemCanvasFingerprint(unavailable))
  })

  it('reports an explicitly selected ready take with an empty URL', () => {
    const current = item()
    current.stageOutputs.video_gen!.shots[0].takes[0].videoUrl = ''
    const graph = buildBatchItemCanvasGraph({ canvasId: 'canvas-1', item: current })
    expect(graph.skippedShots).toEqual([{ shotId: 'shot-1', reason: 'empty_url' }])
  })
})

describe('mergeBatchItemCanvasSync', () => {
  it('updates adopted media and playlist while preserving layout and user edits/nodes/edges', () => {
    const original = item()
    const first = buildBatchItemCanvasGraph({ canvasId: 'canvas-1', item: original })
    const changed = structuredClone(original)
    changed.stageOutputs.video_gen!.shots[0].takes[0].videoUrl = 'new.mp4'
    const next = buildBatchItemCanvasGraph({ canvasId: 'canvas-1', item: changed })
    const originalShot = first.nodes.find((node) => node.type === 'video')!
    originalShot.position = { x: 999, y: 777 }
    originalShot.data = { ...originalShot.data, title: '用户标题', prompt: '用户提示词', sourceMetadata: { ...(originalShot.data?.sourceMetadata as Record<string, unknown>), userAnnotation: 'keep' } }
    const originalPlaylist = first.nodes.find((node) => node.type === 'playlist')!
    originalPlaylist.data = { ...originalPlaylist.data, title: '用户播放列表' }
    const userNode = { ...originalShot, id: 'user-node', type: 'text', position: { x: 1, y: 2 }, data: { text: 'mine' } }
    const userEdge = { id: 'user-edge', sourceNodeId: 'user-node', targetNodeId: originalShot.id, sourceHandle: null, targetHandle: null, role: 'INPUT_DEFAULT' }
    const merged = mergeBatchItemCanvasSync({ existingNodes: [...first.nodes, userNode], existingEdges: [...first.edges, userEdge], graph: next })!
    const shot = merged.nodes.find((node) => node.id === originalShot.id)!
    expect(shot.position).toEqual({ x: 999, y: 777 })
    expect(shot.data).toMatchObject({ title: '用户标题', prompt: '用户提示词', videoUrl: 'new.mp4', contentUrl: 'new.mp4', sourceMetadata: { userAnnotation: 'keep' } })
    expect(merged.nodes.find((node) => node.id === 'user-node')).toEqual(userNode)
    expect(merged.edges).toContainEqual(userEdge)
    const playlist = merged.nodes.find((node) => node.id === originalPlaylist.id)!
    expect(playlist.data?.title).toBe('用户播放列表')
    expect(playlist.data?.playlistItems).toEqual([expect.objectContaining({ videoUrl: 'new.mp4', sourceNodeId: originalShot.id })])
    expect(canvasFingerprintFromSnapshot({ nodes: merged.nodes })).toBe(computeBatchItemCanvasFingerprint(changed))
  })

  it('does not resurrect a workflow node the user deleted', () => {
    const original = item()
    const first = buildBatchItemCanvasGraph({ canvasId: 'canvas-1', item: original })
    const shot = first.nodes.find((node) => node.type === 'video')!
    const next = buildBatchItemCanvasGraph({ canvasId: 'canvas-1', item: original })
    const merged = mergeBatchItemCanvasSync({
      existingNodes: first.nodes.filter((node) => node.id !== shot.id),
      existingEdges: first.edges.filter((edge) => edge.sourceNodeId !== shot.id && edge.targetNodeId !== shot.id),
      graph: next,
    })!
    expect(merged.nodes.some((node) => node.type === 'video')).toBe(false)
    expect(merged.edges.some((edge) => edge.sourceNodeId === shot.id || edge.targetNodeId === shot.id)).toBe(false)
  })

  it('keeps the last usable media when the newly selected take is unavailable', () => {
    const original = item()
    const first = buildBatchItemCanvasGraph({ canvasId: 'canvas-1', item: original })
    const changed = structuredClone(original)
    changed.stageOutputs.video_gen!.shots[0].takes[0].status = 'failed'
    const next = buildBatchItemCanvasGraph({ canvasId: 'canvas-1', item: changed })
    const merged = mergeBatchItemCanvasSync({ existingNodes: first.nodes, existingEdges: first.edges, graph: next })!
    const shot = merged.nodes.find((node) => node.type === 'video')!
    expect(shot.data?.videoUrl).toBe('a.mp4')
    const playlist = merged.nodes.find((node) => node.type === 'playlist')!
    expect(playlist.data?.playlistItems).toEqual([])
  })

  it('refuses to guess ownership on a legacy canvas', () => {
    const original = item()
    const first = buildBatchItemCanvasGraph({ canvasId: 'canvas-1', item: original })
    const legacy = first.nodes.map((node) => ({ ...node, data: { ...node.data, sourceMetadata: { shotId: 'shot-1' } } }))
    expect(mergeBatchItemCanvasSync({ existingNodes: legacy, existingEdges: first.edges, graph: first })).toBeNull()
  })
})
