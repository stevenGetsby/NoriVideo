import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('canvas node drag story editor visibility', () => {
  it('hides the story editor while dragging and restores it when dragging stops', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const styles = readSource('src/features/canvas/canvas.css')

    expect(graph).toContain('const [nodeDragging, setNodeDragging] = useState(false)')
    expect(graph).toContain('setNodeDragging(true)')
    expect(graph).toContain('setNodeDragging(false)')
    expect(graph).toContain("${nodeDragging ? ' is-node-dragging' : ''}")
    expect(styles).toContain('.nori-canvas-workspace.is-node-dragging .nori-canvas-generator')
    expect(styles).toContain('visibility: hidden;')
    expect(styles).toContain('pointer-events: none;')
  })

  it('freezes the anchored generator geometry through drag and resize gestures', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const styles = readSource('src/features/canvas/canvas.css')

    expect(graph).toContain('const [generatorAnchorFrozen, setGeneratorAnchorFrozen] = useState(false)')
    expect(graph).toContain('const generatorAnchorFreezeRef = useRef')
    expect(graph).toContain('const freezeGeneratorAnchor = useCallback')
    expect(graph).toContain('const releaseGeneratorAnchor = useCallback')
    expect(graph).toContain('freezeGeneratorAnchor()')
    expect(graph).toContain('releaseGeneratorAnchor()')
    expect(graph).toContain('if (change.resizing) freezeGeneratorAnchor()')
    expect(graph).toContain('const generatorAnchor = frozenGeneratorAnchor ?? liveGeneratorAnchor')
    expect(styles).toContain('.nori-canvas-generator.is-node-anchored')
    expect(styles).toContain('transition: left .14s')
    expect(styles).toContain('transition: max-height .18s')
  })
})
