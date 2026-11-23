import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { build } from 'esbuild'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/canvas-picker-scroll')
await mkdir(artifacts, { recursive: true })
const bundle = await build({
  entryPoints: ['tests/browser/canvas-picker-scroll.fixture.tsx'],
  bundle: true,
  write: false,
  outdir: '/fixture.js',
  outExtension: { '.js': '.js', '.css': '.raw.css' },
  jsx: 'automatic',
  platform: 'browser',
  external: ['tailwindcss'],
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'),
    'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx'),
  },
  define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const rawCss = bundle.outputFiles.find((file) => file.path.endsWith('.raw.css'))?.contents
assert.ok(script && rawCss, 'fixture bundle must contain JavaScript and CSS')
const globalCss = await readFile(path.join(root, 'src/app/globals.css'), 'utf8')
const css = Buffer.from((await postcss([tailwindcss()]).process(`${globalCss}\n${Buffer.from(rawCss).toString()}`, {
  from: path.join(root, 'src/app/globals.css'),
  map: false,
})).css)
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLfcAAAAASUVORK5CYII=', 'base64')
const imageUrl = `data:image/png;base64,${png.toString('base64')}`
const materials = Array.from({ length: 120 }, (_, index) => ({
  id: `material-${index + 1}`, projectId: 'project-1', projectName: '滚动验证作品', ownerName: '测试成员',
  title: `滚动素材 ${index + 1}`, type: 'image', source: 'upload', status: 'ready', isFavorited: false,
  resultUrl: imageUrl, storageKey: null, url: imageUrl, metadata: { assetCategory: 'character' },
  createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z',
}))
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

async function assertPickerScroll(page, legacy) {
  const dialog = page.getByRole('dialog', { name: '从资产库选择' })
  await dialog.waitFor({ state: 'visible' })
  await page.getByText('滚动素材 1', { exact: true }).waitFor()
  const results = page.locator('.material-picker-results')
  const mediaRatio = await page.locator('.material-picker-card-media').first().evaluate((element) => element.getBoundingClientRect().width / element.getBoundingClientRect().height)
  assert.ok(Math.abs(mediaRatio - 4 / 3) < 0.02, `material card ratio: ${mediaRatio}`)
  await results.hover()
  for (let index = 0; index < 60; index += 1) {
    if (await results.evaluate((element) => element.scrollTop + element.clientHeight >= element.scrollHeight - 2)) break
    await page.mouse.wheel(0, 5000)
    await page.waitForTimeout(120)
  }
  await page.waitForFunction(() => {
    const element = document.querySelector('.material-picker-results')
    return element && element.scrollTop + element.clientHeight >= element.scrollHeight - 2
  })
  const metrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const list = element.querySelector('.material-picker-results')
    const last = [...element.querySelectorAll('.material-picker-card')].at(-1)
    const lastRect = last?.getBoundingClientRect()
    return {
      dialogBottom: rect.bottom,
      viewportHeight: window.innerHeight,
      scrollHeight: list.scrollHeight,
      clientHeight: list.clientHeight,
      scrollTop: list.scrollTop,
      lastVisible: Boolean(lastRect && lastRect.top >= 0 && lastRect.bottom <= window.innerHeight),
      lastTitle: last?.textContent,
      overscrollBehavior: getComputedStyle(list).overscrollBehavior,
    }
  })
  assert.ok(metrics.dialogBottom <= metrics.viewportHeight, JSON.stringify(metrics))
  assert.ok(metrics.scrollHeight > metrics.clientHeight, JSON.stringify(metrics))
  assert.ok(metrics.scrollTop > 0, JSON.stringify(metrics))
  assert.ok(metrics.lastVisible, JSON.stringify(metrics))
  assert.match(metrics.lastTitle, /滚动素材 120/)
  assert.equal(metrics.overscrollBehavior, 'contain')
  await page.screenshot({ path: path.join(artifacts, `${legacy ? 'legacy' : 'modern'}-picker.png`) })
  return metrics
}

async function assertPreviewScroll(page, legacy) {
  await page.getByRole('button', { name: '打开素材库', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.fml-main')?.textContent?.includes('滚动素材 1'))
  await page.locator('.fml-main article > button:not([aria-label])').first().click()
  const dialog = page.getByTestId('material-large-preview')
  await dialog.waitFor({ state: 'visible' })
  const metrics = await dialog.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    const sidebar = element.querySelector('aside')
    return {
      insideViewport: rect.top >= 0 && rect.bottom <= window.innerHeight,
      sidebarScrolls: sidebar.scrollHeight > sidebar.clientHeight,
      height: getComputedStyle(element).height,
    }
  })
  assert.ok(metrics.insideViewport, JSON.stringify(metrics))
  assert.ok(metrics.sidebarScrolls, JSON.stringify(metrics))
  await page.screenshot({ path: path.join(artifacts, `${legacy ? 'legacy' : 'modern'}-preview.png`) })
  return metrics
}

try {
  for (const legacy of [true, false]) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
    const errors = []
    page.on('pageerror', (error) => errors.push(error.message))
    await page.route('**/*', async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname === '/fixture.css') {
        if (!legacy) return route.continue()
        const response = await route.fetch()
        const body = (await response.text()).replace(/(\d)(dvh|svh|lvh)/g, '$1dvhx')
        return route.fulfill({ response, body })
      }
      if (url.origin === base && !url.pathname.startsWith('/api/')) return route.continue()
      let payload = { materials, projects: [{ id: 'project-1', name: '滚动验证作品', workId: 'work-1' }], capabilities: { trash: { supported: true, count: 0 } } }
      if (url.pathname === '/api/projects') payload = { works: [{ id: 'project-1', name: '滚动验证作品', workId: 'work-1' }], projects: [{ id: 'project-1', name: '滚动验证作品', workId: 'work-1' }], pagination: { totalPages: 1 } }
      if (url.pathname === '/api/projects/project-1') payload = { work: { id: 'project-1', name: '滚动验证作品', workId: 'work-1' } }
      if (url.pathname === '/api/assets') payload = { assets: [] }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
    })
    await page.goto(base, { waitUntil: 'domcontentloaded' })
    const picker = await assertPickerScroll(page, legacy)
    await page.getByRole('button', { name: '关闭素材选择器' }).click()
    const preview = await assertPreviewScroll(page, legacy)
    assert.deepEqual(errors, [])
    await page.close()
    console.log(JSON.stringify({ ok: true, mode: legacy ? 'invalid-dynamic-units' : 'modern', picker, preview }))
  }
  console.log(JSON.stringify({ ok: true, artifacts }))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
