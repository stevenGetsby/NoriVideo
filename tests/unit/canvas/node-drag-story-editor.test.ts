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

  it('anchors the generator inside the viewport transform so gestures never need frozen geometry', () => {
    const graph = readSource('src/features/canvas/CanvasGraph.tsx')
    const generator = readSource('src/features/canvas/components/CanvasGenerator.tsx')
    const styles = readSource('src/features/canvas/canvas.css')

    expect(graph).not.toContain('generatorAnchorFrozen')
    expect(graph).not.toContain('freezeGeneratorAnchor')
    expect(generator).toContain('<ViewportPortal>')
    expect(generator).toContain('flowStore.subscribe(apply)')
    expect(generator).toContain('state.nodeLookup.get(node.id)')
    expect(generator).toContain("--nori-generator-inverse-zoom")
    expect(styles).toContain('.nori-canvas-generator-anchor')
    expect(styles).toContain('scale(var(--nori-generator-inverse-zoom, 1))')
    expect(styles).toContain('.nori-canvas-generator.is-node-anchored')
    expect(styles).not.toContain('transition: left .14s')
  })
})
