import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { build } from 'esbuild'

const root = process.cwd()
const { chromium } = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))('playwright-core')
const requireTs = createRequire(import.meta.url)
requireTs('tsx/cjs')
const { buildCanvasNodeSummaryV1 } = requireTs('../../src/lib/canvas/graph-summary')
const { createCanvasAgentFakeModel } = requireTs('../../src/lib/canvas-agent/fake-model')
const { toModelMessages } = requireTs('../../src/lib/assistant-platform/messages')
const { canvasAgentTools } = requireTs('../../src/lib/canvas-agent/tools')
const { streamText } = requireTs('ai')
const artifacts = path.join(root, 'test-results/canvas-agent/B4')
await mkdir(artifacts, { recursive: true })
const bundle = await build({
  entryPoints: ['tests/browser/canvas-agent-panel.fixture.tsx'], bundle: true, splitting: true, write: false,
  format: 'esm', jsx: 'automatic', platform: 'browser', outdir: '/fixture', external: ['tailwindcss'],
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'),
    'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx'),
  },
  define: { 'process.env.NODE_ENV': '"production"', 'process.env': '{}' },
})
const assets = new Map(bundle.outputFiles.filter((asset) => asset.path.endsWith('.js')).map((asset) => [asset.path, asset.contents]))
const global = await readFile('src/app/globals.css', 'utf8')
const bundleCss = bundle.outputFiles.filter((asset) => asset.path.endsWith('.css')).map((asset) => asset.text).join('\n')
const styles = (await postcss([tailwindcss()]).process(`${global}\n${bundleCss}`, { from: path.join(root, 'src/app/globals.css'), map: false })).css
const server = createServer((request, response) => {
  if (assets.has(request.url)) return response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(assets.get(request.url))
  if (request.url === '/fixture.css') return response.writeHead(200, { 'Content-Type': 'text/css' }).end(styles)
  response.writeHead(200, { 'Content-Type': 'text/html' }).end('<!doctype html><html lang="zh"><meta charset="utf-8"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script type="module" src="/fixture/canvas-agent-panel.fixture.js"></script>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const results = []
const issues = []
const models = ['deepseek', 'kimi', 'openai'].map((providerId) => ({ modelKey: `${providerId}::fixture`, providerId, displayName: `${providerId} 测试` }))
const graph = {
  canvas: { id: 'canvas-1', projectId: 'project-1', title: '喵导浏览器测试', revision: 0, viewport: { x: 0, y: 0, zoom: 1 } },
  nodes: [{ id: 'node-base', canvasId: 'canvas-1', type: 'image', position: { x: 150, y: 160 }, size: { width: 300, height: 200 }, status: 'IDLE', data: { title: '原节点', mediaType: 'image' } }],
  edges: [],
}

function packets(sequence, call, text) {
  const id = `assistant-${sequence}`
  const events = [{ type: 'start', messageId: id }, { type: 'start-step' }]
  if (text) events.push({ type: 'text-start', id }, { type: 'text-delta', id, delta: text }, { type: 'text-end', id })
  if (call) for (const [index, item] of (Array.isArray(call) ? call : [call]).entries()) {
    events.push({ type: 'tool-input-available', toolCallId: `call-${sequence}-${index}`, toolName: item.name, input: item.input })
  }
  events.push({ type: 'finish-step' }, { type: 'finish', finishReason: call ? 'tool-calls' : 'stop' })
  return events.map((item) => `data: ${JSON.stringify(item)}\n\n`).join('') + 'data: [DONE]\n\n'
}

function modelResponse(body) {
  if (body.context.turnIndex) return { text: '本轮已处理。' }
  const prompt = body.messages.findLast((item) => item.role === 'user').parts.find((item) => item.type === 'text').text
  if (prompt === '请问风格') return { call: { name: 'ask_user', input: { question: '偏好什么风格？', options: ['水墨', '写实'] } } }
  if (prompt === '删除四个节点') return { call: { name: 'delete_nodes', input: { nodes: ['镜头1', '镜头2', '镜头3', '镜头4'], reason: '测试拒绝删除' } } }
  if (prompt === '在标签 B 改写原文') return { call: { name: 'update_nodes', input: { updates: [{ node: '保留文本', text: '来自标签 B 的独立编辑' }] } } }
  if (prompt === '生成镜头1') return { call: { name: 'generate', input: { node: '镜头1', prompt: '写镜头脚本', count: 1 } } }
  if (prompt === '创建批量测试图') return { call: { name: 'build_graph', input: {
    title: '三张分镜图', nodes: ['批量一', '批量二', '批量三'].map((title, index) => ({ key: `batch${index}`, type: 'image', title })),
  } } }
  if (prompt === '批量生成三张图') return { call: ['1K', '2K', '4K'].map((resolution, index) => ({
    name: 'generate', input: { node: ['批量一', '批量二', '批量三'][index], prompt: '绘制合成分镜', params: { resolution }, count: 1 },
  })) }
  const count = prompt === '创建八个镜头' ? 8 : 5
  const blueprint = Array.from({ length: count }, (_, index) => ({ key: `n${index}`, type: 'text', title: `镜头${index + 1}` }))
  const pairs = count === 5 ? [[0, 1], [0, 2], [1, 2], [1, 3], [2, 4]] : [[0, 1]]
  return { text: '先搭画布结构。', call: {
    name: 'build_graph',
    input: { title: `分镜 ${count}`, nodes: blueprint, links: pairs.map(([from, to]) => ({ from: { key: `n${from}` }, to: { key: `n${to}` } })) },
  } }
}

async function open(query = '', withModels = true, viewport = { width: 1440, height: 900 }, shared, tab) {
  const page = shared ? await shared.context.newPage() : await browser.newPage({ viewport })
  const experience = new URLSearchParams(query).has('experience')
  const calls = []
  const requests = []
  const generationRequests = []
  const state = shared ?? { nodes: new Map((experience ? [] : graph.nodes).map((node) => [node.id, node])), edges: new Map(), revision: 0 }
  const pendingAssets = new Map()
  let finishFixtures = false
  const persistedNodes = state.nodes
  const persistedEdges = state.edges
  await page.addInitScript(() => localStorage.setItem('nori-canvas-agent-model', 'obsolete::fixture'))
  page.on('pageerror', (error) => issues.push(error.message))
  page.on('request', (request) => requests.push(request.url()))
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin !== base) return route.abort()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    let payload = { materials: [], projects: [], voices: [] }
    if (url.pathname.endsWith('/agent/models')) payload = { defaultModelKey: withModels ? models[0].modelKey : null, models: withModels ? models : [] }
    else if (url.pathname.endsWith('/agent/chat')) {
      const body = route.request().postDataJSON()
      calls.push(body)
      if (experience) {
        const model = createCanvasAgentFakeModel(body.messages, body.context.digest)
        assert.ok(model, 'offline experience uses the non-production fake model only')
        const answer = streamText({ model, messages: await toModelMessages(body.messages), tools: canvasAgentTools, maxRetries: 0 })
        return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' },
          body: await answer.toUIMessageStreamResponse({ originalMessages: body.messages }).text() })
      }
      const { call, text } = modelResponse(body)
      return route.fulfill({ status: 200, headers: { 'content-type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' }, body: packets(calls.length, call, text) })
    } else if (url.pathname.endsWith('/ops')) {
      const save = route.request().postDataJSON()
      const ops = save.ops ?? []
      if (shared) {
        const write = { tab, expectedRevision: save.expectedRevision, ops, status: null }
        shared.writes.push(write)
        if (tab === 'A' && shared.hold) {
          shared.hold = false
          shared.held()
          await shared.resume
        }
        if (save.expectedRevision !== state.revision) {
          write.status = 409
          return route.fulfill({ status: 409, json: { actualRevision: state.revision, message: '合成并发冲突' } })
        }
        write.status = 200
      }
      for (const op of ops) {
        if (op.type === 'node.upsert') persistedNodes.set(op.node.id, { ...op.node, canvasId: 'canvas-1' })
        if (op.type === 'node.update_geometry') {
          const node = persistedNodes.get(op.id)
          if (node) persistedNodes.set(op.id, { ...node, ...(op.position ? { position: op.position } : {}), ...(op.size ? { size: op.size } : {}) })
        }
        if (op.type === 'node.delete') persistedNodes.delete(op.id)
        if (op.type === 'edge.add') persistedEdges.set(op.edge.id, { ...op.edge, canvasId: 'canvas-1' })
        if (op.type === 'edge.delete') persistedEdges.delete(op.id)
      }
      payload = {
        canvas: { ...graph.canvas, revision: ++state.revision },
        nodes: ops.filter((op) => op.type === 'node.upsert').map((op) => op.node),
        edges: ops.filter((op) => op.type === 'edge.add').map((op) => op.edge),
        deletedNodeIds: ops.filter((op) => op.type === 'node.delete').map((op) => op.id),
        deletedEdgeIds: ops.filter((op) => op.type === 'edge.delete').map((op) => op.id),
        geometry: ops.filter((op) => op.type === 'node.update_geometry'),
      }
    } else if (url.pathname.endsWith('/generate-text') || url.pathname.endsWith('/canvas/canvas-1/generate')) {
      const request = route.request().postDataJSON()
      generationRequests.push(request)
      if (experience && request.type === 'image') {
        const assetId = `synthetic-asset-${generationRequests.length}`
        pendingAssets.set(assetId, { type: 'image', id: assetId, status: 'processing' })
        return route.fulfill({ json: { tasks: [{ taskId: `synthetic-task-${generationRequests.length}`, assetId, nodeId: request.nodeId }] } })
      }
      return route.fulfill({ status: 503, json: { error: { message: '合成测试拒绝，未调用任何生成供应商' } } })
    } else if (experience && url.pathname.endsWith('/toolbox/assets')) {
      const ids = new Set((url.searchParams.get('assetIds') || '').split(','))
      payload = { assets: [...pendingAssets.values()].filter((asset) => ids.has(asset.id)).map((asset) =>
        finishFixtures ? { ...asset, status: 'ready', resultUrl: '/synthetic-image-result.png' } : asset) }
    } else if (url.pathname.endsWith('/canvas/canvas-1')) {
      const summary = url.searchParams.get('view') === 'summary-v1'
      shared?.reads.push({ tab, summary, revision: state.revision })
      const nodes = [...persistedNodes.values()]
      payload = { ...(summary ? { kind: 'summary-v1' } : {}), canvas: { ...graph.canvas, revision: state.revision },
        nodes: summary ? nodes.map((node) => buildCanvasNodeSummaryV1(node)) : nodes, edges: [...persistedEdges.values()] }
    } else if (shared && url.searchParams.get('view') === 'detail-v1') {
      const node = persistedNodes.get(decodeURIComponent(url.pathname.split('/').at(-1)))
      if (!node) return route.fulfill({ status: 404, json: { message: '合成节点不存在' } })
      payload = { kind: 'detail-v1', detailVersion: buildCanvasNodeSummaryV1(node).detailVersion, node }
    }
    else if (url.pathname.endsWith('/balance')) payload = { balancePoints: 500, generationAllowed: true }
    else if (url.pathname.endsWith('/generation-config')) payload = {
      textModels: [{ modelKey: 'fixture::text', name: '测试文本模型', provider: 'fixture', options: {}, available: true }],
      imageModels: [{ modelKey: 'fixture::image', name: '测试图片模型', provider: 'fixture', options: {}, available: true }],
      videoModels: [], audioModels: [], model3dModels: [], defaults: { textModel: 'fixture::text', imageModel: 'fixture::image' },
    }
    else if (url.pathname.endsWith('/generation-quote')) {
      const resolution = url.searchParams.get('resolution')
      payload = { points: resolution === '1K' ? 6 : resolution === '2K' ? 9
        : generationRequests.some((request) => request.type === 'image') ? 13 : 12 }
    }
    else if (url.pathname.endsWith('/agent/threads')) payload = { threads: [] }
    else if (url.pathname === '/api/projects/project-1') payload = { work: { id: 'project-1', name: '测试作品', workId: 'work-1' } }
    return route.fulfill({ status: 200, json: payload })
  })
  await page.goto(`${base}/${query}`)
  await page.locator(experience ? '.react-flow' : '.react-flow__node').first().waitFor({ timeout: 8000 }).catch(async (error) => {
    throw new Error(`${error.message}\n${JSON.stringify({ issues, requests, text: (await page.locator('body').innerText()).slice(0, 300) })}`)
  })
  return { page, calls, requests, generationRequests,
    setCompleted: (complete) => { finishFixtures = complete } }
}

async function send(page, text) {
  const box = page.getByPlaceholder('告诉喵导你想做什么…')
  await box.fill(text)
  await page.getByRole('button', { name: '发送', exact: true }).click()
}

async function waitNodes(page, length) {
  await page.waitForFunction((size) => document.querySelectorAll('.react-flow__node').length === size, length, { timeout: 10_000 })
}

async function verifySiblingConflict() {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const videoHistory = { id: 'fixture-history', prompt: '不可丢失的旧历史。'.repeat(2600), createdAt: '2026-11-22T00:00:00Z', status: 'ready' }
  const { promise: inFlight, resolve: held } = Promise.withResolvers()
  const { promise: resume, resolve: release } = Promise.withResolvers()
  const basis = { ...graph.nodes[0], taskId: null, runId: null, mediaObjectId: null, parentNodeId: null }
  const shared = { context, hold: true, held, resume, revision: 0, reads: [], writes: [], edges: new Map(),
    nodes: new Map([
      ['video-race', { ...basis, id: 'video-race', type: 'video', taskId: 'synthetic-task', status: 'RUNNING', data: {
        title: '异步视频', mediaType: 'video', progress: 48, history: [videoHistory],
        generationTask: { kind: 'video', taskId: 'synthetic-task', submittedAt: '2026-11-22T00:00:00Z' },
      } }],
      ['text-race', { ...basis, id: 'text-race', type: 'text', position: { x: 570, y: 160 }, data: { title: '保留文本', text: '原文' } }],
    ]),
  }
  try {
    const a = (await open('?summary=1', true, undefined, shared, 'A')).page
    const b = (await open('?summary=1', true, undefined, shared, 'B')).page
    await a.locator('.react-flow__node[data-id="video-race"]').click({ position: { x: 90, y: 70 } })
    await a.locator('.nori-canvas-workspace').focus()
    await a.keyboard.press('ArrowRight')
    await Promise.race([inFlight, new Promise((_, reject) => {
      const watchdog = setTimeout(() => reject(new Error('标签 A 未开始保存')), 5000)
      watchdog.unref()
    })])

    await b.getByRole('button', { name: '打开喵导' }).click()
    await b.getByRole('option', { name: 'kimi 测试' }).waitFor({ state: 'attached' })
    const savedB = b.waitForResponse((response) => response.url().endsWith('/ops') && response.status() === 200, { timeout: 8000 })
    await send(b, '在标签 B 改写原文')
    await savedB
    assert.equal(shared.nodes.get('text-race').data.text, '来自标签 B 的独立编辑')

    const video = shared.nodes.get('video-race')
    const workerResult = { ...video, status: 'SUCCEEDED', data: {
      ...video.data, contentUrl: '/synthetic-worker-result.mp4', videoUrl: '/synthetic-worker-result.mp4', progress: 100,
      generationTask: { ...video.data.generationTask, completed: true },
      history: [videoHistory, { id: 'worker-history', prompt: '并发完成的生成', createdAt: '2026-11-22T00:00:02Z', status: 'ready' }],
    } }
    shared.nodes.set('video-race', workerResult)
    assert.equal(shared.revision, 1, 'worker completes at the same canvas revision')
    const conflict = a.waitForResponse((response) => response.url().endsWith('/ops') && response.status() === 409)
    const savedA = a.waitForResponse((response) => response.url().endsWith('/ops') && response.status() === 200, { timeout: 12000 })
    release()
    await conflict
    await savedA
    const retries = shared.writes.filter((write) => write.tab === 'A')
    assert.equal(retries[0]?.status, 409)
    assert.equal(retries[0]?.expectedRevision, 0)
    const rebased = retries.find((write) => write.status === 200)
    assert.equal(rebased?.expectedRevision, 1)
    assert.equal(rebased?.ops.some((op) => op.type === 'node.upsert' && op.node.id === 'video-race'), false)
    assert.ok(rebased?.ops.some((op) => op.type === 'node.update_geometry' && op.id === 'video-race'))
    assert.ok(shared.reads.some((read) => read.tab === 'A' && read.summary && read.revision === 0))
    assert.ok(shared.reads.some((read) => read.tab === 'A' && !read.summary && read.revision === 1))
    const merged = shared.nodes.get('video-race')
    assert.deepEqual(merged.position, { x: basis.position.x + 5, y: basis.position.y })
    assert.equal(merged.status, workerResult.status)
    assert.deepEqual(merged.data, workerResult.data)
    assert.equal(shared.nodes.get('text-race').data.text, '来自标签 B 的独立编辑')
  } finally {
    release()
    await context.close()
  }
}

async function verifyManualCameraPriority() {
  const { page } = await open()
  try {
    await page.getByRole('button', { name: '打开喵导' }).click()
    const panel = page.getByRole('complementary', { name: '喵导 · 画布助手' })
    await panel.getByRole('option', { name: 'kimi 测试' }).waitFor({ state: 'attached' })
    await send(page, '创建八个镜头')
    await panel.getByRole('button', { name: '放到画布' }).waitFor()
    const viewport = page.locator('.react-flow__viewport')
    const readTransform = () => viewport.evaluate((element) => element.style.transform)
    const before = await readTransform()
    await page.mouse.move(560, 720)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(400, 720, { steps: 12 })
    await page.mouse.up({ button: 'middle' })
    await page.waitForFunction((value) => document.querySelector('.react-flow__viewport')?.style.transform !== value, before)
    const userTransform = await readTransform()
    const hasOffscreenGhost = await page.evaluate(() => {
      const panelLeft = document.querySelector('.nori-canvas-agent-panel').getBoundingClientRect().left
      return [...document.querySelectorAll('.nori-canvas-agent-ghost-node')].some((node) => {
        const rect = node.getBoundingClientRect()
        return rect.left >= panelLeft || rect.right <= 0 || rect.top >= innerHeight || rect.bottom <= 0
      })
    })
    assert.ok(hasOffscreenGhost, 'the fixture must propose at least one node outside the visible canvas')
    await panel.getByRole('button', { name: '放到画布' }).click()
    await waitNodes(page, 9)
    await panel.getByText('本轮已结束', { exact: true }).waitFor()
    await page.waitForTimeout(360)
    assert.equal(await readTransform(), userTransform, 'automatic camera follow must defer to the recent manual pan')
  } finally {
    await page.close()
  }
}

async function runExperienceStory() {
  const previousFake = process.env.CANVAS_AGENT_FAKE_MODEL
  process.env.CANVAS_AGENT_FAKE_MODEL = '1'
  const output = path.join(root, 'test-results/canvas-agent/B6/experience')
  await mkdir(output, { recursive: true })
  try {
    const { page, calls, generationRequests, setCompleted } = await open('?experience=1')
    try {
      const capture = (name) => page.screenshot({ path: path.join(output, `${name}.png`) })
      await page.keyboard.press('Control+j')
      const panel = page.getByRole('complementary', { name: '喵导 · 画布助手' })
      await panel.getByRole('button', { name: '从一句话搭一个短片工作流' }).waitFor()
      await capture('01-empty-panel')
      await send(page, '做一个 30 秒的猫咪咖啡馆短片，3 个镜头，吉卜力风格')
      await panel.getByText('做一个 30 秒的猫咪咖啡馆短片，3 个镜头，吉卜力风格', { exact: true }).waitFor()
      await capture('02-user-brief')
      await panel.getByText('先把骨架搭出来，你看看。', { exact: true }).waitFor()
      await capture('03-streamed-director-reply')
      await page.waitForFunction(() => document.querySelectorAll('.nori-canvas-agent-ghost-node').length === 7)
      await panel.getByRole('button', { name: '在画布上预览蓝图' }).click()
      await page.waitForTimeout(360)
      await capture('04-seven-ghost-nodes')
      await panel.getByRole('button', { name: '放到画布' }).click()
      await waitNodes(page, 8)
      await panel.getByText('本轮已结束', { exact: true }).waitFor()
      await capture('05-blueprint-placed')

      await send(page, '生成分镜图')
      const confirm = panel.getByRole('button', { name: '全部确认（共 27 点）' })
      await confirm.waitFor()
      assert.equal(await panel.locator('legend').filter({ hasText: /^生成「/ }).count(), 3)
      assert.equal(generationRequests.length, 0)
      await capture('06-batch-price-confirmation')
      await confirm.click()
      await panel.getByText('本轮已结束', { exact: true }).waitFor()
      assert.equal(generationRequests.length, 3)
      setCompleted(true)
      await panel.getByText('3 个生成任务已完成', { exact: true }).waitFor()
      await capture('07-worker-result-notice')

      setCompleted(false)
      await send(page, '第二张太暗了，重画亮一点')
      const regenerate = panel.getByRole('button', { name: '确认生成', exact: true })
      await regenerate.waitFor()
      await capture('08-redraw-confirmation')
      await regenerate.click()
      await panel.getByText('本轮已结束', { exact: true }).waitFor()
      assert.equal(generationRequests.length, 4)
      assert.match(generationRequests.at(-1).prompt, /画面明亮/)
      await panel.getByRole('button', { name: '撤销本轮' }).click()
      await panel.getByRole('button', { name: '撤销本轮' }).waitFor()
      assert.equal(await panel.getByRole('button', { name: '撤销本轮' }).isDisabled(), true)
      assert.equal(generationRequests.length, 4)
      await capture('09-undo-without-cancelling-job')
      await writeFile(path.join(output, 'result.json'), JSON.stringify({ status: 'passed', captures: 9,
        fakeModelStreams: calls.length, mockedGenerationRequests: generationRequests.length, providerRequests: 0 }, null, 2))
    } finally { await page.close() }
  } finally {
    if (previousFake === undefined) delete process.env.CANVAS_AGENT_FAKE_MODEL
    else process.env.CANVAS_AGENT_FAKE_MODEL = previousFake
  }
}

try {
  const { page, calls, requests, generationRequests } = await open()
  assert.ok(!requests.some((url) => /CanvasAgentPanel-/.test(url)))
  await page.keyboard.press('Control+j')
  const panel = page.getByRole('complementary', { name: '喵导 · 画布助手' })
  await panel.waitFor()
  const picker = panel.getByRole('combobox', { name: '喵导模型' })
  await picker.getByRole('option', { name: 'kimi 测试' }).waitFor({ state: 'attached' })
  assert.equal(await picker.inputValue(), models[0].modelKey)
  assert.ok(requests.some((url) => /CanvasAgentPanel-/.test(url)))
  await page.locator('.react-flow__node').first().click({ position: { x: 95, y: 70 } })
  await page.getByPlaceholder('告诉喵导你想做什么…').focus()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.react-flow__node.selected').count(), 1)
  await page.locator('.react-flow__node').first().click({ position: { x: 95, y: 70 } })
  const generator = page.locator('.nori-canvas-generator')
  await generator.waitFor()
  const [generatorRect, panelRect] = await Promise.all([generator.boundingBox(), panel.boundingBox()])
  assert.ok(generatorRect && panelRect && generatorRect.x + generatorRect.width <= panelRect.x,
    'the regular node generator must remain beside the agent panel')
  await page.screenshot({ path: path.join(artifacts, 'generator-and-agent.png') })
  await picker.selectOption('kimi::fixture')
  await send(page, '创建五个镜头')
  await waitNodes(page, 6)
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 5)
  await panel.getByText('本轮已结束', { exact: true }).waitFor({ timeout: 10_000 })
  assert.deepEqual(calls.slice(0, 2).map(({ context }) => [context.modelKey, context.turnIndex]), [['kimi::fixture', 0], ['kimi::fixture', 1]])
  assert.ok(calls[1].messages.some((item) => item.parts.some((part) => part.type === 'tool-build_graph' && part.state === 'output-available')))
  await page.screenshot({ path: path.join(artifacts, 'blueprint-committed.png') })
  await page.locator('.nori-canvas-workspace').focus()
  await page.keyboard.press('Control+z')
  await waitNodes(page, 1)
  results.push('lazy-loading, tool continuation, pinned model and one-step undo')

  await picker.selectOption('openai::fixture')
  await send(page, '请问风格')
  await panel.getByRole('button', { name: '水墨', exact: true }).click()
  await panel.getByText('本轮已结束', { exact: true }).waitFor()
  assert.deepEqual(calls.slice(2, 4).map(({ context }) => [context.modelKey, context.turnIndex]), [['openai::fixture', 0], ['openai::fixture', 1]])
  assert.ok(calls[3].messages.some((item) => item.parts.some((part) => part.type === 'tool-ask_user' && part.output?.answer === '水墨')))
  results.push('ask card and next-turn model changes')

  await send(page, '创建八个镜头')
  await page.waitForFunction(() => document.querySelectorAll('.nori-canvas-agent-ghost-node').length === 8)
  assert.equal(await picker.isDisabled(), true)
  const viewport = page.locator('.react-flow__viewport')
  const beforePreview = await viewport.evaluate((element) => element.style.transform)
  await panel.getByRole('button', { name: '在画布上预览蓝图' }).click()
  await page.waitForFunction((original) => document.querySelector('.react-flow__viewport')?.style.transform !== original, beforePreview)
  await page.screenshot({ path: path.join(artifacts, 'blueprint-preview.png') })
  await panel.getByRole('button', { name: '放到画布' }).click()
  await waitNodes(page, 9)
  await page.locator('.is-agent-touched').first().waitFor()
  await page.locator('.nori-canvas-agent-ghost-node').first().waitFor({ state: 'detached' })
  await page.locator('.is-agent-touched').first().waitFor({ state: 'detached' })
  await panel.getByText('本轮已结束', { exact: true }).waitFor()
  const undoTurn = panel.getByRole('button', { name: '撤销本轮' })
  assert.equal(await undoTurn.isDisabled(), false)
  await page.locator('.react-flow__node').filter({ hasText: '镜头1' }).first().click()
  await page.locator('.nori-canvas-workspace').focus()
  await page.keyboard.press('ArrowRight')
  await page.waitForFunction(() => document.querySelector('.nori-canvas-agent-card[aria-label=\"本轮回执\"] button')?.disabled === true)
  await page.locator('.react-flow__node').filter({ hasText: '镜头2' }).first().click({ modifiers: ['Shift'] })
  const selectionBar = page.locator('.nori-canvas-selection-toolbar')
  await selectionBar.waitFor()
  const selectionRect = await selectionBar.boundingBox()
  assert.ok(selectionRect && panelRect && selectionRect.x + selectionRect.width <= panelRect.x,
    'the selection toolbar must remain beside the agent panel')
  await send(page, '删除四个节点')
  await panel.getByRole('button', { name: '保留', exact: true }).click()
  await panel.getByText('本轮已结束', { exact: true }).waitFor()
  await waitNodes(page, 9)
  assert.ok(calls.at(-1).messages.some((item) => item.parts.some((part) => part.type === 'tool-delete_nodes' && part.output?.status === 'declined')))
  results.push('blueprint ghosts, touch feedback and declined deletion')

  await send(page, '生成镜头1')
  const confirm = panel.getByRole('button', { name: '确认生成', exact: true })
  await confirm.waitFor()
  assert.equal(generationRequests.length, 0)
  await page.screenshot({ path: path.join(artifacts, 'generation-confirmation.png') })
  await confirm.click()
  await panel.getByText('本轮已结束', { exact: true }).waitFor()
  assert.equal(generationRequests.length, 1)
  assert.match(generationRequests[0].nodeId, /^[0-9a-f-]{36}$/)
  assert.equal(generationRequests[0].prompt, '写镜头脚本')
  assert.equal(generationRequests[0].modelKey, 'fixture::text')
  assert.ok(calls.at(-1).messages.some((item) => item.parts.some((part) =>
    part.type === 'tool-generate' && part.errorText?.startsWith('GENERATE_FAILED'))))
  results.push('generation approval reaches the existing submission route exactly once; no provider call')

  await send(page, '创建批量测试图')
  await panel.getByText('本轮已结束', { exact: true }).waitFor()
  await send(page, '批量生成三张图')
  const confirmAll = panel.getByRole('button', { name: '全部确认（共 27 点）', exact: true })
  await confirmAll.waitFor({ timeout: 8000 })
  assert.equal(generationRequests.filter((request) => request.type === 'image').length, 0)
  await confirmAll.click()
  await panel.getByText('预计 13 点', { exact: false }).waitFor({ timeout: 12000 })
  assert.deepEqual(generationRequests.filter((request) => request.type === 'image').map((request) => request.options.resolution), ['1K', '2K'])
  await panel.getByRole('button', { name: '先不生成', exact: true }).click()
  await panel.getByText('本轮已结束', { exact: true }).waitFor()
  assert.equal(generationRequests.filter((request) => request.type === 'image').length, 2)
  results.push('one batch confirmation submits only unchanged quoted tasks; a price change requires new consent')
  await page.close()

  const unavailable = await open('', false)
  await unavailable.page.getByRole('button', { name: '打开喵导' }).click()
  await unavailable.page.getByText('管理平台尚未开放可用模型。').waitFor()
  assert.equal(await unavailable.page.getByPlaceholder('告诉喵导你想做什么…').isDisabled(), true)
  await unavailable.page.close()
  const narrow = await open('', true, { width: 390, height: 844 })
  await narrow.page.getByRole('button', { name: '打开喵导' }).click()
  const narrowPanel = narrow.page.getByRole('complementary', { name: '喵导 · 画布助手' })
  await narrowPanel.waitFor()
  await narrowPanel.getByRole('option', { name: 'kimi 测试' }).waitFor({ state: 'attached' })
  const narrowRect = await narrowPanel.boundingBox()
  const railRect = await narrow.page.locator('.nori-canvas-tool-rail').boundingBox()
  assert.ok(narrowRect && railRect && narrowRect.x >= railRect.x + railRect.width
    && narrowRect.x + narrowRect.width <= 390 && narrowRect.y + narrowRect.height <= 844,
  'the narrow panel must fit without blocking the canvas tool rail')
  await narrow.page.screenshot({ path: path.join(artifacts, 'narrow-panel.png') })
  await narrow.page.close()
  results.push('390px panel remains inside the viewport and clears the canvas tool rail')
  for (const query of ['?story=1', '?readonly=1']) {
    const { page } = await open(query)
    assert.equal(await page.locator('.nori-canvas-agent-launcher').count(), 0)
    await page.close()
  }
  results.push('read-only, story and no-model gates')
  await verifySiblingConflict()
  results.push('two tabs recover a real browser 409 without losing the worker terminal output or either edit')
  await verifyManualCameraPriority()
  results.push('a recent manual pan wins over automatic follow even for off-screen new nodes')
  await runExperienceStory()
  results.push('nine-step cafe workflow via the actual offline fake model with screenshot evidence')
  assert.deepEqual(issues, [])
  await writeFile(path.join(artifacts, 'result.json'), JSON.stringify({ status: 'passed', results }, null, 2))
  console.log(JSON.stringify({ status: 'passed', results }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
