import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveProjectListViewState } from '@/components/frameos/project-list-state'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('project list reliability', () => {
  it('never turns a failed zero-result request into the successful empty state', () => {
    expect(resolveProjectListViewState({
      loading: false,
      error: '数据库暂不可用',
      projectCount: 0,
    })).toBe('error')
  })

  it('uses the empty state only after a successful empty response', () => {
    expect(resolveProjectListViewState({
      loading: false,
      error: null,
      projectCount: 0,
    })).toBe('empty')
    expect(resolveProjectListViewState({
      loading: false,
      error: null,
      projectCount: 1,
    })).toBe('populated')
  })

  it('keeps timeout, retry, empty CTA, and per-project canvas entry wired in the surface', () => {
    const source = readSource('src/components/frameos/FosProjectsClient.tsx')
    const panelSource = readSource('src/components/frameos/works/FosWorkPanels.tsx')

    expect(source).toContain('new AbortController()')
    expect(source).toContain('signal: controller.signal')
    expect(source).toContain('data-testid="project-list-error"')
    expect(source).toContain('data-testid="project-list-retry"')
    expect(source).toContain('data-testid="project-list-empty-create"')
    expect(panelSource).toContain('data-testid="project-card-canvas-entry"')
    expect(panelSource).toContain('/workbench-premium2/canvas')
    expect(source).not.toContain('setWorks([])')
  })
})
