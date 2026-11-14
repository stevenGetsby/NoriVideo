// Real CanvasGraph + application CSS with a media-heavy canvas (large JPEGs and
// 720p clips). Every API is mocked locally: no paid model calls, no prod data.
// Measures main-thread cost while the canvas is panned with the middle button.
//   PAN_SCENARIOS  JSON array of { nodes, selected, minimap, zoom, videoRatio }
//   PAN_GPU=metal  use the real GPU instead of SwiftShader
//   PAN_DEV=1      development React build so the Profiler reports commit counts
//   PAN_TRACE=1    also record a Chrome trace and report per-thread busy time
//   PAN_ASSERT=1   fail when the pan budget below is exceeded (regression mode)
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const sharp = (await import('sharp')).default
const artifacts = path.join(root, 'test-results/canvas-pan-performance')
await mkdir(artifacts, { recursive: true })

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
  define: { 'process.env.NODE_ENV': process.env.PAN_DEV ? '"development"' : '"production"', 'process.env': '{}' },
  minify: process.env.PAN_MINIFY !== '0',
  keepNames: true,
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

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname.startsWith('/img/')) {
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
const canvasRecord = (viewport) => ({ id: 'canvas-1', projectId: 'project-1', title: '拖动性能', revision: 0, viewport, themeColor: null, visibility: 'workspace', forkedFromId: null, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z' })
const common = { canvasId: 'canvas-1', runId: null, mediaObjectId: null, parentNodeId: null }

function buildGraph({ nodes: count, videoRatio = 0.25, zoom = 0.6 }) {
  const columns = Math.max(4, Math.ceil(Math.sqrt(count * 1.6)))
  const nodes = []
  const edges = []
  let firstVideo = null
  let previousImages = []
  for (let i = 0; i < count; i += 1) {
    const column = i % columns
    const row = Math.floor(i / columns)
    const position = { x: column * 380, y: 260 + row * 260 }
    const isText = i % 10 === 9
    const isVideo = !isText && (i % Math.round(1 / videoRatio) === Math.round(1 / videoRatio) - 1)
    const id = isVideo && firstVideo === null ? 'gen-1' : `node-${i}`
    if (isText) {
      nodes.push({ ...common, id, type: 'text', position, size: { width: 320, height: 180 }, status: 'IDLE', taskId: null, data: { title: `文本${i}`, mediaType: 'text', origin: 'manual', text: `分镜说明 ${i}：夜晚的街道，霓虹灯映在雨后的路面上。`.repeat(3) } })
    } else if (isVideo) {
      if (firstVideo === null) firstVideo = id
      const poster = `/img/${i}.jpg?n=${i}`
      nodes.push({ ...common, id, type: 'video', position, size: { width: 320, height: 180 }, status: 'SUCCEEDED', taskId: null, data: { title: `视频${i}`, mediaType: 'video', origin: 'generate', prompt: '雨夜街头的镜头推进', videoUrl: `images/pan-${i}.mp4`, contentUrl: `images/pan-${i}.mp4`, imageUrl: poster, generation: { modelKey: model.modelKey }, history: [] } })
      for (const source of previousImages.slice(-2)) edges.push({ id: `edge-${source}-${id}`, canvasId: 'canvas-1', sourceNodeId: source, targetNodeId: id, sourceHandle: 'output', targetHandle: 'input', role: 'INPUT_DEFAULT' })
    } else {
      const url = `/img/${i}.jpg?n=${i}`
      nodes.push({ ...common, id, type: 'image', position, size: { width: 320, height: 180 }, status: 'IDLE', taskId: null, data: { title: `素材${i}`, mediaType: 'image', origin: 'upload', contentUrl: url, imageUrl: url, materialId: `material-${i}` } })
      previousImages.push(id)
    }
  }
  return { canvas: canvasRecord({ x: 30, y: 90, zoom }), edges, nodes }
}

async function findEmptyPoint(page) {
  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect()
    if (!pane) return null
    for (let y = pane.y + 90; y < pane.y + pane.height - 40; y += 24) {
      for (let x = pane.x + 60; x < pane.x + pane.width - 60; x += 40) {
        const element = document.elementFromPoint(x, y)
        if (element && !element.closest('.react-flow__node, .nori-canvas-generator, .react-flow__minimap, .nori-canvas-viewport-controls, .nori-canvas-dialog, .nori-canvas-chrome, .nori-canvas-tool-rail, header, [role="menu"]') && element.closest('.react-flow__pane, .react-flow__renderer')) return { x, y }
      }
    }
    return null
  })
  assert.ok(point, 'The canvas must expose an empty point for the pan gesture')
  return point
}

const quantile = (values, q) => {
  if (!values.length) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
}
const round = (value, digits = 1) => Math.round(value * 10 ** digits) / 10 ** digits

async function runScenario(scenario) {
  const graph = buildGraph(scenario)
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 })
  const page = await context.newPage()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (!url.pathname.startsWith('/api/') || url.pathname === '/api/storage/sign') return route.continue()
    let payload
    if (url.pathname.endsWith('/generation-config')) payload = { textModels: [], imageModels: [], videoModels: [model], audioModels: [], model3dModels: [], defaults: { videoModel: model.modelKey, aspectRatio: '16:9', resolution: '720p' } }
    else if (url.pathname.endsWith('/generation-quote')) payload = { points: 20, costCny: 0.2 }
    else if (url.pathname.endsWith('/balance')) payload = { balancePoints: 1000, generationAllowed: true, dailyLimitPoints: null, dailyUsedPoints: 0, dailyLimitExceeded: false }
    else if (url.pathname.endsWith('/toolbox/assets')) payload = { assets: [] }
    else if (url.pathname.endsWith('/operations')) payload = { engines: [], latestTask: null, latestTaskLinks: null }
    else if (url.pathname.endsWith('/studio-document')) payload = { studioDocument: null }
    else if (url.pathname.includes('/canvas/canvas-1')) payload = graph
    else payload = { voices: [], materials: [], projects: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
  await page.goto(`${base}/`)
  await page.waitForFunction((expected) => document.querySelectorAll('.react-flow__node').length >= expected, Math.min(graph.nodes.length, 8), { timeout: 30000 })
  await page.locator('.nori-canvas-sync-lock').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await page.waitForFunction(() => [...document.images].every((image) => image.complete) && [...document.querySelectorAll('video')].every((v) => v.readyState >= 1 || v.error), null, { timeout: 45000 }).catch(() => {})
  await page.waitForTimeout(1200)

  if (scenario.minimap) await page.getByRole('button', { name: /小地图/ }).first().click().catch(() => {})
  if (scenario.selected) {
    const handle = page.locator('.react-flow__node[data-id="gen-1"] .nori-canvas-node-drag-handle').first()
    await handle.click()
    await page.waitForTimeout(400)
    await handle.click()
    await page.locator('.nori-canvas-generator').waitFor({ timeout: 8000 })
  } else {
    const point = await findEmptyPoint(page)
    await page.mouse.click(point.x, point.y)
  }
  await page.waitForTimeout(800)

  const cdp = await context.newCDPSession(page)
  await cdp.send('Performance.enable')
  const readMetrics = async () => Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map((metric) => [metric.name, metric.value]))
  await page.evaluate(() => {
    const state = { frames: [], loaf: [], longtasks: [], mutations: 0, stop: false }
    window.__pan = state
    let last = performance.now()
    const tick = (time) => { state.frames.push(time - last); last = time; if (!state.stop) requestAnimationFrame(tick) }
    requestAnimationFrame(tick)
    try {
      new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) state.loaf.push({
          duration: entry.duration, blocking: entry.blockingDuration,
          script: entry.scripts.reduce((sum, script) => sum + script.duration, 0),
          layout: entry.scripts.reduce((sum, script) => sum + script.forcedStyleAndLayoutDuration, 0),
          render: entry.startTime + entry.duration - entry.renderStart,
        })
      }).observe({ type: 'long-animation-frame', buffered: false })
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) state.longtasks.push(entry.duration) }).observe({ entryTypes: ['longtask'] })
    } catch {}
    state.mutationKinds = {}
    new MutationObserver((records) => {
      state.mutations += records.length
      for (const record of records) {
        const target = record.target
        const element = target.nodeType === 1 ? target : target.parentElement
        const area = element?.closest?.('.react-flow__node') ? 'node' : element?.closest?.('.react-flow__edges, .react-flow__edge') ? 'edge' : element?.closest?.('.nori-canvas-generator') ? 'generator' : element?.closest?.('.react-flow__viewport') ? 'viewport' : 'chrome'
        const label = `${area} ${element?.tagName?.toLowerCase() || '?'}.${String(element?.getAttribute?.('class') || '').split(/\s+/).filter(Boolean).slice(0, 2).join('.')}:${record.type}${record.attributeName ? `:${record.attributeName}` : ''}`
        state.mutationKinds[label] = (state.mutationKinds[label] || 0) + 1
      }
    }).observe(document.body, { subtree: true, attributes: true, childList: true, characterData: true })
  })

  const start = await findEmptyPoint(page)
  const transformBefore = await page.locator('.react-flow__viewport').first().evaluate((element) => element.style.transform)
  if (process.env.PAN_TRACE) await browser.startTracing(page, { path: path.join(artifacts, 'trace.json'), categories: ['toplevel', 'devtools.timeline', 'disabled-by-default-devtools.timeline', 'cc', 'gpu', 'viz', 'blink'] })
  if (process.env.PAN_PROFILE) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start') }
  const before = await readMetrics()
  const commitsBefore = await page.evaluate(() => window.__reactCommits.length)
  const startedAt = Date.now()
  await page.mouse.move(start.x, start.y)
  await page.mouse.down({ button: 'middle' })
  const steps = scenario.steps || 150
  for (let step = 0; step < steps; step += 1) {
    const angle = step / 18
    await page.mouse.move(start.x + Math.cos(angle) * 160 - 160, start.y + Math.sin(angle) * 80)
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())))
  }
  await page.mouse.up({ button: 'middle' })
  const elapsed = Date.now() - startedAt
  const after = await readMetrics()
  const commitDurations = await page.evaluate((from) => window.__reactCommits.slice(from), commitsBefore)
  let profile = null
  if (process.env.PAN_PROFILE) profile = summariseProfile((await cdp.send('Profiler.stop')).profile)
  let trace = null
  if (process.env.PAN_TRACE) {
    const buffer = await browser.stopTracing()
    trace = summariseTrace(JSON.parse(buffer.toString()))
  }
  const result = await page.evaluate(() => { window.__pan.stop = true; return window.__pan })
  const transformAfter = await page.locator('.react-flow__viewport').first().evaluate((element) => element.style.transform)
  assert.notEqual(transformAfter, transformBefore, 'Middle-button drag must pan the canvas')

  const frames = result.frames.slice(2)
  const summary = {
    scenario: JSON.stringify(scenario),
    nodes: graph.nodes.length, domNodes: after.Nodes,
    elapsedMs: elapsed, moves: steps,
    frameAvg: round(frames.reduce((sum, value) => sum + value, 0) / Math.max(1, frames.length)),
    frameP95: round(quantile(frames, 0.95)), frameMax: round(Math.max(0, ...frames)),
    slowFrames: frames.filter((value) => value > 34).length, frameCount: frames.length,
    mainBusyMs: round((after.TaskDuration - before.TaskDuration) * 1000, 0),
    scriptMs: round((after.ScriptDuration - before.ScriptDuration) * 1000, 0),
    layoutMs: round((after.LayoutDuration - before.LayoutDuration) * 1000, 0),
    styleMs: round((after.RecalcStyleDuration - before.RecalcStyleDuration) * 1000, 0),
    styleRecalcs: after.RecalcStyleCount - before.RecalcStyleCount,
    layouts: after.LayoutCount - before.LayoutCount,
    longTasks: result.longtasks.length, longTaskMs: round(result.longtasks.reduce((sum, value) => sum + value, 0), 0),
    loafs: result.loaf.length, loafMs: round(result.loaf.reduce((sum, entry) => sum + entry.duration, 0), 0),
    loafScriptMs: round(result.loaf.reduce((sum, entry) => sum + entry.script, 0), 0),
    loafRenderMs: round(result.loaf.reduce((sum, entry) => sum + entry.render, 0), 0),
    reactCommits: commitDurations.length, reactCommitMs: round(commitDurations.reduce((sum, value) => sum + value, 0), 0),
    mutations: result.mutations,
    mutationAreas: Object.entries(Object.entries(result.mutationKinds).reduce((areas, [label, count]) => { const area = label.split(' ')[0]; areas[area] = (areas[area] || 0) + count; return areas }, {})),
    mutationKinds: Object.entries(result.mutationKinds).sort((a, b) => b[1] - a[1]).slice(0, 12),
    ...(profile ? { profile } : {}),
    ...(trace ? { trace } : {}),
    errors,
  }
  await page.screenshot({ path: path.join(artifacts, `scenario-${graph.nodes.length}${scenario.selected ? '-selected' : ''}.png`) })
  await context.close()
  return summary
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
    if (!node.__counted) inclusiveByKey[k] = (inclusiveByKey[k] || 0) + total
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

const defaults = [
  { nodes: 20 }, { nodes: 60 }, { nodes: 120 },
  { nodes: 60, selected: true }, { nodes: 120, selected: true },
]
const scenarios = process.env.PAN_SCENARIOS ? JSON.parse(process.env.PAN_SCENARIOS) : defaults
const results = []
try {
  if (gpu) {
    const session = await browser.newBrowserCDPSession()
    const info = await session.send('SystemInfo.getInfo')
    console.log(JSON.stringify({ gpuFeatures: info.gpu.featureStatus, renderer: info.gpu.devices?.[0]?.deviceString }))
  }
  for (const scenario of scenarios) {
    const summary = await runScenario(scenario)
    results.push(summary)
    console.log(JSON.stringify(summary))
  }
  await writeFile(path.join(artifacts, 'results.json'), JSON.stringify(results, null, 2))
  if (process.env.PAN_ASSERT) {
    for (const summary of results) {
      assert.equal(summary.errors.length, 0, `page errors: ${summary.errors.join('; ')}`)
    }
  }
  console.log('status passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
