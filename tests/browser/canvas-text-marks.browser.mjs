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
const artifacts = path.join(root, 'test-results/canvas-editing-theme/E2')
await mkdir(artifacts, { recursive: true })
const bundle = await build({ entryPoints: ['tests/browser/canvas-text-marks.fixture.tsx'], bundle: true, write: false, outdir: '/fixture.js', outExtension: { '.js': '.js', '.css': '.raw.css' }, jsx: 'automatic', platform: 'browser', external: ['tailwindcss'], alias: { '@': path.join(root, 'src'), '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'), 'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'), 'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'), 'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'), 'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx') }, define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' } })
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const rawCss = bundle.outputFiles.find((file) => file.path.endsWith('.raw.css'))?.contents
assert.ok(script && rawCss)
const globalCss = await readFile(path.join(root, 'src/app/globals.css'), 'utf8')
const css = Buffer.from((await postcss([tailwindcss()]).process(`${globalCss}\n${Buffer.from(rawCss).toString()}`, { from: path.join(root, 'src/app/globals.css'), map: false })).css)
const textNode = { id: 'text-a', canvasId: 'canvas-1', type: 'text', position: { x: 420, y: 420 }, size: { width: 360, height: 240 }, status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null, data: { title: '文本', text: 'hello world', mediaType: 'text', origin: 'upload' } }
const graph = { canvas: { id: 'canvas-1', projectId: 'project-1', title: '文本标注验证', revision: 0, viewport: { x: 0, y: 0, zoom: 1 }, themeColor: null, visibility: 'workspace', forkedFromId: null, createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z' }, nodes: [textNode], edges: [] }
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); return }
  if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return }
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === base && !url.pathname.startsWith('/api/')) return route.continue()
    let payload = { voices: [], materials: [], projects: [] }
    if (url.pathname.includes('/canvas/canvas-1')) payload = graph
    else if (url.pathname.endsWith('/generation-config')) payload = { textModels: [], imageModels: [], videoModels: [], audioModels: [], model3dModels: [], defaults: {} }
    else if (url.pathname.endsWith('/balance')) payload = { balancePoints: 1000, generationAllowed: true }
    else if (url.pathname.endsWith('/operations')) payload = { engines: [], latestTask: null, latestTaskLinks: null }
    else if (url.pathname.endsWith('/studio-document')) payload = { studioDocument: null }
    else if (url.pathname === '/api/interactive') payload = null
    else if (url.pathname === '/api/projects/project-1') payload = { work: { id: 'project-1', name: '文本标注验证', workId: 'work-1', workName: '验证项目' } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
  await page.addInitScript(() => { window.localStorage.setItem('nori-canvas-offline-drafts-v1', '[]') })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const body = page.locator('[data-id="text-a"] .nori-canvas-text-preview')
  await body.waitFor()
  await body.click()
  await body.click()
  const textarea = page.locator('[data-id="text-a"] textarea')
  await textarea.waitFor()
  assert.equal(await page.locator('.nori-canvas-text-mirror').count(), 0)
  const select = async (start, end) => { await textarea.evaluate((element, start) => { element.focus(); element.setSelectionRange(start, start) }, start); for (let index = start; index < end; index += 1) await page.keyboard.press('Shift+ArrowRight') }
  await select(6, 11)
  await page.getByRole('button', { name: '加粗（⌘B）', exact: true }).click()
  await page.locator('.nori-canvas-text-mirror .is-bold').waitFor()
  assert.equal(await page.locator('.nori-canvas-text-mirror .is-bold').textContent(), 'world')
  await textarea.evaluate((element) => { element.focus(); element.setSelectionRange(9, 9) })
  await page.keyboard.type('x')
  assert.equal(await page.locator('.nori-canvas-text-mirror .is-bold').textContent(), 'worxld')
  await select(0, 5)
  await page.getByRole('button', { name: '黄色高亮', exact: true }).click()
  assert.equal(await page.locator('.nori-canvas-text-mirror .hl-yellow').textContent(), 'hello')
  await page.getByRole('button', { name: '黄色高亮', exact: true }).click()
  assert.equal(await page.locator('.nori-canvas-text-mirror .hl-yellow').count(), 0)
  await select(0, 5)
  await page.keyboard.press('Meta+b')
  await select(0, 5)
  await page.keyboard.press('Meta+Shift+h')
  assert.equal(await page.locator('.nori-canvas-text-mirror .hl-yellow').textContent(), 'hello')
  await page.getByRole('button', { name: '清除标注', exact: true }).click()
  assert.equal(await page.locator('.nori-canvas-text-mirror .hl-yellow').count(), 0)
  await select(0, 5)
  await page.getByRole('button', { name: '蓝色高亮', exact: true }).click()
  await page.locator('.nori-canvas-workspace').click({ position: { x: 20, y: 200 } })
  await textarea.waitFor({ state: 'detached' })
  assert.equal(await body.locator('.is-bold').textContent(), 'worxld')
  assert.equal(await body.locator('.hl-blue').textContent(), 'hello')
  await page.screenshot({ path: path.join(artifacts, 'marks.png') })
  await page.keyboard.press('Meta+z')
  await body.locator('.is-bold').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '重做', exact: true }).click()
  await body.locator('.is-bold').waitFor()
  await page.screenshot({ path: path.join(artifacts, 'restored.png') })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, results: ['bold', 'highlight-toggle', 'clear', 'shortcuts', 'rebase', 'preview'], artifacts }))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
