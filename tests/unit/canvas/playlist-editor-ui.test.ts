import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

function source(path: string) {
  return readFileSync(path, 'utf8')
}

describe('canvas playlist frame editor UI contract', () => {
  it('shares the project assembly timeline instead of a head-tail trim slider', () => {
    const canvasEditor = source('src/features/canvas/nodes/PlaylistNode.tsx')
    const projectEditor = source('src/components/frameos/views/FosAssemblyEditor.tsx')

    expect(canvasEditor).toContain("import { FosAssemblyTimeline, type AssemblyTrackSelection }")
    expect(projectEditor).toContain('<FosAssemblyTimeline')
    expect(canvasEditor).toContain('<FosAssemblyTimeline')
    expect(canvasEditor).not.toContain('<RoughCutTrimEditor')
    expect(canvasEditor).not.toContain('<RoughCutTimeline')
    expect(canvasEditor).not.toContain('设为入点')
    expect(canvasEditor).not.toContain('设为出点')
    expect(canvasEditor).toContain('CANVAS_PLAYLIST_FPS')
  })

  it('keeps playhead cutting, ordering, continuous preview and reviewer submission in the node', () => {
    const canvasEditor = source('src/features/canvas/nodes/PlaylistNode.tsx')

    expect(canvasEditor).toContain('const splitAtPlayhead = () =>')
    expect(canvasEditor).toContain("commitItems(next, '在播放头切割片段')")
    expect(canvasEditor).toContain('onCut={splitAtPlayhead}')
    expect(canvasEditor).toContain('onUndo={editor.undo}')
    expect(canvasEditor).toContain('onReorder={reorderItems}')
    expect(canvasEditor).toContain('onSeek={seekTimeline}')
    expect(canvasEditor).toContain('finishClip(activeItem.id)')
    expect(canvasEditor).toContain('editor.submitPlaylistReview(id)')
    expect(canvasEditor).toContain('提交最终审核')
  })

  it('freezes the submitted frame ranges into the existing review snapshot', () => {
    const playlistContract = source('src/lib/canvas/playlist.ts')
    const reviewRoute = source('src/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/playlist-review/route.ts')

    expect(playlistContract).toContain('canvasPlaylistItemFrameRange')
    expect(playlistContract).toContain('trimStartMs = canvasPlaylistFrameToMs(frameRange.from)')
    expect(reviewRoute).toContain('reviewSubmission: submission.snapshot')
    expect(reviewRoute).toContain("status: 'pending_review'")
  })

  it('requires the current immutable MP4 render before final review', () => {
    const canvasEditor = source('src/features/canvas/nodes/PlaylistNode.tsx')
    const graph = source('src/features/canvas/CanvasGraph.tsx')
    const reviewRoute = source('src/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/playlist-review/route.ts')

    expect(canvasEditor).toContain("render.status === 'completed'")
    expect(canvasEditor).toContain('editor.startPlaylistRender(id)')
    expect(canvasEditor).toContain('setRender(DEFAULT_RENDER)')
    expect(graph).toContain('await flushAutosave()')
    expect(reviewRoute).toContain('episodeOutputUrl: render.outputUrl')
    expect(reviewRoute).toContain('renderFingerprint: render.fingerprint')
    expect(reviewRoute).toContain('serializeCanvasPlaylistRenderTask(task, fingerprint)')
  })
})
