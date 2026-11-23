// Real CanvasGraph + application CSS on deterministic synthetic canvases
// (tests/browser/canvas-scale-fixtures.mjs). Every API is mocked locally: no
// paid model calls, no production data, no real prompts or media URLs.
//
// Drives real input (middle-button pan, mouse.wheel zoom, toolbar viewport
// buttons, node drag) and asserts that the React Flow transform really changed.
// Reports per phase: p50/p95/max frame time, >50 ms frame ratio, main-thread,
// script, layout and style time, saves (count/bytes/op kinds) and DOM sizes.
//
//   PAN_SCENARIOS      JSON array of scenario names or { name, ...overrides, selected, minimap }
//                      (legacy { nodes, videoRatio, zoom } entries still work)
//   PAN_SCENARIO_SET   quick | reference | limits | controls | p5 | all   (default quick)
//   PAN_RUNS           repeated runs per scenario, each in a fresh browser context (default 1)
//   PAN_CPU            CPU throttle rate, e.g. 4 for Chrome's 4x slowdown (default 1)
//   PAN_GPU=metal      real GPU instead of SwiftShader
//   PAN_DEV=1          development React build so the Profiler reports commit counts
//   PAN_TRACE=1        record a Chrome trace of the pan phase and report per-thread busy time
//   PAN_PROFILE=1      CPU profile of the pan phase
//   PAN_PROFILE_PHASE  CPU profile of the named phase (e.g. drag-multi)
//   PAN_SWITCH=0       skip the 6-way canvas switch / heap check
//   PAN_RECOVERY=1     offline-drag/reload/replay check on a fixture with visible media
//   PAN_HISTORY_RACE=1 switch canvases while a summary-history request is pending
//   PAN_SOAK_SECONDS   continuous pan+zoom soak, heap measured before/after GC (default 0)
//   PAN_OUT            result file name inside test-results/canvas-pan-performance
//   PAN_ASSERT=1       fail on structural assertions (page errors, no real pan/zoom, video before play)
//   PAN_BUDGET=1       additionally fail on the frame budget: p95 <= 25 ms (33.4 ms at CPU >= 4x),
//                      >50 ms frames <= 1% in the pan, wheel-zoom, viewport-controls and drag phases
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { gzipSync } from 'node:zlib'
import { CONTROL_PAIRS, SCALE_SCENARIOS, buildScaleGraph, graphStats, resolveScenario } from './canvas-scale-fixtures.mjs'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const esbuild = await import('esbuild')
const artifacts = path.join(root, 'test-results/canvas-pan-performance')
await mkdir(artifacts, { recursive: true })
const summaryBundlePath = path.join(artifacts, 'canonical-summary.mjs')
await esbuild.build({
  stdin: { contents: "export { buildCanvasNodeSummaryV1 } from './src/lib/canvas/graph-summary'", resolveDir: root, loader: 'ts' },
  outfile: summaryBundlePath,
  bundle: true, format: 'esm', platform: 'node', alias: { '@': path.join(root, 'src') },
})
const { buildCanvasNodeSummaryV1 } = await import(pathToFileURL(summaryBundlePath).href)
const sharp = (await import('sharp')).default

const cpuRate = Number(process.env.PAN_CPU || 1)
const runsPerScenario = Math.max(1, Number(process.env.PAN_RUNS || 1))
const frameBudgetMs = cpuRate >= 4 ? 33.4 : 25
const VIEWPORT = { width: 1440, height: 900 }
const DEVICE_SCALE = 2

let appCss
if (process.env.NORI_BROWSER_GLOBAL_CSS_PATH) appCss = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH, 'utf8')
else {
  const workspace = new URL(process.env.NORI_WORKSPACE_URL || 'http://127.0.0.1:3000')
  assert.ok(['localhost', '127.0.0.1'].includes(workspace.hostname))
  const html = await (await fetch(new URL('/zh/auth/signin', workspace))).text()
  const styles = [...html.matchAll(/<link\b[^>]*>/g)]
    .filter(([tag]) => tag.includes('rel="stylesheet"'))
    .map(([tag]) => tag.match(/href="([^"]+)"/)?.[1]).filter((href) => href?.startsWith('/_next/static/'))
  assert.ok(styles.length, 'Set NORI_BROWSER_GLOBAL_CSS_PATH or run the guarded local app')
  appCss = (await Promise.all(styles.map(async (href) => (await fetch(new URL(href, workspace))).text()))).join('\n')
}
// A raw globals.css served by this fixture leaves its relative @imports
// unresolved, losing the production theme and undermeasuring render cost.
assert.match(appCss, /--nori-bg-0\s*:/, 'Use compiled application CSS that includes the theme tokens')
assert.match(appCss, /--nori-primary\s*:/, 'Use compiled application CSS that includes the theme tokens')
const appCssSha256 = createHash('sha256').update(appCss).digest('hex')

const bundle = process.env.NORI_BROWSER_PREBUILT_DIR ? {
  outputFiles: await Promise.all(['js', 'css'].map(async (extension) => ({
    path: `/fixture/fixture.${extension}`,
    contents: await readFile(path.join(process.env.NORI_BROWSER_PREBUILT_DIR, `canvas-pan-performance.${extension}`)),
  }))),
} : await (await import('esbuild')).build({
  entryPoints: ['tests/browser/canvas-pan-performance.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
  },
  define: { 'process.env.NODE_ENV': process.env.PAN_DEV ? '"development"' : '"production"', 'process.env.NORI_CANVAS_PERF_FIXTURE': '"1"', 'process.env': '{}' },
  minify: process.env.PAN_MINIFY !== '0',
  keepNames: true,
  sourcemap: process.env.PAN_SOURCEMAP ? 'external' : false,
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).contents

async function makeImage(seed, width = 2048, height = 1152) {
  const raw = Buffer.alloc(width * height * 3)
  let state = seed * 9301 + 49297
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 3
      state = (state * 1103515245 + 12345) & 0x7fffffff
      const noise = (state >> 16) & 31
      raw[i] = ((x * 255) / width + seed * 20 + noise) & 255
      raw[i + 1] = ((y * 255) / height + seed * 35 + noise) & 255
      raw[i + 2] = (((x + y) * 255) / (width + height) + seed * 50 + noise) & 255
    }
  }
  return sharp(raw, { raw: { width, height, channels: 3 } }).jpeg({ quality: 82 }).toBuffer()
}
const images = await Promise.all(Array.from({ length: 8 }, (_, index) => makeImage(index + 1)))
let video
try { video = await readFile(path.join(artifacts, 'sample-720p.mp4')) } catch { video = await readFile(path.join(root, 'test-results/canvas-ui-regression/sample.mp4')) }

const graphPayloads = new Map()
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname.startsWith('/bench-graph/')) {
    const body = graphPayloads.get(url.pathname)
    if (!body) {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, {
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip',
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
    }).end(body)
  } else if (url.pathname.startsWith('/img/')) {
    const body = images[Number(url.pathname.match(/(\d+)/)?.[1] || 0) % images.length]
    response.writeHead(200, { 'Content-Type': 'image/jpeg', 'Content-Length': body.length, 'Cache-Control': 'max-age=600' })
    response.end(body)
  } else if (url.pathname === '/api/storage/sign') {
    const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = match ? Math.min(Number(match[1]), video.length - 1) : 0
    const end = match?.[2] ? Math.min(Number(match[2]), video.length - 1) : video.length - 1
    response.writeHead(match ? 206 : 200, {
      'Content-Type': 'video/mp4', 'Content-Disposition': 'inline', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1,
      ...(match ? { 'Content-Range': `bytes ${start}-${end}/${video.length}` } : {}),
    })
    response.end(video.subarray(start, end + 1))
  } else if (url.pathname === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(script)
  } else if (url.pathname === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css'); response.end(css)
  } else if (url.pathname === '/global.css') {
    response.setHeader('Content-Type', 'text/css'); response.end(appCss)
  } else {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const gpu = process.env.PAN_GPU === 'metal'
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: gpu ? ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-zero-copy'] : ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'],
})

const model = {
  modelKey: 'kuaizi::doubao-seedance-2-5-260628', name: 'doubao-seedance-2-5-260628', provider: 'kuaizi', configured: true, available: true,
  supportGenerateAudio: true, firstLastFrame: true,
  options: { duration: [4, 5, 6, 8, 10], resolution: ['480p', '720p'], aspectRatio: ['16:9', '9:16', '1:1'] },
  inputSchema: { image: { min: 0, max: 9 }, video: { min: 0, max: 3 }, audio: { min: 0, max: 3 }, requiredFields: ['prompt'] },
}

const SETS = {
  quick: ['small-40', 'laotou-a'],
  reference: ['small-40', 'small-80', 'laotou-a', 'laotou-b'],
  limits: ['limit-1000', 'limit-1000-long', 'limit-1000-grouped', 'limit-1000-sparse'],
  controls: [...CONTROL_PAIRS.sameNodesDifferentEdges, ...CONTROL_PAIRS.sameTopologyDifferentHistory]
    .map((entry) => ({ name: entry.name, base: entry.base, ...entry.overrides })),
  p5: ['p5-5000'],
  all: Object.keys(SCALE_SCENARIOS),
}

function resolveEntry(entry) {
  const spec = typeof entry === 'string' ? { name: entry } : entry
  const { selected = process.env.PAN_SELECTED === '1', minimap = process.env.PAN_MINIMAP === '1', steps, base: baseName, videoRatio, ...config } = spec
  let graphConfig
  if (!baseName && !SCALE_SCENARIOS[config.name] && config.nodes) {
    graphConfig = {
      name: config.name || `custom-${config.nodes}`, seed: 1, maxInbound: 22, hubInbound: 0, groups: 0, history: null,
      edges: Math.round(config.nodes * 1.5), videos: Math.round(config.nodes * (videoRatio || 0.25)), layout: 'dense', zoom: 0.6,
      ...config,
    }
  } else {
    graphConfig = resolveScenario(baseName || config.name, config)
  }
  return { label: graphConfig.name, graphConfig, selected, minimap, steps }
}

function readScenarios() {
  if (process.env.PAN_SCENARIOS) return JSON.parse(process.env.PAN_SCENARIOS).map(resolveEntry)
  const set = process.env.PAN_SCENARIO_SET || 'quick'
  assert.ok(SETS[set], `Unknown PAN_SCENARIO_SET ${set}`)
  return SETS[set].map(resolveEntry)
}

const quantile = (values, q) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}
const median = (values) => quantile(values.filter((value) => typeof value === 'number' && Number.isFinite(value)), 0.5)
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits
const sum = (values) => values.reduce((total, value) => total + value, 0)

const transformOf = (page) => page.locator('.react-flow__viewport').first().evaluate((element) => element.style.transform)
const zoomOf = (page) => page.locator('.react-flow__viewport').first().evaluate((element) => new DOMMatrixReadOnly(getComputedStyle(element).transform).a)
const raf = (page) => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))

async function settleViewport(page, quietMs = 250, maxMs = 3000) {
  let last = await transformOf(page)
  let stableSince = Date.now()
  const startedAt = Date.now()
  while (Date.now() - startedAt < maxMs) {
    await page.waitForTimeout(50)
    const current = await transformOf(page)
    if (current !== last) { last = current; stableSince = Date.now() } else if (Date.now() - stableSince >= quietMs) return
  }
}

async function findEmptyPoint(page) {
  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect()
    if (!pane) return null
    const blocked = '.react-flow__node, .nori-canvas-generator, .react-flow__minimap, .nori-canvas-viewport-controls, .nori-canvas-dialog, .nori-canvas-chrome, .nori-canvas-tool-rail, header, [role="menu"]'
    for (let y = pane.y + 90; y < pane.y + pane.height - 40; y += 24) {
      for (let x = pane.x + 60; x < pane.x + pane.width - 60; x += 40) {
        const element = document.elementFromPoint(x, y)
        if (element && !element.closest(blocked) && element.closest('.react-flow__pane, .react-flow__renderer')) return { x, y }
      }
    }
    return { x: pane.x + pane.width / 2, y: pane.y + pane.height / 2, crowded: true }
  })
  assert.ok(point, 'The canvas pane must exist')
  return point
}

async function findSelectionRectangle(page, deadline = Date.now() + 5000, targetIds = null, requireUnmounted = false) {
  const rectangle = await page.evaluate(({ ids, requireUnmounted }) => {
    const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect()
    const workspace = document.querySelector('.nori-canvas-workspace')
    const flow = window.__noriFlowState?.()
    const projection = window.__noriProjection?.()
    if (!pane || !workspace || !flow || !projection) return null
    const bounds = workspace.getBoundingClientRect()
    const scaleX = bounds.width / workspace.clientWidth
    const scaleY = bounds.height / workspace.clientHeight
    const [tx, ty, zoom] = flow.transform
    const counts = {
      total: projection.nodes.length,
      mounted: projection.mounted.length,
      zoom,
      visible: projection.nodes.filter((node) => node.type !== 'group' && pane.x + tx + node.position.x * zoom >= pane.x && pane.y + ty + node.position.y * zoom >= pane.y && pane.x + tx + (node.position.x + node.width) * zoom <= pane.right && pane.y + ty + (node.position.y + node.height) * zoom <= pane.bottom).length,
      inBuffer: projection.nodes.filter((node) => node.type !== 'group' && pane.x + tx + (node.position.x + node.width) * zoom >= pane.x - 200 && pane.x + tx + node.position.x * zoom <= pane.right + 200 && pane.y + ty + (node.position.y + node.height) * zoom >= pane.y - 200 && pane.y + ty + node.position.y * zoom <= pane.bottom + 200).length,
      transform: flow.transform,
      target: ids ? {
        requested: ids.length,
        candidates: projection.nodes.filter((node) => ids.includes(node.id)).length,
        unmounted: projection.nodes.filter((node) => ids.includes(node.id) && !document.querySelector(`.react-flow__node[data-id="${node.id}"]`)).length,
        bounds: (() => {
          const target = projection.nodes.filter((node) => ids.includes(node.id))
          return target.length ? [Math.min(...target.map((node) => node.position.x)), Math.min(...target.map((node) => node.position.y)), Math.max(...target.map((node) => node.position.x + node.width)), Math.max(...target.map((node) => node.position.y + node.height))] : null
        })(),
      } : null,
    }
    const mounted = new Set(Array.from(document.querySelectorAll('.react-flow__node'), (element) => element.getAttribute('data-id')))
    const requested = ids ? new Set(ids) : null
    const candidates = projection.nodes.filter((node) => node.type !== 'group' && (!requested || requested.has(node.id))).map((node) => ({
      id: node.id,
      mounted: mounted.has(node.id),
      rect: {
        x: bounds.x + (tx + node.position.x * zoom) * scaleX,
        y: bounds.y + (ty + node.position.y * zoom) * scaleY,
        right: bounds.x + (tx + (node.position.x + node.width) * zoom) * scaleX,
        bottom: bounds.y + (ty + (node.position.y + node.height) * zoom) * scaleY,
      },
    })).filter((node) => node.rect.x >= pane.x && node.rect.y >= pane.y && node.rect.right <= pane.right && node.rect.bottom <= pane.bottom)
      .sort((a, b) => Number(a.mounted) - Number(b.mounted))
      .slice(0, 120)
    if (requireUnmounted && !candidates.some((node) => !node.mounted)) return { requiresWait: true, counts, reason: 'all mounted' }
    if (candidates.length < 2) return { requiresWait: true, counts, reason: 'fewer than two candidates' }
    const obstacles = Array.from(document.querySelectorAll('.nori-canvas-generator, .react-flow__minimap, .nori-canvas-viewport-controls, .nori-canvas-dialog, .nori-canvas-chrome, .nori-canvas-tool-rail, header, [role="menu"]'))
      .map((element) => element.getBoundingClientRect())
    const isEmpty = (x, y) => x >= pane.x && x <= pane.right && y >= pane.y && y <= pane.bottom
      && !obstacles.some((rect) => x >= rect.x && x <= rect.right && y >= rect.y && y <= rect.bottom)
      && !candidates.some(({ rect }) => x >= rect.x && x <= rect.right && y >= rect.y && y <= rect.bottom)
      && !document.elementFromPoint(x, y)?.closest('.react-flow__node, .react-flow__edge, .react-flow__nodesselection, .nori-canvas-node-toolbar')
    const left = Math.min(...candidates.map((node) => node.rect.x)) - 2
    const top = Math.min(...candidates.map((node) => node.rect.y)) - 2
    const right = Math.max(...candidates.map((node) => node.rect.right)) + 2
    const bottom = Math.max(...candidates.map((node) => node.rect.bottom)) + 2
    for (const pad of [5, 12, 20, 28, 36, 48]) {
      for (const [x, y, endX, endY] of [
        [left - pad, top - pad, right, bottom],
        [right + pad, top - pad, left, bottom],
        [left - pad, bottom + pad, right, top],
        [right + pad, bottom + pad, left, top],
      ]) {
        if (isEmpty(x, y)) return { x, y, width: endX - x, height: endY - y }
      }
    }
    return { requiresWait: true, counts, reason: 'no empty start' }
  }, { ids: targetIds, requireUnmounted })
  if (rectangle?.requiresWait) {
    if (Date.now() >= deadline) console.log('selection-projection-timeout', rectangle.counts, rectangle.reason)
    assert.ok(Date.now() < deadline, 'A projected but unmounted node must remain selectable within 5 seconds')
    await page.waitForTimeout(100)
    return findSelectionRectangle(page, deadline, targetIds, requireUnmounted)
  }
  assert.ok(rectangle, 'The viewport must have an empty box-selection start containing at least two nodes')
  return rectangle
}

async function pickNodes(page, count, predicate = 'any') {
  return page.evaluate(({ count: wanted, predicate: kind }) => {
    const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect()
    if (!pane) return []
    const cx = pane.x + pane.width / 2
    const cy = pane.y + pane.height / 2
    const found = []
    for (const element of document.querySelectorAll('.react-flow__node')) {
      const type = [...element.classList].find((name) => name.startsWith('react-flow__node-'))?.slice('react-flow__node-'.length) || ''
      if (type === 'group' || (kind === 'video' && type !== 'video') || (kind === 'media' && !['video', 'image'].includes(type))) continue
      const handle = element.querySelector('.nori-canvas-node-drag-handle')
      if (!handle) continue
      const rect = handle.getBoundingClientRect()
      if (rect.width < 10 || rect.height < 6) continue
      const x = rect.x + rect.width / 2
      const y = rect.y + Math.min(rect.height / 2, 24)
      if (x < pane.x + 80 || x > pane.right - 160 || y < pane.y + 100 || y > pane.bottom - 100) continue
      if (!document.elementFromPoint(x, y)?.closest('.react-flow__node')?.isSameNode(element)) continue
      found.push({ id: element.getAttribute('data-id'), type, x, y, distance: Math.hypot(x - cx, y - cy) })
    }
    return found.sort((a, b) => a.distance - b.distance).slice(0, wanted)
  }, { count, predicate })
}

const domCounts = (page) => page.evaluate(() => ({
  reactFlowNodes: document.querySelectorAll('.react-flow__node').length,
  reactFlowEdges: document.querySelectorAll('.react-flow__edge').length,
  edgePaths: document.querySelectorAll('.react-flow__edges path').length,
  images: document.images.length,
  videos: document.querySelectorAll('video').length,
  domElements: document.getElementsByTagName('*').length,
}))

function expectedMounted(graph) {
  const { x, y, zoom } = graph.canvas.viewport
  const left = -x / zoom
  const top = -y / zoom
  const right = left + VIEWPORT.width / zoom
  const bottom = top + VIEWPORT.height / zoom
  const visible = graph.nodes.filter((node) => node.type !== 'group'
    && node.position.x + node.size.width > left && node.position.x < right
    && node.position.y + node.size.height > top && node.position.y < bottom).length
  return visible === 0 ? 0 : Math.max(1, Math.min(8, visible - 1))
}

async function measureOpen(page, graph, requests) {
  const expected = expectedMounted(graph)
  const operable = await page.waitForFunction((count) => {
    if (document.querySelectorAll('.react-flow__node').length < count && !document.querySelector('[data-canvas-overview]')) return false
    if (document.querySelector('.nori-canvas-sync-lock')) return false
    return performance.now()
  }, expected, { timeout: 45000, polling: 'raf' }).catch(async (error) => {
    const diagnostic = await page.evaluate(() => ({ nodes: document.querySelectorAll('.react-flow__node').length, syncLock: document.querySelector('.nori-canvas-sync-lock')?.textContent || null, body: document.body.innerText.slice(0, 200) })).catch(() => null)
    await page.screenshot({ path: path.join(artifacts, 'open-timeout.png') }).catch(() => {})
    throw new Error(`${error.message.split('\n')[0]} expected>=${expected} ${JSON.stringify(diagnostic)}`)
  })
  const firstOperableMs = round(await operable.jsonValue())
  const overviewOpen = await page.evaluate(() => Boolean(document.querySelector('[data-canvas-overview]')))
  const poster = overviewOpen ? null : await page.waitForFunction(() => {
    const image = document.querySelector('.nori-canvas-video-poster img')
    return image && image.complete && image.naturalWidth > 0 ? performance.now() : false
  }, null, { timeout: 10000, polling: 'raf' }).catch(() => null)
  const firstPosterMs = poster ? round(await poster.jsonValue()) : null
  const counts = { api: 0, image: 0, media: 0, other: 0 }
  for (const request of requests) {
    if (request.url.includes('/api/')) counts.api += 1
    else if (request.type === 'image') counts.image += 1
    else if (request.type === 'media') counts.media += 1
    else counts.other += 1
  }
  return { firstOperableMs, firstPosterMs, overviewOpen, requests: requests.length, requestKinds: counts, ...(await domCounts(page)) }
}

function frameStats(frames) {
  const kept = frames.slice(2)
  return {
    frames: kept.length,
    p50: round(quantile(kept, 0.5)), p95: round(quantile(kept, 0.95)), max: round(Math.max(0, ...kept)),
    over34: kept.filter((value) => value > 34).length,
    over50: kept.filter((value) => value > 50).length,
    over50Ratio: kept.length ? round(kept.filter((value) => value > 50).length / kept.length, 4) : 0,
  }
}

async function installCollector(page) {
  await page.evaluate(() => {
    const state = { frames: [], loaf: [], longtasks: [], slow: [], marks: [], origin: 0, active: false }
    window.__perfState = state
    let last = performance.now()
    const tick = (time) => {
      if (state.active) {
        state.frames.push(time - last)
        if (time - last > 50) state.slow.push({ at: Math.round(time - state.origin), ms: Math.round(time - last) })
      }
      last = time
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
    try {
      new PerformanceObserver((list) => {
        if (!state.active) return
        for (const entry of list.getEntries()) state.loaf.push({ duration: entry.duration, script: entry.scripts.reduce((total, item) => total + item.duration, 0) })
      }).observe({ type: 'long-animation-frame', buffered: false })
      new PerformanceObserver((list) => { if (state.active) for (const entry of list.getEntries()) state.longtasks.push(entry.duration) }).observe({ entryTypes: ['longtask'] })
    } catch {}
    window.__perfBegin = () => { state.frames = []; state.loaf = []; state.longtasks = []; state.slow = []; state.marks = []; state.origin = performance.now(); state.active = true }
    window.__perfMark = (label) => state.marks.push({ label, at: Math.round(performance.now() - state.origin) })
    window.__perfEnd = () => { state.active = false; return { frames: state.frames, loaf: state.loaf, longtasks: state.longtasks, slow: state.slow, marks: state.marks } }
  })
}

function nodeDetailVersion(node) {
  const payload = JSON.stringify([node.data, node.status, node.taskId, node.runId, node.mediaObjectId, node.parentNodeId])
  let hash = 2166136261
  for (let index = 0; index < payload.length; index += 1) {
    hash ^= payload.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return `v1-${(hash >>> 0).toString(16).padStart(8, '0')}-${payload.length}`
}

function summarizeGraph(graph) {
  return {
    ...graph,
    kind: 'summary-v1',
    nodes: graph.nodes.map(buildCanvasNodeSummaryV1),
  }
}

function nodeHistory(graph, nodeId) {
  const node = graph.nodes.find((item) => item.id === nodeId)
  if (!node) return null
  const detailVersion = nodeDetailVersion(node)
  return {
    detailVersion,
    items: (node.data?.history || []).map(({ prompt: _prompt, text: _text, references: _references, parameters: _parameters, ...item }) => item),
    node,
  }
}

async function runOnce(entry, graph, rawGraph, switchGraph, runIndex) {
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE })
  const page = await context.newPage()
  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  if (cpuRate > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuRate })
  const readMetrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))

  const errors = []
  const failures = []
  const gets = []
  const saves = []
  const viewportSaves = []
  let requests = []
  let revision = 0
  let rejectWrites = false
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => requests.push({ url: request.url(), type: request.resourceType() }))

  const encodeGraph = (graph, raw) => {
    const summary = Buffer.from(JSON.stringify(summarizeGraph(graph)))
    return { graph, raw, encoded: gzipSync(raw), summary, encodedSummary: gzipSync(summary) }
  }
  const mainFixture = encodeGraph(graph, rawGraph)
  const switchFixture = encodeGraph(switchGraph, Buffer.from(JSON.stringify(switchGraph)))
  const historyGate = Promise.withResolvers()
  let delayHistory = process.env.PAN_HISTORY_RACE === '1'
  graphPayloads.clear()
  for (const [canvasId, source] of [['canvas-1', mainFixture], ['canvas-2', switchFixture]]) {
    graphPayloads.set(`/bench-graph/${canvasId}/summary-v1`, source.encodedSummary)
    graphPayloads.set(`/bench-graph/${canvasId}/full`, source.encoded)
  }
  await page.route('**/*', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (!url.pathname.startsWith('/api/') || url.pathname === '/api/storage/sign') return route.continue()
    const json = (payload, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
    if (url.pathname.endsWith('/generation-config')) return json({ textModels: [], imageModels: [], videoModels: [model], audioModels: [], model3dModels: [], defaults: { videoModel: model.modelKey, aspectRatio: '16:9', resolution: '720p' } })
    if (url.pathname.endsWith('/generation-quote')) return json({ points: 20, costCny: 0.2 })
    if (url.pathname.endsWith('/balance')) return json({ balancePoints: 1000, generationAllowed: true, dailyLimitPoints: null, dailyUsedPoints: 0, dailyLimitExceeded: false })
    if (url.pathname.endsWith('/toolbox/assets')) return json({ assets: [] })
    if (url.pathname.endsWith('/operations')) return json({ engines: [], latestTask: null, latestTaskLinks: null })
    if (url.pathname.endsWith('/studio-document')) return json({ studioDocument: null })
    if (url.pathname.endsWith('/revisions')) return json({ revisions: [] })
    const nodeRequest = url.pathname.match(/\/canvas\/(canvas-\d)\/nodes\/([^/]+)$/)
    if (nodeRequest) {
      const source = nodeRequest[1] === 'canvas-1' ? graph : switchGraph
      const history = nodeHistory(source, decodeURIComponent(nodeRequest[2]))
      if (!history) return json({ error: { message: '节点不存在' } }, 404)
      if (url.searchParams.get('view') === 'detail-v1') return json({ kind: 'detail-v1', detailVersion: history.detailVersion, node: history.node })
      if (url.searchParams.get('view') === 'history-v1') {
        if (delayHistory && nodeRequest[1] === 'canvas-1') {
          delayHistory = false
          await historyGate.promise
        }
        return json({ kind: 'history-v1', detailVersion: history.detailVersion, items: history.items.slice(0, 20), nextCursor: history.items.length > 20 ? '20' : null })
      }
      if (url.searchParams.get('view') === 'history-item-v1') {
        const item = history.node.data?.history?.find((entry) => entry.id === url.searchParams.get('entryId'))
        return item ? json({ kind: 'history-item-v1', detailVersion: history.detailVersion, item }) : json({ error: { message: '历史不存在' } }, 404)
      }
    }
    const canvas = url.pathname.match(/\/canvas\/(canvas-\d)(?:\/(ops|document))?$/)
    if (canvas) {
      const [, canvasId, sub] = canvas
      const source = canvasId === 'canvas-1' ? mainFixture : switchFixture
      if (!sub && request.method() === 'GET') {
        const summary = url.searchParams.get('view') === 'summary-v1'
        const payload = summary ? source.summary : source.raw
        const body = summary ? source.encodedSummary : source.encoded
        gets.push({ canvasId, view: summary ? 'summary-v1' : 'full', gzipBytes: body.length, decodedBytes: payload.length })
        // Playwright fulfills response bodies as-is; serve compressed bytes
        // over HTTP so Chromium actually exercises content decoding.
        return route.continue({ url: `${base}/bench-graph/${canvasId}/${summary ? 'summary-v1' : 'full'}` })
      }
      if (sub) {
        if (rejectWrites) return route.abort('internetdisconnected')
        const body = request.postData() || ''
        let parsed = null
        try { parsed = JSON.parse(body) } catch {}
        const kinds = {}
        for (const operation of parsed?.ops || []) kinds[operation.type] = (kinds[operation.type] || 0) + 1
        const operations = (parsed?.ops || []).map((operation) => {
          const item = { type: operation.type, id: operation.id || operation.node?.id || operation.edge?.id, position: operation.position ?? operation.node?.position, size: operation.size ?? operation.node?.size, nodeKeys: operation.node ? Object.keys(operation.node).filter((key) => key !== 'data') : undefined, dataKeys: operation.node?.data ? Object.keys(operation.node.data).filter((key) => !['prompt', 'text'].includes(key)) : undefined }
          if (operation.node?.type === 'group') {
            item.groupMembers = operation.node.data?.memberIds ?? []
            item.groupHasOnlyGroupFields = Object.keys(operation.node.data ?? {}).every((key) => ['title', 'groupColor', 'memberIds'].includes(key))
          }
          return item
        })
        saves.push({ at: Date.now(), pageAt: await page.evaluate(() => Math.round(performance.now())).catch(() => null), kind: sub, bytes: Buffer.byteLength(body), ops: kinds, operations, nodes: parsed?.nodes?.length, edges: parsed?.edges?.length })
        revision += 1
        const viewport = parsed?.ops?.find((operation) => operation.type === 'canvas.update_meta')?.viewport
        const next = { ...source.graph.canvas, ...(viewport ? { viewport } : {}), revision }
        const ops = parsed?.ops ?? []
        return json(sub === 'ops'
          ? {
            canvas: next,
            nodes: ops.filter((operation) => operation.type === 'node.upsert').map((operation) => ({ ...operation.node, canvasId })),
            edges: ops.filter((operation) => operation.type === 'edge.add').map((operation) => ({ ...operation.edge, canvasId })),
            deletedNodeIds: ops.filter((operation) => operation.type === 'node.delete').map((operation) => operation.id),
            deletedEdgeIds: ops.filter((operation) => operation.type === 'edge.delete').map((operation) => operation.id),
            geometry: ops.flatMap((operation) => operation.type === 'node.update_geometry' ? [{ id: operation.id, ...(operation.position ? { position: operation.position } : {}), ...(operation.size ? { size: operation.size } : {}) }] : []),
          }
          : { canvas: next, nodes: source.graph.nodes, edges: source.graph.edges })
      }
      return json({ canvas: source.graph.canvas })
    }
    return json({ voices: [], materials: [], projects: [] })
  })

  // Cold open, then a reload with warm HTTP image cache.
  await page.goto(`${base}/${process.env.PAN_SUMMARY === '0' ? '?summary=0' : ''}`)
  assert.ok(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--nori-bg-0').trim()),
    'Compiled theme tokens did not apply inside the browser')
  const cold = await measureOpen(page, graph, requests).catch(async (error) => {
    console.log('open-failure', JSON.stringify({ errors, requests, diagnostic: await page.evaluate(() => ({ readyState: document.readyState, root: document.querySelector('#root')?.innerHTML.slice(0, 500) || null, scripts: [...document.scripts].map((script) => ({ src: script.src, async: script.async, defer: script.defer })) })).catch(() => null) }))
    throw error
  })
  const coldGets = gets.slice()
  requests = []
  await page.reload()
  const warm = await measureOpen(page, graph, requests)
  await page.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 45000 }).catch(() => {})
  await settleViewport(page, 400, 3000)
  await page.waitForTimeout(800)

  const structural = {}
  // Poster-first video: explicit activation must start exactly one video element A reload afterwards keeps the measured phases free of the playing video.
  structural.videoElementsBeforePlay = await page.locator('.react-flow__node video').count()
  if (structural.videoElementsBeforePlay !== 0) failures.push('video element mounted before play activation')
  const activation = { skipped: 'no poster in viewport' }
  const posterNodes = await pickNodes(page, 6, 'video')
  for (const candidate of posterNodes) {
    const play = page.locator(`.react-flow__node[data-id="${candidate.id}"] [data-testid="canvas-video-play"]`)
    if (!(await play.count()) || !(await play.first().isVisible())) continue
    try {
      await play.first().click({ timeout: 5000 })
      await page.locator('.react-flow__node video').first().waitFor({ timeout: 8000 })
      structural.videoElementsAfterPlay = await page.locator('.react-flow__node video').count()
      if (structural.videoElementsAfterPlay !== 1) failures.push(`expected 1 video after activation, saw ${structural.videoElementsAfterPlay}`)
      await page.waitForFunction(() => [...document.querySelectorAll('video')].every((item) => item.readyState >= 2 || item.error), null, { timeout: 15000 }).catch(() => {})
      structural.playbackStarted = await page.locator('.react-flow__node video').first().evaluate((item) => !item.paused)
      if (!structural.playbackStarted) failures.push('activation did not start playback')
      await page.locator('.react-flow__node video').first().evaluate((item) => item.pause())
      delete activation.skipped
      activation.nodeId = candidate.id
      break
    } catch (error) { activation.skipped = `candidate ${candidate.id}: ${error.message.split('\n')[0]}` }
  }
  if (activation.skipped && posterNodes.length) failures.push(`activation: ${activation.skipped}`)

  // Drag a single node, then a multi-selection.
  await page.reload()
  await measureOpen(page, graph, [])
  await page.waitForFunction(() => [...document.images].every((image) => image.complete), null, { timeout: 45000 }).catch(() => {})
  await settleViewport(page, 400, 3000)
  await page.waitForTimeout(500)

  const initialZoom = await zoomOf(page)
  await installCollector(page)

  const VIEWPORT_ONLY_PHASES = new Set(['pan', 'idle-2s', 'wheel-zoom', 'viewport-controls'])

  async function phase(name, run) {
    const before = await readMetrics()
    const commitsBefore = await page.evaluate(() => window.__reactCommits.length)
    const savesFrom = saves.length
    await page.evaluate(() => window.__perfBegin())
    const startedAt = Date.now()
    let detail = null
    const profiled = process.env.PAN_PROFILE_PHASE === name
    if (profiled) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start') }
    try { detail = await run() } catch (error) { failures.push(`${name}: ${error.message.split('\n')[0]}`); detail = { failed: error.message.split('\n')[0] } }
    if (profiled) {
      const rawProfile = (await cdp.send('Profiler.stop')).profile
      if (process.env.PAN_SOURCEMAP) {
        const mapOutput = bundle.outputFiles.find((file) => file.path.endsWith('.js.map'))
        if (mapOutput) {
          const { TraceMap, originalPositionFor } = await import('@jridgewell/trace-mapping')
          const tracer = new TraceMap(JSON.parse(new TextDecoder().decode(mapOutput.contents)))
          for (const node of rawProfile.nodes) {
            const frame = node.callFrame
            if (!frame.url.endsWith('/fixture.js') || frame.lineNumber < 0 || frame.columnNumber < 0) continue
            const original = originalPositionFor(tracer, { line: frame.lineNumber + 1, column: frame.columnNumber })
            if (original.source) node.callFrame = { ...frame, functionName: original.name || frame.functionName, url: original.source, lineNumber: (original.line || 1) - 1, columnNumber: original.column || 0 }
          }
        }
      }
      detail = { ...detail, profile: summariseProfile(rawProfile) }
    }
    const collected = await page.evaluate(() => window.__perfEnd())
    const elapsedMs = Date.now() - startedAt
    const after = await readMetrics()
    const commitDurations = await page.evaluate((from) => window.__reactCommits.slice(from), commitsBefore)
    const phaseSaves = saves.slice(savesFrom)
    const viewportSaveSyncMs = await page.evaluate(() => {
      const durations = performance.getEntriesByName('canvas:viewport-save-sync', 'measure').map((entry) => entry.duration)
      performance.clearMarks('canvas:viewport-save-scheduled')
      performance.clearMarks('canvas:viewport-save-request')
      performance.clearMeasures('canvas:viewport-save-sync')
      return durations
    })
    if (VIEWPORT_ONLY_PHASES.has(name)) {
      for (const save of phaseSaves) {
        const kinds = Object.keys(save.ops)
        const metadataOnly = save.kind === 'ops' && kinds.length === 1 && kinds[0] === 'canvas.update_meta' && save.ops['canvas.update_meta'] === 1
        if (!metadataOnly) failures.push(`${name}: viewport-only gesture saved ${save.kind} ${JSON.stringify(save.ops)}`)
        else viewportSaves.push({ phase: name, bytes: save.bytes, syncMs: viewportSaveSyncMs.shift() })
      }
      if (viewportSaveSyncMs.length > 0) failures.push(`${name}: viewport timing marks outnumber requests`)
    }
    return {
      name, elapsedMs,
      ...frameStats(collected.frames),
      mainBusyMs: round((after.TaskDuration - before.TaskDuration) * 1000, 0),
      scriptMs: round((after.ScriptDuration - before.ScriptDuration) * 1000, 0),
      layoutMs: round((after.LayoutDuration - before.LayoutDuration) * 1000, 0),
      styleMs: round((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000, 0),
      styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
      layouts: after.LayoutCount - before.LayoutCount,
      longTasks: collected.longtasks.length, longTaskMs: round(sum(collected.longtasks), 0),
      loafs: collected.loaf.length, loafMs: round(sum(collected.loaf.map((item) => item.duration)), 0),
      reactCommits: commitDurations.length, reactCommitMs: round(sum(commitDurations), 0),
      saves: phaseSaves.length, saveBytes: sum(phaseSaves.map((item) => item.bytes)),
      saveKinds: phaseSaves.reduce((kinds, item) => { for (const [kind, count] of Object.entries(item.ops)) kinds[kind] = (kinds[kind] || 0) + count; if (item.kind === 'document') kinds.document = (kinds.document || 0) + 1; return kinds }, {}),
      operations: phaseSaves.flatMap((item) => item.operations),
      dom: await domCounts(page),
      timeline: collected.slow.length ? { slowFrames: collected.slow, marks: collected.marks } : undefined,
      detail,
    }
  }

  const phases = []

  structural.videoElementsBeforePlay = await page.locator('.react-flow__node video').count()
  if (structural.videoElementsBeforePlay !== 0) failures.push('video element mounted before play activation')
  structural.posterCount = await page.locator('.nori-canvas-video-poster').count()

  if (entry.selected) {
    const [target] = await pickNodes(page, 1, 'video')
    if (target) {
      await page.mouse.click(target.x, target.y)
      await page.waitForTimeout(400)
      await page.mouse.click(target.x, target.y)
      await page.locator('.nori-canvas-generator').waitFor({ timeout: 8000 }).catch(() => failures.push('selected scenario: generator did not open'))
    }
  }
  if (entry.minimap) await page.getByRole('button', { name: /小地图/ }).first().click().catch(() => {})

  // Middle-button pan with a real drag.
  const traceFile = path.join(artifacts, `trace-${entry.label}.json`)
  phases.push(await phase('pan', async () => {
    const start = await findEmptyPoint(page)
    const transformBefore = await transformOf(page)
    if (process.env.PAN_TRACE) await browser.startTracing(page, { path: traceFile, categories: ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc', 'gpu', 'viz', 'blink'] })
    if (process.env.PAN_PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start') }
    await page.mouse.move(start.x, start.y)
    await page.mouse.down({ button: 'middle' })
    const steps = entry.steps || 150
    for (let step = 0; step < steps; step += 1) {
      const angle = step / 18
      await page.mouse.move(start.x + Math.cos(angle) * 160 - 160, start.y + Math.sin(angle) * 80)
      await raf(page)
    }
    await page.mouse.up({ button: 'middle' })
    const detail = { steps, crowdedStart: Boolean(start.crowded) }
    if (process.env.PAN_PROFILE) detail.profile = summariseProfile((await cdp.send('Profiler.stop')).profile)
    if (process.env.PAN_TRACE) detail.trace = summariseTrace(JSON.parse((await browser.stopTracing()).toString()))
    assert.notEqual(await transformOf(page), transformBefore, 'Middle-button drag must pan the canvas')
    return detail
  }))

  // Idle 2 s after the gesture: shows deferred saves and background work.
  phases.push(await phase('idle-2s', async () => { await page.waitForTimeout(2000); return {} }))

  // Real wheel zoom, in then back out.
  phases.push(await phase('wheel-zoom', async () => {
    const point = await findEmptyPoint(page)
    const zoomBefore = await zoomOf(page)
    await page.mouse.move(point.x, point.y)
    let zoomMid = zoomBefore
    for (let step = 0; step < 6; step += 1) { await page.mouse.wheel(0, -100); await raf(page) }
    zoomMid = await zoomOf(page)
    for (let step = 0; step < 6; step += 1) { await page.mouse.wheel(0, 100); await raf(page) }
    const zoomAfter = await zoomOf(page)
    assert.ok(Math.abs(zoomMid - zoomBefore) > 0.05, `Wheel must change the real zoom (before ${zoomBefore.toFixed(2)}, after ${zoomMid.toFixed(2)})`)
    return { zoomBefore: round(zoomBefore, 3), zoomIn: round(zoomMid, 3), zoomAfter: round(zoomAfter, 3) }
  }))

  // Toolbar viewport controls drive React Flow's own setViewport/fitView.
  phases.push(await phase('viewport-controls', async () => {
    const controls = '.nori-canvas-viewport-controls button'
    const transformBefore = await transformOf(page)
    await page.locator(`${controls}[title^="适应画布"]`).click()
    await settleViewport(page)
    const fitted = await zoomOf(page)
    await page.locator(`${controls}[title^="放大"]`).click(); await settleViewport(page)
    await page.locator(`${controls}[title^="放大"]`).click(); await settleViewport(page)
    const zoomedIn = await zoomOf(page)
    await page.locator(`${controls}[title^="缩小"]`).click(); await settleViewport(page)
    assert.notEqual(await transformOf(page), transformBefore, 'Toolbar viewport controls must change the transform')
    assert.ok(zoomedIn > fitted, 'Zoom-in must increase the zoom level')
    return { fitted: round(fitted, 3), zoomedIn: round(zoomedIn, 3) }
  }))

  // After the toolbar fit the whole graph is in view: re-seat near zoom 0.6 for interaction probes.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2)
  for (let step = 0; step < 14 && (await zoomOf(page)) < 0.55; step += 1) { await page.mouse.wheel(0, -100); await raf(page) }
  await settleViewport(page, 400, 3000)
  await page.keyboard.press('Escape')
  await page.locator('.nori-canvas-generator').waitFor({ state: 'hidden' }).catch(() => {})
  await page.waitForTimeout(500)

  phases.push(await phase('drag-single', async () => {
    const [target] = await pickNodes(page, 1, 'media')
    if (!target) return { skipped: 'no draggable node in viewport' }
    const node = page.locator(`.react-flow__node[data-id="${target.id}"]`)
    const beforeTransform = await node.evaluate((element) => element.style.transform)
    await page.mouse.move(target.x, target.y)
    await page.mouse.down()
    for (let step = 1; step <= 30; step += 1) {
      await page.mouse.move(target.x + step * 3, target.y + step * 1.5)
      await raf(page)
    }
    await page.mouse.up()
    assert.notEqual(await node.evaluate((element) => element.style.transform), beforeTransform, 'Single node drag must move the node')
    return { nodeId: target.id }
  }))

  const singleDragId = phases.at(-1)?.detail?.nodeId
  if (singleDragId) {
    const deadline = Date.now() + 5000
    while (Date.now() < deadline && !saves.some((save) => save.operations.some((operation) =>
      operation.type === 'node.update_geometry' && operation.id === singleDragId))) {
      await page.waitForTimeout(50)
    }
    if (!saves.some((save) => save.operations.some((operation) =>
      operation.type === 'node.update_geometry' && operation.id === singleDragId))) {
      failures.push('drag-single: no geometry save for the dragged node')
    }
  }
  phases.push(await phase('drag-multi', async () => {
    const sparse = entry.graphConfig.layout === 'sparse'
    const requireUnmounted = graph.nodes.length >= 1000 && !sparse
    const candidateViewports = await page.evaluate(({ requireUnmounted, sparse }) => {
      const projection = window.__noriProjection()
      const pane = document.querySelector('.react-flow__pane').getBoundingClientRect()
      const visible = projection.nodes.filter((node) => node.type !== 'group')
      const candidates = []
      const zooms = requireUnmounted ? [0.32, 0.35, 0.38] : [0.38, 0.4]
      for (const zoom of zooms) {
        for (const anchor of visible) {
          const group = visible.filter((node) => node.position.x >= anchor.position.x && node.position.x + node.width <= anchor.position.x + 3000 && node.position.y >= anchor.position.y && node.position.y + node.height <= anchor.position.y + 1420)
          if (group.length < (sparse ? 2 : 24)) continue
          const left = Math.min(...group.map((item) => item.position.x))
          const top = Math.min(...group.map((item) => item.position.y))
          const right = Math.max(...group.map((item) => item.position.x + item.width))
          const bottom = Math.max(...group.map((item) => item.position.y + item.height))
          if ((right - left) * zoom > pane.width - 160 || (bottom - top) * zoom > pane.height - 160) continue
          const inBuffer = visible.filter((item) => item.position.x + item.width >= left - 500 && item.position.x <= right + 500 && item.position.y + item.height >= top - 500 && item.position.y <= bottom + 500)
          candidates.push({ x: 80 - left * zoom, y: 80 - top * zoom, zoom, count: inBuffer.length, ids: group.map((item) => item.id) })
        }
        if (candidates.some((candidate) => candidate.count > 80)) break
      }
      return candidates.sort((a, b) => b.count - a.count).slice(0, 12)
    }, { requireUnmounted, sparse })
    assert.ok(candidateViewports.length > 0, sparse ? 'A sparse viewport must contain a selectable pair' : 'A dense grid selection candidate must exist')
    let targetViewport = null
    let preBoxMounted = new Set()
    if (requireUnmounted) {
      // Enter full mode first, then use its denser side of the hysteresis
      // band. At 0.38 the only omitted candidate can be clipped by the pane.
      await page.evaluate(async () => {
        const [x, y] = window.__noriFlowState().transform
        await window.__noriSetViewport({ x, y, zoom: 0.45 })
      })
      await settleViewport(page, 300)
    }
    for (const candidate of candidateViewports) {
      await page.evaluate(async (viewport) => { await window.__noriSetViewport(viewport) }, candidate)
      await settleViewport(page, 650)
      const mounted = new Set(await page.locator('.react-flow__node').evaluateAll((elements) => elements.map((element) => element.getAttribute('data-id'))))
      if (!requireUnmounted || candidate.ids.some((id) => !mounted.has(id))) {
        targetViewport = candidate
        preBoxMounted = mounted
        break
      }
    }
    assert.ok(targetViewport, 'No usable grid for box selection')
    if (requireUnmounted) assert.ok(targetViewport.count > 80, 'The full-render viewport must contain more nodes than the mount budget')
    await page.keyboard.press('Escape')
    const clearBeforeBox = await findEmptyPoint(page)
    await page.mouse.click(clearBeforeBox.x, clearBeforeBox.y)
    await page.waitForFunction(() => window.__noriFlowNodes().every((node) => !node.selected))
    const start = await findSelectionRectangle(page, Date.now() + 5000, targetViewport.ids, requireUnmounted)
    preBoxMounted = new Set(await page.locator('.react-flow__node').evaluateAll(
      (elements) => elements.map((element) => element.getAttribute('data-id')),
    ))
    if (requireUnmounted) assert.ok(
      targetViewport.ids.some((id) => !preBoxMounted.has(id)),
      'The box-selection target must include a node that is not mounted',
    )
    const selectedCount = () => page.locator('.nori-canvas-node.is-selected').count()
    await page.evaluate(() => window.__perfMark('box-start'))
    await page.keyboard.down('Shift')
    await page.mouse.move(start.x, start.y)
    await page.mouse.down()
    await page.mouse.move(start.x + start.width, start.y + start.height, { steps: 10 })
    await page.mouse.up()
    await page.keyboard.up('Shift')
    await page.evaluate(() => window.__perfMark('box-end'))
    await raf(page)
    await page.waitForTimeout(50)
    const selected = await selectedCount()
    const selectedFlowCount = await page.locator('.react-flow__node.selected').count()
    const flowSelectionCount = await page.locator('.react-flow__selection').count()
    if (selected < 2) throw new Error(`Shift box selection selected ${selected} node(s); flow=${selectedFlowCount}, selectionBox=${flowSelectionCount}`)
    const beforeSelection = await page.waitForFunction(({ requireUnmounted, mountedIds }) => {
      const nodes = window.__noriProjection().nodes.filter((node) => node.selected && node.type !== 'group')
      return nodes.length >= 2 && (!requireUnmounted || nodes.some((node) => !mountedIds.includes(node.id))) ? nodes : false
    }, { requireUnmounted, mountedIds: [...preBoxMounted] }, { timeout: 5000 }).then((handle) => handle.jsonValue())
    if (requireUnmounted) assert.ok(beforeSelection.some((node) => !preBoxMounted.has(node.id)), 'Multi-selection probe must include an unmounted node')
    const target = await page.evaluate(() => {
      const selected = [...document.querySelectorAll('.react-flow__node:has(.nori-canvas-node.is-selected)')]
      const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect()
      if (!pane || !selected.length) return null
      const surface = { left: Math.max(0, pane.left), top: Math.max(0, pane.top),
        right: Math.min(innerWidth, pane.right), bottom: Math.min(innerHeight, pane.bottom) }
      const controls = 'button,input,[role="dialog"],.nori-canvas-viewport-controls,.nori-canvas-tool-rail'
      const candidates = []
      const overlay = document.querySelector('.react-flow__nodesselection-rect')?.getBoundingClientRect()
      if (overlay) {
        // A clipped group-selection box can have its geometric centre outside
        // the screen. Only probe points that actually hit its visible part.
        const left = Math.max(overlay.left + 2, surface.left)
        const top = Math.max(overlay.top + 2, surface.top)
        const right = Math.min(overlay.right - 2, surface.right)
        const bottom = Math.min(overlay.bottom - 2, surface.bottom)
        for (const fx of [0.5, 0.25, 0.75, 0.1, 0.9]) for (const fy of [0.5, 0.25, 0.75, 0.1, 0.9]) {
          if (left >= right || top >= bottom) continue
          const x = left + (right - left) * fx
          const y = top + (bottom - top) * fy
          if (document.elementFromPoint(x, y)?.closest('.react-flow__nodesselection-rect')) {
            candidates.push({ id: selected[0].getAttribute('data-id'), x, y })
          }
        }
      }
      for (const node of selected) {
        const handle = node.querySelector('.nori-canvas-node-drag-handle')
        const rect = handle?.getBoundingClientRect()
        if (!rect || !rect.width || !rect.height) continue
        const x = rect.x + rect.width / 2
        const y = rect.y + Math.min(rect.height / 2, 24)
        const hit = document.elementFromPoint(x, y)
        if (hit && handle.contains(hit) && !hit.closest(controls)) candidates.push({ id: node.getAttribute('data-id'), x, y })
      }
      for (const point of candidates) for (const [dx, dy] of [[-2, 2], [2, 2], [-2, -2], [2, -2]]) {
        const x = point.x + dx * 30
        const y = point.y + dy * 30
        if (x <= surface.left || y <= surface.top || x >= surface.right || y >= surface.bottom) continue
        const end = document.elementFromPoint(x, y)
        if (end && !end.closest(`.react-flow__node,${controls}`)) return { ...point, dx, dy }
      }
      return null
    })
    if (!target) throw new Error('No hit-testable selection handle with a clear multi-drag drop point')
    const hit = await page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y)
      return element ? { tag: element.tagName, className: String(element.getAttribute('class') || ''), nodeId: element.closest('.react-flow__node')?.getAttribute('data-id') || null } : null
    }, target)
    const dragged = page.locator(`.react-flow__node[data-id="${target.id}"]`)
    const beforeTransform = await dragged.evaluate((element) => element.style.transform)
    const readGroups = () => page.evaluate(() => window.__noriProjection().nodes.filter((node) => node.type === 'group'))
    const groupsBefore = new Map((await readGroups()).map((node) => [node.id, node]))
    await page.mouse.move(target.x, target.y)
    const dragSavesFrom = saves.length
    await page.evaluate(() => window.__perfBegin())
    await page.mouse.down()
    for (let step = 1; step <= 30; step += 1) {
      await page.mouse.move(target.x + step * target.dx, target.y + step * target.dy)
      await raf(page)
    }
    await page.evaluate(() => window.__perfMark('drag-end'))
    await page.mouse.up()
    const afterTransform = await dragged.evaluate((element) => element.style.transform)
    if (afterTransform === beforeTransform) console.log('multi-drag-failure', JSON.stringify({ target, hit, selectedBefore: selected, selectedAfter: await page.locator('.react-flow__node.selected').count(), beforeTransform, afterTransform }))
    assert.notEqual(afterTransform, beforeTransform, 'Multi-selection drag must move the nodes')
    const afterSelection = await page.evaluate(() => window.__noriProjection().nodes.filter((node) => node.selected))
    const deltas = beforeSelection.map((before) => {
      const after = afterSelection.find((node) => node.id === before.id)
      return { id: before.id, dx: (after?.position.x ?? before.position.x) - before.position.x, dy: (after?.position.y ?? before.position.y) - before.position.y, mountedBeforeBox: preBoxMounted.has(before.id) }
    })
    const zoom = await zoomOf(page)
    // React Flow's default one-pixel nodeDragThreshold starts on the first
    // diagonal move without applying its position; later moves carry the drag.
    const expectedDelta = { x: target.dx * 29 / zoom, y: target.dy * 29 / zoom }
    for (const item of deltas) {
      assert.ok(Math.abs(item.dx - expectedDelta.x) < 0.1 && Math.abs(item.dy - expectedDelta.y) < 0.1, `Every selected node must move by the gesture delta: ${JSON.stringify(item)}`)
    }
    await page.waitForTimeout(1400)
    const operations = saves.slice(dragSavesFrom).flatMap((save) => save.operations)
    const geometry = operations.filter((operation) => operation.type === 'node.update_geometry' && !groupsBefore.has(operation.id))
    assert.deepEqual(new Set(geometry.map((operation) => operation.id)), new Set(beforeSelection.map((node) => node.id)), 'Multi-selection drag must save exactly the selected content node geometries')
    const savedPositions = new Map(geometry.map((operation) => [operation.id, operation.position]))
    for (const node of afterSelection) if (node.type !== 'group') assert.deepEqual(savedPositions.get(node.id), node.position, `${node.id}: saved position differs from the rendered graph`)
    const afterGroups = await readGroups()
    const groupWrites = operations.filter((op) => groupsBefore.has(op.id))
    const changedMembership = afterGroups.filter((node) =>
      JSON.stringify(node.memberIds) !== JSON.stringify(groupsBefore.get(node.id)?.memberIds))
    assert.deepEqual(new Set(groupWrites.filter((op) => op.type === 'node.upsert').map((op) => op.id)),
      new Set(changedMembership.map((node) => node.id)), 'only group nodes whose membership changed may require body updates')
    for (const group of afterGroups) {
      const before = groupsBefore.get(group.id)
      const writes = groupWrites.filter((op) => op.id === group.id)
      const expectedSize = { width: group.width, height: group.height }
      const moved = !before || before.position.x !== group.position.x || before.position.y !== group.position.y
      const resized = !before || before.width !== group.width || before.height !== group.height
      if (moved) assert.deepEqual(writes.findLast((op) => op.position)?.position, group.position, 'group position must persist')
      if (resized) assert.deepEqual(writes.findLast((op) => op.size)?.size, expectedSize, 'group size must persist')
      const upsert = writes.findLast((op) => op.type === 'node.upsert')
      if (upsert) {
        assert.equal(upsert.groupHasOnlyGroupFields, true, 'membership changes must not serialize any content body')
        assert.deepEqual(upsert.groupMembers, group.memberIds, 'group membership must persist')
      }
    }
    return { selected, deltas, savedGeometryIds: geometry.map((operation) => operation.id) }
  }))
  const emptyAfterDrag = await findEmptyPoint(page)
  await page.mouse.click(emptyAfterDrag.x, emptyAfterDrag.y)
  await page.waitForTimeout(500)
  phases.push(await phase('idle-after-drag', async () => { await page.waitForTimeout(2000); return {} }))

  phases.push(await phase('mention-at', async () => {
    const [target] = await pickNodes(page, 1, 'video')
    if (!target) return { skipped: 'no video node in viewport' }
    await page.mouse.click(target.x, target.y)
    await page.waitForTimeout(400)
    await page.mouse.click(target.x, target.y)
    await page.locator('.nori-canvas-generator').waitFor({ timeout: 8000 })
    const editor = page.locator('.nori-canvas-generator textarea').first()
    await editor.click()
    const typedAt = Date.now()
    await page.keyboard.type('@')
    await page.locator('[role="listbox"]').first().waitFor({ state: 'visible', timeout: 8000 })
    const listboxMs = Date.now() - typedAt
    await page.keyboard.press('Escape'); await page.keyboard.press('Backspace')
    const emptyAfterMention = await findEmptyPoint(page)
    await page.mouse.click(emptyAfterMention.x, emptyAfterMention.y)
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node.selected').length === 0 && !document.querySelector('.nori-canvas-generator'))
    return { nodeId: target.id, listboxMs }
  }))

  const hasHistory = graph.nodes.some((node) => node.type === 'video' && node.data?.history?.length)
  phases.push(await phase('open-history', async () => {
    if (!hasHistory) return { skipped: 'scenario has no generation history' }
    const [target] = await pickNodes(page, 1, 'video')
    if (!target) return { skipped: 'no video node in viewport' }
    await page.mouse.click(target.x, target.y)
    await page.locator(`.react-flow__node[data-id="${target.id}"].selected`).waitFor({ timeout: 8000 })
    const inline = page.locator('.nori-canvas-node-toolbar button[title="生成历史"]').first()
    const more = page.locator('.nori-canvas-node-toolbar button[title="更多操作"]').first()
    await more.or(inline).waitFor({ timeout: 8000 })
    const pendingHistory = process.env.PAN_HISTORY_RACE === '1' ? page.waitForRequest((request) => {
      const url = new URL(request.url())
      return url.pathname.includes('/canvas/canvas-1/nodes/') && url.searchParams.get('view') === 'history-v1'
    }, { timeout: 8000 }) : null
    // Avoid an unhandled timeout before the UI has opened the context menu.
    void pendingHistory?.catch(() => undefined)
    let clickedAt = Date.now()
    if (await inline.count()) await inline.click()
    else {
      await more.click()
      const item = page.locator('[role="menuitem"]', { hasText: '生成历史' }).first()
      try { await item.waitFor({ timeout: 5000 }) }
      catch (error) {
        console.log('history-menu-failure', JSON.stringify({
          menus: await page.evaluate(() => [...document.querySelectorAll('[role="menu"]')].map((element) => element.outerHTML)),
          buttons: await page.evaluate(() => [...document.querySelectorAll('.nori-canvas-node-toolbar button')].map((element) => ({ title: element.title, expanded: element.getAttribute('aria-expanded') }))),
        }))
        throw error
      }
      clickedAt = Date.now()
      await item.click()
    }
    await page.locator('.nori-canvas-history-dialog').waitFor({ state: 'visible', timeout: 10000 })
    const dialogMs = Date.now() - clickedAt
    if (pendingHistory) {
      try {
        await pendingHistory
        await page.evaluate(() => window.__noriPerf.switchCanvas('canvas-2'))
        await page.waitForFunction((count) => window.__noriProjection?.().nodes.length === count, switchGraph.nodes.length)
        assert.equal(await page.locator('.nori-canvas-history-dialog').count(), 0)
        historyGate.resolve()
        await page.waitForTimeout(600)
        assert.equal(await page.locator('.nori-canvas-history-dialog').count(), 0, 'late history must not reopen in the sibling canvas')
        await page.evaluate(() => window.__noriPerf.switchCanvas('canvas-1'))
        await page.waitForFunction((count) => window.__noriProjection?.().nodes.length === count, graph.nodes.length)
        return { nodeId: target.id, dialogMs, lateHistoryIsolated: true }
      } finally { historyGate.resolve() }
    }
    await page.waitForTimeout(400)
    const rows = await page.locator('.nori-canvas-history-dialog img, .nori-canvas-history-dialog video').count()
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    return { nodeId: target.id, dialogMs, mediaInDialog: rows }
  }))
  historyGate.resolve()

  // Canvas switches with GC: heap and DOM counters must not grow monotonically.
  let switching = null
  if (process.env.PAN_SWITCH !== '0') {
    const heap = []
    const counters = []
    const sample = async () => {
      await cdp.send('HeapProfiler.collectGarbage')
      heap.push(round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576, 1))
      const dom = await cdp.send('Memory.getDOMCounters')
      counters.push({ nodes: dom.nodes, listeners: dom.jsEventListeners, documents: dom.documents })
    }
    await sample()
    for (let round_ = 0; round_ < 6; round_ += 1) {
      const target = round_ % 2 === 0 ? 'canvas-2' : 'canvas-1'
      await page.evaluate((canvasId) => window.__noriPerf.switchCanvas(canvasId), target)
      await page.waitForFunction((expected) => document.querySelectorAll('.react-flow__node').length >= expected || Boolean(document.querySelector('[data-canvas-overview]')), Math.min(8, expectedMounted(target === 'canvas-2' ? switchGraph : graph)), { timeout: 30000 }).catch(() => failures.push(`switch to ${target} did not render`))
      await settleViewport(page, 300, 2000)
      await page.waitForTimeout(500)
      await sample()
    }
    switching = { heapMiB: heap, domCounters: counters, heapGrowthMiB: round(heap[heap.length - 1] - heap[1]), switches: 6 }
  }

  const soakSeconds = Number(process.env.PAN_SOAK_SECONDS || 0)
  let soak = null
  if (soakSeconds > 0) {
    await cdp.send('HeapProfiler.collectGarbage')
    const heapBefore = (await cdp.send('Runtime.getHeapUsage')).usedSize
    phases.push(await phase('soak', async () => {
      const startedAt = Date.now()
      let loops = 0
      const start = await findEmptyPoint(page)
      while (Date.now() - startedAt < soakSeconds * 1000) {
        await page.mouse.move(start.x, start.y)
        await page.mouse.down({ button: 'middle' })
        for (let step = 0; step < 40; step += 1) { await page.mouse.move(start.x + Math.cos(step / 6) * 120 - 120, start.y + Math.sin(step / 6) * 60); await raf(page) }
        await page.mouse.up({ button: 'middle' })
        await page.mouse.wheel(0, loops % 2 === 0 ? -100 : 100); await raf(page)
        loops += 1
      }
      return { loops }
    }))
    await cdp.send('HeapProfiler.collectGarbage')
    soak = { heapBeforeMiB: round(heapBefore / 1048576, 1), heapAfterMiB: round((await cdp.send('Runtime.getHeapUsage')).usedSize / 1048576, 1), seconds: soakSeconds }
  }

  await page.waitForTimeout(2500)
  let recovery = null
  if (process.env.PAN_RECOVERY === '1') {
    try {
      await page.reload()
      await measureOpen(page, graph, [])
      const [target] = await pickNodes(page, 1, 'media')
      assert.ok(target, 'The recovery fixture needs a visible draggable node')
      const readPosition = () => page.evaluate((id) =>
        window.__noriProjection().nodes.find((node) => node.id === id)?.position, target.id)
      const before = await readPosition()
      rejectWrites = true
      await context.setOffline(true)
      await page.mouse.move(target.x, target.y)
      await page.mouse.down()
      await page.mouse.move(target.x + 50, target.y + 20, { steps: 12 })
      await page.mouse.up()
      const after = await readPosition()
      assert.notDeepEqual(after, before)
      const readJournal = () => page.evaluate((id) => new Promise((resolve) => {
        const request = indexedDB.open('nori-canvas-offline-v1', 1)
        request.onerror = () => resolve(false)
        request.onsuccess = () => {
          const db = request.result
          if (!db.objectStoreNames.contains('pending_documents')) { db.close(); resolve(false); return }
          const rows = db.transaction('pending_documents', 'readonly').objectStore('pending_documents').getAll()
          rows.onsuccess = () => {
            db.close()
            resolve(rows.result.find((draft) => draft.schema_version === 2 && draft.pendingOps.some((op) => op.id === id)) || false)
          }
          rows.onerror = () => { db.close(); resolve(false) }
        }
      }), target.id)
      const journalDeadline = Date.now() + 5000
      let journal = await readJournal()
      while (!journal && Date.now() < journalDeadline) {
        await page.waitForTimeout(100)
        journal = await readJournal()
      }
      assert.ok(journal?.document, 'Offline geometry journal must be present in IndexedDB')
      assert.deepEqual(journal.document.nodes, [])
      assert.deepEqual(journal.document.edges, [])
      // Prevent the original page's online listener from flushing before the reload.
      await context.setOffline(false)
      await page.reload()
      await page.getByRole('dialog', { name: '恢复本地未同步画布' }).waitFor()
      const saveFrom = saves.length
      rejectWrites = false
      await page.getByRole('button', { name: '恢复本地', exact: true }).click()
      await page.waitForFunction(({ id, after }) => {
        const selected = window.__noriProjection?.().nodes.find((node) => node.id === id)?.position
        return selected?.x === after.x && selected?.y === after.y
      }, { id: target.id, after })
      const deadline = Date.now() + 5000
      while (saves.length === saveFrom && Date.now() < deadline) await page.waitForTimeout(50)
      const replay = saves.slice(saveFrom).flatMap((save) => save.operations)
      assert.deepEqual(replay.filter((op) => op.type !== 'canvas.update_meta').map(({ id, type, position }) => ({ id, type, position })),
        [{ id: target.id, type: 'node.update_geometry', position: after }])
      recovery = { passed: true, operationKinds: replay.map((op) => op.type) }
    } catch (error) {
      failures.push(`offline-recovery: ${error.message.split('\n')[0]}`)
    } finally {
      rejectWrites = false
      await context.setOffline(false)
    }
  }
  const contentSaves = saves.filter((save) => Object.keys(save.ops).some((kind) => kind !== 'canvas.update_meta'))
  const dragSaveOperations = phases.filter((item) => ['drag-single', 'drag-multi', 'idle-after-drag'].includes(item.name)).flatMap((item) => item.operations || [])
  const unexpectedDragUpserts = dragSaveOperations.filter((operation) => operation.type === 'node.upsert' && !operation.groupHasOnlyGroupFields)
  if (unexpectedDragUpserts.length) failures.push(`drag saved whole nodes: ${unexpectedDragUpserts.map((operation) => `${operation.id} [${(operation.dataKeys || []).join(',')}]`).join('; ')}`)
  for (const save of contentSaves) {
    if (save.kind !== 'ops') failures.push(`content gesture used full-document ${save.kind} save`)
    for (const operation of save.operations || []) {
      if (operation.type === 'node.update_geometry') assert.ok(operation.position || operation.size, 'geometry operation must carry local geometry')
    }
  }
  const structuralSaves = contentSaves.map((save) => ({ kind: save.kind, bytes: save.bytes, ops: save.ops }))
  if (!viewportSaves.length) failures.push('viewport-only gestures never produced a canvas.update_meta save')
  const finalState = { viewportSaves: viewportSaves.length, viewportSaveSyncMsP50: round(quantile(viewportSaves.map((item) => item.syncMs), 0.5), 2), viewportSaveSyncMsP95: round(quantile(viewportSaves.map((item) => item.syncMs), 0.95), 2), viewportSaveMaxBytes: Math.max(0, ...viewportSaves.map((item) => item.bytes)), saves: saves.length, saveBytes: sum(saves.map((item) => item.bytes)), saveKinds: saves.reduce((kinds, item) => { kinds[item.kind] = (kinds[item.kind] || 0) + 1; return kinds }, {}) }
  await page.screenshot({ path: path.join(artifacts, `scenario-${entry.label}.png`) })
  await context.close()

  return {
    scenario: entry.label, run: runIndex + 1, errors, failures, structural, activation,
    open: { cold, warm, canvasGets: coldGets },
    initialZoom: round(initialZoom, 3), selected: entry.selected, minimap: entry.minimap,
    phases, switching, soak, recovery, contentSaves: structuralSaves, totals: finalState,
  }
}

function aggregate(entry, stats, runs) {
  const names = runs[0].phases.map((item) => item.name)
  const phases = Object.fromEntries(names.map((name) => {
    const items = runs.map((run) => run.phases.find((item) => item.name === name))
    return [name, {
      p95Median: round(median(items.map((item) => item.p95))), p95Runs: items.map((item) => item.p95),
      p50Median: round(median(items.map((item) => item.p50))), maxMedian: round(median(items.map((item) => item.max))),
      over50RatioMedian: round(median(items.map((item) => item.over50Ratio)), 4),
      mainBusyMsMedian: round(median(items.map((item) => item.mainBusyMs)), 0),
      saves: round(median(items.map((item) => item.saves)), 0), saveBytes: round(median(items.map((item) => item.saveBytes)), 0),
    }]
  }))
  return {
    scenario: entry.label, stats, runs: runs.length,
    openColdOperableMs: round(median(runs.map((run) => run.open.cold.firstOperableMs))),
    openWarmOperableMs: round(median(runs.map((run) => run.open.warm.firstOperableMs))),
    openColdPosterMs: round(median(runs.map((run) => run.open.cold.firstPosterMs))),
    canvasGetGzipBytes: runs[0].open.canvasGets[0]?.gzipBytes, canvasGetDecodedBytes: runs[0].open.canvasGets[0]?.decodedBytes,
    viewportSaveSyncMsP50: round(median(runs.map((run) => run.totals.viewportSaveSyncMsP50)), 2),
    viewportSaveSyncMsP95: round(quantile(runs.map((run) => run.totals.viewportSaveSyncMsP95), 0.95), 2),
    domAtOpen: { nodes: runs[0].open.cold.reactFlowNodes, edges: runs[0].open.cold.reactFlowEdges, edgePaths: runs[0].open.cold.edgePaths },
    phases,
  }
}

function summariseProfile(profile) {
  const byId = new Map(profile.nodes.map((node) => [node.id, node]))
  const self = new Map()
  profile.samples.forEach((id, index) => self.set(id, (self.get(id) || 0) + (profile.timeDeltas[index] || 0)))
  const key = (node) => `${node.callFrame.functionName || '(anon)'} ${node.callFrame.url.split('/').pop()}:${node.callFrame.lineNumber}`
  const selfByKey = {}
  const inclusiveByKey = {}
  const inclusive = (node) => {
    let total = self.get(node.id) || 0
    for (const childId of node.children || []) total += inclusive(byId.get(childId))
    const k = key(node)
    inclusiveByKey[k] = (inclusiveByKey[k] || 0) + total
    return total
  }
  for (const node of profile.nodes) selfByKey[key(node)] = (selfByKey[key(node)] || 0) + (self.get(node.id) || 0)
  inclusive(profile.nodes[0])
  const top = (table, count) => Object.entries(table).sort((a, b) => b[1] - a[1]).slice(0, count).map(([name, value]) => [name, round(value / 1000, 0)])
  return { selfTop: top(selfByKey, 14), inclusiveTop: top(inclusiveByKey, 40) }
}

function summariseTrace(trace) {
  const events = Array.isArray(trace) ? trace : trace.traceEvents
  const threads = new Map()
  const processes = new Map()
  for (const event of events) {
    if (event.ph === 'M' && event.name === 'thread_name') threads.set(`${event.pid}:${event.tid}`, event.args.name)
    if (event.ph === 'M' && event.name === 'process_name') processes.set(event.pid, event.args.name)
  }
  const busy = {}
  const named = {}
  for (const event of events) {
    if (event.ph !== 'X' || typeof event.dur !== 'number') continue
    const thread = `${processes.get(event.pid) || event.pid}/${threads.get(`${event.pid}:${event.tid}`) || event.tid}`
    if (event.name === 'ThreadControllerImpl::RunTask' || event.name === 'ThreadControllerImpl::DoWork' || event.name === 'RunTask') busy[thread] = (busy[thread] || 0) + event.dur
    if (['RasterTask', 'ImageDecodeTask', 'GpuRasterTask', 'Paint', 'PrePaint', 'Layerize', 'UpdateLayoutTree', 'Layout', 'Commit', 'DrawFrame', 'FunctionCall', 'RunMicrotasks', 'DisplayItemList::Raster', 'Decode Image', 'Draw LazyPixelRef'].includes(event.name)) named[event.name] = (named[event.name] || 0) + event.dur
  }
  const top = Object.entries(busy).filter(([, value]) => value > 5000).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => [name, round(value / 1000, 0)])
  return { busyMsByThread: top, namedMs: Object.fromEntries(Object.entries(named).map(([name, value]) => [name, round(value / 1000, 0)])) }
}

const scenarios = readScenarios()
const results = { env: null, scenarios: [] }
const budgetPhases = ['pan', 'wheel-zoom', 'viewport-controls', 'drag-single', 'drag-multi']
const budgetViolations = []
try {
  let gpuInfo = null
  if (gpu) {
    const session = await browser.newBrowserCDPSession()
    const info = await session.send('SystemInfo.getInfo')
    gpuInfo = { features: info.gpu.featureStatus, renderer: info.gpu.devices?.[0]?.deviceString }
  }
  results.env = {
    chrome: browser.version(), node: process.version, platform: `${os.platform()} ${os.release()} ${os.arch()}`,
    cpu: os.cpus()[0]?.model, cpuCores: os.cpus().length, gpuMode: gpu ? 'metal' : 'swiftshader', gpu: gpuInfo,
    viewport: `${VIEWPORT.width}x${VIEWPORT.height}`, deviceScaleFactor: DEVICE_SCALE, cpuThrottle: cpuRate,
    reactBuild: process.env.PAN_DEV ? 'development' : 'production', runsPerScenario, frameBudgetMs,
  }
  results.env.appCssSha256 = appCssSha256
  console.log(JSON.stringify({ env: results.env }))

  for (const entry of scenarios) {
    const graph = buildScaleGraph(entry.graphConfig)
    const stats = graphStats(graph)
    const rawGraph = Buffer.from(JSON.stringify(graph))
    const switchGraph = buildScaleGraph('small-40')
    switchGraph.canvas = { ...switchGraph.canvas, id: 'canvas-2', title: '切换对照' }
    switchGraph.nodes = switchGraph.nodes.map((node) => ({ ...node, canvasId: 'canvas-2' }))
    switchGraph.edges = switchGraph.edges.map((edge) => ({ ...edge, canvasId: 'canvas-2' }))
    console.log(JSON.stringify({ scenario: entry.label, stats: { ...stats, bounds: undefined } }))
    const runs = []
    for (let runIndex = 0; runIndex < runsPerScenario; runIndex += 1) {
      const run = await runOnce(entry, graph, rawGraph, switchGraph, runIndex)
      runs.push(run)
      console.log(JSON.stringify(run))
      for (const item of run.phases.filter((phase) => budgetPhases.includes(phase.name) && phase.frames > 0)) {
        if (item.p95 > frameBudgetMs || item.over50Ratio > 0.01) budgetViolations.push(`${entry.label} run ${run.run} ${item.name}: p95 ${item.p95} ms, >50ms ${(item.over50Ratio * 100).toFixed(2)}%`)
      }
    }
    const summary = aggregate(entry, { ...stats, bounds: undefined }, runs)
    console.log(JSON.stringify({ aggregate: summary }))
    results.scenarios.push({ ...summary, runDetails: runs })
  }
  await writeFile(path.join(artifacts, process.env.PAN_OUT || 'results.json'), JSON.stringify(results, null, 2))
  if (process.env.PAN_ASSERT) {
    for (const scenario of results.scenarios) {
      for (const run of scenario.runDetails) {
        assert.equal(run.errors.length, 0, `${scenario.scenario} page errors: ${run.errors.join('; ')}`)
        assert.equal(run.failures.length, 0, `${scenario.scenario} structural failures: ${run.failures.join('; ')}`)
      }
    }
  }
  if (process.env.PAN_BUDGET) assert.equal(budgetViolations.length, 0, `Frame budget exceeded:\n${budgetViolations.join('\n')}`)
  console.log(budgetViolations.length ? `budget report: ${budgetViolations.length} violation(s)\n${budgetViolations.join('\n')}` : 'budget report: within budget')
  console.log('status passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
