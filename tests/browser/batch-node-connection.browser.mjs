// Actual CanvasGraph + React Flow, mocked local persistence. No paid calls.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/batch-node-connection')
await mkdir(artifacts, { recursive: true })
let globalCss
if (process.env.NORI_BROWSER_GLOBAL_CSS_PATH) globalCss = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH, 'utf8')
else {
  const workspace = new URL('http://127.0.0.1:3000')
  const html = await (await fetch(new URL('/zh/auth/signin', workspace))).text()
  const styles = [...html.matchAll(/<link\b[^>]*>/g)].filter(([tag]) => tag.includes('rel="stylesheet"'))
    .map(([tag]) => tag.match(/href="([^"]+)"/)?.[1]).filter((href) => href?.startsWith('/_next/static/'))
  assert.ok(styles.length, 'Guarded local app must be running')
  globalCss = (await Promise.all(styles.map(async (href) => {
    const response = await fetch(new URL(href, workspace))
    assert.ok(response.ok, `Global stylesheet unavailable: ${response.status}`)
    return response.text()
  }))).join('\n')
}
const video = await readFile(path.join(root, 'test-results/canvas-ui-regression/sample.mp4'))
const bundle = process.env.NORI_BROWSER_PREBUILT_DIR ? {
  outputFiles: await Promise.all(['js', 'css'].map(async (extension) => ({
    path: `/fixture/fixture.${extension}`,
    contents: await readFile(path.join(process.env.NORI_BROWSER_PREBUILT_DIR, `batch-node-connection.${extension}`)),
  }))),
} : await (await import('esbuild')).build({
  entryPoints: ['tests/browser/batch-node-connection.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', platform: 'browser', jsx: 'automatic',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const server = createServer((request, response) => {
  if (request.url === '/sample.mp4') { response.setHeader('Content-Type', 'video/mp4'); return response.end(video) }
  if (request.url === '/global.css') { response.setHeader('Content-Type', 'text/css'); return response.end(globalCss) }
  if (request.url === '/fixture.js' || request.url === '/fixture.css') {
    response.setHeader('Content-Type', request.url.endsWith('css') ? 'text/css' : 'text/javascript')
    return response.end(bundle.outputFiles.find((file) => file.path.endsWith(request.url.endsWith('css') ? '.css' : '.js')).contents)
  }
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const errors = []
const cases = []
let latest
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="180" height="120"><rect width="180" height="120" fill="#345179"/></svg>')
async function open(viewport, mode = '') {
  const page = await browser.newPage({ viewport })
  latest = page
  page.on('pageerror', (error) => errors.push(error.message))
  let graph = {
    canvas: { id: 'canvas-1', projectId: 'project-1', title: '批量连接', revision: 0, viewport: { x: 0, y: 0, zoom: 1 }, themeColor: null, visibility: 'workspace', forkedFromId: null, createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' },
    edges: [],
    nodes: [
      ...['a', 'b', 'c'].map((id, i) => ({ id, canvasId: 'canvas-1', type: 'image', position: { x: 80, y: 145 + 180 * i }, size: { width: 180, height: 120 }, status: 'IDLE', taskId: null, runId: null, parentNodeId: null, mediaObjectId: null, data: { title: `素材 ${id}`, mediaType: 'image', origin: 'upload', imageUrl: image, contentUrl: image, history: [{ id: `h-${id}`, url: image, status: 'ready', actualCostPoints: 12 + i, quotedCostPoints: 10, createdAt: '2026-10-13T00:00:00Z' }] } })),
      { id: 'target', canvasId: 'canvas-1', type: 'video', position: { x: 530, y: 220 }, size: { width: 260, height: 200 }, status: 'IDLE', taskId: null, runId: null, parentNodeId: null, mediaObjectId: null, data: { title: '目标视频', mediaType: 'video', origin: 'generate', videoUrl: '/sample.mp4', contentUrl: '/sample.mp4', history: [{ id: 'h-video', url: '/sample.mp4', status: 'ready', actualCostPoints: 37, quotedCostPoints: 40, createdAt: '2026-10-13T00:00:00Z' }], generation: mode === 'limited' ? { inputMode: 'firstlastframe' } : mode === 'stale' ? { referenceNodeIds: ['a', 'deleted-reference'] } : mode === 'delete-reference' ? { referenceNodeIds: ['a', 'b'] } : {} } },
    ],
  }
  page.graph = () => graph
  if (mode === 'retry-stale') {
    const target = graph.nodes.find((item) => item.id === 'target')
    target.status = 'FAILED'
    target.data.prompt = '历史失败节点重试，不能提交失效引用'
    target.data.errorMessage = '历史失败，点击重试'
    target.data.generation = { modelKey: 'nori::norivideo2.5', referenceNodeIds: ['deleted-reference'] }
  }
  page.writes = []
  page.registrations = []
  page.generations = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    let payload = {}
    if (url.pathname.endsWith('/balance')) payload = { balancePoints: 1000, generationAllowed: true, dailyLimitPoints: null, dailyUsedPoints: 0 }
    else if (url.pathname.endsWith('/generation-config')) payload = {
      textModels: [], imageModels: [], audioModels: [], model3dModels: [],
      videoModels: [{ modelKey: 'nori::norivideo2.5', name: 'LanMiaoTV 2.5', configured: true, available: true, provider: 'nori', inputSchema: { image: { min: 0, max: 9 }, video: { min: 0, max: 3 }, audio: { min: 0, max: 3 }, requiredFields: ['prompt'] } }],
      defaults: { videoModel: 'nori::norivideo2.5', resolution: '720p', aspectRatio: '16:9' },
    }
    else if (url.pathname.endsWith('/generation-quote')) payload = { points: 20, costCny: 0.2 }
    else if (url.pathname === '/api/frameos/materials') payload = { materials: [{
      id: 'library-1', projectId: 'project-1', projectName: '测试作品', title: '素材库图片', type: 'image',
      source: 'upload', status: 'ready', url: image, storageKey: null, resultUrl: image,
      createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z',
    }], projects: [{ id: 'project-1', name: '测试作品' }] }
    else if (url.pathname.endsWith('/canvas/canvas-1/materials')) {
      const body = request.postDataJSON()
      page.registrations.push(body)
      for (const id of body.nodeIds) assert.ok(graph.nodes.some((node) => node.id === id), 'References must be persisted before material registration')
      payload = { materials: [{ materialId: 'registered-asset', nodeId: 'a', title: body.title }], materialByNodeId: Object.fromEntries(body.nodeIds.map((id) => [id, `registered-${id}`])) }
    }
    else if (url.pathname.endsWith('/canvas/canvas-1/generate')) {
      assert.ok(['generation', 'stale', 'delete-reference'].includes(mode), 'Only the local mocked generation tests may submit')
      const body = request.postDataJSON()
      const saved = graph.nodes.find((node) => node.id === body.nodeId)
      assert.equal(saved.data.prompt, body.prompt, 'Latest draft must be committed before generation')
      page.generations.push(body)
      payload = { success: true, tasks: [{ taskId: 'task-test', assetId: 'asset-test' }] }
    }
    else if (url.pathname.includes('/canvas/canvas-1')) {
      if (request.method() !== 'GET') {
        const body = request.postDataJSON()
        page.writes.push(body)
        if (body.nodes) graph = { ...graph, nodes: body.nodes, edges: body.edges || [] }
        for (const op of body.ops || []) {
          if (op.type === 'node.upsert') graph.nodes = [...graph.nodes.filter((node) => node.id !== op.node.id), op.node]
          if (op.type === 'node.remove' || op.type === 'node.delete') graph.nodes = graph.nodes.filter((node) => node.id !== op.id)
          if (op.type === 'edge.add' || op.type === 'edge.upsert') graph.edges = [...graph.edges.filter((edge) => edge.id !== op.edge.id), op.edge]
          if (op.type === 'edge.remove' || op.type === 'edge.delete') graph.edges = graph.edges.filter((edge) => edge.id !== op.id)
        }
        graph = { ...graph, canvas: { ...graph.canvas, revision: graph.canvas.revision + 1 } }
      }
      payload = graph
    } else payload = { materials: [], voices: [], assets: [], projects: [] }
    assert.ok(!url.pathname.endsWith('/generate') || ['generation', 'stale', 'delete-reference'].includes(mode), 'No external generation API calls allowed')
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
  await page.goto(`${base}/${mode === 'readonly' ? '?readonly=1' : ''}`)
  await page.locator('.react-flow__node[data-id="a"]').waitFor()
  return page
}
const node = (page, id) => page.locator(`.react-flow__node[data-id="${id}"]`)
const edges = (page) => page.locator('.react-flow__edge')
async function select(page, ids) {
  const pane = await page.locator('.react-flow__pane').boundingBox()
  await page.mouse.click(pane.x + pane.width - 18, pane.y + 110)
  const boxes = await Promise.all(ids.map((id) => node(page, id).boundingBox()))
  const from = { x: Math.min(...boxes.map((box) => box.x)) - 20, y: Math.min(...boxes.map((box) => box.y)) - 35 }
  const to = { x: Math.max(...boxes.map((box) => box.x + box.width)) + 20, y: Math.max(...boxes.map((box) => box.y + box.height)) + 12 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 15 })
  await page.mouse.up()
  await page.waitForFunction((count) => document.querySelectorAll('.react-flow__node.selected').length === count, ids.length, { timeout: 5000 })
}
async function dragToNode(page, sourceId, targetId, handle = false) {
  const source = handle ? await node(page, sourceId).locator('.react-flow__handle[data-handleid="output"]').boundingBox()
    : await node(page, sourceId).locator('.nori-canvas-node-drag-handle').boundingBox()
  const target = await node(page, targetId).boundingBox()
  const from = { x: source.x + source.width / 2, y: source.y + source.height / 2 }
  const to = { x: target.x + target.width / 2, y: target.y + target.height / 2 }
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(to.x, to.y, { steps: 20 })
  if (!handle) await page.locator('.nori-canvas-batch-connect-target').waitFor({ timeout: 5000 })
  await page.mouse.up()
}
async function waitEdgeCount(page, count) {
  await page.waitForFunction((expected) => document.querySelectorAll('.react-flow__edge').length === expected, count)
}
async function dragBatchHandle(page, targetId, cancel = false) {
  const handle = await page.getByRole('button', { name: '拖到目标节点批量连接', exact: true }).boundingBox()
  const target = await node(page, targetId).boundingBox()
  await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2)
  await page.mouse.down()
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 15 })
  await page.locator('.nori-canvas-batch-connect-target').waitFor()
  if (cancel) await page.keyboard.press('Escape')
  await page.mouse.up()
}
try {
  const unified = await open({ width: 1280, height: 900 })
  await select(unified, ['a', 'b', 'c'])
  const beforeUnified = await Promise.all(['a', 'b', 'c'].map((id) => node(unified, id).boundingBox()))
  await dragBatchHandle(unified, 'target')
  await waitEdgeCount(unified, 3)
  const afterUnified = await Promise.all(['a', 'b', 'c'].map((id) => node(unified, id).boundingBox()))
  assert.ok(beforeUnified.every((box, i) => Math.abs(box.x - afterUnified[i].x) < 1 && Math.abs(box.y - afterUnified[i].y) < 1))
  await unified.keyboard.press('Control+z')
  await waitEdgeCount(unified, 0)
  await select(unified, ['a', 'b', 'c'])
  await dragBatchHandle(unified, 'target', true)
  assert.equal(await edges(unified).count(), 0, 'Escape cancels unified batch drop')
  await unified.locator('.nori-canvas-workspace').focus()
  await unified.keyboard.press('Control+a')
  await unified.waitForFunction(() => document.querySelectorAll('.react-flow__node.selected').length === 4)
  await dragBatchHandle(unified, 'target')
  await waitEdgeCount(unified, 3)
  await unified.keyboard.press('Control+s')
  for (let i = 0; i < 30 && unified.graph().edges.length !== 3; i++) await unified.waitForTimeout(100)
  assert.deepEqual(unified.graph().nodes.find((item) => item.id === 'target').data.generation.referenceNodeIds, ['a', 'b', 'c'])
  await unified.close()
  cases.push('unified-handle-three-sources-cancel-select-all-self-filter-real-inputs')
  const smallToolbar = await open({ width: 390, height: 700 })
  await smallToolbar.locator('.nori-canvas-workspace').focus()
  await smallToolbar.keyboard.press('Control+a')
  await smallToolbar.getByRole('button', { name: '拖到目标节点批量连接', exact: true }).waitFor()
  for (const button of await smallToolbar.locator('.nori-canvas-selection-toolbar button').all()) {
    const box = await button.boundingBox()
    assert.ok(box.x >= 0 && box.x + box.width <= 391, `Small-screen selection action clipped: ${JSON.stringify(box)}`)
  }
  await smallToolbar.close()
  cases.push('390px-unified-selection-toolbar-bounded')
  for (const viewport of [{ width: 1280, height: 800 }, { width: 1024, height: 600 }]) {
    const page = await open(viewport)
    const before = await node(page, 'a').boundingBox()
    await select(page, ['a', 'b'])
    await dragToNode(page, 'a', 'target')
    await waitEdgeCount(page, 2)
    const after = await node(page, 'a').boundingBox()
    assert.ok(Math.abs(before.x - after.x) < 2 && Math.abs(before.y - after.y) < 2, 'Reference nodes must return to their original positions')
    await page.keyboard.press('Control+z')
    await waitEdgeCount(page, 0)
    await page.keyboard.press('Control+Shift+z')
    await waitEdgeCount(page, 2)
    await select(page, ['a', 'b'])
    await dragToNode(page, 'a', 'target')
    await waitEdgeCount(page, 2)
    await select(page, ['a', 'b'])
    const source = await node(page, 'a').locator('.nori-canvas-node-drag-handle').boundingBox()
    await page.mouse.move(source.x + 30, source.y + 10)
    await page.mouse.down()
    await page.mouse.move(source.x + 100, source.y + 75, { steps: 12 })
    await page.mouse.up()
    assert.equal(await edges(page).count(), 2, 'Dragging into empty space must not create wires')
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}-body-drag.png`) })
    await page.keyboard.press('Control+s')
    for (let attempt = 0; attempt < 30 && page.graph().edges.length !== 2; attempt++) await page.waitForTimeout(100)
    assert.equal(page.graph().edges.length, 2, 'All batch edges must be persisted')
    await page.evaluate(async () => {
      localStorage.clear()
      await new Promise((resolve) => {
        const request = indexedDB.deleteDatabase('nori-canvas-offline-v1')
        request.onsuccess = request.onerror = request.onblocked = () => resolve()
      })
    })
    await page.reload()
    await waitEdgeCount(page, 2)
    cases.push(`${viewport.width}:body-batch-undo-redo-dedupe-empty-save-reload`)
    await page.close()
  }
  const wire = await open({ width: 1280, height: 800 })
  await select(wire, ['a', 'b'])
  await dragToNode(wire, 'a', 'target', true)
  await waitEdgeCount(wire, 2)
  await wire.close()
  cases.push('output-handle-batch-to-node-body')
  const integrations = await open({ width: 1280, height: 800 })
  assert.ok((await node(integrations, 'a').locator('.nori-canvas-node-cost').innerText()).includes('实际 12'))
  assert.ok((await node(integrations, 'target').locator('.nori-canvas-node-cost').innerText()).includes('实际 37'))
  const bounds = await node(integrations, 'a').boundingBox()
  await integrations.mouse.click(bounds.x + 50, bounds.y + 50, { button: 'right' })
  await integrations.getByRole('menuitem', { name: /上传到资产库/ }).click()
  const upload = integrations.locator('.nori-canvas-asset-library-dialog')
  await upload.locator('input').fill('画布右键登记场景')
  await upload.getByLabel('资产归类').selectOption('location')
  await upload.getByRole('button', { name: '上传到资产库', exact: true }).click()
  await upload.waitFor({ state: 'hidden' })
  assert.deepEqual(integrations.registrations[0], { register: 'library', nodeIds: ['a'], title: '画布右键登记场景', assetCategory: 'location' })
  assert.equal(await integrations.locator('.react-flow__node').count(), 4)
  // A normal wire dropped on the body of an existing node reuses that node.
  await dragToNode(integrations, 'a', 'target', true)
  await waitEdgeCount(integrations, 1)
  assert.equal(await integrations.locator('.react-flow__node').count(), 4)
  await node(integrations, 'target').click({ position: { x: 140, y: 80 } })
  const generator = integrations.locator('.nori-canvas-generator')
  await generator.getByTitle('从素材库添加引用素材（无需连线）').click()
  const picker = integrations.getByRole('dialog', { name: /从素材库添加|引用素材|选择引用/ })
  await picker.waitFor()
  await picker.getByText('素材库图片', { exact: true }).click()
  await picker.getByRole('button', { name: /添加引用/ }).click()
  await picker.waitFor({ state: 'hidden' })
  await integrations.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 5)
  assert.equal(await edges(integrations).count(), 1, 'Material plus must not require or create an extra wire')
  await generator.locator('.nori-canvas-generator-refs').getByText('素材库图片', { exact: true }).waitFor()
  assert.equal(await node(integrations, 'target').getAttribute('class').then((value) => value.includes('selected')), true)
  const libraryNodeId = await integrations.locator('.react-flow__node-image').filter({ hasText: '素材库图片' }).getAttribute('data-id')
  await generator.getByTitle('从素材库添加引用素材（无需连线）').click()
  await picker.getByText('素材库图片', { exact: true }).click()
  await picker.getByRole('button', { name: /添加引用/ }).click()
  await picker.waitFor({ state: 'hidden' })
  assert.equal(await integrations.locator('.react-flow__node').count(), 5, 'Picker must not insert duplicate reference material ids')
  await integrations.getByText('所选素材已经引用，无需重复添加', { exact: true }).waitFor()
  await integrations.keyboard.press('Control+s')
  for (let i = 0; i < 50 && !(integrations.graph().nodes.find((item) => item.id === 'target').data.generation?.referenceNodeIds || []).includes(libraryNodeId); i++) await integrations.waitForTimeout(100)
  assert.ok(integrations.graph().nodes.find((item) => item.id === 'target').data.generation.referenceNodeIds.includes(libraryNodeId))
  await integrations.evaluate(async () => {
    localStorage.clear()
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase('nori-canvas-offline-v1')
      request.onsuccess = request.onerror = request.onblocked = () => resolve()
    })
  })
  await integrations.reload()
  await integrations.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 5)
  await node(integrations, 'target').click({ position: { x: 140, y: 80 } })
  await generator.locator('.nori-canvas-generator-refs').getByText('素材库图片', { exact: true }).waitFor()
  await integrations.screenshot({ path: path.join(artifacts, 'cost-upload-picker-single-wire.png') })
  await integrations.close()
  cases.push('image-video-cost-rightclick-assets-plus-without-wire-existing-node')
  const bulk = await open({ width: 1280, height: 800 })
  const dropMaterials = ['bulk-1', 'bulk-2'].map((id) => ({ id, projectId: 'project-1', projectName: '当前作品', type: 'image', source: 'upload', title: id, status: 'ready', url: image }))
  const dropAtTarget = async () => {
    const box = await node(bulk, 'target').boundingBox()
    await bulk.locator('.nori-canvas-workspace').evaluate((element, input) => {
      const transfer = new DataTransfer()
      transfer.setData('application/x-nori-canvas-material-collection', JSON.stringify(input.materials))
      element.dispatchEvent(new DragEvent('drop', { bubbles: true, dataTransfer: transfer, clientX: input.x, clientY: input.y }))
    }, { materials: dropMaterials, x: box.x + box.width / 2, y: box.y + box.height / 2 })
  }
  await dropAtTarget()
  await bulk.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 6)
  assert.equal(await edges(bulk).count(), 0, 'Library bulk drop does not need wires')
  assert.ok((await node(bulk, 'target').getAttribute('class')).includes('selected'))
  await dropAtTarget()
  assert.equal(await bulk.locator('.react-flow__node').count(), 6, 'Repeat bulk drop must not duplicate existing references')
  await bulk.locator('.nori-canvas-workspace').focus()
  await bulk.keyboard.press('Control+s')
  for (let i = 0; i < 30 && !(bulk.graph().nodes.find((item) => item.id === 'target').data.generation?.referenceNodeIds || []).length; i++) await bulk.waitForTimeout(100)
  assert.equal(bulk.graph().nodes.find((item) => item.id === 'target').data.generation.referenceNodeIds.length, 2)
  await bulk.keyboard.press('Control+z')
  await bulk.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 4)
  await bulk.close()
  cases.push('library-bulk-drop-without-wires-dedup-save-and-one-step-undo')

  const generation = await open({ width: 1280, height: 900 }, 'generation')
  await node(generation, 'a').click({ position: { x: 80, y: 40 } })
  await generation.locator('.nori-canvas-workspace').focus()
  await generation.keyboard.press('Control+d')
  await generation.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 5)
  const clonedId = await generation.locator('.react-flow__node.selected').getAttribute('data-id')
  await dragToNode(generation, clonedId, 'target', true)
  await waitEdgeCount(generation, 1)
  await node(generation, 'target').click({ position: { x: 140, y: 80 } })
  const generationPanel = generation.locator('.nori-canvas-generator')
  await generationPanel.locator('textarea').fill('刚复制素材后立即生成，使用当前最新提示词')
  await generationPanel.getByRole('button', { name: '生成', exact: true }).click()
  for (let i = 0; i < 50 && generation.generations.length === 0; i++) await generation.waitForTimeout(100)
  assert.equal(generation.generations.length, 1)
  assert.deepEqual(generation.registrations.at(-1).nodeIds, [clonedId])
  assert.deepEqual(generation.generations[0].referenceMaterialIds, [`registered-${clonedId}`])
  await generation.close()
  cases.push('copied-reference-immediate-generation-commits-draft-and-reference-before-registration')
  const stale = await open({ width: 1024, height: 600 }, 'stale')
  await node(stale, 'target').click({ position: { x: 140, y: 80 } })
  const stalePanel = stale.locator('.nori-canvas-generator')
  await stalePanel.getByRole('alert').filter({ hasText: '有 1 个引用节点已删除' }).waitFor()
  const cleanupButton = stalePanel.getByRole('button', { name: '清除失效引用', exact: true })
  const cleanupBox = await cleanupButton.boundingBox()
  assert.ok(cleanupBox && cleanupBox.x >= 0 && cleanupBox.y >= 0 && cleanupBox.x + cleanupBox.width <= 1024 && cleanupBox.y + cleanupBox.height <= 600,
    'Stale reference recovery must be visible on a small screen')
  await stalePanel.locator('textarea').fill('提示词不能因为清除已删除引用而丢失')
  await stalePanel.getByRole('button', { name: '生成', exact: true }).click()
  await stalePanel.getByText('部分引用节点已删除，请在引用素材中清除失效引用或重新选择后再生成。', { exact: true }).waitFor()
  assert.equal(stale.generations.length, 0, 'Missing references must not silently submit a paid task')
  assert.equal(stale.registrations.length, 0, 'No obsolete ids should reach the material route')
  await cleanupButton.click()
  assert.equal(await stalePanel.locator('textarea').inputValue(), '提示词不能因为清除已删除引用而丢失')
  assert.equal(await cleanupButton.count(), 0)
  await stalePanel.getByRole('button', { name: '生成', exact: true }).click()
  for (let i = 0; i < 50 && stale.generations.length === 0; i++) await stale.waitForTimeout(100)
  assert.equal(stale.generations.length, 1, 'Explicit recovery must allow generation again')
  assert.deepEqual(stale.registrations.at(-1).nodeIds, ['a'], 'Keep valid references in their original order')
  assert.deepEqual(stale.generations[0].referenceMaterialIds, ['registered-a'])
  await stale.close()
  cases.push('legacy-deleted-reference-warning-visible-small-screen-clear-and-regenerate-with-valid-inputs')

  const deletion = await open({ width: 1280, height: 800 }, 'delete-reference')
  await node(deletion, 'a').click({ position: { x: 80, y: 40 } })
  await deletion.locator('.nori-canvas-workspace').focus()
  await deletion.keyboard.press('Delete')
  await deletion.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 3)
  await deletion.keyboard.press('Control+s')
  for (let i = 0; i < 30 && deletion.graph().nodes.length !== 3; i++) await deletion.waitForTimeout(100)
  assert.deepEqual(deletion.graph().nodes.find((item) => item.id === 'target').data.generation.referenceNodeIds, ['b'])
  assert.equal(await edges(deletion).count(), 0, 'The regression specifically covers plus-picker references without wires')
  await deletion.keyboard.press('Control+z')
  await deletion.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 4)
  await deletion.keyboard.press('Control+s')
  for (let i = 0; i < 30 && deletion.graph().nodes.length !== 4; i++) await deletion.waitForTimeout(100)
  assert.deepEqual(deletion.graph().nodes.find((item) => item.id === 'target').data.generation.referenceNodeIds, ['a', 'b'])
  await deletion.keyboard.press('Control+Shift+z')
  await deletion.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 3)
  await node(deletion, 'target').click({ position: { x: 140, y: 80 } })
  const deletionPanel = deletion.locator('.nori-canvas-generator')
  await deletionPanel.locator('textarea').fill('删除素材后使用剩余引用继续生成')
  await deletionPanel.getByRole('button', { name: '生成', exact: true }).click()
  for (let i = 0; i < 50 && deletion.generations.length === 0; i++) await deletion.waitForTimeout(100)
  assert.equal(deletion.generations.length, 1)
  assert.deepEqual(deletion.generations[0].referenceMaterialIds, ['registered-b'])
  await deletion.close()
  cases.push('unwired-reference-deletion-cleans-persistent-ids-with-undo-redo-and-generation')

  const retryStale = await open({ width: 1280, height: 800 }, 'retry-stale')
  await node(retryStale, 'target').locator('button.nori-canvas-node-error').click()
  await retryStale.getByText('部分引用节点已删除，请在引用素材中清除失效引用或重新选择后再生成。', { exact: true }).waitFor()
  await retryStale.getByRole('button', { name: '清除失效引用', exact: true }).waitFor()
  assert.equal(retryStale.generations.length, 0)
  assert.equal(retryStale.registrations.length, 0)
  await retryStale.close()
  cases.push('failed-node-regenerate-recovers-visibly-without-unhandled-rejection-or-paid-call')
  const limited = await open({ width: 1280, height: 900 }, 'limited')
  await select(limited, ['a', 'b', 'c'])
  await dragToNode(limited, 'a', 'target')
  await waitEdgeCount(limited, 2)
  await limited.getByText(/1 个因已连接、不兼容或超出引用上限跳过/).waitFor()
  await limited.close()
  cases.push('three-sources-first-last-frame-cap')
  const readonly = await open({ width: 1280, height: 800 }, 'readonly')
  await readonly.keyboard.down('Shift')
  await node(readonly, 'a').locator('.nori-canvas-node-body').click()
  await node(readonly, 'b').locator('.nori-canvas-node-body').click()
  await readonly.keyboard.up('Shift')
  const before = await node(readonly, 'a').boundingBox()
  const target = await node(readonly, 'target').boundingBox()
  await readonly.mouse.move(before.x + 40, before.y + 40)
  await readonly.mouse.down()
  await readonly.mouse.move(target.x + 50, target.y + 50, { steps: 15 })
  await readonly.mouse.up()
  const after = await node(readonly, 'a').boundingBox()
  assert.ok(Math.abs(before.x - after.x) < 2 && Math.abs(before.y - after.y) < 2)
  assert.equal(await edges(readonly).count(), 0)
  assert.equal(readonly.writes.length, 0)
  await readonly.close()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, cases, readOnly: true, artifacts }, null, 2))
} catch (error) {
  await latest?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ errors, savedEdges: latest?.graph?.().edges.length, writes: latest?.writes?.map((write) => ({ keys: Object.keys(write), ops: write.ops?.map((op) => op.type) })), text: (await latest?.locator('body').innerText().catch(() => '') || '').slice(0, 550) }))
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
