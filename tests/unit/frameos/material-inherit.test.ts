import { describe, expect, it } from 'vitest'
import { ApiError } from '@/lib/api-errors'
import { materialSourceLabel } from '@/components/frameos/materials/contracts'
import { readInheritAssetsRequest } from '@/lib/frameos/material-inherit-service'
import {
  INHERITED_FROM_KEY,
  MATERIAL_ORIGIN_LABELS,
  MAX_INHERITED_MATERIALS,
  collapseInheritedDuplicates,
  inheritedMaterialMetadata,
  inheritedMaterialSource,
  isInheritedMaterial,
  isUserManagedMaterial,
  materialOrigin,
} from '@/lib/frameos/material-inherit'

const source = { projectId: 'project-a', projectName: '第一集', materialId: 'material-a' }

function marker(overrides: Record<string, unknown> = {}) {
  return { [INHERITED_FROM_KEY]: { ...source, ...overrides } }
}

describe('inherited material marker', () => {
  it.each([null, undefined, 'text', 12, [], {}, { inheritedFrom: 'x' }, { inheritedFrom: [] }])(
    'reads no source from %j', (metadata) => {
      expect(inheritedMaterialSource(metadata)).toBeNull()
      expect(isInheritedMaterial({ metadata })).toBe(false)
    })

  it.each([
    { projectId: '', materialId: 'm' },
    { projectId: '  ', materialId: 'm' },
    { projectId: 'p', materialId: '' },
    { projectId: 'p' },
    { materialId: 'm' },
    { projectId: 4, materialId: 'm' },
  ])('ignores an incomplete marker %j', (marked) => {
    expect(inheritedMaterialSource({ [INHERITED_FROM_KEY]: marked })).toBeNull()
  })

  it('trims the ids and falls back to a generic project name', () => {
    expect(inheritedMaterialSource(marker({ projectId: ' p ', materialId: ' m ', projectName: '  ' }))).toEqual({
      projectId: 'p', materialId: 'm', projectName: '其他作品',
    })
    expect(inheritedMaterialSource(marker())).toEqual(source)
  })
})

describe('material origin', () => {
  it('tells generated results, uploads and inherited copies apart', () => {
    expect(materialOrigin({ source: 'creative', metadata: {} })).toBe('generated')
    expect(materialOrigin({ source: 'toolbox' })).toBe('generated')
    expect(materialOrigin({ source: 'production', metadata: null })).toBe('generated')
    expect(materialOrigin({ source: 'upload', metadata: {} })).toBe('uploaded')
    expect(materialOrigin({ source: 'creative', metadata: marker() })).toBe('inherited')
    expect(materialOrigin({ source: 'upload', metadata: marker() })).toBe('inherited')
  })

  it('labels every origin in Chinese', () => {
    expect(MATERIAL_ORIGIN_LABELS).toEqual({ generated: '生成', uploaded: '上传', inherited: '继承' })
  })

  it('lets people manage uploads and inherited copies but not generated results', () => {
    expect(isUserManagedMaterial({ source: 'upload' })).toBe(true)
    expect(isUserManagedMaterial({ source: 'creative', metadata: marker() })).toBe(true)
    expect(isUserManagedMaterial({ source: 'production', metadata: marker() })).toBe(true)
    expect(isUserManagedMaterial({ source: 'creative', metadata: {} })).toBe(false)
    expect(isUserManagedMaterial({ source: 'toolbox' })).toBe(false)
  })
})

describe('inherited copy metadata', () => {
  const sourceMetadata = {
    prompt: '红脸长髯',
    originalName: '关羽.png',
    width: 640,
    height: 360,
    taskId: 'task-1',
    retryOf: 'task-0',
    originId: 'origin-1',
    targetType: 'character',
    targetId: 'target-1',
    canvasId: 'canvas-1',
    canvasNodeId: 'node-1',
    sourceNodeId: 'node-0',
    characterId: 'char-1',
    characterName: '关羽',
    voiceMaterialId: 'voice-1',
    seedancePrivateAsset: { assetId: 'asset-private', groupId: 'group-1' },
    supersededByMaterialId: 'next-1',
    replacesMaterialId: 'old-1',
    inheritedFrom: { projectId: 'project-z', projectName: '更早的作品', materialId: 'material-z' },
  }

  it('drops every key that ties the source row to its own task, canvas, character or retirement', () => {
    const next = inheritedMaterialMetadata(sourceMetadata, source, null)
    for (const key of [
      'taskId', 'retryOf', 'originId', 'targetType', 'targetId', 'canvasId', 'canvasNodeId', 'sourceNodeId',
      'characterId', 'characterName', 'voiceMaterialId', 'seedancePrivateAsset', 'supersededByMaterialId', 'replacesMaterialId',
    ]) {
      expect(next, key).not.toHaveProperty(key)
    }
  })

  it('never hands another project\'s private provider asset to the copy', () => {
    expect(JSON.stringify(inheritedMaterialMetadata(sourceMetadata, source, 'voice-copy'))).not.toContain('asset-private')
  })

  it('keeps the descriptive facts and points the marker at the immediate source, not the older ancestor', () => {
    const next = inheritedMaterialMetadata(sourceMetadata, source, null)
    expect(next).toMatchObject({ prompt: '红脸长髯', originalName: '关羽.png', width: 640, height: 360 })
    expect(next[INHERITED_FROM_KEY]).toEqual(source)
  })

  it('binds only the voice it is given', () => {
    expect(inheritedMaterialMetadata(sourceMetadata, source, null)).not.toHaveProperty('voiceMaterialId')
    expect(inheritedMaterialMetadata(sourceMetadata, source, 'voice-copy')).toMatchObject({ voiceMaterialId: 'voice-copy' })
  })

  it('pins the category even when the source only implied it through its origin type', () => {
    expect(inheritedMaterialMetadata({ originType: 'character_portrait' }, source, null).assetCategory).toBe('character')
    expect(inheritedMaterialMetadata({ originType: 'location_wide' }, source, null).assetCategory).toBe('location')
    expect(inheritedMaterialMetadata({ assetCategory: 'prop' }, source, null).assetCategory).toBe('prop')
    expect(inheritedMaterialMetadata(null, source, null).assetCategory).toBe('other')
  })

  it('does not mutate the source metadata', () => {
    const snapshot = JSON.parse(JSON.stringify(sourceMetadata))
    inheritedMaterialMetadata(sourceMetadata, source, 'voice-copy')
    expect(sourceMetadata).toEqual(snapshot)
  })

  it.each([null, undefined, 'text', []])('starts from nothing when the source metadata is %j', (metadata) => {
    expect(inheritedMaterialMetadata(metadata, source, null)).toEqual({
      assetCategory: 'other',
      [INHERITED_FROM_KEY]: source,
    })
  })

  it('produces a copy that reads back as inherited', () => {
    const next = inheritedMaterialMetadata({ prompt: 'p' }, source, null)
    expect(isInheritedMaterial({ metadata: next })).toBe(true)
    expect(inheritedMaterialSource(next)).toEqual(source)
  })
})

describe('collapseInheritedDuplicates', () => {
  interface Row { id: string; projectId: string; createdAt: string; metadata?: unknown }
  const original = (id: string, projectId: string, createdAt = '2026-11-01T00:00:00.000Z'): Row => ({ id, projectId, createdAt })
  const copyOf = (id: string, projectId: string, from: Row, createdAt = '2026-11-05T00:00:00.000Z'): Row => ({
    id,
    projectId,
    createdAt,
    metadata: { [INHERITED_FROM_KEY]: { projectId: from.projectId, projectName: from.projectId, materialId: from.id } },
  })
  const ids = (rows: Row[]) => rows.map((row) => row.id)

  it('returns rows without any inheritance untouched and in order', () => {
    const rows = [original('a', 'p1'), original('b', 'p2'), original('c', 'p1')]
    expect(ids(collapseInheritedDuplicates(rows, 'p1'))).toEqual(['a', 'b', 'c'])
    expect(collapseInheritedDuplicates([], 'p1')).toEqual([])
  })

  it('shows the copy of the current 作品 instead of the original it came from', () => {
    const a = original('a', 'p1')
    const rows = [a, copyOf('a-copy', 'p2', a), original('other', 'p2')]
    expect(ids(collapseInheritedDuplicates(rows, 'p2'))).toEqual(['a-copy', 'other'])
  })

  it('falls back to the original when the current 作品 holds none of the lineage', () => {
    const a = original('a', 'p1')
    const rows = [a, copyOf('a-copy', 'p2', a)]
    expect(ids(collapseInheritedDuplicates(rows, 'p3'))).toEqual(['a'])
    expect(ids(collapseInheritedDuplicates(rows, ''))).toEqual(['a'])
  })

  it('follows a chain of copies back to the same original', () => {
    const a = original('a', 'p1')
    const b = copyOf('b', 'p2', a)
    const c = copyOf('c', 'p3', b)
    const rows = [a, b, c]
    expect(ids(collapseInheritedDuplicates(rows, 'p3'))).toEqual(['c'])
    expect(ids(collapseInheritedDuplicates(rows, 'p2'))).toEqual(['b'])
    expect(ids(collapseInheritedDuplicates(rows, 'p1'))).toEqual(['a'])
    expect(ids(collapseInheritedDuplicates(rows, 'p9'))).toEqual(['a'])
  })

  it('keeps the newest row when the current 作品 holds several of one lineage', () => {
    const a = original('a', 'p1')
    const rows = [
      copyOf('old', 'p2', a, '2026-11-02T00:00:00.000Z'),
      copyOf('new', 'p2', a, '2026-11-09T00:00:00.000Z'),
      copyOf('mid', 'p2', a, '2026-11-05T00:00:00.000Z'),
      a,
    ]
    expect(ids(collapseInheritedDuplicates(rows, 'p2'))).toEqual(['new'])
  })

  it('collapses sibling copies in other 作品 into the original', () => {
    const a = original('a', 'p1')
    const rows = [a, copyOf('c2', 'p2', a), copyOf('c3', 'p3', a)]
    expect(ids(collapseInheritedDuplicates(rows, 'p9'))).toEqual(['a'])
  })

  it('keeps independent lineages side by side and preserves the input order', () => {
    const a = original('a', 'p1')
    const x = original('x', 'p1')
    const rows = [copyOf('x-copy', 'p2', x), a, x, copyOf('a-copy', 'p2', a)]
    expect(ids(collapseInheritedDuplicates(rows, 'p2'))).toEqual(['x-copy', 'a-copy'])
  })

  it('treats a copy whose source is not in the list as its own lineage root', () => {
    const missing = original('gone', 'p1')
    const rows = [copyOf('orphan', 'p2', missing), original('plain', 'p2')]
    expect(ids(collapseInheritedDuplicates(rows, 'p2'))).toEqual(['orphan', 'plain'])
    expect(ids(collapseInheritedDuplicates(rows, 'p5'))).toEqual(['orphan', 'plain'])
  })

  it('lets rows the user already picked stay and win over the automatic choice', () => {
    const a = original('a', 'p1')
    const rows = [a, copyOf('a-copy', 'p2', a)]
    expect(ids(collapseInheritedDuplicates(rows, 'p2', new Set(['a'])))).toEqual(['a'])
    expect(ids(collapseInheritedDuplicates(rows, 'p2', new Set(['a-copy'])))).toEqual(['a-copy'])
    expect(ids(collapseInheritedDuplicates(rows, 'p2', new Set(['a', 'a-copy'])))).toEqual(['a', 'a-copy'])
    expect(ids(collapseInheritedDuplicates(rows, 'p2', new Set(['unrelated'])))).toEqual(['a-copy'])
  })

  it('ignores a marker that points at the row itself', () => {
    const selfish: Row = { id: 's', projectId: 'p1', createdAt: '2026-11-01T00:00:00.000Z', metadata: { [INHERITED_FROM_KEY]: { projectId: 'p1', projectName: 'x', materialId: 's' } } }
    expect(ids(collapseInheritedDuplicates([selfish], 'p1'))).toEqual(['s'])
  })

  it('terminates on markers that point at each other and never drops a whole lineage', () => {
    const a: Row = { id: 'a', projectId: 'p1', createdAt: '2026-11-01T00:00:00.000Z', metadata: { [INHERITED_FROM_KEY]: { projectId: 'p2', projectName: 'x', materialId: 'b' } } }
    const b: Row = { id: 'b', projectId: 'p2', createdAt: '2026-11-02T00:00:00.000Z', metadata: { [INHERITED_FROM_KEY]: { projectId: 'p1', projectName: 'x', materialId: 'a' } } }
    for (const current of ['p1', 'p2', 'p3', '']) {
      const kept = collapseInheritedDuplicates([a, b], current)
      expect(kept.length).toBeGreaterThanOrEqual(1)
      expect(kept.every((row) => row === a || row === b)).toBe(true)
    }
  })

  it('treats an unreadable timestamp as the oldest, whichever order the rows arrive in', () => {
    const a = original('a', 'p1')
    const bad = copyOf('bad', 'p2', a, 'not a date')
    const good = copyOf('good', 'p2', a, '2026-11-01T00:00:00.000Z')
    expect(ids(collapseInheritedDuplicates([a, bad, good], 'p2'))).toEqual(['good'])
    expect(ids(collapseInheritedDuplicates([a, good, bad], 'p2'))).toEqual(['good'])
  })

  it('does not mutate its input', () => {
    const a = original('a', 'p1')
    const rows = [a, copyOf('a-copy', 'p2', a)]
    const snapshot = [...rows]
    collapseInheritedDuplicates(rows, 'p2')
    expect(rows).toEqual(snapshot)
  })
})

describe('materialSourceLabel', () => {
  it('names the 作品 an inherited copy came from', () => {
    expect(materialSourceLabel({ source: 'creative', metadata: marker({ projectName: '第三集' }) })).toBe('继承自「第三集」')
    expect(materialSourceLabel({ source: 'upload', metadata: marker({ projectName: '' }) })).toBe('继承自「其他作品」')
  })

  it('keeps the plain source label for everything else', () => {
    expect(materialSourceLabel({ source: 'upload', metadata: null })).toBe('本地上传')
    expect(materialSourceLabel({ source: 'creative', metadata: {} })).toBe('资产生成')
    expect(materialSourceLabel({ source: 'toolbox' })).toBe('工具箱')
    expect(materialSourceLabel({ source: 'production', metadata: undefined })).toBe('作品制作')
  })
})

describe('readInheritAssetsRequest', () => {
  function failure(body: Record<string, unknown>): ApiError {
    try {
      readInheritAssetsRequest(body)
    } catch (error) {
      expect(error).toBeInstanceOf(ApiError)
      return error as ApiError
    }
    throw new Error('expected readInheritAssetsRequest to throw')
  }

  it('asks for nothing when no inherit field is present', () => {
    expect(readInheritAssetsRequest({})).toBeNull()
    expect(readInheritAssetsRequest({ name: 'x', inheritSourceProjectId: '  ', inheritMaterialIds: '' })).toBeNull()
    expect(readInheritAssetsRequest({ inheritSourceProjectId: '', inheritMaterialIds: null })).toBeNull()
  })

  it('reads a JSON array or the stringified array a multipart body carries', () => {
    expect(readInheritAssetsRequest({ inheritSourceProjectId: ' p ', inheritMaterialIds: ['a', 'b'] })).toEqual({ sourceProjectId: 'p', materialIds: ['a', 'b'] })
    expect(readInheritAssetsRequest({ inheritSourceProjectId: 'p', inheritMaterialIds: '["a","b"]' })).toEqual({ sourceProjectId: 'p', materialIds: ['a', 'b'] })
  })

  it('trims and de-duplicates the ids while keeping their order', () => {
    expect(readInheritAssetsRequest({ inheritSourceProjectId: 'p', inheritMaterialIds: [' b ', 'a', 'b', '', '  ', 'a'] }))
      .toEqual({ sourceProjectId: 'p', materialIds: ['b', 'a'] })
  })

  it('requires a source whenever ids are sent', () => {
    expect(failure({ inheritMaterialIds: ['a'] }).details).toMatchObject({ code: 'INHERIT_SOURCE_REQUIRED' })
    expect(failure({ inheritSourceProjectId: 7, inheritMaterialIds: ['a'] }).details).toMatchObject({ code: 'INHERIT_SOURCE_REQUIRED' })
  })

  it('requires at least one id whenever a source is sent', () => {
    expect(failure({ inheritSourceProjectId: 'p' }).details).toMatchObject({ code: 'INHERIT_MATERIALS_INVALID' })
    expect(failure({ inheritSourceProjectId: 'p', inheritMaterialIds: [] }).details).toMatchObject({ code: 'INHERIT_MATERIALS_REQUIRED' })
    expect(failure({ inheritSourceProjectId: 'p', inheritMaterialIds: ['', ' '] }).details).toMatchObject({ code: 'INHERIT_MATERIALS_REQUIRED' })
    expect(failure({ inheritSourceProjectId: 'p', inheritMaterialIds: '[]' }).details).toMatchObject({ code: 'INHERIT_MATERIALS_REQUIRED' })
  })

  it.each([
    ['not json', '{oops'],
    ['an object', { a: 1 }],
    ['a number', 5],
    ['a boolean', true],
    ['non-string members', ['a', 2]],
    ['null members', ['a', null]],
    ['a json object string', '{"a":1}'],
  ])('rejects an id list that is %s', (_label, ids) => {
    const error = failure({ inheritSourceProjectId: 'p', inheritMaterialIds: ids })
    expect(error.status).toBe(400)
    expect(error.details).toMatchObject({ code: 'INHERIT_MATERIALS_INVALID' })
  })

  it('accepts exactly the cap and rejects one more', () => {
    const ids = (count: number) => Array.from({ length: count }, (_, index) => `m-${index}`)
    expect(readInheritAssetsRequest({ inheritSourceProjectId: 'p', inheritMaterialIds: ids(MAX_INHERITED_MATERIALS) })?.materialIds).toHaveLength(MAX_INHERITED_MATERIALS)
    const error = failure({ inheritSourceProjectId: 'p', inheritMaterialIds: ids(MAX_INHERITED_MATERIALS + 1) })
    expect(error.status).toBe(400)
    expect(error.details).toMatchObject({ code: 'INHERIT_MATERIALS_LIMIT' })
  })

  it('counts distinct ids against the cap, so repeated ids do not trip it', () => {
    const repeated = Array.from({ length: MAX_INHERITED_MATERIALS * 2 }, () => 'same')
    expect(readInheritAssetsRequest({ inheritSourceProjectId: 'p', inheritMaterialIds: repeated })?.materialIds).toEqual(['same'])
  })

  it('refuses an absurdly long list before de-duplicating it', () => {
    const huge = Array.from({ length: MAX_INHERITED_MATERIALS * 5 + 1 }, () => 'same')
    expect(failure({ inheritSourceProjectId: 'p', inheritMaterialIds: huge }).details).toMatchObject({ code: 'INHERIT_MATERIALS_INVALID' })
  })
})
