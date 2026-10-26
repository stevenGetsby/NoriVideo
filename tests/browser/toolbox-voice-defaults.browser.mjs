// 独立浏览器验证：工具箱角色音色角标、音色汇总提示、默认全能参考与工作留痕。
// 使用真实 FosToolbox；只 mock 网络，不登录、不写数据库、不调用生成接口。
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
const artifacts = path.join(root, 'test-results/toolbox-voice-defaults')
await mkdir(artifacts, { recursive: true })

let appCss
if (process.env.NORI_BROWSER_GLOBAL_CSS_PATH) {
  appCss = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH, 'utf8')
} else {
  const entry = path.join(root, 'src/app/globals.css')
  appCss = (await postcss([tailwind()]).process(await readFile(entry, 'utf8'), { from: entry, to: entry })).css
}

const bundle = await build({
  entryPoints: ['tests/browser/toolbox-voice-defaults.fixture.tsx'],
  bundle: true,
  write: false,
  outdir: '/fixture',
  jsx: 'automatic',
  platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.contents
assert.ok(script && css, 'fixture bundle must contain JavaScript and CSS')

const videoModel = {
  modelKey: 'nori::norivideo2.5',
  name: 'NoriVideo 2.5',
  provider: 'nori',
  tier: 'pro',
  configured: true,
  available: true,
  firstLastFrame: true,
  supportGenerateAudio: true,
  options: {
    duration: [4, 5, 6, 8, 10],
    resolution: ['480p', '720p', '1080p'],
    aspectRatio: ['16:9', '9:16', '1:1'],
    generateAudio: [true, false],
  },
  inputSchema: {
    image: { min: 0, max: 9 },
    video: { min: 0, max: 3 },
    audio: { min: 0, max: 3, maxTotalDurationSeconds: 15 },
    requiredFields: ['prompt'],
  },
}

const historyAsset = {
  id: 'asset-1',
  projectId: 'project-1',
  materialId: 'result-1',
  type: 'video',
  status: 'completed',
  modelId: 'nori::norivideo2.5',
  resultUrl: '/result.mp4',
  url: '/result.mp4',
  errorMessage: null,
  params: {
    title: '雨夜角色测试',
    prompt: '苏晚卿在雨夜回头，顾北辰撑伞走来。',
    inputMode: 'reference',
    aspectRatio: '16:9',
    resolution: '720p',
    duration: 5,
    generateAudio: true,
    assetCategory: 'shot',
    referenceSummary: [
      { type: 'image', title: '苏晚卿', role: 'REF' },
      { type: 'image', title: '顾北辰', role: 'REF' },
      { type: 'audio', title: '苏晚卿音色', role: 'REF', durationSeconds: 7.2 },
    ],
  },
  createdAt: '2026-10-25T10:24:00.000Z',
  task: { id: 'task-1', status: 'completed', progress: 100, errorCode: null, errorMessage: null, costPoints: 120 },
}

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
  const page = await browser.newPage({ viewport: { width: 1402, height: 970 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const isLocal = ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === base.split(':')[2]
    if (isLocal && !url.pathname.startsWith('/api/')) {
      if (['image', 'media'].includes(route.request().resourceType())) {
        return await route.fulfill({ status: 204, contentType: 'image/png', body: '' })
      }
      return await route.continue()
    }
    const body = url.pathname.includes('generation-config')
      ? {
        imageModels: [],
        videoModels: [videoModel],
        defaults: { imageModel: null, videoModel: 'nori::norivideo2.5', aspectRatio: '16:9', resolution: '720p' },
      }
      : url.pathname.endsWith('/api/projects')
        ? { works: [{ id: 'project-1', name: '小屏验证作品' }], pagination: { totalPages: 1 } }
        : url.pathname.includes('/toolbox/assets')
          ? { assets: [historyAsset] }
          : url.pathname.endsWith('/api/user/balance')
            ? { balancePoints: 1200, generationAllowed: true }
            : { voices: [] }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  })
  await page.goto(base, { waitUntil: 'domcontentloaded' })

  const badges = page.locator('.toolbox-ref-voice-badge')
  try {
    await badges.first().waitFor({ timeout: 15_000 })
  } catch (error) {
    throw new Error(`${error.message}\n\nPage text:\n${await page.locator('body').innerText()}\n\nBrowser errors:\n${errors.join('\n')}\n\nRoot:\n${await page.locator('#root').innerHTML().catch(() => 'missing')}`)
  }
  assert.equal(await badges.count(), 2, 'both character references must show a badge')

  const mode = page.getByLabel('视频生成模式')
  assert.equal(await mode.inputValue(), 'reference', 'legacy v2 text drafts must migrate to the all-in-one reference default')
  assert.match(await mode.locator('option:checked').textContent(), /全能参考（图片 \/ 视频 \/ 音色）/)

  const badgeState = await badges.evaluateAll((items) => items.map((item) => {
    const card = item.parentElement
    const remove = card?.querySelector('button')
    const badge = item.getBoundingClientRect()
    const cardBox = card?.getBoundingClientRect()
    const removeBox = remove?.getBoundingClientRect()
    const label = item.querySelector('span')
    return {
      text: item.textContent?.trim(),
      tone: item.className,
      insideCard: Boolean(cardBox
        && badge.top >= cardBox.top && badge.left >= cardBox.left
        && badge.right <= cardBox.right && badge.bottom <= cardBox.bottom),
      clearOfRemove: !removeBox || badge.right <= removeBox.left - 0.5,
      fullLabel: Boolean(label && label.scrollWidth <= label.clientWidth + 1),
    }
  }))
  assert.deepEqual(badgeState.map((item) => item.text).sort(), ['缺音色', '音色'])
  assert.ok(badgeState.some((item) => item.tone.includes('border-violet-300/40')))
  assert.ok(badgeState.some((item) => item.tone.includes('border-amber-300/45')))
  assert.ok(badgeState.every((item) => item.insideCard), 'toolbox voice badges must not be clipped by the 72px card')
  assert.ok(badgeState.every((item) => item.clearOfRemove), 'toolbox voice badges must not overlap the remove button')
  assert.ok(badgeState.every((item) => item.fullLabel), 'toolbox voice labels must not truncate')

  const hint = page.getByText('角色音色 1/2；自动带入 1 个已绑定音色，1 个缺音色。')
  await hint.waitFor()
  assert.ok((await hint.getAttribute('class'))?.includes('text-amber-300/90'), 'missing character voice must be warned')

  const trace = page.locator('[aria-label="工作留痕"]')
  await trace.waitFor({ timeout: 15_000 })
  const traceText = await trace.innerText()
  for (const expected of ['已完成', '120 积分', 'NoriVideo 2.5', '全能参考（图片 / 视频 / 音色）', '苏晚卿音色', '7.2 秒']) {
    assert.ok(traceText.includes(expected), `toolbox trace must show ${expected}`)
  }
  await page.screenshot({ path: path.join(artifacts, '01-toolbox-1402.png'), fullPage: true })
  await hint.scrollIntoViewIfNeeded()
  await page.screenshot({ path: path.join(artifacts, '03-toolbox-voice-hint.png') })

  await page.setViewportSize({ width: 1280, height: 720 })
  await page.reload({ waitUntil: 'domcontentloaded' })
  await badges.first().waitFor({ timeout: 15_000 })
  const compact = await badges.evaluateAll((items) => items.map((item) => {
    const badge = item.getBoundingClientRect()
    const label = item.querySelector('span')
    return {
      insideViewport: badge.left >= 0 && badge.right <= window.innerWidth && badge.top >= 0,
      fullLabel: Boolean(label && label.scrollWidth <= label.clientWidth + 1),
    }
  }))
  assert.ok(compact.every((item) => item.insideViewport), '1280px toolbox badges must fit the viewport')
  assert.ok(compact.every((item) => item.fullLabel), '1280px toolbox voice labels must not truncate')
  assert.equal(await page.getByLabel('视频生成模式').inputValue(), 'reference')
  await page.screenshot({ path: path.join(artifacts, '02-toolbox-1280.png'), fullPage: true })

  assert.deepEqual(errors, [], 'no browser errors')
  console.log(JSON.stringify({ ok: true, viewports: ['1402x970', '1280x720'], badges: badgeState, artifacts }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
