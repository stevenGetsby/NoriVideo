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
const artifacts = path.join(root, 'test-results/story-chapter-map-edges')
await mkdir(artifacts, { recursive: true })
const bundle = await build({
  entryPoints: ['tests/browser/story-chapter-map-edges.fixture.tsx'],
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

// React Flow anchors edges at the handle's EDGE midpoint, not its center
// (@xyflow/system getEdgePosition -> getHandlePosition(..., center=false):
//  Position.Right -> x + width, Position.Left -> x). Distance-to-center is
// structurally width/2 (~6px) even with perfect alignment, so the alignment
// assertion compares against the anchor point; center distances stay reported.
const MEASURE = () => {
  const edge = document.querySelector('.react-flow__edge.nori-ix-link')
  const pathEl = edge.querySelector('.react-flow__edge-path')
  const m = pathEl.getScreenCTM()
  const toScreen = (p) => { const pt = new DOMPoint(p.x, p.y).matrixTransform(m); return { x: pt.x, y: pt.y } }
  const start = toScreen(pathEl.getPointAtLength(0))
  const end = toScreen(pathEl.getPointAtLength(pathEl.getTotalLength()))
  const exit = document.querySelector('.react-flow__handle[data-nodeid="p1"][data-handleid="exit:out"]')
  const entry = document.querySelector('.react-flow__handle[data-nodeid="p2"][data-handleid="entry:in"]')
  const eb = exit.getBoundingClientRect()
  const nb = entry.getBoundingClientRect()
  const center = (r) => ({ x: r.left + r.width / 2, y: r.top + r.height / 2 })
  const exitAnchor = { x: eb.right, y: eb.top + eb.height / 2 }
  const entryAnchor = { x: nb.left, y: nb.top + nb.height / 2 }
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y)
  const onDot = (p, r) => p.x >= r.left - 1 && p.x <= r.right + 1 && p.y >= r.top - 1 && p.y <= r.bottom + 1
  const viewport = document.querySelector('.react-flow__viewport')
  const zoom = Number(/scale\(([^)]+)\)/.exec(viewport.style.transform)?.[1] ?? 1)
  const chapter = document.querySelector('.nori-ix-chapter').getBoundingClientRect()
  return {
    startDist: dist(start, center(eb)), endDist: dist(end, center(nb)),
    startAnchorDist: dist(start, exitAnchor) / zoom, endAnchorDist: dist(end, entryAnchor) / zoom,
    startOnDot: onDot(start, eb), endOnDot: onDot(end, nb),
    startDy: start.y - center(eb).y, endDy: end.y - center(nb).y, zoom, chapterWidth: chapter.width,
  }
}

async function setFlowZoom(page, target) {
  const current = await page.evaluate(() => Number(/scale\(([^)]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1))
  const pane = await page.locator('.react-flow__pane').boundingBox()
  await page.mouse.move(pane.x + pane.width / 2, pane.y + pane.height / 2)
  const deltaY = -Math.log2(target / current) / 0.002
  await page.mouse.wheel(0, deltaY)
  await page.waitForTimeout(400)
  return page.evaluate(() => Number(/scale\(([^)]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1))
}

const results = []
try {
  for (const legacy of [false, true]) {
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
    if (legacy) await context.addInitScript(() => {
      // init scripts can run before <html> exists
      const apply = () => document.documentElement.setAttribute('data-zoom-mode', 'legacy')
      if (document.documentElement) apply()
      else window.addEventListener('DOMContentLoaded', apply, { once: true })
    })
    const page = await context.newPage()
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    await page.locator('.react-flow__edge.nori-ix-link').waitFor()
    await page.waitForTimeout(600)
    for (const target of [null, 0.6, 1.4]) {
      const zoom = target === null ? undefined : await setFlowZoom(page, target)
      const row = await page.evaluate(MEASURE)
      results.push({ mode: legacy ? 'legacy' : 'zoom1.2', flowZoom: Number((zoom ?? row.zoom).toFixed(3)), ...row })
      if (process.env.EDGES_DEBUG) console.log(JSON.stringify(results.at(-1)))
      const label = `mode ${legacy ? 'legacy' : 'zoom1.2'}, flow ${row.zoom}`
      assert.ok(row.endAnchorDist <= 3, `edge end off entry anchor by ${row.endAnchorDist.toFixed(2)} flow px (${label})`)
      assert.ok(row.startAnchorDist <= 3, `edge start off exit anchor by ${row.startAnchorDist.toFixed(2)} flow px (${label})`)
      assert.ok(row.endOnDot && row.startOnDot, `edge endpoints must land on the handle dots (${label})`)
    }
    await setFlowZoom(page, 1)
    await page.screenshot({ path: path.join(artifacts, `${legacy ? 'legacy' : 'zoom12'}.png`) })
    if (!legacy) {
      const width = await page.evaluate(() => {
        const chapter = document.querySelector('.nori-ix-chapter').getBoundingClientRect().width
        const zoom = Number(/scale\(([^)]+)\)/.exec(document.querySelector('.react-flow__viewport').style.transform)?.[1] ?? 1)
        return chapter / zoom
      })
      assert.ok(Math.abs(width - 288 * 1.2) <= 1, `chapter visual width ${width} != 345.6 at flow zoom 1`)
      // drag a fresh wire exit:out2 -> entry:in2 and delete the selected edge
      const from = await page.locator('.react-flow__handle[data-nodeid="p1"][data-handleid="exit:out2"]').boundingBox()
      const to = await page.locator('.react-flow__handle[data-nodeid="p2"][data-handleid="entry:in2"]').boundingBox()
      await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
      await page.mouse.down()
      await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
      const connecting = await page.locator('.react-flow__handle.connectingto').count()
      await page.mouse.up()
      await page.waitForTimeout(300)
      const events = await page.evaluate(() => window.__mapEvents)
      assert.ok(connecting >= 1, 'connectingto highlight missing during drag')
      assert.ok(events.some((event) => event.startsWith('connect:p1:exit:out2->p2:entry:in2')), `connect not registered: ${events}`)
      const mid = await page.evaluate(() => {
        const pathEl = document.querySelector('.react-flow__edge.nori-ix-link .react-flow__edge-path')
        const m = pathEl.getScreenCTM()
        const pt = new DOMPoint(...(() => { const p = pathEl.getPointAtLength(pathEl.getTotalLength() / 2); return [p.x, p.y] })()).matrixTransform(m)
        return { x: pt.x, y: pt.y }
      })
      await page.mouse.click(mid.x, mid.y)
      await page.waitForTimeout(200)
      assert.ok(await page.locator('.react-flow__edge.nori-ix-link.selected').count() >= 1, 'edge click must select the edge (pink highlight)')
      if (process.env.EDGES_DEBUG) {
        console.log('after-click', JSON.stringify(await page.evaluate((m) => ({
          edges: [...document.querySelectorAll('.react-flow__edge')].map((e) => [e.getAttribute('data-testid'), e.classList.contains('selected'), e.getAttribute('aria-selected')]),
          active: `${document.activeElement?.tagName}.${document.activeElement?.className}`,
          hit: document.elementFromPoint(m.x, m.y)?.getAttribute('class'),
        }), mid)))
      }
      await page.keyboard.press('Delete')
      await page.waitForTimeout(300)
      const after = await page.evaluate(() => window.__mapEvents)
      assert.ok(after.some((event) => event.startsWith('delete:')), `delete not registered: ${after}`)
    }
    assert.deepEqual(errors, [])
    await context.close()
  }
  await readFile(path.join(artifacts, 'zoom12.png'))
  console.log(JSON.stringify({ ok: true, results }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
