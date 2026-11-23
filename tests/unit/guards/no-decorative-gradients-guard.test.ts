import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { inspectDecorativeGradients } from '../../../scripts/guards/no-decorative-gradients-guard.mjs'

describe('decorative gradient guard', () => {
  it('ignores local Finder copies but still rejects gradients in source files', () => {
    const root = mkdtempSync(join(tmpdir(), 'nori-gradient-guard-'))
    const script = fileURLToPath(new URL('../../../scripts/guards/no-decorative-gradients-guard.mjs', import.meta.url))
    const style = '.card { background: linear-gradient(white, black); }'
    const run = () => spawnSync(process.execPath, [script], { cwd: root, encoding: 'utf8' })
    try {
      mkdirSync(join(root, 'src'))
      writeFileSync(join(root, 'src', 'cards 2.css'), style)
      expect(run().status).toBe(0)
      writeFileSync(join(root, 'src', 'cards.css'), style)
      const failed = run()
      expect(failed.status).toBe(1)
      expect(failed.stderr).toContain('src/cards.css:1')
      expect(failed.stderr).not.toContain('cards 2.css')
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it('keeps owned UI source free of CSS, SVG and Tailwind gradient decoration', () => {
    const { violations } = inspectDecorativeGradients()
    expect(violations).toEqual([])
  })
})
