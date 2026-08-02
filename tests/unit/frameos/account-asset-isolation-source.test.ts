import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readSource(relativePath: string): string {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('FrameOS account and asset isolation wiring', () => {
  it('requires a real session outside explicit test mode and exposes real sign out', () => {
    const shell = readSource('src/components/frameos/FosShell.tsx')
    const projects = readSource('src/components/frameos/FosProjectsClient.tsx')

    expect(shell).toContain("router.replace({ pathname: '/auth/signin' })")
    expect(shell).toContain('signOut({ callbackUrl:')
    expect(projects).toContain("const TEST_MODE = process.env.NEXT_PUBLIC_NORI_TEST_MODE === 'true'")
    expect(projects).toContain("if (!session && !TEST_MODE) router.replace({ pathname: '/auth/signin' })")
    expect(projects).not.toContain("process.env.NODE_ENV === 'development'")
  })

  it('loads assets from authenticated APIs instead of bundled demo constants', () => {
    const assetLibrary = readSource('src/components/frameos/views/FosAssetLibrary.tsx')

    expect(assetLibrary).toContain("apiFetch('/api/projects?page=1&pageSize=100')")
    expect(assetLibrary).toContain("'/api/assets?scope=global'")
    expect(assetLibrary).toContain('scope=project&projectId=')
    expect(assetLibrary).not.toContain('const ASSETS')
    expect(assetLibrary).not.toContain('$50,000 Deal with the Devil')
  })

  it('loads screenwriter drafts from the actual signed-in account without demo scripts', () => {
    const workbench = readSource('src/components/frameos/views/FosScreenwriter.tsx')
    const models = readSource('src/components/frameos/views/screenwriterModels.ts')
    const scriptsRoute = readSource('src/app/api/video-repaint/scripts/route.ts')

    expect(workbench).toContain("fetch('/api/video-repaint/scripts'")
    expect(scriptsRoute).toContain('session.user.actorId || session.user.id')
    expect(models).not.toContain('INITIAL_WRITER_SCRIPTS')
    expect(`${models}\n${workbench}`).not.toContain('夜色债')
  })
})
