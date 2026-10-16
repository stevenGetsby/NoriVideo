import { describe, expect, it } from 'vitest'
import { normalizeMoveWorkInput } from '@/lib/works/move-input'

describe('new and legacy work move request fields', () => {
  it('accepts either protocol while returning one unambiguous move', () => {
    expect(normalizeMoveWorkInput({ workIds: ['a'], targetProjectId: 'parent' }))
      .toEqual({ workIds: ['a'], targetProjectId: 'parent' })
    expect(normalizeMoveWorkInput({ projectIds: ['a'], targetWorkId: 'parent' }))
      .toEqual({ workIds: ['a'], targetProjectId: 'parent' })
  })

  it('compares normalized sets, ignoring order, whitespace and duplicates', () => {
    expect(normalizeMoveWorkInput({
      workIds: [' b ', 'a', 'a'], projectIds: ['a', 'b'],
      targetProjectId: ' parent ', targetWorkId: 'parent',
    })).toEqual({ workIds: ['b', 'a'], targetProjectId: 'parent' })
  })

  it.each([
    { workIds: ['a'], projectIds: ['b'] },
    { workIds: ['a', 'b'], projectIds: ['a'] },
    { workIds: [], projectIds: ['a'] },
    { workIds: ['a'], projectIds: [] },
  ])('rejects conflicting source lists instead of choosing one: %j', (fields) => {
    expect(() => normalizeMoveWorkInput({ ...fields, targetProjectId: 'parent' }))
      .toThrow('作品列表不一致')
  })

  it.each([null, 'a', [null], [''], ['  '], [42], ['x'.repeat(192)]])(
    'rejects malformed IDs in either protocol: %j',
    (invalid) => {
      expect(() => normalizeMoveWorkInput({ workIds: invalid, targetProjectId: 'parent' }))
        .toThrow('有效的作品 ID')
      expect(() => normalizeMoveWorkInput({
        workIds: ['a'], projectIds: invalid, targetProjectId: 'parent',
      })).toThrow('有效的作品 ID')
    },
  )

  it('rejects target alias conflicts', () => {
    expect(() => normalizeMoveWorkInput({
      workIds: ['a'], targetProjectId: 'new-parent', targetWorkId: 'old-parent',
    })).toThrow('目标项目不一致')
  })

  it.each([null, '', ' ', 12, 'x'.repeat(192)])('rejects invalid targets: %j', (invalid) => {
    expect(() => normalizeMoveWorkInput({ workIds: ['a'], targetProjectId: invalid }))
      .toThrow('有效的目标项目')
  })

  it('rejects an empty move and does not mutate request arrays', () => {
    expect(() => normalizeMoveWorkInput({ workIds: [], targetProjectId: 'parent' }))
      .toThrow('请选择作品和目标项目')
    const ids = [' b ', 'a', 'a']
    normalizeMoveWorkInput({ workIds: ids, targetProjectId: 'parent' })
    expect(ids).toEqual([' b ', 'a', 'a'])
  })
})
