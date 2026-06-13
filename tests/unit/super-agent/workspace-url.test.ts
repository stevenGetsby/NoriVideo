import { describe, expect, it } from 'vitest'
import {
  buildAgentWorkspaceVideoUrl,
  normalizeAgentWorkspaceVideoUrl,
} from '@/lib/super-agent/workspace-url'

describe('super-agent workspace url', () => {
  it('builds Agent workspace urls that land on the final review stage', () => {
    expect(buildAgentWorkspaceVideoUrl({
      locale: 'zh',
      projectId: 'project-1',
      episodeId: 'episode-1',
    })).toBe('/zh/workspace/project-1?episode=episode-1&stage=videos')
  })

  it('normalizes recovered Agent run urls to the final review stage', () => {
    expect(normalizeAgentWorkspaceVideoUrl(
      '/zh/workspace/project-1?episode=episode-1',
      'episode-1',
    )).toBe('/zh/workspace/project-1?episode=episode-1&stage=videos')

    expect(normalizeAgentWorkspaceVideoUrl(
      '/zh/workspace/project-1?episode=episode-1&stage=config',
      'episode-1',
    )).toBe('/zh/workspace/project-1?episode=episode-1&stage=videos')
  })

  it('adds a missing episode while preserving the final review target', () => {
    expect(normalizeAgentWorkspaceVideoUrl(
      '/zh/workspace/project-1',
      'episode-1',
    )).toBe('/zh/workspace/project-1?episode=episode-1&stage=videos')
  })
})
