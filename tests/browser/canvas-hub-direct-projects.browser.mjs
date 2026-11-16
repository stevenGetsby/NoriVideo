import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { build } from 'esbuild'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/canvas-hub-direct-projects')
await mkdir(artifacts, { recursive: true })
const bundle = await build({
  entryPoints: ['tests/browser/canvas-hub-direct-projects.fixture.tsx'],
  bundle: true,
  write: false,
  outdir: '/fixture.js',
  outExtension: { '.js': '.js', '.css': '.raw.css' },
  jsx: 'automatic',
  platform: 'browser',
  external: ['tailwindcss'],
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'),
    'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx'),
  },
  define: { 'process.env.NODE_ENV': '"development"' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const rawCss = bundle.outputFiles.find((file) => file.path.endsWith('.raw.css'))?.contents
assert.ok(script && rawCss, 'fixture bundle must contain JavaScript and CSS')
const globalCss = await readFile(path.join(root, 'src/app/globals.css'), 'utf8')
const css = Buffer.from((await postcss([tailwindcss()]).process(`${globalCss}\n${Buffer.from(rawCss).toString()}`, {
  from: path.join(root, 'src/app/globals.css'),
  map: false,
})).css)
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(script)
    return
  }
  if (request.url === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css')
    response.end(css)
    return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})

async function measure(page) {
  return page.evaluate(() => {
    const buttons = [...document.querySelectorAll('.nori-canvas-hub-direct-projects > div > button')]
    return buttons.map((button) => {
      const cover = button.querySelector('.work-cover')
      const titleBlock = button.querySelector(':scope > span:not(.work-cover)')
      const strong = titleBlock.querySelector('strong')
      const small = titleBlock.querySelector('small')
      const svg = button.querySelector(':scope > svg')
      const b = button.getBoundingClientRect()
      const c = cover.getBoundingClientRect()
      const t = titleBlock.getBoundingClientRect()
      const s = strong.getBoundingClientRect()
      const v = svg.getBoundingClientRect()
      const hit = document.elementFromPoint(s.left + 4, s.top + s.height / 2)
      return {
        name: strong.textContent.slice(0, 12),
        gap: t.left - c.right,
        titleHitBySelf: hit === strong || strong.contains(hit),
        coverInside: c.left >= b.left && c.top >= b.top && c.bottom <= b.bottom,
        ellipsis: strong.scrollWidth > strong.clientWidth,
        smallEllipsis: small.scrollWidth > small.clientWidth,
        arrowClear: v.left >= t.right,
        height: b.height,
      }
    })
  })
}

try {
  for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
    const page = await browser.newPage({ viewport })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.locator('[data-testid="global-canvas-direct-project-entry"]').first().waitFor()
    await page.waitForTimeout(300)
    const rows = await measure(page)
    assert.equal(rows.length, 4)
    for (const row of rows) {
      assert.ok(row.gap >= 8, `cover/title gap ${row.gap} for ${row.name}`)
      assert.ok(row.titleHitBySelf, `title start covered for ${row.name}`)
      assert.ok(row.coverInside, `cover outside button for ${row.name}`)
      assert.ok(row.arrowClear, `arrow overlaps text for ${row.name}`)
    }
    const longRows = rows.filter((row) => row.name.startsWith('超长标题') || row.name.startsWith('Supercal'))
    for (const row of longRows) assert.ok(row.ellipsis, `long title must ellipsize: ${row.name}`)
    const heights = rows.map((row) => row.height)
    assert.ok(Math.max(...heights) - Math.min(...heights) <= 1, `button heights differ: ${heights}`)
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)
    assert.ok(overflow <= 0, `horizontal overflow ${overflow}`)
    assert.deepEqual(errors, [])
    await page.screenshot({ path: path.join(artifacts, `hub-${viewport.width}.png`) })
    console.log(JSON.stringify({ ok: true, viewport: viewport.width, rows }))
    await page.close()
  }
  console.log(JSON.stringify({ ok: true, artifacts }))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
