import { describe, expect, it } from 'vitest'
import {
  assertProjectRoleAssignee,
  projectAssigneeForStage,
  readProjectRoleAssignees,
} from '@/lib/projects/project-role-assignments'

describe('project role assignees', () => {
  it('parses one subaccount per production role and maps storyboard to video', () => {
    const assignees = readProjectRoleAssignees({
      writerAssigneeUserId: ' writer-1 ',
      assetAssigneeUserId: 'asset-1',
      storyboardAssigneeUserId: 'storyboard-1',
    }, 'team')

    expect(assignees).toEqual({
      writer: 'writer-1',
      asset: 'asset-1',
      storyboard: 'storyboard-1',
    })
    expect(projectAssigneeForStage(assignees, 'script')).toBe('writer-1')
    expect(projectAssigneeForStage(assignees, 'video')).toBe('storyboard-1')
  })

  it('requires at least one assignee in team mode but ignores role fields in solo mode', () => {
    expect(() => readProjectRoleAssignees({}, 'team')).toThrow(/至少需要选择一名/)
    expect(readProjectRoleAssignees({ writerAssigneeUserId: 'writer-1' }, 'solo'))
      .toEqual({ writer: null, asset: null, storyboard: null })
  })

  it('rejects unavailable accounts or accounts missing the required functional area', () => {
    const assignees = readProjectRoleAssignees({ writerAssigneeUserId: 'writer-1' }, 'team')
    expect(() => assertProjectRoleAssignee(assignees, null, 'writer')).toThrow(/不存在、已停用/)
    expect(() => assertProjectRoleAssignee(assignees, {
      id: 'writer-1', role: 'asset', status: 'active',
    }, 'writer')).toThrow(/未开启剧本功能区权限/)
    expect(() => assertProjectRoleAssignee(assignees, {
      id: 'writer-1', role: 'asset', permissions: ['read', 'scriptWrite'], status: 'active',
    }, 'writer')).not.toThrow()
  })

  it('allows one cross-functional account to own more than one project stage', () => {
    expect(readProjectRoleAssignees({
      writerAssigneeUserId: 'multi-1',
      assetAssigneeUserId: 'multi-1',
      storyboardAssigneeUserId: 'multi-1',
    }, 'team')).toEqual({
      writer: 'multi-1',
      asset: 'multi-1',
      storyboard: 'multi-1',
    })
  })
})
