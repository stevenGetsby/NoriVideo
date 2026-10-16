import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { BRAND_ASSETS } from '@/lib/brand'
import { buildLanmiaoAssets, extractLanmiaoCat } from '../../../scripts/build-lanmiao-brand-assets.mjs'

const root = process.cwd()
const originalPath = path.join(root, 'tests/fixtures/brand/lanmiao-ip-source.png')
const source = (file: string) => readFileSync(path.join(root, file), 'utf8')
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex')

describe('Lanmiao IP cutout and complete brand handoff', () => {
  it('removes the slogan/background while retaining all opaque original pixels and the tail', async () => {
    const original = await readFile(originalPath)
    const before = digest(original)
    const { png, bounds } = await extractLanmiaoCat(original)
    const full = await sharp(original).removeAlpha().raw().toBuffer()
    const { data, info } = await sharp(png).raw().toBuffer({ resolveWithObject: true })
    expect(info.channels).toBe(4)
    expect(bounds.top).toBeGreaterThanOrEqual(62)
    let opaque = 0, transparent = 0, soft = 0
    for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
      const index = (y * info.width + x) * 4
      if (data[index + 3] === 0) transparent++
      else if (data[index + 3] !== 255) soft++
      else {
        opaque++
        const from = ((bounds.top + y) * 272 + bounds.left + x) * 3
        // Assert the original RGB, not a visually similar generated redraw.
        if (data[index] !== full[from] || data[index + 1] !== full[from + 1] || data[index + 2] !== full[from + 2]) {
          throw new Error('Opaque source pixels changed')
        }
      }
    }
    expect(opaque).toBeGreaterThan(30_000)
    expect(transparent).toBeGreaterThan(10_000)
    expect(soft).toBeGreaterThan(100)
    expect(data[3]).toBe(0)
    // Source tail sample, retained even though the original lower crop makes
    // it a separate connected component from the body.
    const tail = ((239 - bounds.top) * info.width + (244 - bounds.left)) * 4
    expect(data[tail + 3]).toBe(255)
    expect(data[tail + 2]).toBeGreaterThan(data[tail])
    expect(digest(await readFile(originalPath))).toBe(before)
  })

  it('produces real alpha PNGs at native/display/icon sizes', async () => {
    for (const [file, width, height] of [
      ['brand/lanmiao-cat.png', 250, 210], ['brand/lanmiao-cat-icon.png', 128, 128],
      ['brand/lanmiao-cat-apple.png', 180, 180], ['logo.png', 256, 256], ['logo-small.png', 64, 64],
    ] as const) {
      const metadata = await sharp(path.join(root, 'public', file)).metadata()
      expect(metadata).toMatchObject({ format: 'png', width, height, hasAlpha: true })
      const { data } = await sharp(path.join(root, 'public', file)).raw().toBuffer({ resolveWithObject: true })
      expect(data[3]).toBe(0)
    }
  })

  it('generates standalone SVG and multi-resolution ICO favicons', async () => {
    const icon = await readFile(path.join(root, 'public/brand/lanmiao-cat-icon.png'))
    const svg = source('public/icon.svg')
    const encoded = svg.match(/href="data:image\/png;base64,([^"]+)"/)?.[1]
    expect(Boolean(encoded)).toBe(true)
    expect(digest(Buffer.from(encoded!, 'base64'))).toBe(digest(icon))
    expect(svg).not.toMatch(/href="https?:\/\//)
    const ico = await readFile(path.join(root, 'public/favicon.ico'))
    expect(ico.readUInt16LE(2)).toBe(1)
    expect(ico.readUInt16LE(4)).toBe(4)
    for (let index = 0; index < 4; index++) {
      const entry = 6 + 16 * index
      const width = ico[entry]
      const length = ico.readUInt32LE(entry + 8), offset = ico.readUInt32LE(entry + 12)
      expect(await sharp(ico.subarray(offset, offset + length)).metadata()).toMatchObject({ width, height: width, hasAlpha: true })
    }
  })

  it('retains old image URLs as new-IP aliases', async () => {
    for (const [current, old] of [
      ['logo.png', 'logo 2.png'], ['logo-small.png', 'logo-small 2.png'],
      ['icon.png', 'icon 2.png'], ['logo.ico', 'logo 2.ico'], ['logo.ico', 'favicon.ico'],
      ['logo-small.png', 'nori-view/nori-onion-logo.png'],
    ]) {
      expect(digest(await readFile(path.join(root, 'public', old)))).toBe(digest(await readFile(path.join(root, 'public', current))))
    }
  })

  it('backs up replaced assets once and preserves the original supplied source', async () => {
    const temp = await mkdtemp(path.join(os.tmpdir(), 'nori-brand-test-'))
    try {
      await mkdir(path.join(temp, 'public'), { recursive: true })
      await writeFile(path.join(temp, 'public/logo.png'), 'original-logo-test-only')
      await buildLanmiaoAssets(originalPath, temp)
      const backup = path.join(temp, '.runtime/lanmiao-brand/previous/logo.png')
      expect((await readFile(backup)).toString()).toBe('original-logo-test-only')
      await buildLanmiaoAssets(originalPath, temp)
      expect((await readFile(backup)).toString()).toBe('original-logo-test-only')
      expect(digest(await readFile(path.join(temp, '.runtime/lanmiao-brand/ip-source.png')))).toBe(digest(await readFile(originalPath)))
    } finally {
      await rm(temp, { recursive: true, force: true })
    }
  })

  it('shares one mark across public/workspace/admin/legacy/Agent entry points', () => {
    for (const file of [
      'src/components/frameos/FosAuthShell.tsx', 'src/components/frameos/FosShell.tsx',
      'src/components/admin/PlatformAdminShell.tsx', 'src/components/Navbar.tsx',
      'src/components/workspace/FrameWorkbenchShell.tsx', 'src/components/super-agent/SuperInputBox.tsx',
    ]) {
      const code = source(file)
      expect(code).toContain('<NoriBrandMark')
      expect(code).not.toContain('<i /><i /><i />')
      expect(code).not.toContain('src="/nori-view/nori-onion-logo.png"')
      expect(code).not.toMatch(/^\s*N\s*$/m)
    }
    expect(source('src/components/brand/NoriBrandMark.tsx')).toContain('BRAND_ASSETS.mark')
    expect(source('src/components/brand/NoriBrandMark.tsx')).toContain("objectFit: 'contain'")
    expect(source('src/styles/frameos-replica.css')).not.toContain('.fos-logo-mark i')
    expect(source('src/styles/nori-auth.css')).not.toContain('.nori-auth-brand-symbol')
  })

  it('updates locale metadata and cache-busts the browser and Apple icons', () => {
    const layout = source('src/app/[locale]/layout.tsx')
    expect(layout).toContain('BRAND_ASSETS.icon')
    expect(layout).toContain('BRAND_ASSETS.apple')
    expect(layout).not.toContain('/icon.svg?v=3')
    expect(BRAND_ASSETS.mark).toBe('/brand/lanmiao-cat.png?v=4')
    expect(BRAND_ASSETS.icon).toBe('/brand/lanmiao-cat-icon.png?v=4')
    expect(BRAND_ASSETS.apple).toBe('/brand/lanmiao-cat-apple.png?v=4')
  })
})
