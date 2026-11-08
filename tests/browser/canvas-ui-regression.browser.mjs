// Real CanvasGraph / generator / account UI; all writes and generation APIs
// are mocked locally. No paid model calls and no production data changes.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const operations = await import(path.join(root, 'src/lib/canvas/operations.ts'))
const { validateCanvasOperationsSaveInput } = operations.default || operations
const documentContract = await import(path.join(root, 'src/lib/canvas/document.ts'))
const { validateCanvasDocumentSaveInput } = documentContract.default || documentContract
const artifacts = path.join(root, 'test-results/canvas-ui-regression')
await mkdir(artifacts, { recursive: true })
let appCss
const workspace = new URL(process.env.NORI_WORKSPACE_URL || 'http://127.0.0.1:3000')
assert.ok(['localhost', '127.0.0.1'].includes(workspace.hostname))
if (process.env.NORI_BROWSER_GLOBAL_CSS_PATH) appCss = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH, 'utf8')
else {
  const html = await (await fetch(new URL('/zh/auth/signin', workspace))).text()
  const styles = [...html.matchAll(/<link\b[^>]*>/g)]
    .filter(([tag]) => tag.includes('rel="stylesheet"'))
    .map(([tag]) => tag.match(/href="([^"]+)"/)?.[1]).filter((href) => href?.startsWith('/_next/static/'))
  assert.ok(styles.length, 'Local guarded app must be running')
  appCss = (await Promise.all(styles.map(async (href) => (await fetch(new URL(href, workspace))).text()))).join('\n')
}
const media = await readFile(process.env.NORI_TEST_VIDEO_PATH || path.join(artifacts, 'sample.mp4'))
const bundle = process.env.NORI_BROWSER_PREBUILT_DIR ? {
  outputFiles: await Promise.all(['js', 'css'].map(async (extension) => ({
    path: `/fixture/fixture.${extension}`,
    contents: await readFile(path.join(process.env.NORI_BROWSER_PREBUILT_DIR, `canvas-ui-regression.${extension}`)),
  }))),
} : await (await import('esbuild')).build({
  entryPoints: ['tests/browser/canvas-ui-regression.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).contents
const server = createServer((request, response) => {
  if (request.url.startsWith('/api/storage/sign')) {
    const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = match ? Math.min(Number(match[1]), media.length - 1) : 0
    const end = match?.[2] ? Math.min(Number(match[2]), media.length - 1) : media.length - 1
    response.writeHead(match ? 206 : 200, {
      'Content-Type': 'video/mp4', 'Content-Disposition': 'inline', 'Accept-Ranges': 'bytes',
      'Content-Length': end - start + 1,
      ...(match ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}),
    })
    response.end(media.subarray(start, end + 1))
  } else if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(script)
  } else if (request.url === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css'); response.end(css)
  } else if (request.url === '/global.css') {
    response.setHeader('Content-Type', 'text/css'); response.end(appCss)
  } else {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []
const cases = []
let latestPage
const model = {
  modelKey: 'kuaizi::doubao-seedance-2-5-260628', name: 'doubao-seedance-2-5-260628', provider: 'kuaizi', configured: true, available: true,
  supportGenerateAudio: true, firstLastFrame: true,
  options: { duration: [4, 5, 6, 8, 10], resolution: ['480p', '720p'], aspectRatio: ['16:9', '9:16', '1:1'] },
  inputSchema: { image: { min: 0, max: 30 }, video: { min: 0, max: 10 }, audio: { min: 0, max: 10 }, requiredFields: ['prompt'] },
}
const canvas = { id: 'canvas-1', projectId: 'project-1', title: '交互回归', revision: 0, viewport: { x: 0, y: 0, zoom: 1 }, themeColor: null, visibility: 'workspace', forkedFromId: null, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z' }
const common = { canvasId: 'canvas-1', runId: null, mediaObjectId: null, parentNodeId: null }
const reference = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#36517d"/></svg>')

async function open(viewport, query = '') {
  const page = await browser.newPage({ viewport })
  latestPage = page
  page.on('pageerror', (error) => errors.push(error.message))
  let savedLimit = query.includes('accounts') ? 100 : null
  page.setQuota = (value) => { savedLimit = value }
  let walletPoints = 1000
  page.setWallet = (value) => { walletPoints = value }
  let holdNextBalance = query.includes('slow=1')
  const heldBalanceReads = []
  let firstHeldBalance
  page.firstHeldBalance = new Promise((resolve) => { firstHeldBalance = resolve })
  page.armStaleBalanceRead = () => { holdNextBalance = true }
  page.releaseStaleBalanceRead = () => heldBalanceReads.shift()?.()
  let holdNextAccounts = false
  let releaseHeldRead
  page.armStaleAccountRead = () => { holdNextAccounts = true }
  page.releaseStaleAccountRead = () => releaseHeldRead?.()
  let failNextVideoGeneration = false
  page.failNextVideoGeneration = () => { failNextVideoGeneration = true }
  let failNextRecoverySave = false
  page.failNextRecoverySave = () => { failNextRecoverySave = true }
  let failNextRecoveryConflict = false
  page.failNextRecoveryConflict = () => { failNextRecoveryConflict = true }
  let bumpNextCanvasRead = false
  page.bumpNextCanvasRead = () => { bumpNextCanvasRead = true }
  page.canvasWrites = []
  const usage = () => ({
    timeZone: 'Asia/Shanghai', limitPoints: savedLimit, usedPoints: 110, consumedPoints: 80, pendingPoints: 30,
    remainingPoints: savedLimit !== null ? Math.max(0, savedLimit - 110) : null, exceeded: savedLimit !== null && savedLimit <= 110, resetsAt: '2026-10-08T16:00:00.000Z',
  })
  const account = () => ({ id: 'child-1', username: '回归子账号', role: 'writer', roleLabel: '编剧', status: 'active', permissions: [], credits: { coins: 0, points: 1000 }, dailyLimitPoints: savedLimit, usageToday: usage(), createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z', lastLoginAt: null, usage: { byType: [], cost: 0, count: 0 } })
  let graph = {
    canvas, edges: [
      { id: 'edge-wired', canvasId: 'canvas-1', sourceNodeId: 'ref-1', targetNodeId: 'gen-1', sourceHandle: 'output', targetHandle: 'input', role: 'INPUT_DEFAULT' },
      ...(query.includes('secondary=1') ? [{ id: 'edge-secondary', canvasId: 'canvas-1', sourceNodeId: 'ref-2', targetNodeId: 'ref-1', sourceHandle: 'output', targetHandle: 'input', role: 'INPUT_DEFAULT' }] : []),
    ],
    nodes: [
      query.includes('first=1')
        ? { ...common, id: 'gen-1', type: 'video', position: { x: 440, y: 140 }, size: { width: 320, height: 180 }, status: 'IDLE', taskId: null, data: { title: '视频生成节点', mediaType: 'video', prompt: '', origin: 'empty', generation: { modelKey: model.modelKey }, history: [] } }
        : { ...common, id: 'gen-1', type: 'video', position: { x: 440, y: 140 }, size: { width: 320, height: 180 }, status: 'RUNNING', taskId: 'task-1', data: { title: '视频生成节点', mediaType: 'video', prompt: '', origin: 'generate', generation: { assetId: 'video-1', taskId: 'task-1', modelKey: model.modelKey, ...(query.includes('superresolve') ? { parameters: { superresolveTarget: '720p' } } : {}) }, history: [{ id: 'history-1', assetId: 'video-1', taskId: 'task-1', status: 'processing', createdAt: '2026-10-08T00:00:00.000Z' }] } },
      ...Array.from({ length: 20 }, (_, i) => ({ ...common, id: `ref-${i + 1}`, type: 'image', position: { x: -1100, y: i * 230 }, size: { width: 320, height: 180 }, status: 'IDLE', taskId: null, data: { title: `参考素材${i + 1}`, mediaType: 'image', origin: 'upload', contentUrl: reference, imageUrl: reference, materialId: `material-${i + 1}` } })),
      ...(query.includes('globalstyle=1') ? [
        { ...common, id: 'image-near', type: 'image', position: { x: 860, y: 140 }, size: { width: 300, height: 170 }, status: 'IDLE', taskId: null, data: { title: '近景图片', mediaType: 'image', origin: 'upload', contentUrl: reference, imageUrl: reference, materialId: 'material-near' } },
        { ...common, id: 'style-1', type: 'text', position: { x: 60, y: 470 }, size: { width: 300, height: 150 }, status: 'IDLE', taskId: null, data: { title: '风格源', mediaType: 'text', text: '统一水彩绘本风，柔和自然光', origin: 'upload' } },
        { ...common, id: 'style-2', type: 'text', position: { x: 420, y: 470 }, size: { width: 300, height: 150 }, status: 'IDLE', taskId: null, data: { title: '备用风格', mediaType: 'text', text: '霓虹黑金质感', origin: 'upload' } },
      ] : []),
    ],
  }
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.port === workspace.port) return route.continue()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/storage/sign') return route.continue()
    let payload
    if (url.pathname.endsWith('/generation-config')) payload = { textModels: [], imageModels: [], videoModels: [model], audioModels: [], model3dModels: [], defaults: { videoModel: model.modelKey, aspectRatio: '16:9', resolution: '720p' } }
    else if (url.pathname === '/api/interactive') payload = query.includes('story') ? { story: { workId: 'work-story', name: '回归分镜', aspectRatio: '16:9', resolution: '1080p', canManage: true, config: { variables: [] }, chapters: [{ projectId: 'project-1', name: '第一章' }] } } : { story: null }
    else if (url.pathname.endsWith('/generate') && route.request().method() === 'POST') {
      const body = route.request().postDataJSON()
      page.lastGenerateBody = body
      assert.equal(body.type, 'video')
      const target = graph.nodes.find((node) => node.id === body.nodeId)
      assert.ok(target, 'The generation target must be durable before task submission')
      if (!query.includes('first=1')) {
        assert.ok(graph.edges.some((edge) => edge.targetNodeId === body.nodeId && edge.sourceNodeId === 'ref-1'), 'The inherited input must be durable before task submission')
      }
      if (failNextVideoGeneration) {
        failNextVideoGeneration = false
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '模拟生成提交失败' }) })
        return
      }
      const taskId = query.includes('first=1') ? 'first-task' : 'comparison-task'
      const assetId = query.includes('first=1') ? 'first-asset' : 'comparison-asset'
      page.comparisonNodeId = body.nodeId
      graph.nodes = graph.nodes.map((node) => node.id === body.nodeId ? { ...node, status: 'RUNNING', taskId, data: { ...node.data, prompt: body.prompt, generation: { ...node.data.generation, modelKey: body.modelKey, assetId, taskId } } } : node)
      payload = { success: true, tasks: [{ taskId, assetId, nodeId: body.nodeId }] }
    }
    else if (url.pathname === '/api/projects/project-1') payload = { work: { id: 'project-1', name: '回归作品', workId: 'work-1', workName: '回归项目' } }
    else if (url.pathname === '/api/frameos/materials') payload = {
      materials: [
        { id: 'library-character', projectId: 'project-1', projectName: '回归项目', ownerName: null, title: '林夏', type: 'image', source: 'upload', status: 'ready', isFavorited: true, resultUrl: reference, storageKey: null, url: reference, metadata: { assetCategory: 'character' }, createdAt: '2026-10-08', updatedAt: '2026-10-08' },
        { id: 'library-location', projectId: 'project-1', projectName: '回归项目', ownerName: null, title: '雨夜街巷', type: 'image', source: 'upload', status: 'ready', isFavorited: false, resultUrl: reference, storageKey: null, url: reference, metadata: { assetCategory: 'location' }, createdAt: '2026-10-08', updatedAt: '2026-10-08' },
      ], projects: [], pagination: { nextCursor: null },
    }
    else if (url.pathname.endsWith('/generation-quote')) payload = { points: 20, costCny: 0.2 }
    else if (url.pathname.endsWith('/balance')) {
      payload = { balancePoints: walletPoints, generationAllowed: walletPoints > 0 && !usage().exceeded, dailyLimitPoints: savedLimit, dailyUsedPoints: 110, dailyLimitExceeded: usage().exceeded }
      if (holdNextBalance) {
        holdNextBalance = false
        await new Promise((resolve) => { heldBalanceReads.push(resolve); firstHeldBalance() })
      }
    }
    else if (url.pathname.endsWith('/toolbox/assets')) {
      const ids = url.searchParams.get('assetIds')?.split(',') || []
      const assets = [{ id: 'video-1', type: 'video', status: 'ready', resultUrl: 'images/ui.mp4', url: 'images/ui.mp4', materialId: 'video-material', task: { id: 'task-1', status: 'completed', progress: 100, costPoints: 20 } }]
      if (ids.includes('comparison-asset')) assets.push({ id: 'comparison-asset', type: 'video', status: 'processing', resultUrl: null, url: null, materialId: null, task: { id: 'comparison-task', status: 'processing', progress: 2, costPoints: 20 } })
      payload = { assets: assets.filter((asset) => ids.includes(asset.id)) }
    }
    else if (url.pathname.endsWith('/materials') && route.request().method() === 'POST') {
      if (query.includes('capture-fail')) {
        await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '模拟关键帧上传失败' }) })
        return
      }
      payload = { material: { id: 'frame-material-1', title: '视频关键帧', url: reference } }
    }
    else if (url.pathname.endsWith('/admin/accounts/child-1')) {
      assert.equal(route.request().method(), 'PATCH')
      const value = route.request().postDataJSON().dailyPointLimit
      savedLimit = value === 'unlimited' ? null : Number(value)
      payload = { success: true, account: account() }
    } else if (url.pathname.endsWith('/admin/accounts')) {
      payload = { workspaces: [{ manager: { id: 'user-1', username: '测试管理账号', credits: { points: 1000 }, dailyLimitPoints: null }, subaccounts: [account()], usage: { projects: 1, assets: 20, byType: [] } }] }
      if (holdNextAccounts) {
        holdNextAccounts = false
        page.heldAccountUrl = url.toString()
        await new Promise((resolve) => { releaseHeldRead = resolve })
      }
    }
    else if (url.pathname.endsWith('/operations') && route.request().method() === 'POST') {
      const operation = route.request().postDataJSON()
      page.operationRequests = [...(page.operationRequests || []), operation]
      if (operation.operation === 'grid_split') {
        payload = {
          success: true,
          operation: 'grid_split',
          results: operation.selectedCells.map((cell, index) => ({
            index, row: cell.row, col: cell.col, width: 1200, height: 800,
            title: `参考素材1 · 切片 ${index + 1}`,
            materialId: `grid-material-${index + 1}`,
            url: reference,
          })),
        }
      } else {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ message: '浏览器回归未配置该处理操作' }) })
        return
      }
    }
    else if (url.pathname.endsWith('/operations')) payload = { engines: [], latestTask: null, latestTaskLinks: null }
    else if (url.pathname.endsWith('/studio-document')) payload = {
      studioDocument: { projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'stress-node', revision: 1, document: {}, updatedAt: null, persisted: true, source: 'document' },
    }
    else if (url.pathname.includes('/canvas/canvas-1')) {
      if (route.request().method() === 'GET' && bumpNextCanvasRead) {
        bumpNextCanvasRead = false
        graph = { ...graph, canvas: { ...graph.canvas, revision: graph.canvas.revision + 1 } }
      }
      if (route.request().method() !== 'GET') {
        const body = route.request().postDataJSON()
        if (failNextRecoverySave && body?.nodes) {
          failNextRecoverySave = false
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: '模拟恢复保存失败' }) })
          return
        }
        if (failNextRecoveryConflict && body?.nodes) {
          failNextRecoveryConflict = false
          graph = { ...graph, canvas: { ...graph.canvas, revision: graph.canvas.revision + 1 } }
          await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '模拟恢复版本冲突', actualRevision: graph.canvas.revision }) })
          return
        }
        page.canvasWrites.push({ path: url.pathname, body })
        if (body?.ops) {
          const validated = validateCanvasOperationsSaveInput(body)
          assert.ok(validated.success, `Canvas operations must satisfy the real server allowlist: ${JSON.stringify(body)}`)
        }
        if (body?.nodes) {
          const validated = validateCanvasDocumentSaveInput(body)
          assert.ok(validated.success, 'Full canvas saves must satisfy the real server document validator')
        }
        if (body?.nodes) graph = { ...graph, nodes: body.nodes }
        if (body?.edges) graph = { ...graph, edges: body.edges }
        for (const op of body?.ops || []) {
          if (op.type === 'node.upsert') {
            const exists = graph.nodes.some((node) => node.id === op.node.id)
            graph.nodes = exists ? graph.nodes.map((n) => n.id === op.node.id ? { ...n, ...op.node } : n) : [...graph.nodes, op.node]
          }
          if (op.type === 'edge.add') {
            if (graph.edges.some((edge) => edge.id === op.edge.id)) {
              await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ message: '连线已存在', actualRevision: graph.canvas.revision }) })
              return
            }
            graph.edges = [...graph.edges, op.edge]
          }
          if (op.type === 'edge.delete') graph.edges = graph.edges.filter((edge) => edge.id !== op.id)
          if (op.type === 'node.delete') graph.nodes = graph.nodes.filter((node) => node.id !== op.id)
        }
        graph = { ...graph, canvas: { ...graph.canvas, revision: graph.canvas.revision + 1 } }
      }
      payload = graph
    } else payload = { voices: [], materials: [], projects: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
  if (query.includes('legacy-frame-recovery=1')) {
    await page.addInitScript(async ({ nodes, edges }) => {
      if (sessionStorage.getItem('legacy-frame-recovery-seeded')) return
      const key = 'canvas-draft-v1:user-1:project-1:canvas-1'
      if (sessionStorage.getItem('legacy-frame-recovery-slow')) {
        await new Promise((resolve) => setTimeout(resolve, 600))
        sessionStorage.removeItem('legacy-frame-recovery-slow')
      }
      const frame = { ...nodes.find((node) => node.id === 'ref-1'), id: 'legacy-frame' }
      const draft = {
        key, schema_version: 1,
        namespace: { accountId: 'user-1', projectId: 'project-1', canvasId: 'canvas-1' },
        document: { schema_version: 1, expectedRevision: 0, clientId: 'old-tab', changeSummary: '已添加视频关键帧', viewport: { x: 0, y: 0, zoom: 1 }, nodes: [...nodes, frame], edges: [...edges, { id: 'legacy-frame-edge', canvasId: 'canvas-1', sourceNodeId: 'gen-1', targetNodeId: 'legacy-frame', sourceHandle: 'output', targetHandle: 'input', role: 'VIDEO_FRAME' }] },
        pendingOps: [], lastServerRevision: 0, baseRevision: 0, dirty: true, retryAttempt: 5,
        lastError: '画布文档格式无效。', updatedAt: Date.now(),
      }
      await new Promise((resolve, reject) => {
        const request = indexedDB.open('nori-canvas-offline-v1', 1)
        request.onupgradeneeded = () => request.result.createObjectStore('pending_documents', { keyPath: 'key' })
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const transaction = request.result.transaction('pending_documents', 'readwrite')
          transaction.objectStore('pending_documents').put(draft)
          transaction.oncomplete = () => {
            sessionStorage.setItem('legacy-frame-recovery-seeded', '1')
            resolve()
          }
          transaction.onerror = () => reject(transaction.error)
        }
      })
    }, graph)
  }
  await page.goto(`${base}/${query}`)
  return page
}
async function bounded(locator, label) {
  const rect = await locator.evaluate((el) => {
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, right: r.right, bottom: r.bottom, width: r.width, viewportWidth: innerWidth, viewportHeight: innerHeight }
  })
  assert.ok(rect.x >= -1 && rect.y >= -1 && rect.right <= rect.viewportWidth + 1 && rect.bottom <= rect.viewportHeight + 1, `${label} must fit the viewport: ${JSON.stringify(rect)}`)
  return rect
}
async function openNodeContextMenu(page, nodeId) {
  await page.locator(`.react-flow__node[data-id="${nodeId}"]`).evaluate((element) => {
    const box = element.getBoundingClientRect()
    element.dispatchEvent(new MouseEvent('contextmenu', {
      bubbles: true, cancelable: true, button: 2,
      clientX: box.left + Math.max(8, box.width / 2),
      clientY: box.top + 16,
    }))
  })
  const menu = page.getByRole('menu', { name: '节点操作' })
  await menu.waitFor()
  return menu
}
async function setCanvasGlobalStyle(page, nodeId) {
  const menu = await openNodeContextMenu(page, nodeId)
  await menu.getByRole('menuitem', { name: /设为全局风格/ }).click()
}
async function clearCanvasGlobalStyle(page, nodeId) {
  const menu = await openNodeContextMenu(page, nodeId)
  await menu.getByRole('menuitem', { name: /取消全局风格/ }).click()
}
async function selectCanvasNode(page, nodeId) {
  const node = page.locator(`.react-flow__node[data-id="${nodeId}"]`)
  const isSelected = () => page.waitForFunction((id) => document.querySelector(`.react-flow__node[data-id="${id}"]`)?.classList.contains('selected'), nodeId, { timeout: 4000 })
  await node.locator('.nori-canvas-node-drag-handle').evaluate((element) => element.click())
  try {
    await isSelected()
  } catch {
    // A preceding synthetic gesture can leave pointer state that swallows the
    // handle click; select through the node wrapper instead.
    await node.evaluate((element) => element.click())
    await isSelected()
  }
}
async function pasteInto(locator, text) {
  await locator.evaluate((element, value) => {
    const data = new DataTransfer()
    data.setData('text/plain', value)
    const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'clipboardData', { value: data })
    element.dispatchEvent(event)
  }, text)
}
async function findEmptyCanvasPoint(page, pane) {
  const point = await page.evaluate((box) => {
    for (let y = box.y + box.height - 40; y > box.y + 80; y -= 40) {
      for (let x = box.x + 40; x < box.x + box.width - 40; x += 80) {
        const element = document.elementFromPoint(x, y)
        if (element && !element.closest('.react-flow__node, .nori-canvas-generator, .react-flow__minimap, .nori-canvas-viewport-controls, .nori-canvas-dialog, [role="menu"], .nori-canvas-menu-portal')) return { x, y }
      }
    }
    return null
  }, pane)
  assert.ok(point, 'The canvas must expose an empty point for pan and zoom gestures')
  return point
}
try {
  if (process.env.NORI_CANVAS_LEGACY_FRAME_RECOVERY_ONLY) {
    const page = await open({ width: 1440, height: 900 }, '?legacy-frame-recovery=1')
    await page.getByText('发现本地未同步版本', { exact: true }).waitFor()
    const recoverySave = page.waitForResponse(async (response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname.endsWith('/document')
      && response.status() === 200
      && response.request().postDataJSON()?.nodes?.some((node) => node.id === 'legacy-frame'))
    await page.getByRole('button', { name: '恢复本地', exact: true }).click()
    const savedDocument = (await recoverySave).request().postDataJSON()
    const restoredEdge = savedDocument.edges.find((edge) => edge.id === 'legacy-frame-edge')
    assert.equal(restoredEdge?.role, 'REF', 'Recovery must migrate the legacy frame-capture role before the full save')
    assert.ok(savedDocument.nodes.some((node) => node.id === 'legacy-frame'), 'Recovery must preserve the local frame node')
    assert.ok(validateCanvasDocumentSaveInput(savedDocument).success, 'The recovered document must pass the real server validator')
    await page.locator('.react-flow__node[data-id="legacy-frame"]').waitFor()
    await page.locator('.react-flow__edge[data-id="legacy-frame-edge"]').waitFor()
    await page.waitForFunction(() => !document.querySelector('.nori-canvas-save-status')?.textContent?.includes('未保存'))
    assert.equal(await page.locator('.react-flow__node').count(), 22, 'Recovery must not discard any local nodes')
    assert.equal(await page.locator('.react-flow__edge').count(), 2, 'Recovery must preserve both the original input and the captured-frame wire')
    assert.equal(page.canvasWrites.flatMap((write) => write.body.edges || []).some((edge) => edge.role === 'VIDEO_FRAME'), false, 'No write may retain the obsolete role')
    cases.push('legacy IndexedDB recovery migrates VIDEO_FRAME to REF and saves every local node and wire')
    await page.close()

    const conflictRecovery = await open({ width: 1440, height: 900 }, '?legacy-frame-recovery=1')
    await conflictRecovery.getByText('发现本地未同步版本', { exact: true }).waitFor()
    conflictRecovery.failNextRecoveryConflict()
    const conflictResponse = conflictRecovery.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname.endsWith('/document') && response.status() === 409)
    const conflictRetry = conflictRecovery.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname.endsWith('/document') && response.status() === 200)
    await conflictRecovery.getByRole('button', { name: '恢复本地', exact: true }).click()
    assert.equal((await conflictResponse).request().postDataJSON().expectedRevision, 0)
    const conflictDocument = (await conflictRetry).request().postDataJSON()
    assert.equal(conflictDocument.expectedRevision, 1, 'The retry must use the revision returned by the automatic server read')
    assert.equal(conflictDocument.nodes.length, 22)
    assert.equal(conflictDocument.edges.length, 2)
    assert.equal(conflictDocument.edges.find((edge) => edge.id === 'legacy-frame-edge')?.role, 'REF')
    assert.ok(validateCanvasDocumentSaveInput(conflictDocument).success)
    assert.equal(conflictRecovery.canvasWrites.some((write) => write.path.endsWith('/ops')), false, 'Recovery conflicts must not degrade into operations')
    await conflictRecovery.locator('.react-flow__node[data-id="legacy-frame"]').waitFor()
    await conflictRecovery.locator('.react-flow__edge[data-id="legacy-frame-edge"]').waitFor()
    assert.equal(await conflictRecovery.locator('.react-flow__node').count(), 22)
    assert.equal(await conflictRecovery.locator('.react-flow__edge').count(), 2)
    cases.push('recovery conflicts reread the revision and retry the same complete migrated document')
    await conflictRecovery.close()

    const failedRecovery = await open({ width: 1440, height: 900 }, '?legacy-frame-recovery=1')
    await failedRecovery.evaluate(() => {
      sessionStorage.setItem('legacy-frame-recovery-slow', '1')
      const channel = new BroadcastChannel('nori-canvas:user-1:project-1:canvas-1')
      channel.postMessage({ type: 'canvas-revision', source: 'unrelated-tab', revision: 99 })
      setTimeout(() => channel.close(), 100)
    })
    await failedRecovery.reload()
    await failedRecovery.getByText('发现本地未同步版本', { exact: true }).waitFor()
    failedRecovery.failNextRecoverySave()
    const failedSave = failedRecovery.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/document') && response.status() === 503)
    await failedRecovery.getByRole('button', { name: '恢复本地', exact: true }).click()
    await failedSave
    await failedRecovery.getByRole('button', { name: '画布工具', exact: true }).click()
    await failedRecovery.locator('.nori-canvas-save-state.is-offline').waitFor()
    const cachedRecovery = await failedRecovery.evaluate(async () => {
      await new Promise((resolve) => setTimeout(resolve, 180))
      const request = indexedDB.open('nori-canvas-offline-v1', 1)
      return await new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const read = request.result.transaction('pending_documents', 'readonly').objectStore('pending_documents').get('canvas-draft-v1:user-1:project-1:canvas-1')
          read.onerror = () => reject(read.error)
          read.onsuccess = () => resolve(read.result)
        }
      })
    })
    assert.equal(cachedRecovery?.dirty, true)
    assert.equal(cachedRecovery?.document?.nodes?.length, 22)
    assert.equal(cachedRecovery?.document?.edges?.find((edge) => edge.id === 'legacy-frame-edge')?.role, 'REF')
    const retrySave = failedRecovery.waitForResponse((response) => response.request().method() === 'PUT' && new URL(response.url()).pathname.endsWith('/document') && response.status() === 200)
    await failedRecovery.locator('.nori-canvas-save-state.is-offline').click()
    const retriedDocument = (await retrySave).request().postDataJSON()
    assert.equal(retriedDocument.nodes.length, 22)
    assert.equal(retriedDocument.edges.length, 2)
    assert.equal(retriedDocument.edges.find((edge) => edge.id === 'legacy-frame-edge')?.role, 'REF')
    assert.ok(validateCanvasDocumentSaveInput(retriedDocument).success)
    await failedRecovery.locator('.react-flow__node[data-id="legacy-frame"]').waitFor()
    assert.equal(await failedRecovery.locator('.react-flow__node').count(), 22)
    cases.push('failed recovery caches the complete document across viewport events, sibling notifications and retry')
    await failedRecovery.close()

    const serverRecovery = await open({ width: 1440, height: 900 }, '?legacy-frame-recovery=1')
    await serverRecovery.evaluate(() => sessionStorage.setItem('legacy-frame-recovery-slow', '1'))
    await serverRecovery.reload()
    await serverRecovery.getByText('发现本地未同步版本', { exact: true }).waitFor()
    await serverRecovery.getByRole('button', { name: '使用服务器', exact: true }).click()
    await serverRecovery.locator('.nori-canvas-offline-recovery-dialog').waitFor({ state: 'detached' })
    assert.equal(await serverRecovery.locator('.react-flow__node').count(), 21)
    assert.equal(await serverRecovery.locator('.react-flow__edge').count(), 1)
    assert.equal(await serverRecovery.locator('.react-flow__node[data-id="legacy-frame"]').count(), 0)
    const deletedDraft = await serverRecovery.waitForFunction(async () => {
      const request = indexedDB.open('nori-canvas-offline-v1', 1)
      return await new Promise((resolve, reject) => {
        request.onerror = () => reject(request.error)
        request.onsuccess = () => {
          const read = request.result.transaction('pending_documents', 'readonly').objectStore('pending_documents').get('canvas-draft-v1:user-1:project-1:canvas-1')
          read.onerror = () => reject(read.error)
          read.onsuccess = () => resolve(read.result === undefined)
        }
      })
    })
    assert.ok(await deletedDraft.jsonValue())
    await serverRecovery.reload()
    await serverRecovery.locator('.react-flow__node[data-id="gen-1"]').waitFor()
    await serverRecovery.getByText('正在检查本地未同步版本', { exact: false }).waitFor({ state: 'detached' })
    assert.equal(await serverRecovery.getByText('发现本地未同步版本', { exact: true }).count(), 0)
    assert.equal(await serverRecovery.locator('.react-flow__node').count(), 21)
    assert.equal(serverRecovery.canvasWrites.length, 0, 'Choosing the server version must not write the discarded local document')
    cases.push('choosing the server version deletes the durable local draft without saving or prompting it again')
    await serverRecovery.close()

    const siblingRecovery = await open({ width: 1440, height: 900 }, '?legacy-frame-recovery=1')
    await siblingRecovery.evaluate(() => sessionStorage.setItem('legacy-frame-recovery-slow', '1'))
    await siblingRecovery.reload()
    await siblingRecovery.getByText('发现本地未同步版本', { exact: true }).waitFor()
    await siblingRecovery.evaluate(() => {
      const channel = new BroadcastChannel('nori-canvas:user-1:project-1:canvas-1')
      channel.postMessage({ type: 'canvas-revision', source: 'unrelated-tab', revision: 1 })
      setTimeout(() => channel.close(), 100)
    })
    siblingRecovery.failNextRecoverySave()
    const siblingFailedSave = siblingRecovery.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname.endsWith('/document') && response.status() === 503)
    await siblingRecovery.getByRole('button', { name: '恢复本地', exact: true }).click()
    await siblingFailedSave
    await siblingRecovery.getByRole('button', { name: '画布工具', exact: true }).click()
    await siblingRecovery.locator('.nori-canvas-save-state.is-offline').waitFor()
    siblingRecovery.bumpNextCanvasRead()
    await siblingRecovery.evaluate(() => {
      const channel = new BroadcastChannel('nori-canvas:user-1:project-1:canvas-1')
      channel.postMessage({ type: 'canvas-revision', source: 'other-tab', revision: 1 })
      setTimeout(() => channel.close(), 100)
    })
    const siblingRetry = siblingRecovery.waitForResponse((response) => response.request().method() === 'PUT'
      && new URL(response.url()).pathname.endsWith('/document') && response.status() === 200)
    const siblingDocument = (await siblingRetry).request().postDataJSON()
    assert.equal(siblingDocument.expectedRevision, 1)
    assert.equal(siblingDocument.nodes.length, 22)
    assert.equal(siblingDocument.edges.length, 2)
    assert.equal(siblingDocument.edges.find((edge) => edge.id === 'legacy-frame-edge')?.role, 'REF')
    assert.ok(validateCanvasDocumentSaveInput(siblingDocument).success)
    assert.equal(siblingRecovery.canvasWrites.some((write) => write.path.endsWith('/ops')), false)
    await siblingRecovery.locator('.react-flow__node[data-id="legacy-frame"]').waitFor()
    assert.equal(await siblingRecovery.locator('.react-flow__node').count(), 22)
    cases.push('sibling revision sync preserves the selected recovery document and retries a full save')
    await siblingRecovery.close()
    assert.deepEqual(errors, [], 'No uncaught browser errors')
    console.log(JSON.stringify({ ok: true, cases, legacyFrameRecoveryOnly: true }, null, 2))
  } else {
  const shared = await open({ width: 1024, height: 600 }, '?session=child')
  const sharedGenerator = shared.locator('.nori-canvas-generator')
  await sharedGenerator.getByRole('button', { name: '生成', exact: true }).waitFor()
  await shared.waitForFunction(() => !document.querySelector('.nori-canvas-generate-button')?.disabled)
  shared.setQuota(0)
  await shared.waitForFunction(() => document.querySelector('.nori-canvas-generate-button')?.disabled)
  assert.ok((await sharedGenerator.getByRole('button', { name: '生成', exact: true }).getAttribute('title')).includes('禁止生成'))
  shared.setQuota(null)
  await shared.waitForFunction(() => !document.querySelector('.nori-canvas-generate-button')?.disabled)
  shared.setWallet(0)
  await shared.waitForFunction(() => document.querySelector('.nori-canvas-generate-button')?.disabled)
  assert.ok((await sharedGenerator.getByRole('button', { name: '生成', exact: true }).getAttribute('title')).includes('积分不足'))
  await shared.screenshot({ path: path.join(artifacts, 'child-shared-wallet-gate.png') })
  await shared.close()

  const slowBilling = await open({ width: 1024, height: 600 }, '?view=billing&session=child&slow=1')
  await slowBilling.firstHeldBalance
  slowBilling.armStaleBalanceRead()
  const secondSlowRequest = slowBilling.waitForRequest((request) => new URL(request.url()).pathname === '/api/user/balance')
  await slowBilling.getByRole('button', { name: '刷新额度', exact: true }).click()
  await secondSlowRequest
  slowBilling.releaseStaleBalanceRead()
  await slowBilling.waitForFunction(() => !document.querySelector('[data-testid="generate"]').disabled)
  slowBilling.releaseStaleBalanceRead()
  await slowBilling.close()

  const firstGeneration = await open({ width: 1440, height: 900 }, '?first=1')
  const firstGenerator = firstGeneration.locator('.nori-canvas-generator')
  await firstGenerator.locator('textarea[role="combobox"]').fill('空视频节点的第一次生成')
  const firstSubmission = firstGeneration.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/generate'))
  await firstGenerator.getByRole('button', { name: '生成', exact: true }).click()
  const firstRequest = (await firstSubmission).postDataJSON()
  await firstGeneration.getByText('已提交 1 个生成任务', { exact: true }).waitFor()
  await firstGeneration.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 21)
  assert.equal(firstRequest.nodeId, 'gen-1')
  assert.equal(await firstGeneration.locator('.react-flow__node').count(), 21, 'The first generation must reuse the empty video node')
  assert.equal(await firstGeneration.locator('.react-flow__edge').count(), 1, 'The first generation must preserve the original input without duplicating it')
  assert.equal(await firstGeneration.getByText('对照视频已提交，原视频和输入连线已保留', { exact: true }).count(), 0)
  assert.equal(firstGeneration.canvasWrites.filter((write) => write.body?.ops?.some((op) => (op.type === 'node.upsert' && op.node.id !== 'gen-1') || op.type === 'edge.add')).length, 0, 'The first generation must not persist a comparison draft')
  cases.push('first video generation reuses its empty node and original input wire')
  await firstGeneration.close()

  const comparison = await open({ width: 1440, height: 900 }, '?story=1')
  const comparisonGenerator = comparison.locator('.nori-canvas-generator')
  await comparison.locator('.nori-story-bar').waitFor()
  await comparisonGenerator.locator('textarea[role="combobox"]').fill('雨停之后，角色转身看向镜头')
  const comparisonSubmission = comparison.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/generate'))
  await comparisonGenerator.getByRole('button', { name: '生成', exact: true }).click()
  const comparisonRequest = (await comparisonSubmission).postDataJSON()
  await comparison.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 22)
  assert.notEqual(comparisonRequest.nodeId, 'gen-1')
  assert.equal(comparisonRequest.prompt, '雨停之后，角色转身看向镜头')
  assert.equal(comparisonRequest.modelKey, model.modelKey)
  await comparison.locator(`.react-flow__node[data-id="${comparisonRequest.nodeId}"]`).waitFor()
  await comparison.getByText('对照视频已提交，原视频和输入连线已保留', { exact: true }).waitFor()
  await comparison.waitForFunction(
    () => document.querySelectorAll('.react-flow__edge').length === 2,
    undefined,
    { timeout: 10000 },
  )
  assert.ok(await comparison.locator('.react-flow__node[data-id="gen-1"] video').count(), 'The original generated video must remain')
  assert.equal(await comparison.locator('.react-flow__node[data-id="ref-1"]').count(), 1, 'Reference nodes must not be duplicated')
  await comparison.waitForFunction(() => document.querySelector('.nori-canvas-generator')?.classList.contains('is-node-anchored'))
  const anchorBeforeDrag = await comparisonGenerator.evaluate((element) => ({
    left: element.style.left,
    top: element.style.top,
    placement: element.getAttribute('data-anchor-placement'),
    maxHeight: element.querySelector('.nori-canvas-generator-scroll')?.style.maxHeight || '',
  }))
  assert.ok(anchorBeforeDrag.left && anchorBeforeDrag.top && anchorBeforeDrag.maxHeight, 'The visible generator must be anchored with settled geometry')
  assert.equal(anchorBeforeDrag.placement, 'below')
  const dragHandle = await comparison.locator('.react-flow__node[data-id="gen-1"] .nori-canvas-node-drag-handle').boundingBox()
  await comparison.mouse.move(dragHandle.x + dragHandle.width / 2, dragHandle.y + dragHandle.height / 2)
  await comparison.mouse.down()
  await comparison.mouse.move(dragHandle.x + 100, dragHandle.y + 420, { steps: 8 })
  await comparison.waitForFunction(() => document.querySelector('.nori-canvas-workspace')?.classList.contains('is-node-dragging'))
  await comparison.waitForFunction(() => getComputedStyle(document.querySelector('.nori-story-bar')).visibility === 'hidden')
  const anchorDuringDrag = await comparisonGenerator.evaluate((element) => ({
    left: element.style.left,
    top: element.style.top,
    placement: element.getAttribute('data-anchor-placement'),
    maxHeight: element.querySelector('.nori-canvas-generator-scroll')?.style.maxHeight || '',
  }))
  assert.deepEqual(anchorDuringDrag, anchorBeforeDrag, 'The hidden generator must freeze its anchored geometry for the whole gesture, including before a vertical flip')
  await comparison.mouse.up()
  await comparison.waitForFunction(() => getComputedStyle(document.querySelector('.nori-story-bar')).visibility === 'visible')
  await comparison.waitForFunction(
    (frozen) => document.querySelector('.nori-canvas-generator-scroll')?.style.maxHeight !== frozen,
    anchorBeforeDrag.maxHeight,
    { timeout: 5000 },
  )
  await comparison.waitForFunction(() => document.querySelector('.nori-canvas-generator')?.getAttribute('data-anchor-placement') === 'above', undefined, { timeout: 5000 })
  const anchorAfterDrag = await comparisonGenerator.evaluate((element) => ({
    left: element.style.left,
    top: element.style.top,
    placement: element.getAttribute('data-anchor-placement'),
    maxHeight: element.querySelector('.nori-canvas-generator-scroll')?.style.maxHeight || '',
  }))
  assert.equal(anchorAfterDrag.placement, 'above', 'Dragging the node down must flip the settled anchor above the node')
  assert.notEqual(anchorAfterDrag.maxHeight, anchorBeforeDrag.maxHeight, 'The anchored panel must re-measure once the drag settles instead of keeping the frozen height')
  await comparison.screenshot({ path: path.join(artifacts, 'video-comparison-storyboard-restored.png') })
  cases.push('video comparison preserves source and input wires; storyboard and anchored generator freeze while hidden and re-measure after drag')
  await comparison.close()

  const failedComparison = await open({ width: 1440, height: 900 }, '?story=1&superresolve=720p')
  const failedGenerator = failedComparison.locator('.nori-canvas-generator')
  await failedComparison.locator('.nori-story-bar').waitFor()
  await failedGenerator.locator('textarea[role="combobox"]').fill('保留原镜头的失败重试')
  failedComparison.failNextVideoGeneration()
  await failedGenerator.getByRole('button', { name: '生成', exact: true }).click()
  await failedComparison.getByText('模拟生成提交失败', { exact: true }).waitFor()
  await failedComparison.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 21)
  assert.ok(await failedComparison.locator('.react-flow__node[data-id="gen-1"] video').count(), 'A failed comparison must not change the original video')
  await failedComparison.locator('.react-flow__edge[data-id="edge-wired"]').waitFor()
  assert.equal(await failedComparison.locator('.react-flow__edge').count(), 1, 'A failed comparison must remove only its inherited input')
  await failedGenerator.locator('textarea[role="combobox"]').fill('失败后重新提交对照镜头')
  const retrySubmission = failedComparison.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/generate'))
  await failedGenerator.getByRole('button', { name: '生成', exact: true }).click()
  const retryRequest = (await retrySubmission).postDataJSON()
  await failedComparison.getByText('对照视频已提交，原视频和输入连线已保留', { exact: true }).waitFor()
  await failedComparison.locator(`.react-flow__node[data-id="${retryRequest.nodeId}"]`).waitFor()
  await failedComparison.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 2)
  assert.notEqual(retryRequest.nodeId, 'gen-1')
  assert.equal(retryRequest.options.superresolveTarget, '720p', 'Retry must preserve the saved superresolution target')
  cases.push('failed comparison submission removes its durable draft and can be retried')
  await failedComparison.close()

  const globalStyle = await open({ width: 1440, height: 900 }, '?first=1&globalstyle=1')
  const globalGenerator = globalStyle.locator('.nori-canvas-generator')
  const globalPrompt = globalGenerator.locator('textarea[role="combobox"]')
  await globalPrompt.waitFor()
  assert.equal(await globalGenerator.locator('.nori-canvas-global-style').count(), 0, 'No global style is injected before a text node is flagged')
  await setCanvasGlobalStyle(globalStyle, 'style-1')
  await selectCanvasNode(globalStyle, 'gen-1')
  const styleBlock = globalGenerator.locator('.nori-canvas-global-style')
  await styleBlock.waitFor()
  assert.ok((await styleBlock.innerText()).includes('来自文本节点「风格源」'))
  assert.equal(await styleBlock.evaluate((element) => getComputedStyle(element).backgroundImage), 'none', 'The global style must use a solid colour rather than a decorative gradient')
  assert.equal(await styleBlock.evaluate((element) => getComputedStyle(element).backgroundColor), 'rgba(110, 123, 255, 0.1)', 'The global style must remain visually distinct from the ordinary prompt')
  const styleEditor = styleBlock.getByLabel('画布全局风格提示词')
  assert.equal(await styleEditor.inputValue(), '统一水彩绘本风，柔和自然光')
  await styleEditor.fill('统一水彩绘本风，柔和自然光，浅金色描边')
  await globalStyle.waitForFunction(() => document.querySelector('.react-flow__node[data-id="style-1"]')?.textContent?.includes('浅金色描边'))
  assert.equal(await styleEditor.inputValue(), '统一水彩绘本风，柔和自然光，浅金色描边')
  await setCanvasGlobalStyle(globalStyle, 'style-2')
  await selectCanvasNode(globalStyle, 'gen-1')
  await globalStyle.waitForFunction(() => document.querySelector('.nori-canvas-global-style')?.textContent?.includes('备用风格'))
  assert.equal(await globalGenerator.locator('.nori-canvas-global-style textarea').inputValue(), '霓虹黑金质感')
  const clearedStyleMenu = await openNodeContextMenu(globalStyle, 'style-1')
  assert.equal(await clearedStyleMenu.getByRole('menuitem', { name: /取消全局风格/ }).count(), 0, 'Setting a second source must clear the first global-style flag')
  await clearedStyleMenu.getByRole('menuitem', { name: /设为全局风格/ }).waitFor()
  await globalStyle.keyboard.press('Escape')
  await clearCanvasGlobalStyle(globalStyle, 'style-2')
  await globalStyle.waitForFunction(() => !document.querySelector('.nori-canvas-global-style'))
  assert.ok((await globalStyle.locator('.react-flow__node[data-id="style-2"]').innerText()).includes('霓虹黑金质感'), 'Clearing the flag must retain the text node content')
  await setCanvasGlobalStyle(globalStyle, 'style-1')
  await selectCanvasNode(globalStyle, 'gen-1')
  await globalGenerator.locator('.nori-canvas-global-style textarea').waitFor()
  assert.equal(await globalGenerator.locator('.nori-canvas-global-style textarea').inputValue(), '统一水彩绘本风，柔和自然光，浅金色描边')
  await selectCanvasNode(globalStyle, 'image-near')
  await globalStyle.waitForFunction(() => document.querySelector('.nori-canvas-global-style')?.textContent?.includes('来自文本节点「风格源」'))
  assert.ok((await globalStyle.locator('.nori-canvas-generator').innerText()).includes('来自文本节点「风格源」'), 'Image prompt editors must show the same global style source')
  const imageToolbar = globalStyle.locator('.react-flow__node-toolbar[data-id~="image-near"]')
  const inlineActionLabels = ['替换内容', '全屏预览', '下载', '收藏', '超清', '720 全景', '涂抹改图', '宫格切分']
  for (const label of inlineActionLabels) await imageToolbar.getByRole('button', { name: label, exact: true }).waitFor()
  assert.equal(await imageToolbar.getByRole('button', { name: '更多操作', exact: true }).count(), 0, 'Image tools must not hide behind an overflow menu')
  assert.equal(await imageToolbar.getByRole('button', { name: '生成历史', exact: true }).count(), 0, 'Image tools still omit actions without history')
  await imageToolbar.waitFor()
  if (process.env.NORI_CANVAS_TOOLBAR_DIAGNOSTICS) console.log(await globalStyle.evaluate(async () => {
    const samples = []
    for (let index = 0; index < 20; index += 1) {
      const toolbar = document.querySelector('.react-flow__node-toolbar[data-id~="image-near"]')
      const node = document.querySelector('.react-flow__node[data-id="image-near"]')
      const surface = document.querySelector('.nori-canvas-workspace')
      samples.push({ toolbar: toolbar?.getBoundingClientRect().toJSON(), style: toolbar?.getAttribute('style'), node: node?.getBoundingClientRect().toJSON(), surface: surface?.getBoundingClientRect().toJSON() })
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    return samples
  }))
  await globalStyle.waitForFunction(() => {
    const toolbar = document.querySelector('.react-flow__node-toolbar[data-id~="image-near"]')
    if (!toolbar) return false
    const bounds = toolbar.getBoundingClientRect()
    return bounds.left >= 0 && bounds.right <= innerWidth
  })
  const toolbarBounds = await bounded(imageToolbar, 'Image toolbar')
  assert.ok(toolbarBounds.width <= 290, 'Image tools fit the available 300px node width')
  await imageToolbar.getByRole('button', { name: '宫格切分', exact: true }).click()
  await globalStyle.getByRole('dialog', { name: /^宫格切分 ·/ }).waitFor()
  await globalStyle.getByRole('button', { name: '取消', exact: true }).click()
  await imageToolbar.getByRole('button', { name: '涂抹改图', exact: true }).click()
  await globalStyle.locator('.nori-canvas-image-edit-dialog').waitFor()
  await globalStyle.locator('.nori-canvas-image-edit-dialog header button[title="关闭"]').click()
  await globalStyle.getByRole('button', { name: '关闭节点编辑器', exact: true }).click()
  await globalStyle.waitForFunction(() => !document.querySelector('.nori-canvas-generator'))
  await selectCanvasNode(globalStyle, 'image-near')
  await imageToolbar.getByRole('button', { name: '720 全景', exact: true }).click()
  await globalStyle.waitForFunction(() => [...document.querySelectorAll('.react-flow__node')].some((node) => node.textContent?.includes('720全景')))
  const panoramaGenerator = globalStyle.locator('.nori-canvas-generator')
  await panoramaGenerator.getByRole('button', { name: '生成', exact: true }).waitFor()
  assert.equal(await panoramaGenerator.locator('textarea[role="combobox"]').inputValue(), '把参考场景转换为无缝衔接的 21:9 超宽幅 720° 全景图。保持原场景的建筑、陈设、材质、时间、天气与光影一致；补全画面左右和背后的空间，地平线保持水平，画面边缘可无缝拼接；不要人物特写、文字、水印、边框或多宫格。')
  assert.equal(await globalStyle.locator('.nori-canvas-dialog').count(), 0, '720 panorama creates a linked image-processing draft without paid generation')
  await selectCanvasNode(globalStyle, 'image-near')
  for (let index = 0; index < 3; index += 1) {
    await globalStyle.locator('.nori-canvas-viewport-controls').getByRole('button', { name: '放大', exact: true }).click()
  }
  await globalStyle.waitForTimeout(350)
  await bounded(imageToolbar, 'Zoomed image toolbar')
  const imageDragHandle = globalStyle.locator('.react-flow__node[data-id="image-near"] .nori-canvas-node-drag-handle')
  const dragBounds = await imageDragHandle.boundingBox()
  assert.ok(dragBounds, 'Image node must expose its drag handle')
  await globalStyle.mouse.move(dragBounds.x + dragBounds.width / 2, dragBounds.y + dragBounds.height / 2)
  await globalStyle.mouse.down()
  await globalStyle.mouse.move(dragBounds.x + dragBounds.width / 2 - 130, dragBounds.y + dragBounds.height / 2 + 25, { steps: 12 })
  await globalStyle.mouse.up()
  await globalStyle.waitForTimeout(250)
  await bounded(imageToolbar, 'Dragged image toolbar')
  cases.push('image tools stay inline, fit the node, follow zoom and drag, and invoke grid, inpaint and panorama actions')
  await selectCanvasNode(globalStyle, 'gen-1')
  await globalPrompt.fill('第一次带全局风格的镜头')
  const globalSubmission = globalStyle.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/generate'))
  await globalGenerator.getByRole('button', { name: '生成', exact: true }).click()
  const globalGenerate = (await globalSubmission).postDataJSON()
  await globalStyle.getByText('已提交 1 个生成任务', { exact: true }).waitFor()
  assert.equal(globalGenerate.prompt, '第一次带全局风格的镜头\n\n[画布全局风格]\n统一水彩绘本风，柔和自然光，浅金色描边\n[/画布全局风格]')
  assert.equal((globalGenerate.prompt.match(/\[画布全局风格\]/g) || []).length, 1, 'Request assembly must inject exactly one global style block')
  assert.ok(globalGenerate.prompt.startsWith('第一次带全局风格的镜头'), 'The user prompt must be preserved before the injected block')
  await globalStyle.waitForFunction(() => document.querySelector('.react-flow__node[data-id="style-1"]')?.textContent?.includes('浅金色描边'))
  cases.push('global style text node feeds video and image editors, stays unique, syncs edits, and injects one block')
  await globalStyle.close()

  const styledComparison = await open({ width: 1440, height: 900 }, '?story=1&globalstyle=1')
  const styledGenerator = styledComparison.locator('.nori-canvas-generator')
  await styledComparison.locator('.nori-story-bar').waitFor()
  await styledGenerator.locator('textarea[role="combobox"]').waitFor()
  await setCanvasGlobalStyle(styledComparison, 'style-1')
  await selectCanvasNode(styledComparison, 'gen-1')
  await styledGenerator.locator('.nori-canvas-global-style').waitFor()
  await styledGenerator.locator('textarea[role="combobox"]').fill('全局风格的对照镜头')
  const styledSubmission = styledComparison.waitForRequest((request) => request.method() === 'POST' && new URL(request.url()).pathname.endsWith('/generate'))
  await styledGenerator.getByRole('button', { name: '生成', exact: true }).click()
  const styledGenerate = (await styledSubmission).postDataJSON()
  await styledComparison.getByText('对照视频已提交，原视频和输入连线已保留', { exact: true }).waitFor()
  assert.notEqual(styledGenerate.nodeId, 'gen-1')
  assert.equal(styledGenerate.prompt, '全局风格的对照镜头\n\n[画布全局风格]\n统一水彩绘本风，柔和自然光\n[/画布全局风格]')
  assert.equal((styledGenerate.prompt.match(/\[画布全局风格\]/g) || []).length, 1, 'Comparison generation must also receive exactly one block')
  cases.push('comparison generation inherits the same single global style block')
  await styledComparison.close()

  const readOnlyImage = await open({ width: 1440, height: 900 }, '?first=1&globalstyle=1&session=child&readonly=1')
  await selectCanvasNode(readOnlyImage, 'image-near')
  const readOnlyToolbar = readOnlyImage.locator('.react-flow__node-toolbar[data-id~="image-near"]')
  for (const label of ['全屏预览', '下载']) await readOnlyToolbar.getByRole('button', { name: label, exact: true }).waitFor()
  for (const label of ['替换内容', '收藏', '超清', '720 全景', '涂抹改图', '宫格切分']) {
    assert.equal(await readOnlyToolbar.getByRole('button', { name: label, exact: true }).count(), 0, `Read-only image tools must hide ${label}`)
  }
  await readOnlyImage.close()
  cases.push('read-only image tools retain viewing actions without mutation tools')

  const narrowImage = await open({ width: 390, height: 700 }, '?first=1&globalstyle=1')
  await selectCanvasNode(narrowImage, 'image-near')
  const narrowToolbar = narrowImage.locator('.react-flow__node-toolbar[data-id~="image-near"]')
  await narrowToolbar.waitFor()
  await narrowImage.waitForFunction(() => {
    const toolbar = document.querySelector('.react-flow__node-toolbar[data-id~="image-near"]')
    if (!toolbar) return false
    const bounds = toolbar.getBoundingClientRect()
    return bounds.left >= 0 && bounds.right <= innerWidth
  })
  await bounded(narrowToolbar, 'Narrow image toolbar')
  await narrowToolbar.getByRole('button', { name: '宫格切分', exact: true }).click()
  await narrowImage.getByRole('dialog', { name: /^宫格切分 ·/ }).waitFor()
  await narrowImage.close()
  cases.push('narrow viewport image tools remain visible and operable')

  const secondary = await open({ width: 1440, height: 900 }, '?secondary=1')
  const secondaryGenerator = secondary.locator('.nori-canvas-generator')
  const secondaryPrompt = secondaryGenerator.locator('textarea[role="combobox"]')
  await secondaryPrompt.waitFor()
  await secondaryPrompt.fill('')
  await secondaryPrompt.pressSequentially('@')
  const secondaryMentions = secondary.getByRole('listbox', { name: '@ 素材', exact: true })
  await secondaryMentions.waitFor()
  await secondary.waitForFunction(() => document.querySelectorAll('[role="option"]').length >= 2)
  assert.equal(await secondaryMentions.getByRole('option').count(), 2, 'Only the direct input and one extra upstream hop may be offered')
  assert.equal(await secondaryMentions.locator('h3').filter({ hasText: '已连接节点' }).count(), 1)
  assert.equal(await secondaryMentions.locator('h3').filter({ hasText: '二级连接节点' }).count(), 1)
  assert.ok((await secondaryMentions.getByRole('option').filter({ hasText: '参考素材1' }).innerText()).includes('已连接节点'))
  assert.ok((await secondaryMentions.getByRole('option').filter({ hasText: '参考素材2' }).innerText()).includes('二级连接节点'))
  await secondaryPrompt.pressSequentially('林')
  await secondaryMentions.getByRole('option', { name: /林夏/ }).first().waitFor()
  await secondary.keyboard.press('Escape')
  await secondaryMentions.waitFor({ state: 'hidden' })
  await secondaryPrompt.fill('')
  const nodesBeforePaste = await secondary.locator('.react-flow__node').count()
  const edgesBeforePaste = await secondary.locator('.react-flow__edge').count()
  await pasteInto(secondaryPrompt, '林夏和雨夜街巷')
  assert.equal(await secondaryPrompt.inputValue(), '@林夏和@雨夜街巷', 'Pasting must prefix known asset names while preserving ordinary text')
  await secondary.waitForFunction((before) => document.querySelectorAll('.react-flow__node').length === before + 2, nodesBeforePaste)
  await secondary.waitForFunction((before) => document.querySelectorAll('.react-flow__edge').length === before + 2, edgesBeforePaste)
  assert.equal(await secondaryGenerator.getByRole('button', { name: /林夏/ }).count(), 1)
  assert.equal(await secondaryGenerator.getByRole('button', { name: /雨夜街巷/ }).count(), 1)
  cases.push('mention picker separates direct and second-hop inputs; pasted prompts bind known library asset names')
  await secondary.close()

  if (process.env.NORI_CANVAS_FRAME_CAPTURE_ONLY) {
    const page = await open({ width: 1280, height: 720 })
    await page.locator('.react-flow__node[data-id="gen-1"] video').waitFor()
    await page.waitForFunction(() => document.querySelector('.react-flow__node[data-id="gen-1"] video')?.readyState >= 2)
    await page.locator('.react-flow__node[data-id="gen-1"] .nori-canvas-video').hover()
    await page.locator('.react-flow__node[data-id="gen-1"]').getByRole('button', { name: '放大预览', exact: true }).click()
    const preview = page.locator('.nori-canvas-media-preview')
    await preview.waitFor()
    await page.waitForFunction(() => document.querySelector('.nori-canvas-media-preview video')?.readyState >= 2)
    await preview.locator('video').evaluate((element) => { element.currentTime = 0.5; element.pause() })
    await preview.getByRole('button', { name: '截取当前帧', exact: true }).click()
    await page.getByText('关键帧已添加到画布', { exact: true }).waitFor()
    await page.waitForTimeout(4000)
    const captureWrite = page.canvasWrites.find((write) => write.body.ops?.some((op) => op.type === 'edge.add') || write.body.edges?.length > 1)
    assert.ok(captureWrite, 'Captured frame must produce a save operation')
    const added = captureWrite.body.ops?.find((op) => op.type === 'edge.add')
      || captureWrite.body.edges?.map((edge) => ({ type: 'edge.add', edge })).find((op) => op.edge.sourceNodeId === 'gen-1')
    assert.equal(added.edge.role, 'REF')
    const frameNode = page.canvasWrites.flatMap((write) => write.body.ops || []).find((op) => op.type === 'node.upsert' && op.node.data?.generation?.parameters?.videoFrameCapture === true)?.node
    assert.equal(added.edge.targetNodeId, frameNode?.id, 'Capture must retain its durable material binding')
    assert.equal(frameNode?.data?.materialId, 'frame-material-1')
    assert.equal(page.canvasWrites.every((write) => typeof write.body.changeSummary === 'string'), true)
    cases.push('captured video frame persists through the real document and operations validators')
    assert.deepEqual(errors, [], 'No uncaught browser errors')
    console.log(JSON.stringify({ ok: true, cases, frameCaptureOnly: true }, null, 2))
  } else if (process.env.NORI_CANVAS_GENERATION_ONLY) {
    assert.deepEqual(errors, [], 'No uncaught browser errors')
    console.log(JSON.stringify({ ok: true, cases, generationOnly: true }, null, 2))
  }

  const billing = await open({ width: 1024, height: 600 }, '?view=billing&session=child')
  await billing.getByTestId('wallet-points').getByText('1000', { exact: true }).waitFor()
  assert.equal(await billing.getByTestId('wallet-scope').textContent(), 'workspace')
  assert.equal(await billing.getByTestId('generate').isEnabled(), true)
  billing.armStaleBalanceRead()
  const heldBalanceRequest = billing.waitForRequest((request) => new URL(request.url()).pathname === '/api/user/balance')
  await billing.getByRole('button', { name: '刷新额度', exact: true }).click()
  await heldBalanceRequest
  billing.setQuota(0)
  await billing.getByRole('button', { name: '刷新额度', exact: true }).click()
  await billing.getByTestId('wallet-status').getByText('管理账号已禁止生成（每日上限 0）', { exact: true }).waitFor()
  const heldBalanceResponse = billing.waitForResponse((response) => new URL(response.url()).pathname === '/api/user/balance')
  billing.releaseStaleBalanceRead()
  await heldBalanceResponse
  assert.equal(await billing.getByTestId('generate').isDisabled(), true, 'An old unlimited response cannot overwrite a newer zero cap')
  billing.setQuota(null)
  await billing.getByRole('button', { name: '刷新额度', exact: true }).click()
  await billing.waitForFunction(() => !document.querySelector('[data-testid="generate"]').disabled)
  billing.armStaleBalanceRead()
  billing.setWallet(0)
  const switchedBalanceRequest = billing.waitForRequest((request) => new URL(request.url()).pathname === '/api/user/balance')
  await billing.getByRole('button', { name: '切换子账号', exact: true }).click()
  await switchedBalanceRequest
  await billing.getByTestId('wallet-status').getByText('正在核对可用积分与每日额度', { exact: true }).waitFor()
  assert.equal(await billing.getByTestId('wallet-points').textContent(), '0', 'Do not show a previous account wallet while switching identity')
  assert.equal(await billing.getByTestId('generate').isDisabled(), true)
  billing.releaseStaleBalanceRead()
  await billing.getByTestId('wallet-status').getByText('积分不足，无法生成', { exact: true }).waitFor()
  await billing.close()

  for (const viewport of [{ width: 1280, height: 720 }, { width: 1024, height: 600 }, { width: 1366, height: 768 }, { width: 1920, height: 1080 }, { width: 768, height: 480 }, { width: 1280, height: 480 }]) {
    const page = await open(viewport)
    const generator = page.locator('.nori-canvas-generator')
    await generator.waitFor()
    await bounded(generator, 'Generator')
    await bounded(generator.getByRole('button', { name: '生成参数', exact: true }), 'Parameters button')
    await bounded(generator.getByRole('button', { name: '生成', exact: true }), 'Generate button')
    if (viewport.width === 1280) {
      page.setQuota(0)
      await page.waitForFunction(() => document.querySelector('.nori-canvas-generate-button')?.disabled, { timeout: 5000 })
      assert.ok((await generator.getByRole('button', { name: '生成', exact: true }).getAttribute('title')).includes('禁止生成'))
      page.setQuota(null)
      await page.waitForFunction(() => !document.querySelector('.nori-canvas-generate-button')?.disabled, { timeout: 5000 })
    }
    assert.equal(await generator.locator('.nori-canvas-generator-refs-label').evaluate((el) => getComputedStyle(el).writingMode), 'horizontal-tb')
    const footer = await generator.locator('.nori-canvas-generator-controls').boundingBox()
    const viewControls = await page.locator('.nori-canvas-viewport-controls').boundingBox()
    assert.ok(footer.y + footer.height <= viewControls.y, 'The canvas view bar must not cover the generator footer')
    const sound = generator.getByLabel('生成声音', { exact: true })
    await sound.waitFor()
    assert.equal(await sound.isChecked(), true, 'New videos must default to sound')
    await sound.uncheck()
    assert.equal(await sound.isChecked(), false, 'An explicit sound preference must not be reset')
    await sound.check()
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}x${viewport.height}-editor.png`) })
    await generator.getByRole('button', { name: '生成参数', exact: true }).click()
    const parameters = page.getByRole('dialog', { name: '生成参数设置' })
    await bounded(parameters, 'Parameter popover')
    assert.equal(await parameters.evaluate((el) => el.parentElement === document.body), true)
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}x${viewport.height}-parameters.png`) })
    await parameters.getByLabel('视频时长').selectOption('8')
    await parameters.getByRole('button', { name: '关闭生成参数' }).click()
    assert.equal(await parameters.count(), 0)
    assert.ok((await generator.locator('.nori-canvas-parameter-trigger').textContent()).includes('8s'))
    await generator.getByRole('button', { name: '生成参数', exact: true }).click()
    await parameters.getByLabel('视频时长').focus()
    await page.keyboard.press('Escape')
    assert.equal(await parameters.count(), 0)
    assert.equal(await generator.count(), 1, 'Escape must close parameters without deselecting the node')
    const prompt = generator.locator('textarea[role="combobox"]')
    await prompt.fill('让角色走入雨夜，')
    await prompt.evaluate((element) => element.setSelectionRange(element.value.length, element.value.length))
    await prompt.pressSequentially('@')
    const mentions = page.getByRole('listbox', { name: '@ 素材', exact: true })
    await mentions.waitFor()
    await bounded(mentions, '@ picker')
    await mentions.getByRole('button', { name: '角色 1', exact: true }).waitFor()
    assert.ok(await mentions.getByRole('button', { name: '收藏 1', exact: true }).count())
    assert.equal(await mentions.getByRole('option').count(), 1, 'Only the actual wired canvas node is initially selectable')
    assert.ok((await mentions.getByRole('option').textContent()).includes('参考素材1'))
    await mentions.screenshot({ path: path.join(artifacts, `${viewport.width}x${viewport.height}-mentions.png`) })
    await mentions.getByRole('button', { name: '角色 1', exact: true }).click()
    const nodeCountBeforeLibrary = await page.locator('.react-flow__node').count()
    const edgeCountBeforeLibrary = await page.locator('.react-flow__edge').count()
    await mentions.getByRole('option', { name: /林夏/ }).click()
    assert.equal(await prompt.inputValue(), '让角色走入雨夜，@林夏 ')
    await page.waitForFunction((before) => document.querySelectorAll('.react-flow__node').length === before + 1, nodeCountBeforeLibrary)
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node[data-id="gen-1"]').length === 1)
    await page.waitForFunction((before) => document.querySelectorAll('.react-flow__edge').length === before + 1, edgeCountBeforeLibrary)
    assert.equal(await generator.getByRole('button', { name: /林夏/ }).count(), 1)
    const nodeCountAfterLibrary = await page.locator('.react-flow__node').count()
    const edgeCountAfterLibrary = await page.locator('.react-flow__edge').count()
    await prompt.evaluate((element) => element.setSelectionRange(element.value.length, element.value.length))
    await prompt.pressSequentially('@林')
    await page.getByRole('option', { name: /林夏/ }).first().click()
    assert.equal(await prompt.inputValue(), '让角色走入雨夜，@林夏 @林夏 ')
    assert.equal(await page.locator('.react-flow__node').count(), nodeCountAfterLibrary, 'Selecting the same library material must reuse its canvas node')
    assert.equal(await page.locator('.react-flow__edge').count(), edgeCountAfterLibrary, 'Selecting the same library material must reuse its existing edge')
    await prompt.evaluate((element) => element.setSelectionRange(element.value.length, element.value.length))
    await prompt.pressSequentially('@雨')
    await page.getByRole('option', { name: /雨夜街巷/ }).waitFor()
    await page.keyboard.press('Enter')
    assert.equal(await prompt.inputValue(), '让角色走入雨夜，@林夏 @林夏 @雨夜街巷 ')
    await page.waitForFunction((before) => document.querySelectorAll('.react-flow__node').length === before + 1, nodeCountAfterLibrary)
    await page.waitForFunction((before) => document.querySelectorAll('.react-flow__edge').length === before + 1, edgeCountAfterLibrary)
    await generator.getByRole('button', { name: /雨夜街巷/ }).waitFor()
    const nodeCountAfterTwoMaterials = await page.locator('.react-flow__node').count()
    const edgeCountAfterTwoMaterials = await page.locator('.react-flow__edge').count()
    await generator.getByRole('button', { name: '添加引用素材', exact: true }).click()
    const picker = page.getByRole('dialog', { name: '选择引用素材', exact: true })
    await picker.waitFor()
    await picker.getByRole('button', { name: '关闭素材选择器', exact: true }).click()
    assert.equal(await picker.count(), 0)
    assert.equal(await generator.count(), 1)
    assert.equal(await page.locator('.react-flow__node').count(), nodeCountAfterTwoMaterials)
    assert.equal(await page.locator('.react-flow__edge').count(), edgeCountAfterTwoMaterials)
    await prompt.pressSequentially('@')
    const reopenedMentions = page.getByRole('listbox', { name: '@ 素材', exact: true })
    await reopenedMentions.waitFor()
    assert.equal(await reopenedMentions.getAttribute('aria-label'), '@ 素材')
    await page.keyboard.press('Escape')
    await reopenedMentions.waitFor({ state: 'hidden' })
    assert.equal(await reopenedMentions.count(), 0)
    assert.equal(await generator.count(), 1, 'Escape should dismiss the picker, not the editor')
    await prompt.focus()
    await page.keyboard.press('Escape')
    assert.equal(await generator.count(), 0, 'A second Escape must dismiss the generator')
    await page.locator('.react-flow__node[data-id="gen-1"] .nori-canvas-node-drag-handle').click()
    await generator.waitFor()
    const video = page.locator('.react-flow__node[data-id="gen-1"] video').first()
    await page.waitForFunction(() => document.querySelector('.react-flow__node[data-id="gen-1"] video')?.readyState >= 2)
    assert.ok((await video.getAttribute('src')).includes('playback=1'))
    assert.equal(await video.getAttribute('poster'), null, 'The video URL must not be used as its own poster')
    await video.evaluate((el) => el.play())
    assert.equal(await video.evaluate((el) => el.paused), false)
    await generator.getByRole('button', { name: '展开大编辑器' }).click()
    await bounded(generator, 'Expanded editor')
    await bounded(generator.getByRole('button', { name: '生成', exact: true }), 'Expanded generate button')
    await generator.locator('.nori-canvas-generator-back').click()
    await generator.getByRole('button', { name: '关闭节点编辑器' }).click()
    await page.getByRole('button', { name: '画布工具', exact: true }).click()
    const navigation = page.locator('[data-canvas-navigation-menu]')
    await bounded(navigation, 'Canvas navigation menu')
    await navigation.getByRole('button', { name: '作品资产', exact: true }).click()
    const assetsPanel = page.locator('.nori-canvas-project-assets')
    await bounded(assetsPanel, 'Project assets panel')
    await assetsPanel.locator('header button[title="关闭"]').click()
    const pane = await page.locator('.react-flow__pane').boundingBox()
    for (let i = 0; i < 6; i++) {
      await page.mouse.click(pane.x + pane.width - 35, pane.y + 220, { button: 'right' })
      const menu = page.getByRole('menu', { name: '画布操作' })
      await menu.waitFor()
      await bounded(menu, 'Context menu')
    }
    await page.mouse.move(pane.x + pane.width - 35, pane.y + 220)
    await page.mouse.down({ button: 'right' })
    await page.mouse.move(pane.x + pane.width - 70, pane.y + 240, { steps: 6 })
    await page.mouse.up({ button: 'right' })
    assert.equal(await page.getByRole('menu', { name: '画布操作' }).count(), 0, 'A real right drag must not leave a menu open')

    const viewportBeforePan = await page.locator('.react-flow__viewport').first().evaluate((element) => element.style.transform)
    const panStart = { x: pane.x + pane.width - 140, y: pane.y + 400 }
    await page.mouse.click(panStart.x, panStart.y)
    await page.keyboard.down('Space')
    await page.locator('.react-flow__pane.draggable').waitFor()
    await page.mouse.down()
    await page.mouse.move(panStart.x - 90, panStart.y + 45, { steps: 8 })
    assert.equal(await page.locator('.nori-canvas-marquee').count(), 0, 'Space panning must never draw the custom marquee')
    await page.waitForFunction((before) => document.querySelector('.react-flow__viewport')?.style.transform !== before, viewportBeforePan)
    assert.notEqual(await page.locator('.react-flow__viewport').first().evaluate((element) => element.style.transform), viewportBeforePan, 'Space+left drag must actually pan')
    await page.mouse.up()
    await page.keyboard.up('Space')
    assert.equal(await page.locator('.nori-canvas-marquee').count(), 0, 'Releasing a Space pan must not leave a marquee')

    const selectionBefore = await page.locator('.react-flow__node.selected').count()
    await page.mouse.move(pane.x + pane.width - 160, pane.y + 120)
    await page.mouse.down()
    await page.mouse.move(pane.x + pane.width - 60, pane.y + 200, { steps: 5 })
    assert.equal(await page.locator('.nori-canvas-marquee').count(), 1, 'An ordinary left drag must retain custom marquee selection')
    await page.mouse.up()
    assert.equal(await page.locator('.nori-canvas-marquee').count(), 0)
    assert.equal(await page.locator('.react-flow__node.selected').count(), selectionBefore, 'An empty marquee must preserve existing selections')

    await page.locator('.react-flow__node[data-id="gen-1"] .nori-canvas-node-drag-handle').click()
    await page.locator('.nori-canvas-generator').waitFor()
    const spacePrompt = page.locator('.nori-canvas-generator textarea[role="combobox"]').first()
    await spacePrompt.click()
    await page.keyboard.type('A')
    await page.keyboard.down('Space')
    await page.keyboard.up('Space')
    await page.keyboard.press('Escape')
    const afterEditorSpace = await page.locator('.react-flow__viewport').first().evaluate((element) => element.style.transform)
    await page.mouse.click(pane.x + pane.width - 35, pane.y + 220)
    await page.mouse.move(pane.x + pane.width - 35, pane.y + 220)
    await page.mouse.down()
    await page.mouse.move(pane.x + pane.width - 90, pane.y + 260, { steps: 5 })
    assert.equal(await page.locator('.nori-canvas-marquee').count(), 1, 'Space typed into an editor must not enable canvas panning')
    assert.equal(await page.locator('.react-flow__viewport').first().evaluate((element) => element.style.transform), afterEditorSpace)
    await page.mouse.up()

    await page.keyboard.down('Space')
    await page.mouse.move(pane.x + pane.width - 35, pane.y + 220)
    await page.mouse.down()
    await page.mouse.move(pane.x + pane.width - 90, pane.y + 260, { steps: 4 })
    await page.evaluate(() => window.dispatchEvent(new Event('blur')))
    await page.mouse.up()
    await page.keyboard.up('Space')
    assert.equal(await page.locator('.nori-canvas-marquee').count(), 0, 'Window blur must not strand the Space gesture state')
    await page.mouse.click(pane.x + pane.width - 35, pane.y + 220, { button: 'right' })
    await page.mouse.click(pane.x + pane.width - 35, pane.y + 220, { button: 'right' })
    await page.getByRole('menu', { name: '画布操作' }).waitFor()
    await page.mouse.click(pane.x + pane.width - 35, pane.y + 300)
    await video.evaluate((element) => {
      const box = element.getBoundingClientRect()
      element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: box.right - 12, clientY: box.top + 12, button: 2 }))
    })
    await page.getByRole('menu', { name: '节点操作' }).waitFor()
    await bounded(page.getByRole('menu', { name: '节点操作' }), 'Video context menu')
    await page.keyboard.press('Escape')
    await selectCanvasNode(page, 'gen-1')
    const nodeToolbar = page.locator('.react-flow__node-toolbar[data-id~="gen-1"]')
    await nodeToolbar.getByRole('button', { name: '更多操作', exact: true }).waitFor()
    await nodeToolbar.getByRole('button', { name: '更多操作', exact: true }).click()
    const nodeOverflowMenu = page.getByRole('menu', { name: '节点更多操作' })
    await nodeOverflowMenu.getByRole('menuitem', { name: '提取音频', exact: true }).click()
    const audioOperation = page.getByRole('dialog', { name: /^提取音频 ·/ })
    await audioOperation.waitFor()
    const audioTimeline = audioOperation.getByLabel('音频提取时间线')
    await audioTimeline.waitFor()
    await page.waitForFunction(() => {
      const dialog = document.querySelector('.nori-canvas-video-operation-dialog')
      const ranges = dialog?.querySelectorAll('input[type="range"]')
      return ranges?.length === 2 && Number(ranges[0].max) > 100 && Number(ranges[0].max) <= 3600000
    })
    const audioRanges = audioTimeline.locator('input[type="range"]')
    assert.equal(await audioRanges.count(), 2, 'Audio extraction must expose a start and end timeline range')
    await audioRanges.first().focus()
    await page.keyboard.press('Home')
    for (let step = 0; step < 5; step++) await page.keyboard.press('ArrowRight')
    await audioTimeline.getByText(/选区 00:00.5/).waitFor()
    assert.ok((await audioTimeline.innerText()).includes('不产生模型费用'))
    assert.equal(await audioOperation.getByRole('button', { name: '提取音频', exact: true }).isEnabled(), true)
    await audioOperation.getByRole('button', { name: '取消', exact: true }).click()
    await audioOperation.waitFor({ state: 'hidden' })
    cases.push({ ...viewport, audioExtractionRangeDialog: true })
    await page.getByRole('button', { name: '关闭节点编辑器' }).click()
    await page.waitForFunction(() => !document.querySelector('.nori-canvas-generator'))
    await page.locator('.react-flow__node[data-id="gen-1"] .nori-canvas-video').hover()
    await page.locator('.react-flow__node[data-id="gen-1"]').getByRole('button', { name: '放大预览', exact: true }).click()
    const canvasPreview = page.locator('.nori-canvas-media-preview')
    await canvasPreview.waitFor()
    await page.waitForFunction(() => document.querySelector('.nori-canvas-media-preview video')?.readyState >= 2)
    const timeline = canvasPreview.locator('.nori-video-timeline')
    await timeline.waitFor()
    await page.waitForFunction(() => document.querySelector('.nori-video-workspace')?.dataset.fpsSource === '实测')
    await canvasPreview.locator('video').evaluate((element) => { element.currentTime = 0.5; element.pause() })
    await page.waitForFunction(() => Math.abs(document.querySelector('.nori-canvas-media-preview video')?.currentTime - 0.5) < 0.002)
    const previewFps = Number.parseFloat(await timeline.locator('.nori-video-timeline-head.is-ruler').textContent())
    await canvasPreview.getByRole('button', { name: '下一帧', exact: true }).click()
    await page.waitForFunction((expected) => Math.abs(document.querySelector('.nori-canvas-media-preview video')?.currentTime - expected) < 0.012, (Math.floor(0.5 * previewFps + 1e-6) + 1) / previewFps + 0.001)
    await timeline.getByRole('button', { name: '标记关键帧', exact: true }).click()
    await timeline.getByRole('button', { name: '查看关键帧 1', exact: true }).waitFor()
    await timeline.getByRole('button', { name: '移除关键帧', exact: true }).click()
    assert.equal(await timeline.getByRole('button', { name: '查看关键帧 1', exact: true }).count(), 0)
    await timeline.getByLabel('时间线缩放').fill('60')
    await page.waitForFunction(() => { const element = document.querySelector('.nori-video-timeline-viewport'); return element && element.scrollWidth > element.clientWidth })
    await canvasPreview.getByLabel('播放速度').selectOption('1.5')
    assert.equal(await canvasPreview.locator('video').evaluate((element) => element.playbackRate), 1.5)
    await canvasPreview.getByRole('button', { name: '循环播放', exact: true }).click()
    assert.equal(await canvasPreview.locator('video').evaluate((element) => element.loop), true)
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}x${viewport.height}-video-timeline.png`) })
    const capture = canvasPreview.getByRole('button', { name: '截取当前帧', exact: true })
    await capture.click()
    await page.waitForFunction((before) => document.querySelectorAll('.react-flow__node').length === before + 1, nodeCountAfterTwoMaterials)
    const frameNode = page.locator('.react-flow__node').filter({ hasText: '视频关键帧' })
    assert.equal(await frameNode.count(), 1, 'A successful capture must create one real image node')
    await page.getByText('关键帧已添加到画布', { exact: true }).waitFor()
    await page.waitForFunction((before) => document.querySelectorAll('.react-flow__edge').length === before + 1, edgeCountAfterTwoMaterials)
    assert.equal(await page.locator('.react-flow__edge').count(), edgeCountAfterTwoMaterials + 1, 'The captured frame must link to its source video')
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}x${viewport.height}-captured-frame.png`) })
    await canvasPreview.getByRole('button', { name: '关闭 (Esc)', exact: true }).click()
    cases.push({ ...viewport, videoFrameCaptureCreatesLinkedImageNode: true })
    const zoomBeforeWheel = await page.locator('.react-flow__viewport').first().evaluate((element) => element.style.transform)
    const wheelPoint = await findEmptyCanvasPoint(page, pane)
    await page.mouse.move(wheelPoint.x, wheelPoint.y)
    await page.mouse.wheel(0, -260)
    await page.waitForFunction((before) => document.querySelector('.react-flow__viewport')?.style.transform !== before, zoomBeforeWheel, { timeout: 5000 })
    const zoomAfterWheel = await page.locator('.react-flow__viewport').first().evaluate((element) => element.style.transform)
    assert.notEqual(zoomAfterWheel, zoomBeforeWheel, 'Mouse wheel must zoom the canvas')
    const middlePoint = await findEmptyCanvasPoint(page, pane)
    await page.mouse.move(middlePoint.x, middlePoint.y)
    await page.mouse.down({ button: 'middle' })
    await page.mouse.move(middlePoint.x - 90, middlePoint.y - 50, { steps: 8 })
    await page.mouse.up({ button: 'middle' })
    await page.waitForFunction((before) => document.querySelector('.react-flow__viewport')?.style.transform !== before, zoomAfterWheel, { timeout: 5000 })
    const panAfterMiddle = await page.locator('.react-flow__viewport').first().evaluate((element) => element.style.transform)
    assert.notEqual(panAfterMiddle, zoomAfterWheel, 'Middle-button drag must pan the canvas')
    const menuPoint = await findEmptyCanvasPoint(page, pane)
    await page.mouse.click(menuPoint.x, menuPoint.y, { button: 'right' })
    await page.getByRole('menu', { name: '画布操作' }).waitFor()
    await page.keyboard.press('Escape')
    cases.push({ ...viewport, wheelZoom: true, middleButtonPan: true, rightClickPreserved: true })

    const gridNodesBefore = await page.locator('.react-flow__node').count()
    const gridEdgesBefore = await page.locator('.react-flow__edge').count()
    const gridMenu = await openNodeContextMenu(page, 'ref-1')
    await gridMenu.getByRole('menuitem', { name: /切分 3×3/ }).click()
    const gridDialog = page.getByRole('dialog', { name: /^宫格切分 ·/ })
    await gridDialog.waitFor()
    assert.equal(await gridDialog.locator('.nori-canvas-grid-overlay button').count(), 9, 'A 3×3 preset must preselect nine cells')
    assert.equal(await gridDialog.locator('.nori-canvas-grid-overlay button.is-selected').count(), 9)
    assert.ok((await gridDialog.innerText()).includes('已选 9 / 9 格'))
    assert.equal(await gridDialog.getByRole('button', { name: '生成 9 张', exact: true }).isEnabled(), true)
    await gridDialog.getByRole('button', { name: '生成 9 张', exact: true }).click()
    await page.getByText('已生成 9 张宫格切片', { exact: true }).waitFor()
    await page.waitForFunction((before) => document.querySelectorAll('.react-flow__node').length === before + 10, gridNodesBefore)
    await page.waitForFunction((before) => document.querySelectorAll('.react-flow__edge').length === before + 9, gridEdgesBefore)
    assert.equal(await page.locator('.react-flow__node[data-id="ref-1"]').count(), 1, 'Grid split must retain the source image node')
    const gridRequest = page.operationRequests.at(-1)
    assert.equal(gridRequest.operation, 'grid_split')
    assert.deepEqual([gridRequest.rows, gridRequest.cols, gridRequest.selectedCells.length], [3, 3, 9])
    const gridTitles = await page.locator('.react-flow__node .nori-canvas-node-drag-handle').evaluateAll((elements) => elements.map((element) => element.textContent || ''))
    assert.equal(gridTitles.filter((title) => title.includes('切片')).length, 9, 'Every selected cell must become an independent node and asset')
    cases.push({ ...viewport, gridSplitPreset: true })
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}x${viewport.height}.png`) })
    cases.push({ ...viewport, mentions: true, parameters: true, sound: true, videoPlayback: true, contextMenus: true })
    await page.close()
  }
  for (const query of ['', '?capture-fail=1']) {
    const page = await open({ width: 1280, height: 720 }, `?view=dialogs&kind=video-preview${query.replace('?', '&')}`)
    const preview = page.locator('.nori-canvas-media-preview')
    await preview.waitFor()
    const video = preview.locator('video')
    await page.waitForFunction(() => document.querySelector('.nori-canvas-media-preview video')?.readyState >= 2)
    await video.evaluate((element) => { element.currentTime = 0.5 })
    const capture = preview.getByRole('button', { name: '截取当前帧', exact: true })
    await capture.click()
    if (query) {
      await preview.getByText('模拟关键帧上传失败', { exact: true }).waitFor()
      assert.equal(await preview.getByRole('button', { name: '截取当前帧', exact: true }).isEnabled(), true)
      assert.equal(await page.locator('[data-testid="dialog-closed"]').count(), 0, 'Capture upload failure must leave the preview open')
    } else {
      await page.getByTestId('dialog-closed').waitFor()
    }
    cases.push({ videoFrameCapture: query ? 'upload-failure-recovers-without-empty-node' : 'jpeg-upload-success' })
    await page.close()
  }

  const accounts = await open({ width: 1280, height: 720 }, '?view=accounts')
  await accounts.getByText('回归子账号', { exact: true }).waitFor()
  const actionButtons = await accounts.locator('.min-w-\\[1460px\\] > div:not(:first-child) span.sticky button').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return { text: element.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom }
  }))
  assert.deepEqual(actionButtons.map((button) => button.text), ['流水', '设置额度', '收回', '编辑', '删除'])
  for (let index = 1; index < actionButtons.length; index++) {
    assert.ok(actionButtons[index].left >= actionButtons[index - 1].right, `Account action buttons must not overlap: ${JSON.stringify(actionButtons)}`)
  }
  const accountTable = accounts.locator('.min-w-\\[1460px\\]').first()
  const tableGeometry = await accountTable.evaluate((element) => ({
    width: element.clientWidth,
    scrollWidth: element.scrollWidth,
    grid: element.firstElementChild?.getBoundingClientRect().width,
    columns: getComputedStyle(element.firstElementChild).gridTemplateColumns,
    cells: [...element.firstElementChild.children].map((cell) => ({
      text: cell.textContent,
      width: cell.getBoundingClientRect().width,
      minWidth: getComputedStyle(cell).minWidth,
    })),
  }))
  assert.equal(tableGeometry.scrollWidth <= tableGeometry.width + 1, true, `Widened account table must contain all action buttons: ${JSON.stringify(tableGeometry)}`)
  accounts.armStaleAccountRead()
  const staleRequest = accounts.waitForRequest((request) => new URL(request.url()).pathname === '/api/admin/accounts')
  await accounts.evaluate(() => window.dispatchEvent(new Event('focus')))
  await staleRequest
  await accounts.getByRole('button', { name: '编辑' }).click()
  const accountDialog = accounts.locator('.account-management-dialog')
  await accountDialog.getByLabel('每日用量上限（积分）').fill('0')
  await accountDialog.getByRole('button', { name: '保存修改' }).click()
  await accounts.getByText('禁止生成 · 上限 0', { exact: true }).waitFor()
  const staleResponse = accounts.waitForResponse((response) => response.url() === accounts.heldAccountUrl)
  accounts.releaseStaleAccountRead()
  await staleResponse
  await accounts.waitForTimeout(150)
  await accounts.getByText('禁止生成 · 上限 0', { exact: true }).waitFor()
  await accounts.getByRole('button', { name: '编辑' }).click()
  assert.equal(await accountDialog.getByLabel('每日用量上限（积分）').inputValue(), '0', 'Zero must survive reopening the editor')
  await accountDialog.getByLabel('每日用量模式').selectOption('unlimited')
  await accountDialog.getByRole('button', { name: '保存修改' }).click()
  await accounts.getByText('unlimited · 不限量', { exact: true }).waitFor()
  assert.equal(await accounts.getByText('今日额度已用尽', { exact: true }).count(), 0)
  assert.equal(await accounts.getByText('110', { exact: true }).count(), 1, 'Cancelling a limit must preserve today usage')
  await accounts.screenshot({ path: path.join(artifacts, 'daily-limit-zero.png') })
  await accounts.close()
  const boundaryCases = []
  for (const viewport of [{ width: 1024, height: 600 }, { width: 768, height: 480 }, { width: 390, height: 700 }]) {
    for (const kind of ['history', 'revisions', 'asset', 'workflow', 'management', 'image-edit', 'image-grid', 'image-focus', 'image-upscale', 'video-upscale', 'video-subtitles', 'image-preview', 'video-preview', 'video-preview-readonly', 'model3d', 'studio', 'panorama']) {
      const page = await open(viewport, `?view=dialogs&kind=${kind}`)
      const panel = page.locator('.nori-canvas-dialog, .nori-canvas-media-preview, .nori-canvas-studio-dialog, .nori-canvas-panorama-dialog').first()
      await panel.waitFor()
      await bounded(panel, `${kind} modal`)
      assert.equal(await panel.evaluate((el) => el.scrollWidth > el.clientWidth + 2), false, `${kind}: no horizontal content clipping`)
      const close = panel.locator('header button[title*="关闭"], header button[title="退出全景"], header button[title="退出 (Esc)"], header button[aria-label*="关闭"]').last()
      await close.waitFor()
      await bounded(close, `${kind} close`)
      if (kind === 'video-preview-readonly') {
        assert.equal(await panel.getByRole('button', { name: '截取当前帧', exact: true }).count(), 0, 'Read-only preview must not capture into the canvas')
        assert.equal(await panel.getByRole('button', { name: '标记关键帧', exact: true }).isDisabled(), true, 'Read-only preview must not add keyframe markers')
      }
      if (kind === 'history') {
        const text = panel.locator('.nori-canvas-history-prompt p').first()
        assert.equal(await text.evaluate((el) => el.scrollHeight > el.clientHeight + 1), false, 'History prompt must not be line-clamped')
      }
      if (kind === 'studio') {
        const dock = panel.locator('.nori-canvas-studio-dock')
        await dock.scrollIntoViewIfNeeded()
        await bounded(dock, '3D dock')
        for (const button of await dock.locator('button').all()) await bounded(button, '3D dock button')
        await dock.locator('button[title="添加机位预设"]').click()
        const presets = page.getByRole('menu', { name: '添加机位预设' })
        await bounded(presets, '3D camera presets')
        await presets.getByRole('button').first().click()
      }
      const confirm = panel.locator('footer button.is-primary, .nori-canvas-image-operation-actions button.is-primary').last()
      if (await confirm.count() && !['studio', 'panorama'].includes(kind)) {
        await confirm.scrollIntoViewIfNeeded()
        await bounded(confirm, `${kind} confirm`)
      }
      await page.screenshot({ path: path.join(artifacts, `boundary-${viewport.width}-${kind}.png`) })
      await close.click()
      await panel.waitFor({ state: 'hidden' })
      boundaryCases.push(`${viewport.width}x${viewport.height}:${kind}`)
      await page.close()
    }
  }
  assert.deepEqual(errors, [], 'No uncaught browser errors')
  console.log(JSON.stringify({ ok: true, cases, dailyLimitZero: true, sharedWalletGate: true, staleBalanceResponse: true, slowBalanceReads: true, identitySwitch: true, boundaryCases, artifacts }, null, 2))
  }
} catch (error) {
  await latestPage?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ browserErrors: errors, pageText: (await latestPage?.locator('body').innerText().catch(() => '') || '').slice(0, 600) }))
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
