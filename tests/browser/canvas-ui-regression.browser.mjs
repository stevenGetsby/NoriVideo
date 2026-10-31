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
  modelKey: 'nori::norivideo2.5', name: 'LanMiaoTV 2.5', provider: 'nori', configured: true, available: true,
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
    await prompt.fill('@')
    const mentions = page.getByRole('listbox', { name: '选择连线输入或资产库素材' })
    await mentions.waitFor()
    await bounded(mentions, '@ picker')
    assert.equal(await mentions.getByRole('option').count(), 20, 'More than eight assets must be reachable')
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}x${viewport.height}-mentions.png`) })
    await mentions.getByRole('option').nth(16).click()
    assert.ok((await prompt.inputValue()).startsWith('@参考素材'))
    await prompt.fill('@')
    await page.keyboard.press('Escape')
    assert.equal(await page.getByRole('listbox').count(), 0)
    assert.equal(await generator.count(), 1, 'Escape should dismiss the picker, not the editor')
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
    await page.locator('.nori-canvas-active-picker').click()
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
    await page.locator('.react-flow__node[data-id="gen-1"] .nori-canvas-video').hover()
    await page.locator('.react-flow__node[data-id="gen-1"]').getByRole('button', { name: '放大预览', exact: true }).click()
    const canvasPreview = page.locator('.nori-canvas-media-preview')
    await canvasPreview.waitFor()
    await page.waitForFunction(() => document.querySelector('.nori-canvas-media-preview video')?.readyState >= 2)
    const capture = canvasPreview.getByRole('button', { name: '截取当前帧', exact: true })
    await capture.click()
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 22)
    const frameNode = page.locator('.react-flow__node').filter({ hasText: '视频关键帧' })
    assert.equal(await frameNode.count(), 1, 'A successful capture must create one real image node')
    await page.getByText('关键帧已添加到画布', { exact: true }).waitFor()
    await page.waitForFunction(() => document.querySelectorAll('.react-flow__edge').length === 1)
    assert.equal(await page.locator('.react-flow__edge').count(), 1, 'The captured frame must link to its source video')
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}x${viewport.height}-captured-frame.png`) })
    await canvasPreview.getByRole('button', { name: '关闭 (Esc)', exact: true }).click()
    cases.push({ ...viewport, videoFrameCaptureCreatesLinkedImageNode: true })
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
  const actionButtons = await accounts.locator('.min-w-\\[1840px\\] > div:not(:first-child) span.sticky button').evaluateAll((elements) => elements.map((element) => {
    const box = element.getBoundingClientRect()
    return { text: element.textContent, left: box.left, right: box.right, top: box.top, bottom: box.bottom }
  }))
  assert.deepEqual(actionButtons.map((button) => button.text), ['流水', '设置额度', '收回', '编辑', '删除'])
  for (let index = 1; index < actionButtons.length; index++) {
    assert.ok(actionButtons[index].left >= actionButtons[index - 1].right, `Account action buttons must not overlap: ${JSON.stringify(actionButtons)}`)
  }
  const accountTable = accounts.locator('.min-w-\\[1840px\\]').first()
  const tableGeometry = await accountTable.evaluate((element) => ({ width: element.clientWidth, scrollWidth: element.scrollWidth, grid: element.firstElementChild?.getBoundingClientRect().width }))
  assert.equal(tableGeometry.scrollWidth <= tableGeometry.width + 1, true, 'Widened account table must contain all action buttons')
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
} catch (error) {
  await latestPage?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ browserErrors: errors, pageText: (await latestPage?.locator('body').innerText().catch(() => '') || '').slice(0, 600) }))
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
