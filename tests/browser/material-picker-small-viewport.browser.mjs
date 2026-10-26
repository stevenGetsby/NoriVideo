// 独立浏览器验证：素材选择器在画布 transform 祖先和小分辨率下仍然完整可操作。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'

const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || process.cwd(), 'package.json'))
const { chromium } = tools('playwright-core')
const root = process.cwd()
const artifacts = path.join(root, 'test-results/material-picker-small-viewport')
await mkdir(artifacts, { recursive: true })

const bundle = await build({
  entryPoints: ['tests/browser/material-picker-small-viewport.fixture.tsx'],
  bundle: true,
  write: false,
  outdir: '/fixture.js',
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
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})

try {
  const page = await browser.newPage({ viewport: { width: 1402, height: 970 } })
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  page.on('console', (message) => { if (message.type() === 'error') browserErrors.push(message.text()) })
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const isLocal = ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === base.split(':')[2]
    if (isLocal && !url.pathname.startsWith('/api/')) return await route.continue()
    if (route.request().resourceType() === 'image') return await route.fulfill({ status: 204, contentType: 'image/png', body: '' })
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        materials: Array.from({ length: 24 }, (_, index) => {
          const character = index < 2
          return {
            id: `material-${index + 1}`,
            projectId: 'project-1',
            projectName: '小屏验证作品',
            ownerName: '管理员',
            title: index === 0 ? '苏晚卿' : index === 1 ? '顾北辰' : `素材 ${index + 1}`,
            type: 'image',
            source: 'upload',
            status: 'ready',
            isFavorited: false,
            resultUrl: `/material-${index + 1}.jpg`,
            storageKey: `/material-${index + 1}.jpg`,
            url: `/material-${index + 1}.jpg`,
            metadata: character
              ? { assetCategory: 'character', ...(index === 0 ? { voiceMaterialId: 'audio-1' } : {}) }
              : null,
            ...(index === 0 ? { voice: { materialId: 'audio-1', title: '苏晚卿音色', url: '/voice.mp3' } } : {}),
            createdAt: '2026-10-01T00:00:00.000Z',
            updatedAt: '2026-10-01T00:00:00.000Z',
          }
        }),
        projects: [{ id: 'project-1', name: '小屏验证作品' }],
        capabilities: { trash: { supported: true, count: 0, reason: '' } },
      }),
    })
  })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const dialog = page.getByRole('dialog', { name: '从素材库选择' })
  await dialog.waitFor({ state: 'visible', timeout: 15_000 })

  try {
    await page.getByText('角色音色 1/2', { exact: true }).waitFor({ timeout: 10_000 })
  } catch (error) {
    throw new Error(`${error.message}\n\nDialog text:\n${await dialog.innerText()}\n\nBrowser errors:\n${browserErrors.join('\n')}`)
  }
  const voiceBadges = await page.locator('.material-picker-voice-badge').evaluateAll((items) => items.map((item) => {
    const card = item.closest('article')
    const thumb = item.closest('div.relative')
    const badge = item.getBoundingClientRect()
    const cardBox = card?.getBoundingClientRect()
    const typeBadge = thumb
      ? [...thumb.querySelectorAll(':scope > span')].find((span) => (
        !span.classList.contains('material-picker-voice-badge')
        && /^(图片|视频|音频|3D)$/.test(span.textContent?.trim() || '')
      ))
      : null
    const typeBox = typeBadge?.getBoundingClientRect()
    return {
      text: item.textContent?.trim(),
      tone: item.querySelector('.nori-voice-badge')?.className || '',
      insideCard: Boolean(cardBox
        && badge.top >= cardBox.top && badge.left >= cardBox.left
        && badge.right <= cardBox.right && badge.bottom <= cardBox.bottom),
      clearOfTypeLabel: !typeBox || badge.left >= typeBox.right + 4,
    }
  }))
  assert.equal(voiceBadges.length, 2, 'both character cards must show a voice badge')
  assert.deepEqual(voiceBadges.map((item) => item.text).sort(), ['有音色', '缺音色'])
  assert.ok(voiceBadges.some((item) => item.tone.includes('nori-voice-badge-bound')))
  assert.ok(voiceBadges.some((item) => item.tone.includes('nori-voice-badge-missing')))
  assert.ok(voiceBadges.every((item) => item.insideCard), 'voice badges must not be clipped by the card')
  assert.ok(voiceBadges.every((item) => item.clearOfTypeLabel), 'voice badge must not overlap the type label')

  const metrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const close = element.querySelector('[aria-label="关闭素材选择器"]')
    const confirm = [...element.querySelectorAll('button')].find((button) => button.textContent?.includes('添加引用'))
    const closeRect = close?.getBoundingClientRect()
    const confirmRect = confirm?.getBoundingClientRect()
    return {
      viewport: { width: window.innerWidth, height: window.innerHeight },
      rect: rect.toJSON(),
      insideViewport: rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight && rect.left >= 0,
      confirmExists: Boolean(confirm),
      closeVisible: !!closeRect && closeRect.top >= 0 && closeRect.bottom <= window.innerHeight,
      confirmVisible: !!confirmRect && confirmRect.top >= 0 && confirmRect.bottom <= window.innerHeight,
      portalParentIsBody: element.parentElement === document.body,
      confirmVisible: !!confirmRect && confirmRect.top >= 0 && confirmRect.bottom <= window.innerHeight,
    }
  })
  assert.equal(metrics.portalParentIsBody, true, '选择器必须 portal 到 body，避免画布 transform 影响 fixed 定位')
  assert.equal(metrics.insideViewport, true, '选择器必须完整落在 1402×970 视口内')
  assert.equal(metrics.closeVisible, true, '右上角关闭按钮必须可点击')
  assert.equal(metrics.confirmVisible, true, '底部确认按钮必须可点击')
  assert.deepEqual(browserErrors, [], 'no browser errors')
  await page.screenshot({ path: path.join(artifacts, '01-small-viewport.png'), fullPage: true })

  await page.locator('[aria-label="关闭素材选择器"]').click()
  await dialog.waitFor({ state: 'hidden' })
  await dialog.waitFor({ state: 'detached' })

  const compact = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await compact.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    const isLocal = ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === base.split(':')[2]
    if (isLocal && !url.pathname.startsWith('/api/')) return await route.continue()
    if (route.request().resourceType() === 'image') return await route.fulfill({ status: 204, contentType: 'image/png', body: '' })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ materials: [], projects: [] }) })
  })
  await compact.goto(base, { waitUntil: 'domcontentloaded' })
  const compactDialog = compact.getByRole('dialog', { name: '从素材库选择' })
  await compactDialog.waitFor({ state: 'visible', timeout: 15_000 })
  const compactMetrics = await compactDialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const close = element.querySelector('[aria-label="关闭素材选择器"]')?.getBoundingClientRect()
    const confirm = [...element.querySelectorAll('button')].find((button) => button.textContent?.includes('添加引用'))?.getBoundingClientRect()
    return {
      rect: rect.toJSON(),
      insideViewport: rect.top >= 0 && rect.right <= window.innerWidth && rect.bottom <= window.innerHeight && rect.left >= 0,
      closeVisible: !!close && close.top >= 0 && close.bottom <= window.innerHeight,
      confirmVisible: !!confirm && confirm.top >= 0 && confirm.bottom <= window.innerHeight,
    }
  })
  assert.equal(compactMetrics.insideViewport, true, '选择器必须完整落在 1280×720 视口内')
  assert.equal(compactMetrics.closeVisible, true, '1280×720 下关闭按钮必须可点击')
  assert.equal(compactMetrics.confirmVisible, true, '1280×720 下确认按钮必须可点击')
  await compact.screenshot({ path: path.join(artifacts, '02-compact-viewport.png'), fullPage: true })
  await compact.close()

  console.log(JSON.stringify({ ok: true, viewports: [metrics.viewport, { width: 1280, height: 720 }], artifacts }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
