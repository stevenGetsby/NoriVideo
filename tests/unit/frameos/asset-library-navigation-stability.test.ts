import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return fs.readFileSync(path.join(process.cwd(), relativePath), 'utf8')
}

describe('asset library navigation stability', () => {
  it('opens the canonical route without a redirect-induced white frame', () => {
    const shell = source('src/components/frameos/FosShell.tsx')
    const styles = source('src/styles/frameos-replica.css')
    const globals = source('src/app/globals.css')
    const theme = source('src/styles/theme.css')

    expect(shell).toContain("href: '/workspace/asset-hub'")
    expect(shell).not.toContain("label: '资产库', href: '/asset-hub'")
    expect(styles).not.toContain('@keyframes works-card-in')
    expect(globals).toMatch(/html,\s*body\s*\{[^}]*background-color:\s*rgb\(var\(--nori-page-bg\)\);/)
    expect(theme).toMatch(/:root,[^}]*--nori-page-bg:\s*13 13 13;/)
    expect(theme).toMatch(/html\[data-nori-theme="light"\]\s*\{[^}]*--nori-page-bg:\s*245 246 250;/)
  })
})
