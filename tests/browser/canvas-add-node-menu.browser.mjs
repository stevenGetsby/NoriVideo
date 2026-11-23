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
const artifacts = path.join(root, 'test-results/canvas-editing-theme/B2')
await mkdir(artifacts, { recursive: true })
const bundle = await build({
  entryPoints: ['tests/browser/canvas-add-node-menu.fixture.tsx'],
  bundle: true, write: false, outdir: '/fixture.js',
  outExtension: { '.js': '.js', '.css': '.raw.css' },
  jsx: 'automatic', platform: 'browser', external: ['tailwindcss'],
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
assert.ok(script && rawCss)
const globalCss = await readFile(path.join(root, 'src/app/globals.css'), 'utf8')
const css = Buffer.from((await postcss([tailwindcss()]).process(`${globalCss}\n${Buffer.from(rawCss).toString()}`, {
  from: path.join(root, 'src/app/globals.css'), map: false,
})).css)
const canvas = { id: 'canvas-1', projectId: 'project-1', title: '添加节点菜单验证', revision: 0, viewport: { x: 0, y: 0, zoom: 1 }, themeColor: null, visibility: 'workspace', forkedFromId: null, createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z' }
const graph = { canvas, nodes: [{ id: 'node-1', canvasId: 'canvas-1', type: 'image', position: { x: 0, y: 500 }, size: { width: 300, height: 200 }, status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null, data: { title: '素材', mediaType: 'image', origin: 'upload' } }], edges: [] }
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
const results = []

async function open(story = false) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('pageerror', (error) => errors.push(error.message))
  let graphReads = 0
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === base && !url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname.includes('/canvas/canvas-1') && route.request().method() === 'GET') graphReads += 1
    let payload = { voices: [], materials: [], projects: [] }
    if (url.pathname.includes('/canvas/canvas-1')) payload = graph
    else if (url.pathname.endsWith('/generation-config')) payload = { textModels: [], imageModels: [], videoModels: [], audioModels: [], model3dModels: [], defaults: {} }
    else if (url.pathname.endsWith('/balance')) payload = { balancePoints: 1000, generationAllowed: true }
    else if (url.pathname.endsWith('/operations')) payload = { engines: [], latestTask: null, latestTaskLinks: null }
    else if (url.pathname.endsWith('/studio-document')) payload = { studioDocument: null }
    else if (url.pathname === '/api/interactive') payload = { story: story ? { workId: 'work-1', name: '影游验证', canManage: true, config: { variables: [] }, chapters: [{ projectId: 'project-1', name: '第一章' }] } : null }
    else if (url.pathname === '/api/projects/project-1') payload = { work: { id: 'project-1', name: '添加节点菜单验证', workId: 'work-1', workName: '验证项目' } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
  await page.goto(`${base}/${story ? '?story=1' : ''}`, { waitUntil: 'domcontentloaded' })
  await page.locator('.react-flow__node').waitFor()
  await page.locator('.nori-canvas-sync-lock').waitFor({ state: 'detached', timeout: 15000 }).catch(() => {})
  await page.locator('.nori-canvas-tool-rail:not(.is-disabled)').waitFor()
  return { page, graphReads: () => graphReads }
}

async function findEmptyPoint(page) {
  const point = await page.evaluate(() => {
    const pane = document.querySelector('.react-flow__pane')?.getBoundingClientRect()
    if (!pane) return null
    for (let y = pane.y + 90; y < pane.y + pane.height - 40; y += 24) {
      for (let x = pane.x + 60; x < pane.x + pane.width - 60; x += 40) {
      const element = document.elementFromPoint(x, y)
      if (element?.closest('.react-flow__pane')) return { x, y }
      }
    }
    return null
  })
  assert.ok(point, 'canvas must expose an empty point')
  return point
}

async function openMenu(page, point) {
  point = point || await findEmptyPoint(page)
  await page.mouse.click(point.x, point.y, { button: 'right' })
  const context = page.getByRole('menu', { name: '画布操作' })
  try { await context.waitFor({ timeout: 3000 }) } catch (error) {
    throw new Error(`${error.message}\n${await page.locator('body').innerText()}\n${JSON.stringify(await page.evaluate((point) => ({ target: document.elementFromPoint(point.x, point.y)?.outerHTML, point }), point))}`)
  }
  await context.waitFor()
  await context.getByRole('menuitem', { name: '添加节点', exact: true }).click()
  const menu = page.getByRole('menu', { name: '添加节点', exact: true })
  await menu.waitFor()
  assert.equal(await page.locator('.nori-canvas-add-panel').count(), 0)
  const rect = await menu.evaluate((element) => element.getBoundingClientRect().toJSON())
  assert.ok(Math.abs(rect.x - point.x) <= 8 && (Math.abs(rect.y - point.y) <= 8 || point.y + 420 > 800), JSON.stringify({ point, rect }))
  return menu
}

try {
  const { page } = await open()
  for (const point of [{ x: 300, y: 200 }, { x: 600, y: 400 }, { x: 900, y: 500 }]) {
    const target = await findEmptyPoint(page)
    const menu = await openMenu(page, target)
    assert.equal(await menu.getByRole('menuitem', { name: '音频', exact: true }).isDisabled(), true)
    await page.keyboard.press('Escape')
    await menu.waitFor({ state: 'detached' })
  }
  const menu = await openMenu(page, { x: 600, y: 400 })
  await menu.getByRole('menuitem', { name: '文本', exact: true }).click()
  await page.locator('.react-flow__node-text').waitFor()
  const nodePoint = await page.locator('.react-flow__node-text').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }
  })
  assert.ok(Math.abs(nodePoint.x - 600) <= 40 && Math.abs(nodePoint.y - 400) <= 40, JSON.stringify(nodePoint))
  assert.equal(await menu.count(), 0)
  await page.screenshot({ path: path.join(artifacts, 'after.png') })
  results.push('position-items-create')

  for (const dismiss of ['escape', 'blank', 'wheel', 'pan', 'node']) {
    const active = await openMenu(page)
    const count = await page.locator('.react-flow__node').count()
    if (dismiss === 'escape') await page.keyboard.press('Escape')
    if (dismiss === 'blank') await page.mouse.click(300, 650)
    if (dismiss === 'wheel') { await page.mouse.move(300, 650); await page.mouse.wheel(0, 100) }
    if (dismiss === 'pan') { await page.mouse.move(300, 650); await page.mouse.down({ button: 'middle' }); await page.mouse.move(340, 670); await page.mouse.up({ button: 'middle' }) }
    if (dismiss === 'node') await page.locator('.react-flow__node').first().click()
    await active.waitFor({ state: 'detached' })
    assert.equal(await page.locator('.react-flow__node').count(), count)
    results.push(`dismiss-${dismiss}`)
  }

  await page.getByRole('button', { name: '添加节点', exact: true }).first().click()
  await page.locator('.nori-canvas-add-panel').waitFor()
  assert.equal(await page.locator('.nori-canvas-add-panel li:not(.is-story) button').count(), 9)
  const blank = await findEmptyPoint(page)
  await page.mouse.click(blank.x, blank.y)
  await page.locator('.nori-canvas-add-panel').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '添加节点', exact: true }).first().click()
  await page.locator('.react-flow__node-text').click()
  await page.locator('.nori-canvas-add-panel').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '添加节点', exact: true }).first().click()
  await page.keyboard.press('Escape')
  await page.locator('.nori-canvas-add-panel').waitFor({ state: 'detached' })
  results.push('left-panel-dismiss')
  await page.close()

  const story = await open(true)
  const storyMenu = await openMenu(story.page, { x: 600, y: 400 })
  await storyMenu.getByRole('menuitem', { name: '剧情片段', exact: true }).waitFor()
  await storyMenu.getByRole('menuitem', { name: '限时抉择', exact: true }).waitFor()
  await storyMenu.getByRole('menuitem', { name: '剧情片段', exact: true }).click()
  await story.page.locator('.react-flow__node-story_scene').waitFor()
  results.push('story-position-items-create')
  await story.page.close()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, results, artifacts }))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
