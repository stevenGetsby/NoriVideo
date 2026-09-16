// Isolated real-ReactFlow browser regression. No login, database or generation API calls.
// Install playwright-core outside the repo, then set NORI_BROWSER_TOOLS_DIR.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'

const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || process.cwd(), 'package.json'))
const { chromium } = tools('playwright-core')
const root = process.cwd()
const baseline = process.argv.includes('--baseline')
const artifacts = path.join(root, 'test-results/studio-node')
await mkdir(artifacts, { recursive: true })
// Reuse the running local app's compiled global styles (including its 120% UI scale).
const workspace = new URL(process.env.NORI_WORKSPACE_URL || 'http://127.0.0.1:3000')
assert.ok(['localhost', '127.0.0.1'].includes(workspace.hostname), 'Only a local workspace may supply test styles')
const loginPage = await (await fetch(new URL('/zh/auth/signin', workspace))).text()
const stylePaths = [...loginPage.matchAll(/<link\b[^>]*>/g)]
  .filter(([tag]) => tag.includes('rel="stylesheet"'))
  .map(([tag]) => tag.match(/href="([^"]+)"/)?.[1])
  .filter((href) => href?.startsWith('/_next/static/'))
assert.ok(stylePaths.length, 'Local workspace must be running')
const appCss = (await Promise.all(stylePaths.map(async (href) => (
  await (await fetch(new URL(href, workspace))).text()
)))).join('\n')
const bundle = await build({
  entryPoints: ['tests/browser/studio-node.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: { '@': path.join(root, 'src') }, define: { 'process.env.NODE_ENV': '"development"' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).contents
const server = createServer(async (req, res) => {
  if (req.url === '/fixture.js') {
    res.setHeader('Content-Type', 'text/javascript'); res.end(script)
  } else if (req.url === '/fixture.css') {
    res.setHeader('Content-Type', 'text/css'); res.end(css)
  } else if (req.url === '/global.css') {
    res.setHeader('Content-Type', 'text/css'); res.end(appCss)
  } else if (req.url.startsWith('/_next/static/')) {
    const asset = await fetch(new URL(req.url, workspace))
    res.statusCode = asset.status
    res.setHeader('Content-Type', asset.headers.get('content-type') || 'application/octet-stream')
    res.end(Buffer.from(await asset.arrayBuffer()))
  } else {
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

async function open(query = '') {
  await page.goto(`${base}/${query}`)
  await page.locator('.nori-canvas-studio-node-body').waitFor()
  await page.getByTestId('node-position').waitFor()
}
async function position() {
  return JSON.parse(await page.getByTestId('node-position').textContent())
}
async function drag(locator, dx = 100, dy = 65) {
  const box = await locator.boundingBox()
  assert.ok(box)
  const x = box.x + box.width * 0.5
  const y = box.y + box.height * 0.5
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 12 })
  await page.mouse.up()
}
async function layout() {
  return page.locator('.nori-canvas-studio-node').evaluate((node) => {
    const rect = (element) => {
      const r = element.getBoundingClientRect()
      return { x: r.x, y: r.y, width: r.width, height: r.height, bottom: r.bottom, right: r.right }
    }
    const body = node.querySelector('.nori-canvas-studio-node-body')
    const scene = node.querySelector('.nori-canvas-studio-node-scene')
    const meta = node.querySelector('.nori-canvas-studio-node-meta')
    return {
      body: rect(body), scene: rect(scene), meta: rect(meta),
      lines: Array.from(meta.children).map(rect),
    }
  })
}
const results = []
try {
  for (const query of ['', '?width=300&height=220&zoom=0.7&long=true', '?width=560&height=380&zoom=1.25', '?width=180&height=120&long=true']) {
    await open(query)
    const geometry = await layout()
    const before = await position()
    await page.screenshot({ path: path.join(artifacts, `${baseline ? 'before' : 'after'}-${results.length}.png`) })
    if (!baseline && results.length === 0) {
      const card = await page.locator('.nori-canvas-studio-node').boundingBox()
      const toolbar = await page.locator('.nori-canvas-node-toolbar').boundingBox()
      const top = Math.max(0, toolbar.y - 12)
      await page.screenshot({
        path: path.join(artifacts, 'fixed-node.png'),
        clip: { x: card.x - 12, y: top, width: card.width + 24, height: card.y + card.height - top + 12 },
      })
    }
    await drag(page.locator('.nori-canvas-studio-node-scene'))
    const after = await position()
    const moved = after.x > before.x + 30 && after.y > before.y + 20
    results.push({ query, moved, geometry })
    if (!baseline) {
      assert.ok(moved, 'Preview area must drag the node')
      assert.ok(geometry.scene.height > 70, 'The scene preview must not collapse')
      assert.ok(geometry.meta.width >= geometry.body.width - 4, 'Metadata must span the card width')
      assert.ok(geometry.scene.bottom <= geometry.meta.y + 1, 'Scene and metadata must not overlap')
      for (let i = 0; i < geometry.lines.length; i++) {
        assert.ok(geometry.lines[i].right <= geometry.body.right + 1)
        assert.ok(geometry.lines[i].bottom <= geometry.body.bottom + 1)
        if (i > 0) assert.ok(geometry.lines[i].y >= geometry.lines[i - 1].bottom, 'Text lines must not overlap')
      }
    }
  }
  if (!baseline) {
    await open()
    const start = await position()
    await drag(page.locator('.nori-canvas-node-label button'))
    assert.ok((await position()).x > start.x + 30, 'Title must drag the node')
    await page.getByRole('button', { name: '重置测试节点', exact: true }).click()
    await page.locator('.nori-canvas-studio-node-body').dblclick()
    assert.equal(await page.getByTestId('action-count').textContent(), '1', 'Double click must still open the studio')
    await page.getByRole('button', { name: '进入导演台', exact: true }).click()
    assert.equal(await page.getByTestId('action-count').textContent(), '2', 'Toolbar must still open the studio')
    const toolbarPosition = await position()
    await drag(page.getByRole('button', { name: '进入导演台', exact: true }), 30, 10)
    assert.deepEqual(await position(), toolbarPosition, 'Toolbar controls must not move the node')
    const beforeKeyboard = Number(await page.getByTestId('action-count').textContent())
    await page.locator('.nori-canvas-studio-node-body').focus()
    await page.keyboard.press('Enter')
    assert.equal(Number(await page.getByTestId('action-count').textContent()), beforeKeyboard + 1, 'Keyboard activation must work')
    await open()
    const resize = page.locator('.nori-canvas-resize-handle.bottom.right')
    const beforeResize = await page.locator('.nori-canvas-studio-node-body').boundingBox()
    await drag(resize, 100, 80)
    const afterResize = await page.locator('.nori-canvas-studio-node-body').boundingBox()
    assert.ok(afterResize.width > beforeResize.width + 30 && afterResize.height > beforeResize.height + 30, 'Resize must still work')
    assert.equal(await page.locator('.nori-canvas-handle').count(), 2, 'Both connection handles remain available')
    await open('?readonly=true')
    const readOnlyStart = await position()
    await drag(page.locator('.nori-canvas-studio-node-scene'))
    assert.deepEqual(await position(), readOnlyStart, 'Read-only nodes must not move')
    await page.getByRole('button', { name: '查看导演台', exact: true }).click()
    assert.equal(await page.getByTestId('action-count').textContent(), '1')
    assert.deepEqual(errors, [], 'No browser errors')
  }
  await writeFile(path.join(artifacts, `${baseline ? 'before' : 'after'}-report.json`), JSON.stringify({ baseline, results, browserErrors: errors }, null, 2))
  console.log(JSON.stringify({ baseline, cases: results.map(({ query, moved }) => ({ query, moved })), browserErrors: errors, artifacts }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
