import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function handlerSource(relativePath: string, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE') {
  const source = fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
  const marker = `export const ${method} =`
  const start = source.indexOf(marker)
  expect(start, `${relativePath} must export ${method}`).toBeGreaterThanOrEqual(0)
  const next = source.indexOf('\nexport const ', start + marker.length)
  return source.slice(start, next < 0 ? source.length : next)
}

const CANVAS_WRITE_ROUTES = [
  ['src/app/api/projects/[projectId]/canvas/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/templates/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/templates/[templateId]/route.ts', 'PATCH'],
  ['src/app/api/projects/[projectId]/canvas/templates/[templateId]/route.ts', 'DELETE'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/route.ts', 'PATCH'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/route.ts', 'DELETE'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/document/route.ts', 'PUT'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/revisions/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/generate/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/generate-text/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/generate-storyboard/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/materials/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/operations/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/operations/tasks/[taskId]/route.ts', 'DELETE'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/operations/tasks/[taskId]/retry/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/ops/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/generation-tasks/[taskId]/route.ts', 'DELETE'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/generation-tasks/[taskId]/retry/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/production-sync/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/nodes/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/nodes/route.ts', 'PATCH'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/nodes/[nodeId]/route.ts', 'DELETE'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/edges/route.ts', 'POST'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/edges/[edgeId]/route.ts', 'DELETE'],
] as const

const CANVAS_READ_ROUTES = [
  ['src/app/api/projects/[projectId]/canvas/route.ts', 'GET'],
  ['src/app/api/projects/[projectId]/canvas/templates/route.ts', 'GET'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/route.ts', 'GET'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/revisions/route.ts', 'GET'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/operations/route.ts', 'GET'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/operations/tasks/[taskId]/route.ts', 'GET'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/generation-tasks/route.ts', 'GET'],
  ['src/app/api/projects/[projectId]/canvas/[canvasId]/generation-tasks/[taskId]/route.ts', 'GET'],
] as const

describe('infinite canvas API role boundary', () => {
  it('requires the dedicated infinite-canvas permission on every canvas mutation', () => {
    for (const [route, method] of CANVAS_WRITE_ROUTES) {
      expect(handlerSource(route, method), `${method} ${route}`).toContain(
        "requireProjectAuthLight(projectId, ['canvasWrite'])",
      )
    }
  })

  it('keeps canvas discovery and inspection readable by every project member', () => {
    for (const [route, method] of CANVAS_READ_ROUTES) {
      const handler = handlerSource(route, method)
      expect(handler, `${method} ${route}`).toContain('requireProjectAuthLight(projectId)')
      expect(handler, `${method} ${route}`).not.toContain("['canvasWrite']")
    }
  })
})
