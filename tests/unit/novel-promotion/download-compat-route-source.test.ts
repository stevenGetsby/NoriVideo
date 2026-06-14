import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function readRoute(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('legacy download routes compatibility boundary', () => {
  it('marks sync download routes as compatibility paths with export artifact replacement hints', () => {
    const videosRoute = readRoute('src/app/api/novel-promotion/[projectId]/download-videos/route.ts')
    const imagesRoute = readRoute('src/app/api/novel-promotion/[projectId]/download-images/route.ts')
    const voicesRoute = readRoute('src/app/api/novel-promotion/[projectId]/download-voices/route.ts')

    for (const source of [videosRoute, imagesRoute, voicesRoute]) {
      expect(source).toContain("'X-Nori-Delivery-Mode': 'compat-sync-download'")
      expect(source).toContain('requireProjectAuthLight(projectId)')
      expect(source).toContain('resolveExportScope')
    }

    for (const source of [videosRoute, imagesRoute]) {
      expect(source).toContain("'X-Nori-Replacement-Endpoint': `/api/novel-promotion/${projectId}/export-queue`")
      expect(source).toContain("'X-Nori-Replacement-Artifact': `/api/novel-promotion/${projectId}/export-artifact`")
    }

    expect(voicesRoute).toContain("'X-Nori-Replacement-Endpoint': `/api/novel-promotion/${projectId}/export-queue`")
    expect(voicesRoute).toContain("'X-Nori-Replacement-Artifact': `/api/novel-promotion/${projectId}/export-artifact`")
  })
})
