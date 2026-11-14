import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  canCacheProjectSnapshot,
  readFallbackProjectPayload,
} from '@/components/frameos/useFosProject'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('project breadcrumb fallback (D1)', () => {
  it('reads the parent work id and name from the project detail fallback response', () => {
    expect(readFallbackProjectPayload({
      project: {
        id: 'project-1',
        name: '第一章',
        workId: 'work-1',
        canDelete: true,
        work: { id: 'work-1', name: '西游记' },
      },
      work: {
        id: 'project-1',
        name: '第一章',
        workId: 'work-1',
        workName: '西游记',
      },
    })).toEqual({
      projectName: '第一章',
      parentProjectId: 'work-1',
      parentProjectName: '西游记',
      canDelete: true,
    })
  })

  it('reads the production work projection when the response omits the raw project', () => {
    expect(readFallbackProjectPayload({
      work: { id: 'project-1', name: '第一章', workId: 'work-1', workName: '西游记' },
    })).toEqual({
      projectName: '第一章',
      parentProjectId: 'work-1',
      parentProjectName: '西游记',
      canDelete: false,
    })
  })

  it('falls back to the nested work relation when the production projection has no name', () => {
    expect(readFallbackProjectPayload({
      project: {
        id: 'project-1',
        name: '第一章',
        canDelete: false,
        workId: 'work-1',
        work: { id: 'work-1', name: '西游记' },
      },
      work: { id: 'project-1', name: '第一章', workId: 'work-1', workName: null },
    })).toMatchObject({
      parentProjectId: 'work-1',
      parentProjectName: '西游记',
    })
  })

  it('treats unusable fallback payloads as missing instead of inventing a parent', () => {
    expect(readFallbackProjectPayload(null)).toBeNull()
    expect(readFallbackProjectPayload('not-json')).toBeNull()
    expect(readFallbackProjectPayload({})).toBeNull()
  })

  it('only caches snapshots that carry both the parent work id and name', () => {
    expect(canCacheProjectSnapshot({ parentProjectId: null, parentProjectName: null })).toBe(false)
    expect(canCacheProjectSnapshot({ parentProjectId: 'work-1', parentProjectName: null })).toBe(false)
    expect(canCacheProjectSnapshot({ parentProjectId: null, parentProjectName: '西游记' })).toBe(false)
    expect(canCacheProjectSnapshot({ parentProjectId: 'work-1', parentProjectName: '西游记' })).toBe(true)
  })

  it('wires the fallback payload and cache gate into the project hook', () => {
    const hook = source('src/components/frameos/useFosProject.ts')
    expect(hook).toContain('return readFallbackProjectPayload(await res.json().catch(() => null))')
    expect(hook).toContain('const parentProjectId = baseResult.parentProjectId ?? fallbackProject?.parentProjectId ?? null')
    expect(hook).toContain('const parentProjectName = baseResult.parentProjectName ?? fallbackProject?.parentProjectName ?? null')
    expect(hook).toContain('if (cached && !canCacheProjectSnapshot(cached.snapshot))')
    expect(hook).toContain('if (canCacheProjectSnapshot(snapshot))')
  })
})
