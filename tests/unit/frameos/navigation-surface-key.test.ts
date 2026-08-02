import { describe, expect, it } from 'vitest'
import {
  canvasNavigationSurfaceKey,
  workflowNavigationSurfaceKey,
} from '@/lib/frameos/navigation-surface-key'

describe('FrameOS navigation surface identity', () => {
  it('isolates every workflow panel from the canvas and its parent surface', () => {
    const project = 'project/with spaces'
    const overview = workflowNavigationSurfaceKey(project, 'overview')
    const storyboard = workflowNavigationSurfaceKey(project, 'storyboard', 'storyboard')
    const canvas = workflowNavigationSurfaceKey(project, 'canvas', 'canvas')

    expect(new Set([overview, storyboard, canvas]).size).toBe(3)
    expect(overview).toContain('project%2Fwith%20spaces')
  })

  it('isolates the global canvas home and each selected project', () => {
    const home = canvasNavigationSurfaceKey()
    const firstProject = canvasNavigationSurfaceKey('project-a')
    const secondProject = canvasNavigationSurfaceKey('project-b')

    expect(home).toBe('canvas:home')
    expect(new Set([home, firstProject, secondProject]).size).toBe(3)
  })
})
