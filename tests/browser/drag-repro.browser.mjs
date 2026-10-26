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
  modelKey: 'nori::norivideo2.5', name: 'NoriVideo 2.5', provider: 'nori', configured: true, available: true,
  supportGenerateAudio: true, firstLastFrame: true,
  options: { duration: [4, 5, 6, 8, 10], resolution: ['480p', '720p'], aspectRatio: ['16:9', '9:16', '1:1'] },
  inputSchema: { image: { min: 0, max: 9 }, video: { min: 0, max: 3 }, audio: { min: 0, max: 3 }, requiredFields: ['prompt'] },
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
  const usage = () => ({
    timeZone: 'Asia/Shanghai', limitPoints: savedLimit, usedPoints: 110, consumedPoints: 80, pendingPoints: 30,
    remainingPoints: savedLimit !== null ? Math.max(0, savedLimit - 110) : null, exceeded: savedLimit !== null && savedLimit <= 110, resetsAt: '2026-10-08T16:00:00.000Z',
  })
  const account = () => ({ id: 'child-1', username: '回归子账号', role: 'writer', roleLabel: '编剧', status: 'active', permissions: [], credits: { coins: 0, points: 1000 }, dailyLimitPoints: savedLimit, usageToday: usage(), createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z', lastLoginAt: null, usage: { byType: [], cost: 0, count: 0 } })
  let graph = {
    canvas, edges: [],
    nodes: [
      { ...common, id: 'gen-1', type: 'video', position: { x: 440, y: 140 }, size: { width: 320, height: 180 }, status: 'RUNNING', taskId: 'task-1', data: { title: '视频生成节点', mediaType: 'video', prompt: '', origin: 'generate', generation: { assetId: 'video-1', taskId: 'task-1', modelKey: model.modelKey }, history: [{ id: 'history-1', assetId: 'video-1', taskId: 'task-1', status: 'processing', createdAt: '2026-10-08T00:00:00.000Z' }] } },
      ...Array.from({ length: 20 }, (_, i) => ({ ...common, id: `ref-${i + 1}`, type: 'image', position: { x: -1100, y: i * 230 }, size: { width: 320, height: 180 }, status: 'IDLE', taskId: null, data: { title: `参考素材${i + 1}`, mediaType: 'image', origin: 'upload', contentUrl: reference, imageUrl: reference, materialId: `material-${i + 1}` } })),
    ],
  }
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.port === workspace.port) return route.continue()
    if (!url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/storage/sign') return route.continue()
    let payload
    if (url.pathname.endsWith('/generation-config')) payload = { textModels: [], imageModels: [], videoModels: [model], audioModels: [], model3dModels: [], defaults: { videoModel: model.modelKey, aspectRatio: '16:9', resolution: '720p' } }
    else if (url.pathname.endsWith('/generation-quote')) payload = { points: 20, costCny: 0.2 }
    else if (url.pathname.endsWith('/balance')) {
      payload = { balancePoints: walletPoints, generationAllowed: walletPoints > 0 && !usage().exceeded, dailyLimitPoints: savedLimit, dailyUsedPoints: 110, dailyLimitExceeded: usage().exceeded }
      if (holdNextBalance) {
        holdNextBalance = false
        await new Promise((resolve) => { heldBalanceReads.push(resolve); firstHeldBalance() })
      }
    }
    else if (url.pathname.endsWith('/toolbox/assets')) payload = { assets: [{ id: 'video-1', type: 'video', status: 'ready', resultUrl: 'images/ui.mp4', url: 'images/ui.mp4', materialId: 'video-material', task: { id: 'task-1', status: 'completed', progress: 100, costPoints: 20 } }] }
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
    else if (url.pathname.endsWith('/operations')) payload = { engines: [], latestTask: null, latestTaskLinks: null }
    else if (url.pathname.endsWith('/studio-document')) payload = {
      studioDocument: { projectId: 'project-1', canvasId: 'canvas-1', nodeId: 'stress-node', revision: 1, document: {}, updatedAt: null, persisted: true, source: 'document' },
    }
    else if (url.pathname.includes('/canvas/canvas-1')) {
      if (route.request().method() !== 'GET') {
        const body = route.request().postDataJSON()
        if (body?.nodes) graph = { ...graph, nodes: body.nodes }
        for (const op of body?.ops || []) if (op.type === 'node.upsert') graph.nodes = graph.nodes.map((n) => n.id === op.node.id ? { ...n, ...op.node } : n)
        graph = { ...graph, canvas: { ...graph.canvas, revision: graph.canvas.revision + 1 } }
      }
      payload = graph
    } else payload = { voices: [], materials: [], projects: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
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
try {
  // on-screen nodes only: gen-1 at (440,140), add a second video node on-screen
  const page = await open({ width: 1280, height: 720 })
  await page.locator('.nori-canvas-generator').waitFor()

  async function dragAndReport(label, dataId, dx, dy, offsetX, offsetY) {
    const node = page.locator(`.react-flow__node[data-id="${dataId}"]`)
    const before = await node.boundingBox()
    const px = before.x + (offsetX ?? before.width / 2)
    const py = before.y + (offsetY ?? before.height / 2)
    const hit = await page.evaluate(([x, y]) => {
      const el = document.elementFromPoint(x, y)
      return el ? { tag: el.tagName, cls: (el.className?.toString?.() || '').slice(0, 90) } : null
    }, [px, py])
    await page.mouse.move(px, py)
    await page.mouse.down()
    await page.mouse.move(px + dx, py + dy, { steps: 10 })
    await page.mouse.up()
    await page.waitForTimeout(400)
    const after = await node.boundingBox()
    const moved = Math.abs(after.x - before.x)
    console.log(JSON.stringify({ label, dataId, hit, movedPx: Math.round(moved) }))
    return moved > 40
  }

  const results = {}
  await page.locator('.nori-canvas-sync-lock').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(800)
  results.centerPlayback = await page.evaluate(() => {
    const node = document.querySelector('.react-flow__node[data-id="gen-1"] video')
    const rect = node.getBoundingClientRect()
    const el = document.elementFromPoint(rect.x + rect.width / 2, rect.y + rect.height / 2)
    return el ? el.tagName + '.' + String(el.className).slice(0,80) : null
  })
  results.labelDrag = await dragAndReport('label drag', 'gen-1', -80, -50, 40, -8)
  results.edgeDrag = await dragAndReport('edge drag', 'gen-1', 60, -40, 7, 90)
  console.log(JSON.stringify({ results, errors }, null, 2))
  await page.screenshot({ path: path.join(artifacts, 'drag-test.png') })
  await page.close()

} catch (error) {
  await latestPage?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ browserErrors: errors, pageText: (await latestPage?.locator('body').innerText().catch(() => '') || '').slice(0, 600) }))
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
