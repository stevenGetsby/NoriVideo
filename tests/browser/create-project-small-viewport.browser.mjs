// 独立浏览器验证：小分辨率下“创建作品”弹窗不裁切、可滚动。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'

const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || process.cwd(), 'package.json'))
const { chromium } = tools('playwright-core')
const root = process.cwd()
const artifacts = path.join(root, 'test-results/create-project-small-viewport')
await mkdir(artifacts, { recursive: true })

const bundle = await build({
  entryPoints: ['tests/browser/create-project-dialog.fixture.tsx'],
  bundle: true,
  write: false,
  outdir: '/fixture.js',
  jsx: 'automatic',
  platform: 'browser',
  alias: { '@': path.join(root, 'src') },
  define: { 'process.env.NODE_ENV': '"development"' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.contents
assert.ok(script && css, 'fixture bundle must contain JavaScript and CSS')

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
const page = await browser.newPage({ viewport: { width: 1402, height: 970 } })
await page.route('**/api/**', async (route) => {
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ scripts: [], candidates: [] }) })
})

try {
  const requests = []
  page.on('request', (request) => requests.push({ url: request.url(), method: request.method() }))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const dialog = page.getByRole('dialog', { name: '创建作品' })
  await dialog.waitFor({ state: 'visible', timeout: 15_000 })
  await page.screenshot({ path: path.join(artifacts, '01-canvas-default.png'), fullPage: true })
  assert.equal(await dialog.getByRole('radio', { name: '画布', exact: true }).getAttribute('aria-checked'), 'true')
  assert.equal(await dialog.locator('.create-project-workflow-settings').count(), 0)
  assert.equal(await dialog.locator('textarea').count(), 0)
  assert.equal(await dialog.getByRole('button', { name: '创建并进入画布', exact: true }).count(), 1)
  await dialog.getByPlaceholder('请输入作品名称').fill('画布验证作品')
  await dialog.getByRole('button', { name: '创建并进入画布', exact: true }).click()
  const created = JSON.parse(await page.getByLabel('创建结果').innerText())
  assert.equal(created.creationMode, 'canvas')
  assert.equal(created.collaborationMode, 'solo')
  assert.equal(created.scriptFile, null)
  assert.equal(created.importedScriptText, '')
  assert.equal(created.initializeEpisodeRange, false)
  assert.deepEqual(created.styleReferenceFiles, [])
  assert.ok(!requests.some((request) => new URL(request.url).pathname === '/api/video-repaint/scripts'), '画布模式不得加载剧本列表')
  assert.ok(requests.every((request) => request.url.startsWith(base) || request.url.startsWith('data:') || request.url.startsWith('blob:')), '画布草稿验证不得上传文件或调用生成接口')

  await dialog.getByRole('radio', { name: '工作流', exact: true }).click()
  await dialog.locator('.create-project-workflow-settings').waitFor()
  await page.screenshot({ path: path.join(artifacts, '02-workflow-top.png'), fullPage: true })

  const metrics = await dialog.evaluate((element) => {
    const body = element.querySelector('.create-project-body')
    const foot = element.querySelector('.fos-dialog-foot')
    const bodyRect = body?.getBoundingClientRect()
    const footRect = foot?.getBoundingClientRect()
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      dialog: element.getBoundingClientRect().toJSON(),
      body: bodyRect?.toJSON(),
      foot: footRect?.toJSON(),
      bodyScroll: body ? { top: body.scrollTop, height: body.scrollHeight, clientHeight: body.clientHeight } : null,
      bodyOverflowY: body ? getComputedStyle(body).overflowY : '',
      footVisible: !!footRect && footRect.bottom <= window.innerHeight + 1 && footRect.right <= window.innerWidth + 1,
    }
  })
  assert.ok(metrics.bodyScroll && metrics.bodyScroll.height >= metrics.bodyScroll.clientHeight, '弹窗内容区域应存在可滚动高度')
  assert.equal(metrics.bodyOverflowY, 'auto', '弹窗内容区域应允许纵向滚动')
  assert.equal(metrics.footVisible, true, '底部操作区必须留在 1402×970 视口内')
  assert.ok(metrics.dialog.width <= 1402 && metrics.dialog.height <= 970, '弹窗整体不能超出小分辨率视口')

  await page.locator('.create-project-body').evaluate((body) => { body.scrollTop = body.scrollHeight })
  await page.waitForTimeout(100)
  const bottom = await page.locator('.create-project-body').evaluate((body) => body.scrollTop)
  assert.ok(bottom > 0, '小分辨率下内容必须能滚动到底部')
  await page.screenshot({ path: path.join(artifacts, '02-bottom.png'), fullPage: true })

  console.log(JSON.stringify({ ok: true, viewport: metrics.viewport, artifacts }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
