import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

describe('GitHub release update preference storage boundary', () => {
  it('uses user preference API as source of truth for muted update versions', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/hooks/common/useGithubReleaseUpdate.ts'),
      'utf8',
    )

    expect(source).toContain("apiFetch('/api/user-preference'")
    expect(source).toContain('mutedUpdateVersion')
    expect(source).toContain('readPreferenceMutedUpdateVersion')
    expect(source).toContain('writePreferenceMutedUpdateVersion')
    expect(source).toContain('LEGACY_MUTED_UPDATE_VERSION_KEY')
    expect(source).not.toContain('const MUTED_UPDATE_VERSION_KEY')
    expect(source).not.toContain('readMutedUpdateVersion()')
    expect(source).not.toContain('writeMutedUpdateVersion(')
  })
})
