import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('canvas navigation overlay cleanup', () => {
  it('keys route content while keeping the app shell mounted', () => {
    const workflow = source('src/components/frameos/FosWorkflowClient.tsx')
    const canvasHub = source('src/components/frameos/FosCanvasHubClient.tsx')

    expect(workflow).toContain('<div key={navigationSurfaceKey} className="contents">')
    expect(workflow).not.toContain('<FosShell key={navigationSurfaceKey}')
    expect(workflow).toContain('workflowNavigationSurfaceKey(projectId, view, focus)')
    expect(canvasHub).toContain('<div key={navigationSurfaceKey} className="contents">')
    expect(canvasHub).not.toContain('<FosShell key={navigationSurfaceKey}')
    expect(canvasHub).toContain('canvasNavigationSurfaceKey(selectedProject?.id)')
  })

  it('leaves native fullscreen when the 3D director overlay unmounts', () => {
    const studio = source('src/features/canvas/components/CanvasStudio3D.tsx')

    expect(studio).toContain('const fullscreenTarget = dialogRef.current')
    expect(studio).toContain('document.fullscreenElement === fullscreenTarget')
    expect(studio).toContain('void document.exitFullscreen().catch(() => undefined)')
  })
})
