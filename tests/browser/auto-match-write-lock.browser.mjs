// Actual CanvasGraph with synthetic, local-only API responses.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createInterface } from 'node:readline'

const require = createRequire(path.resolve(process.env.NORI_BROWSER_TOOLS_DIR || '.', 'package.json'))
const { chromium } = require('playwright-core')
const demo = spawn(process.execPath, ['--import', 'tsx', 'tests/browser/canvas-demo.mjs'], {
  env: { ...process.env, NORI_DEMO_PORT: '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
})
const lines = createInterface({ input: demo.stdout })
let browser
try {
  const base = await new Promise((resolve, reject) => {
    lines.on('line', (line) => {
      const match = /^Canvas demo ready: (http:\/\/127\.0\.0\.1:\d+)$/.exec(line)
      if (match) resolve(match[1])
    })
    demo.once('error', reject)
    demo.once('exit', (code) => reject(new Error(`Canvas demo exited: ${code}`)))
  })
  const graphPath = '/api/projects/project-1/canvas/canvas-1'
  const initialGraph = await (await fetch(new URL(graphPath, base))).json()
  browser = await chromium.launch({ executablePath: process.env.NORI_BROWSER_EXECUTABLE_PATH })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await page.clock.install()
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === base) return route.fallback()
    return route.abort()
  })
  // Model a response that reaches JS even when the client aborts the request.
  await page.addInitScript(() => {
    const fetchOriginal = window.fetch.bind(window)
    window.fetch = (input, init) => {
      const url = new URL(input instanceof Request ? input.url : input, location.href)
      if (url.pathname === '/api/frameos/materials' && url.searchParams.get('scope') === 'current-project') {
        return fetchOriginal(input, { ...init, signal: undefined })
      }
      return fetchOriginal(input, init)
    }
  })
  const writes = []
  page.on('request', (request) => {
    if (request.method() !== 'GET' && /\/canvas\/canvas-1(?:\/ops|\/document)?$/.test(new URL(request.url()).pathname)) {
      writes.push(request.url())
    }
  })
  const materials = (url) => url.pathname === '/api/frameos/materials' && url.searchParams.get('scope') === 'current-project'
  const sync = '**/api/projects/project-1/canvas/canvas-1/production-sync'
  const pendingMaterials = Promise.withResolvers()
  const pendingSync = Promise.withResolvers()
  await page.route(materials, (route) => { pendingMaterials.resolve(route) }, { times: 1 })
  await page.route(sync, (route) => { pendingSync.resolve(route) }, { times: 1 })
  await page.goto(base)
  await page.getByRole('button', { name: '收起', exact: true }).click()

  const match = page.getByRole('button', { name: '一键匹配引用' })
  const nodes = page.locator('.react-flow__node')
  const edges = page.locator('.react-flow__edge')
  const undo = page.getByRole('button', { name: '撤销', exact: true })
  const lock = page.locator('.nori-canvas-sync-lock')
  await Promise.all([page.waitForRequest((request) => materials(new URL(request.url()))), match.click()])
  const [materialRoute] = await Promise.all([pendingMaterials.promise, match.getByText('匹配中…').waitFor()])
  const graphState = async () => ({
    nodes: await nodes.evaluateAll((items) => items.map((item) => item.dataset.id)),
    edges: await edges.evaluateAll((items) => items.map((item) => item.dataset.id)),
    undoDisabled: await undo.isDisabled(),
  })
  await page.getByTitle('画布工具与历史版本').click()
  await Promise.all([
    page.waitForRequest((request) => new URL(request.url()).pathname.endsWith('/production-sync')),
    page.getByRole('button', { name: '同步作品', exact: true }).click(),
  ])
  await lock.waitFor()
  const syncRoute = await pendingSync.promise
  const before = await graphState()
  const writeCount = writes.length
  const lateResponse = page.waitForResponse((response) => materials(new URL(response.url())))
  await materialRoute.fulfill({ response: await materialRoute.fetch() })
  assert.equal(await (await lateResponse).finished(), null)

  // Keep the lock held while the response is processed and autosave can run.
  await page.clock.runFor(1600)
  assert.equal(await lock.isVisible(), true)
  assert.deepEqual(await graphState(), before)
  assert.equal(writes.length, writeCount)

  // Release the lock without replacing the graph. The same match must work.
  await syncRoute.fulfill({ status: 500, json: { message: 'Fixture: release sync lock' } })
  await lock.waitFor({ state: 'hidden' })
  assert.deepEqual(await graphState(), before)
  await match.click()
  await page.getByText(/已匹配 \d+ 个资产，新连线 [1-9]\d* 条/).waitFor()
  assert.ok(await nodes.count() > before.nodes.length)
  assert.ok(await edges.count() > before.edges.length)
  assert.deepEqual(errors, [])
  console.log('PASS: production sync blocks a late match; retry after unlocking writes nodes and edges')

  const limited = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  limited.on('pageerror', (error) => errors.push(error.message))
  await limited.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === base) return route.fallback()
    return route.abort()
  })
  await limited.route(`**${graphPath}`, async (route) => {
    const graph = structuredClone(initialGraph)
    graph.nodes.find((node) => node.id === 'gen-1').data.prompt = 'İİİ“林夏”之后，雨夜街巷、山顶日出、油纸伞。'
    graph.nodes.find((node) => node.id === 'ref-2').data.materialId = 'library-prop-2'
    graph.nodes.push(...Array.from({ length: 999 - graph.nodes.length }, (_, index) => ({
      id: `filler-${index}`, canvasId: 'canvas-1', type: 'text', status: 'IDLE',
      position: { x: 3000 + 300 * (index % 30), y: 3000 + 200 * Math.floor(index / 30) },
      size: { width: 200, height: 100 }, data: { title: 'Synthetic note' },
    })))
    await route.fulfill({ json: graph })
  }, { times: 1 })
  await limited.goto(base)
  await limited.getByRole('button', { name: '收起', exact: true }).click()
  const limitedNodes = limited.locator('.react-flow__node')
  const limitedEdges = limited.locator('.react-flow__edge')
  const limitedMatch = limited.getByRole('button', { name: '一键匹配引用' })
  const ids = (locator) => locator.evaluateAll((items) => items.map((item) => item.dataset.id))
  await limited.locator('.react-flow__node[data-id="ref-2"]').waitFor()
  const priorNodes = await ids(limitedNodes)
  const priorEdges = await ids(limitedEdges)
  assert.equal(priorNodes.length, 999)
  await limitedMatch.click()
  await limited.getByText('已匹配 2 个资产，新连线 2 条（1 个因画布节点已满跳过）').waitFor()
  assert.equal(await limitedNodes.count(), 1000)
  assert.equal(await limitedEdges.count(), priorEdges.length + 2)
  await limitedMatch.click()
  await limited.getByText('已有 2 个匹配资产在引用中（1 个因画布节点已满跳过）').waitFor()
  await limited.getByRole('button', { name: '撤销', exact: true }).click()
  await limitedEdges.nth(priorEdges.length).waitFor({ state: 'detached' })
  assert.deepEqual(errors, [])
  await limitedNodes.nth(priorNodes.length - 1).waitFor({ state: 'attached' })
  await limitedEdges.nth(priorEdges.length - 1).waitFor({ state: 'attached' })
  assert.deepEqual(await ids(limitedNodes), priorNodes)
  assert.deepEqual(await ids(limitedEdges), priorEdges)
  console.log('PASS: the last slot is used, an existing source is reused, quoted text is ignored, and one undo restores the graph')
} finally {
  await browser?.close()
  lines.close()
  demo.kill()
}
