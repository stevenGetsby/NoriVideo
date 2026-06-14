import { describe, expect, it } from 'vitest'
import {
  normalizeExportArtifactQuery,
  resolveExportArtifactDownloadUrl,
} from '@/lib/novel-promotion/export-artifact'

describe('export artifact helpers', () => {
  it('normalizes queue artifact query by default', () => {
    const query = normalizeExportArtifactQuery(new URLSearchParams({
      episodeId: ' episode-1 ',
      cardId: ' final-video ',
    }))

    expect(query).toEqual({
      source: 'queue',
      id: null,
      cardId: 'final-video',
      taskId: null,
      episodeId: 'episode-1',
    })
  })

  it('supports history artifact lookup by id or task id', () => {
    const query = normalizeExportArtifactQuery(new URLSearchParams({
      source: 'history',
      id: 'history-1',
      taskId: 'task-1',
    }))

    expect(query).toMatchObject({
      source: 'history',
      id: 'history-1',
      taskId: 'task-1',
      episodeId: null,
    })
  })

  it('falls back to persisted output url when no storage key is available', () => {
    expect(resolveExportArtifactDownloadUrl({
      outputStorageKey: null,
      outputUrl: 'https://cdn.test/export.zip',
    })).toBe('https://cdn.test/export.zip')
  })
})
