import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

describe('FrameOS click menu and editing interactions', () => {
  it('opens the points menu only by click and exposes detail without recharge or coins', () => {
    const shell = source('src/components/frameos/FosShell.tsx')
    const balance = shell.slice(shell.indexOf('function BalancePill'), shell.indexOf('export function FosHeader'))

    expect(balance).toContain('aria-haspopup="menu"')
    expect(balance).toContain('onClick={() => setOpen((value) => !value)}')
    expect(balance).not.toContain('onMouseEnter')
    expect(balance).not.toContain('立即充值')
    expect(balance).not.toContain('金币')
    expect(balance).toContain('查看明细')
  })

  it('supports draggable source audio, a draggable playhead, and Escape to leave node editing', () => {
    const timeline = source('src/components/frameos/views/FosAssemblyTimeline.tsx')
    const editor = source('src/components/frameos/views/FosAssemblyEditor.tsx')
    const generator = source('src/features/canvas/components/CanvasGenerator.tsx')
    const composition = source('src/features/video-editor/remotion/VideoComposition.tsx')

    expect(timeline).toContain('onMoveAudio')
    expect(timeline).toContain('onPointerDown={(event) => startAudioDrag(event, item)}')
    expect(timeline).toContain('aria-label="剪辑播放头"')
    expect(timeline).toContain('onPointerMove={movePlayhead}')
    expect(editor).toContain('timelineStartFrame')
    expect(composition).toContain('分离后的源音频使用整集绝对坐标')
    expect(generator).toContain("if (event.key !== 'Escape') return")
    expect(generator).toContain('closeEditorRef.current()')
  })

  it('auto-syncs sibling tabs and keeps refs current before retrying a merge', () => {
    const autosave = source('src/features/canvas/state/useCanvasAutosave.ts')
    const graph = source('src/features/canvas/CanvasGraph.tsx')

    expect(autosave).toContain('new BroadcastChannel(`nori-canvas:')
    expect(autosave).toContain("summaryRef.current = '自动合并多标签页更改'")
    expect(autosave).toContain('if (await mergeLatestServerVersion()) return')
    expect(autosave).toContain('MAX_AUTOMATIC_CONFLICT_MERGES = 8')
    expect(autosave).toContain('mergeCanvasDocuments(base, local, remote, summary)')
    expect(graph).toContain('onMergeDocument: mergeDocument')
    expect(graph).toContain('nodesRef.current = nextNodes')
    expect(graph).toContain('edgesRef.current = nextEdges')
  })
})
