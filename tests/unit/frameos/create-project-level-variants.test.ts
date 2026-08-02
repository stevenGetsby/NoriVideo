import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  CREATE_PROJECT_LEVEL_VARIANTS,
  durationBounds,
  styleForLevel,
} from '@/components/frameos/works/create-project-variants'
import {
  normalizeProjectCreationConfig,
  workflowModeForContentType,
} from '@/lib/projects/creation-config'

function source(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('Nori1.0 create-project contract', () => {
  it('uses one Nori1.0 variant with collaboration, four styles and both duration modes', () => {
    expect(Object.keys(CREATE_PROJECT_LEVEL_VARIANTS)).toEqual(['Nori1.0'])
    const variant = CREATE_PROJECT_LEVEL_VARIANTS['Nori1.0']

    expect(variant.showCollaboration).toBe(true)
    expect(variant.showProjectType).toBe(false)
    expect(variant.showStyleReferences).toBe(true)
    expect(variant.allowEpisodeRange).toBe(true)
    expect(variant.durationModes).toEqual(['per-episode', 'per-1000-chars'])
    expect(variant.projectStyles).toEqual(['live-action', 'anime-3d', 'anime-2.5d', 'anime-2d'])
    expect(variant.materialTypes).toEqual(['script'])
    expect(durationBounds('Nori1.0', 'per-episode')).toEqual({ minimum: 10, maximum: 3600 })
    expect(styleForLevel('Nori1.0', 'anime')).toBe('anime-2d')
  })

  it('defaults new backend records to Nori1.0 while retaining historical input compatibility', () => {
    expect(normalizeProjectCreationConfig({})).toMatchObject({ projectLevel: 'Nori1.0' })
    expect(normalizeProjectCreationConfig({ projectLevel: 'premium2' })).toMatchObject({ projectLevel: 'premium2' })
    expect(workflowModeForContentType('story')).toBe('srt')
  })

  it('renders one product version and real role assignee controls', () => {
    const dialog = source('src/components/frameos/CreateProjectDialog.tsx')
    const client = source('src/components/frameos/FosProjectsClient.tsx')
    const route = source('src/app/api/projects/route.ts')

    expect(dialog).toContain('<strong>Nori1.0</strong>')
    expect(dialog).not.toContain('精品版 2.0')
    expect(dialog).not.toContain('<strong>精品版</strong>')
    expect(dialog).toContain('data-testid="project-role-assignees"')
    expect(dialog).toContain('writerAssigneeUserId')
    expect(dialog).toContain('assetAssigneeUserId')
    expect(dialog).toContain('storyboardAssigneeUserId')
    expect(client).toContain("form.set('writerAssigneeUserId'")
    expect(client).toContain("form.set('referenceArtStylePrompt'")
    expect(route).toContain('readProjectRoleAssignees(rawBody, collaborationMode)')
    expect(route).toContain('createInitialWorkflowAssignment(tx')
  })
})
