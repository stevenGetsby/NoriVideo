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
const artifacts = path.join(root, 'test-results/canvas-editing-theme/E4')
await mkdir(artifacts, { recursive: true })
const bundle = await build({
  entryPoints: ['tests/browser/canvas-text-edit-flow.fixture.tsx'], bundle: true, write: false, outdir: '/fixture.js',
  outExtension: { '.js': '.js', '.css': '.raw.css' }, jsx: 'automatic', platform: 'browser', external: ['tailwindcss'],
  alias: {
    '@': path.join(root, 'src'), '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'), 'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'), 'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx'),
  }, define: { 'process.env.NODE_ENV': '"development"' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const rawCss = bundle.outputFiles.find((file) => file.path.endsWith('.raw.css'))?.contents
assert.ok(script && rawCss)
const globalCss = await readFile(path.join(root, 'src/app/globals.css'), 'utf8')
const css = Buffer.from((await postcss([tailwindcss()]).process(`${globalCss}\n${Buffer.from(rawCss).toString()}`, { from: path.join(root, 'src/app/globals.css'), map: false })).css)
const textNode = (id, text, x, y = 500) => ({ id, canvasId: 'canvas-1', type: 'text', position: { x, y }, size: { width: 300, height: 200 }, status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null, data: { title: '文本', text, mediaType: 'text', origin: 'upload' } })
let graph = { canvas: { id: 'canvas-1', projectId: 'project-1', title: '文本编辑验证', revision: 0, viewport: { x: 0, y: 0, zoom: 1 }, themeColor: null, visibility: 'workspace', forkedFromId: null, createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z' }, nodes: [textNode('text-a', 'hello', 450), textNode('text-b', 'target', 800)], edges: [] }
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
    else if (url.pathname === '/api/projects/project-1') payload = { work: { id: 'project-1', name: '文本编辑验证', workId: 'work-1', workName: '验证项目' } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
  await page.addInitScript(() => { window.localStorage.setItem('nori-canvas-offline-drafts-v1', '[]') })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.locator('.react-flow__node-text').first().waitFor()
  await page.locator('.nori-canvas-sync-lock').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  const bodyA = page.locator('.react-flow__node[data-id="text-a"] .nori-canvas-text-preview')
  const bodyB = page.locator('.react-flow__node[data-id="text-b"] .nori-canvas-text-preview')
  await bodyA.click()
  await bodyA.click()
  await page.locator('.react-flow__node[data-id="text-a"] textarea').waitFor()
  await page.locator('.nori-canvas-generator').waitFor({ state: 'detached' })
  assert.equal(await page.locator('.react-flow__node[data-id="text-a"] textarea').evaluate((el) => document.activeElement === el), true)
  assert.equal(await page.locator('.nori-canvas-generator').count(), 0)
  await page.keyboard.press('Meta+a')
  await page.keyboard.type('edited')
  await page.keyboard.press('Meta+z')
  assert.equal(await page.locator('.react-flow__node[data-id="text-a"] textarea').inputValue(), 'edite')
  assert.equal(await page.locator('.react-flow__node').count(), 2)
  await page.keyboard.press('Meta+a')
  await page.keyboard.press('Meta+c')
  await page.keyboard.press('Meta+x')
  assert.equal(await page.locator('.react-flow__node[data-id="text-a"] textarea').inputValue(), '')
  assert.equal(await page.locator('.react-flow__node').count(), 2)
  await page.keyboard.press('Meta+v')
  assert.equal(await page.locator('.react-flow__node[data-id="text-a"] textarea').inputValue(), 'edite')
  await page.locator('.nori-canvas-workspace').click({ position: { x: 20, y: 200 } })
  await page.locator('.react-flow__node[data-id="text-a"] textarea').waitFor({ state: 'detached' })
  assert.equal(await bodyA.textContent(), 'edite')
  await bodyB.click()
  await page.keyboard.press('Enter')
  await page.locator('.react-flow__node[data-id="text-b"] textarea').waitFor()
  assert.equal(await page.locator('.react-flow__node[data-id="text-b"] textarea').inputValue(), 'target')
  await page.evaluate(() => document.querySelector('[data-id="text-b"] textarea').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true })))
  assert.equal(await page.locator('.react-flow__node[data-id="text-b"] textarea').inputValue(), 'target')
  await page.keyboard.press('Escape')
  await page.locator('.react-flow__node[data-id="text-b"] textarea').waitFor({ state: 'detached' })
  await bodyB.click()
  await page.evaluate(async () => { await navigator.clipboard.writeText('pasted') })
  await page.keyboard.press('Meta+v')
  await page.waitForFunction(() => document.querySelector('[data-id="text-b"] .nori-canvas-text-preview')?.textContent?.includes('pasted'))
  assert.equal(await bodyB.textContent(), 'target\npasted')
  assert.equal(await page.locator('.react-flow__node').count(), 2)
  await bodyA.click()
  await page.keyboard.press('Meta+c')
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node.selected').length === 1 && document.querySelector('[data-id="text-a"]')?.classList.contains('selected'))
  await bodyB.click()
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node.selected').length === 1 && document.querySelector('[data-id="text-b"]')?.classList.contains('selected'))
  await bodyB.click()
  await page.locator('.react-flow__node[data-id="text-b"] textarea').waitFor()
  await page.keyboard.press('Escape')
  await page.locator('.react-flow__node[data-id="text-b"] textarea').waitFor({ state: 'detached' })
  await page.keyboard.press('Escape')
  await bodyB.click()
  await page.keyboard.press('Meta+v')
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 3)
  assert.equal(await bodyB.textContent(), 'target\npasted')
  await page.evaluate(async () => { await navigator.clipboard.writeText('pasted') })
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node').length === 3)
  await page.evaluate(() => {
    const overlay = document.createElement('div')
    overlay.setAttribute('role', 'dialog')
    overlay.innerHTML = '<button type="button">dialog action</button>'
    document.body.append(overlay)
    overlay.querySelector('button').focus()
  })
  await page.keyboard.press('Delete')
  assert.equal(await page.locator('.react-flow__node').count(), 3)
  await page.evaluate(() => document.querySelector('[role="dialog"]')?.remove())
  await page.evaluate(() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', repeat: true, bubbles: true })))
  assert.equal(await page.locator('.react-flow__node').count(), 3)
  await bodyB.click()
  await page.waitForFunction(() => document.querySelectorAll('.react-flow__node.selected').length === 1 && document.querySelector('[data-id="text-b"]')?.classList.contains('selected'))
  await page.keyboard.press('Delete')
  await page.locator('.react-flow__node[data-id="text-b"]').waitFor({ state: 'detached' })
  await page.evaluate(() => {
    const client = window.__canvasQueryClient
    client.setQueryData([...client.getQueryCache().getAll().find((query) => query.queryKey.includes('canvas-1')).queryKey], (old) => ({ ...old, canvas: { ...old.canvas, revision: 2 } }))
  })
  await page.locator('.react-flow__node[data-id="text-b"]').waitFor({ state: 'detached' })
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  await page.keyboard.press('Escape')
  await page.keyboard.press('Meta+z')
  await page.getByRole('button', { name: '使用服务器', exact: true }).click()
  await page.getByRole('button', { name: '撤销', exact: true }).click()
  await page.locator('.react-flow__node[data-id="text-b"] .nori-canvas-text-preview').waitFor()
  await page.screenshot({ path: path.join(artifacts, 'after.png') })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, results: ['single-click-edit', 'enter-edit', 'native-editing-shortcuts', 'delete-stale-merge', 'undo', 'paste-selected-text', 'paste-copied-node', 'overlay-delete-protection', 'repeat-protection'], artifacts }))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
