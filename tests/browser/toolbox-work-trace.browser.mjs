// 独立浏览器验证：工具箱「工作留痕」在桌面与窄屏下都完整可读、可复制。
// 使用真实 WorkTraceCard + 编译后的全局样式，不登录、不写数据库、不调用生成接口。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'
import postcss from 'postcss'
import tailwind from '@tailwindcss/postcss'

const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || process.cwd(), 'package.json'))
const { chromium } = tools('playwright-core')
const root = process.cwd()
const artifacts = path.join(root, 'test-results/toolbox-work-trace')
await mkdir(artifacts, { recursive: true })

let appCss
if (process.env.NORI_BROWSER_GLOBAL_CSS_PATH) {
  appCss = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH, 'utf8')
} else {
  const entry = path.join(root, 'src/app/globals.css')
  const result = await postcss([tailwind()]).process(await readFile(entry, 'utf8'), { from: entry, to: entry })
  appCss = result.css
}

const bundle = await build({
  entryPoints: ['tests/browser/toolbox-work-trace.fixture.tsx'],
  bundle: true,
  write: false,
  outdir: '/fixture',
  jsx: 'automatic',
  platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
  },
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
  if (request.url === '/global.css') {
    response.setHeader('Content-Type', 'text/css')
    response.end(appCss)
    return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const isLocal = ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === base.split(':')[2]
    if (isLocal && !url.pathname.startsWith('/api/')) {
      if (route.request().resourceType() === 'image') return await route.fulfill({ status: 204, contentType: 'image/png', body: '' })
      return await route.continue()
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
  })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const cards = page.locator('[aria-label="工作留痕"]')
  try {
    await cards.first().waitFor({ timeout: 15_000 })
  } catch (error) {
    throw new Error(`${error.message}\n\nPage text:\n${await page.locator('body').innerText()}\n\nBrowser errors:\n${errors.join('\n')}\n\nRoot:\n${await page.locator('#root').innerHTML().catch(() => 'missing')}`)
  }
  assert.equal(await cards.count(), 3, 'fixture must render completed, failed and processing traces')

  const completedText = await cards.nth(0).innerText()
  for (const expected of ['工作留痕', '已完成', '126.5 积分', 'Seedance 2.0 Fast', '全能参考（图片 / 视频 / 音色）', '16:9', '720p', '5 秒', '24 FPS', '开启', '角色资产', '3 个', '苏晚卿音色', '7.2 秒', '任务 ID']) {
    assert.ok(completedText.includes(expected), `completed trace must show ${expected}`)
  }
  const failedText = await cards.nth(1).innerText()
  for (const expected of ['失败', '无扣费记录', 'PROVIDER_REJECTED', '参考图片包含无法识别的角色', '9:16', '1080p', '关闭']) {
    assert.ok(failedText.includes(expected), `failed trace must show ${expected}`)
  }
  assert.match(await cards.nth(2).innerText(), /生成中[\s\S]*结算中/, 'processing trace must show pending settlement')

  const desktopOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }))
  assert.ok(desktopOverflow.scrollWidth <= desktopOverflow.clientWidth, 'desktop trace must not overflow horizontally')

  const copy = cards.nth(0).getByRole('button', { name: /复制留痕/ })
  await copy.click()
  await cards.nth(0).getByRole('button', { name: /已复制/ }).waitFor()
  await page.screenshot({ path: path.join(artifacts, '01-desktop.png'), fullPage: true })

  await page.setViewportSize({ width: 390, height: 700 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await cards.first().waitFor({ timeout: 15_000 })
  const compactOverflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    innerWidth: window.innerWidth,
  }))
  assert.ok(compactOverflow.scrollWidth <= compactOverflow.clientWidth, '390px trace must not overflow horizontally')
  const boxes = await cards.evaluateAll((items) => items.map((item) => item.getBoundingClientRect().toJSON()))
  assert.ok(boxes.every((box) => box.left >= 0 && box.right <= compactOverflow.innerWidth + 0.5), 'every trace card must fit the 390px viewport')
  const prompt = cards.nth(0).locator('p').first()
  const promptBox = await prompt.evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
  }))
  assert.equal(promptBox.overflowY, 'auto', 'long prompt must scroll inside the card')
  assert.ok(promptBox.scrollHeight > promptBox.clientHeight, 'long prompt must not expand the trace card')
  const copyCompact = cards.nth(0).getByRole('button', { name: /复制留痕/ })
  const copyBox = await copyCompact.boundingBox()
  assert.ok(copyBox && copyBox.x >= 0 && copyBox.x + copyBox.width <= 390, 'copy action must remain visible at 390px')
  await page.screenshot({ path: path.join(artifacts, '02-compact.png'), fullPage: true })

  assert.deepEqual(errors, [], 'no browser errors')
  console.log(JSON.stringify({ ok: true, viewports: ['1280x900', '390x700'], artifacts }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
