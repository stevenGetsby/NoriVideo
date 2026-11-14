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
const artifacts = path.join(root, 'test-results/canvas-editing-theme/E5')
await mkdir(artifacts, { recursive: true })
const media = await readFile(path.join(root, 'test-results/canvas-ui-regression/sample.mp4'))
const bundle = await build({ entryPoints: ['tests/browser/canvas-video-prompt.fixture.tsx'], bundle: true, write: false, outdir: '/fixture.js', outExtension: { '.js': '.js', '.css': '.raw.css' }, jsx: 'automatic', platform: 'browser', external: ['tailwindcss'], alias: { '@': path.join(root, 'src'), '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'), 'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'), 'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'), 'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'), 'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx') }, define: { 'process.env.NODE_ENV': '"development"' } })
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const rawCss = bundle.outputFiles.find((file) => file.path.endsWith('.raw.css'))?.contents
assert.ok(script && rawCss)
const globalCss = await readFile(path.join(root, 'src/app/globals.css'), 'utf8')
const css = Buffer.from((await postcss([tailwindcss()]).process(`${globalCss}\n${Buffer.from(rawCss).toString()}`, { from: path.join(root, 'src/app/globals.css'), map: false })).css)
const node = { id: 'video-a', canvasId: 'canvas-1', type: 'video', position: { x: 400, y: 240 }, size: { width: 420, height: 280 }, status: 'SUCCEEDED', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null, data: {
  title: '雨夜镜头', prompt: '节点里的旧提示词', mediaType: 'video', origin: 'generate', videoUrl: '/api/storage/sign?key=video.mp4&signature=current', contentUrl: '/api/storage/sign?key=video.mp4&signature=current',
  generation: { modelKey: 'nori::video', modelLabel: '视频模型', referenceNodeIds: [], aspectRatio: '16:9', duration: 5, parameters: {} },
  history: [
    { id: 'v1', url: '/api/storage/sign?key=video.mp4&signature=first', prompt: '第一版提示词', createdAt: '2026-11-14T00:00:00.000Z', status: 'ready' },
    { id: 'v2', url: '/api/storage/sign?key=video.mp4&signature=second', prompt: '第二版：雨夜跟随镜头', modelKey: 'nori::video', parameters: { duration: 5, aspectRatio: '16:9' }, createdAt: '2026-11-15T00:00:00.000Z', status: 'ready' },
  ],
} }
const graph = { canvas: { id: 'canvas-1', projectId: 'project-1', title: '视频提示词验证', revision: 0, viewport: { x: 0, y: 0, zoom: 1 }, themeColor: null, visibility: 'workspace', forkedFromId: null, createdAt: '2026-11-15T00:00:00.000Z', updatedAt: '2026-11-15T00:00:00.000Z' }, nodes: [node], edges: [] }
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); return }
  if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return }
  if (request.url?.startsWith('/api/storage/sign')) {
    const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = match ? Number(match[1]) : 0
    const end = match?.[2] ? Number(match[2]) : media.length - 1
    response.writeHead(match ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(match ? { 'Content-Range': `bytes ${start}-${end}/${media.length}` } : {}) })
    response.end(media.subarray(start, end + 1)); return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const errors = []
const generated = []
const savedPrompts = []
const requests = []
let serverGraph = structuredClone(graph)
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, permissions: ['clipboard-read', 'clipboard-write'] })
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === base && !url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/storage/sign') return route.continue()
    let payload = { voices: [], materials: [], projects: [] }
    const method = route.request().method()
    if (method !== 'GET') requests.push([method, url.pathname])
    if (url.pathname.endsWith('/generate') && method === 'POST') {
      const body = route.request().postDataJSON()
      generated.push(body)
      payload = { tasks: [{ taskId: 'task-mock', assetId: 'asset-mock', nodeId: body.nodeId }] }
    } else if ((url.pathname.endsWith('/ops') || url.pathname.endsWith('/operations')) && method === 'POST') {
      const body = route.request().postDataJSON()
      for (const operation of body.ops || []) if (operation.type === 'node.upsert' && operation.node.id === 'video-a') savedPrompts.push(operation.node.data?.prompt)
      payload = structuredClone(serverGraph)
      payload.canvas.revision += 1
      payload.canvas.updatedAt = new Date().toISOString()
      for (const operation of body.ops || []) {
        if (operation.type === 'node.upsert') {
          const next = { ...operation.node, canvasId: 'canvas-1', status: 'IDLE', taskId: null, runId: null, mediaObjectId: null, parentNodeId: null }
          const index = payload.nodes.findIndex((item) => item.id === next.id)
          if (index >= 0) payload.nodes[index] = next
          else payload.nodes.push(next)
        }
        if (operation.type === 'edge.add') payload.edges.push({ ...operation.edge, canvasId: 'canvas-1' })
      }
      serverGraph = structuredClone(payload)
    } else if (url.pathname.endsWith('/document')) {
      const body = route.request().postDataJSON()
      savedPrompts.push(body.nodes?.find((item) => item.id === 'video-a')?.data?.prompt)
      serverGraph = { ...structuredClone(body), canvas: { ...serverGraph.canvas, revision: serverGraph.canvas.revision + 1, viewport: body.viewport, updatedAt: new Date().toISOString() } }
      payload = serverGraph
    } else if (url.pathname.endsWith('/canvas/canvas-1')) {
      payload = serverGraph
    } else if (url.pathname.endsWith('/generation-quote')) payload = { points: 10, currency: 'points' }
    else if (url.pathname.endsWith('/generation-config')) payload = { textModels: [], imageModels: [], videoModels: [], audioModels: [], model3dModels: [], defaults: {} }
    else if (url.pathname.endsWith('/balance')) payload = { balancePoints: 1000, generationAllowed: true }
    else if (url.pathname.endsWith('/operations')) payload = { engines: [], latestTask: null, latestTaskLinks: null }
    else if (url.pathname.endsWith('/studio-document')) payload = { studioDocument: null }
    else if (url.pathname === '/api/interactive') payload = null
    else if (url.pathname === '/api/projects/project-1') payload = { work: { id: 'project-1', name: '视频提示词验证', workId: 'work-1', workName: '验证项目' } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
  await page.addInitScript(() => { window.localStorage.setItem('nori-canvas-offline-drafts-v1', '[]') })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: '放大预览', exact: true }).waitFor()
  await page.getByRole('button', { name: '放大预览', exact: true }).click({ force: true })
  await page.locator('.nori-video-timeline').waitFor()
  await page.keyboard.press('p')
  const panel = page.locator('.nori-video-prompt-panel')
  await panel.waitFor()
  assert.equal(await panel.locator('.nori-video-prompt-readonly').textContent(), '第二版：雨夜跟随镜头')
  await page.keyboard.press('p')
  await panel.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '对照提示词', exact: true }).click()
  const textarea = panel.getByRole('textbox', { name: '修改提示词' })
  await textarea.fill('第三版：雨夜缓慢推进')
  await panel.getByText('已修改，与当前视频不一致', { exact: true }).waitFor()
  await page.keyboard.press('Escape')
  assert.equal(await page.locator('.nori-canvas-media-preview').count(), 1)
  assert.equal(await textarea.evaluate((element) => document.activeElement === element), false)
  await page.keyboard.press('Escape')
  await page.locator('.nori-canvas-media-preview').waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '放大预览', exact: true }).click({ force: true })
  await page.getByRole('button', { name: '对照提示词', exact: true }).click()
  assert.equal(await textarea.inputValue(), '第三版：雨夜缓慢推进')
  await panel.getByRole('button', { name: '恢复原提示词', exact: true }).click()
  assert.equal(await textarea.inputValue(), '第二版：雨夜跟随镜头')
  await panel.getByRole('button', { name: '复制', exact: true }).click()
  assert.equal(await page.evaluate(() => navigator.clipboard.readText()), '第二版：雨夜跟随镜头')
  await textarea.fill('第三版：雨夜缓慢推进')
  await panel.getByRole('button', { name: '插入时间点', exact: true }).click()
  assert.match(await textarea.inputValue(), /第三版：雨夜缓慢推进\d\d:\d\d $/)
  await panel.getByRole('button', { name: '保存到节点', exact: true }).click()
  await page.waitForFunction(() => window.__canvasQueryClient.getQueryData)
  await page.waitForFunction(() => document.querySelector('[data-id="video-a"]')?.textContent?.includes('雨夜镜头'))
  await page.waitForTimeout(1400)
  assert.ok(savedPrompts.some((prompt) => /第三版：雨夜缓慢推进\d\d:\d\d $/.test(prompt)), `prompt must autosave: ${JSON.stringify({ savedPrompts, requests, errors })}`)
  await page.screenshot({ path: path.join(artifacts, 'after-save.png') })
  await page.reload({ waitUntil: 'domcontentloaded' })
  const recovery = page.getByRole('button', { name: '使用服务器', exact: true })
  await recovery.waitFor({ timeout: 3000 }).catch(() => undefined)
  if (await recovery.count()) await recovery.click()
  if (await recovery.count()) await recovery.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: '放大预览', exact: true }).click({ force: true })
  await page.locator('.nori-video-timeline').waitFor({ timeout: 5000 }).catch(async () => {
    await page.screenshot({ path: path.join(artifacts, 'after-reload.png') })
    throw new Error(JSON.stringify({ errors, text: (await page.locator('body').textContent()).slice(0, 3000) }))
  })
  await page.getByRole('button', { name: '对照提示词', exact: true }).click()
  await page.waitForTimeout(1200)
  await page.screenshot({ path: path.join(artifacts, 'prompt-1440.png') })
  assert.ok((await page.locator('.nori-video-player').boundingBox()).width >= 480)
  await page.keyboard.press('Escape')
  await page.locator('.nori-canvas-media-preview').waitFor({ state: 'detached' })
  await page.setViewportSize({ width: 900, height: 768 })
  await page.getByRole('button', { name: '放大预览', exact: true }).first().click({ force: true })
  await page.locator('.nori-video-timeline').waitFor()
  assert.equal(await page.locator('.nori-video-inspector').count(), 0)
  await page.getByRole('button', { name: '对照提示词', exact: true }).click()
  await page.waitForTimeout(200)
  const narrowLayout = await page.evaluate(() => ({ inspector: getComputedStyle(document.querySelector('.nori-video-inspector')).position, playerWidth: document.querySelector('.nori-video-player').getBoundingClientRect().width, workspaceWidth: document.querySelector('.nori-video-workspace').getBoundingClientRect().width, workspaceGrid: getComputedStyle(document.querySelector('.nori-video-workspace')).gridTemplateColumns, preview: document.querySelector('.nori-canvas-media-preview')?.getBoundingClientRect().width }))
  await page.screenshot({ path: path.join(artifacts, 'narrow-900.png') })
  assert.equal(narrowLayout.inspector, 'absolute')
  assert.ok(Math.abs(narrowLayout.playerWidth - narrowLayout.workspaceWidth) < 2, JSON.stringify(narrowLayout))
  await page.setViewportSize({ width: 1440, height: 900 })
  await textarea.fill('第四版：航拍转入雨夜')
  await panel.getByRole('button', { name: '保存并重新生成', exact: true }).click()
  await page.locator('.nori-canvas-media-preview').waitFor({ state: 'detached' })
  assert.equal(generated.length, 1, JSON.stringify({ generated, requests, savedPrompts, errors }))
  assert.equal(generated[0].prompt, '第四版：航拍转入雨夜')
  await page.getByText('已提交重新生成，完成后可在节点的历史版本里对比', { exact: true }).waitFor()
  await page.close()
  const readOnly = await browser.newPage({ viewport: { width: 1366, height: 768 }, permissions: ['clipboard-read', 'clipboard-write'] })
  readOnly.on('pageerror', (error) => errors.push(error.stack || error.message))
  await readOnly.route('**/*', async (route) => {
    const url = new URL(route.request().url())
    if (url.origin === base && !url.pathname.startsWith('/api/')) return route.continue()
    if (url.pathname === '/api/storage/sign') return route.continue()
    let payload = { voices: [], materials: [], projects: [] }
    if (url.pathname.endsWith('/canvas/canvas-1')) payload = serverGraph
    else if (url.pathname.endsWith('/generation-config')) payload = { textModels: [], imageModels: [], videoModels: [], audioModels: [], model3dModels: [], defaults: {} }
    else if (url.pathname.endsWith('/balance')) payload = { balancePoints: 1000, generationAllowed: true }
    else if (url.pathname.endsWith('/operations')) payload = { engines: [], latestTask: null, latestTaskLinks: null }
    else if (url.pathname.endsWith('/studio-document')) payload = { studioDocument: null }
    else if (url.pathname === '/api/interactive') payload = null
    else if (url.pathname === '/api/projects/project-1') payload = { work: { id: 'project-1', name: '视频提示词验证', workId: 'work-1', workName: '验证项目' } }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(payload) })
  })
  await readOnly.goto(`${base}/?readonly=1`, { waitUntil: 'domcontentloaded' })
  await readOnly.getByRole('button', { name: '放大预览', exact: true }).click({ force: true })
  await readOnly.getByRole('button', { name: '对照提示词', exact: true }).click()
  assert.equal(await readOnly.getByRole('textbox', { name: '修改提示词' }).count(), 0)
  assert.equal(await readOnly.getByRole('button', { name: '保存并重新生成', exact: true }).count(), 0)
  await readOnly.getByRole('button', { name: '复制', exact: true }).click()
  assert.equal(await readOnly.evaluate(() => navigator.clipboard.readText()), '第二版：雨夜跟随镜头')
  await readOnly.screenshot({ path: path.join(artifacts, 'readonly-1366.png') })
  await readOnly.close()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, results: ['version-prompt', 'shortcut', 'draft-recovery', 'restore', 'copy', 'time-insert', 'autosave', 'mock-regenerate', 'narrow-layout', 'readonly'], artifacts }))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
