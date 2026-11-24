import { describe, expect, it } from 'vitest'
import { ownedMaterialScope } from '@/lib/frameos/material-ownership'

describe('ownedMaterialScope', () => {
  it('keeps the project scope when no owner is given', () => {
    expect(ownedMaterialScope({ projectId: 'project-1', personalOwnerId: null })).toEqual({
      projectId: 'project-1',
      personalOwnerId: null,
    })
  })

  it('moves owned outputs to the personal scope of the owner', () => {
    expect(ownedMaterialScope({ projectId: 'project-1', personalOwnerId: ' user-2 ' })).toEqual({
      projectId: 'personal',
      personalOwnerId: 'user-2',
    })
  })

  it('treats a blank owner as no owner', () => {
    expect(ownedMaterialScope({ projectId: 'project-1', personalOwnerId: '   ' })).toEqual({
      projectId: 'project-1',
      personalOwnerId: null,
    })
  })
})
