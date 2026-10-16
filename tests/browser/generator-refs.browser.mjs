// 独立浏览器验证：生成节点「引用素材」行最右侧的素材库加号。
// 只渲染真实 CanvasGenerator，不登录、不写数据库、不调用生成接口。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'

const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || process.cwd(), 'package.json'))
const { chromium } = tools('playwright-core')
const root = process.cwd()
const artifacts = path.join(root, 'test-results/generator-refs')
await mkdir(artifacts, { recursive: true })

let appCss
if (process.env.NORI_BROWSER_GLOBAL_CSS_PATH) {
  appCss = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH, 'utf8')
} else {
  const workspace = new URL(process.env.NORI_WORKSPACE_URL || 'http://127.0.0.1:3000')
  assert.ok(['localhost', '127.0.0.1'].includes(workspace.hostname), 'Only a local workspace may supply test styles')
  const loginPage = await (await fetch(new URL('/zh/auth/signin', workspace))).text()
  const stylePaths = [...loginPage.matchAll(/<link\b[^>]*>/g)]
    .filter(([tag]) => tag.includes('rel="stylesheet"'))
    .map(([tag]) => tag.match(/href="([^"]+)"/)?.[1])
    .filter((href) => href?.startsWith('/_next/static/'))
  assert.ok(stylePaths.length, 'Local workspace must be running')
  appCss = (await Promise.all(stylePaths.map(async (href) => (
    await (await fetch(new URL(href, workspace))).text()
  )))).join('\n')
}

const bundle = process.env.NORI_BROWSER_PREBUILT_DIR ? {
  outputFiles: await Promise.all(['js', 'css'].map(async (extension) => ({
    path: `/fixture/fixture.${extension}`,
    contents: await readFile(path.join(process.env.NORI_BROWSER_PREBUILT_DIR, `generator-refs.${extension}`)),
  }))),
} : await build({
  entryPoints: ['tests/browser/generator-refs.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
  },
  define: { 'process.env.NODE_ENV': '"development"' },
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
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === base.split(':')[2]) return await route.continue()
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
      resolution: ['480p', '720p'],
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
  const body = url.pathname.includes('generation-config')
    ? {
      textModels: [],
      imageModels: [{ ...videoModel, modelKey: 'nori::nori-image', name: 'Nori Image' }],
      videoModels: [videoModel],
      audioModels: [{ modelKey: 'nori::nori-music', name: 'Nori Music', provider: 'nori', tier: 'standard', configured: true, available: true, options: {}, audioModes: ['music', 'sfx'] }],
      model3dModels: [],
      defaults: {
        textModel: null, imageModel: 'nori::nori-image', editModel: null, storyboardModel: null,
        videoModel: 'nori::norivideo2.5', audioModel: 'nori::nori-music', model3dModel: null,
        aspectRatio: '16:9', resolution: '720p',
      },
    }
    : url.pathname.includes('voices')
      ? { voices: [] }
      : { balancePoints: 1200, generationAllowed: true }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
})

const results = []
try {
  for (const [query, expectedType] of [
    ['', 'all'],
    ['?mode=image', 'image'],
    ['?mode=firstlastframe', 'image'],
    ['?type=audio', 'audio'],
    ['?type=image', 'image'],
    ['?refs=1', 'all'],
  ]) {
    await page.goto(`${base}/${query}`)
    const row = page.locator('.nori-canvas-generator-refs')
    await row.waitFor()
    const add = row.getByRole('button', { name: '添加引用素材' })
    assert.equal(await add.count(), 1, `expected exactly one add button for ${query || 'video'}`)
    const boxes = await row.locator('> *').evaluateAll((items) => items.map((item) => {
      const r = item.getBoundingClientRect()
      return { label: item.getAttribute('aria-label') || item.textContent?.trim() || item.className, x: r.x, right: r.right }
    }))
    const addIndex = boxes.findIndex((box) => box.label === '添加引用素材')
    assert.equal(addIndex, boxes.length - 1, `add button must be the last item for ${query || 'video'}`)
    const others = boxes.filter((box) => box.label !== '添加引用素材')
    if (others.length > 0) {
      assert.ok(boxes[addIndex].x >= Math.max(...others.map((box) => box.x)), `add button must sit at the right edge for ${query || 'video'}`)
    }
    await page.screenshot({ path: path.join(artifacts, `refs-${results.length}.png`) })
    if (query === '?mode=firstlastframe') {
      // 已保存的首尾帧节点不能被错误降级成全能参考。
      await page.locator('.nori-canvas-parameter-trigger').dispatchEvent('click')
      const mode = await page.locator('.nori-canvas-generator-parameter-grid select').first().inputValue()
      assert.equal(mode, 'firstlastframe', 'saved first/last frame mode must survive configuration loading')
      await page.locator('.nori-canvas-parameter-trigger').dispatchEvent('click')
    }
    await add.dispatchEvent('click')
    const added = JSON.parse(await page.getByTestId('added-request').textContent())
    assert.equal(added.type, expectedType, `picker media type for ${query || 'video'}`)
    assert.ok(added.maxSelected >= 1)
    results.push({ query: query || '(default video)', type: added.type, maxSelected: added.maxSelected, items: boxes.length })
  }
  for (const viewport of [{ width: 390, height: 700 }, { width: 768, height: 480 }, { width: 1024, height: 600 }]) {
    await page.setViewportSize(viewport)
    await page.goto(`${base}/?stale=1`)
    const warning = page.getByRole('alert').filter({ hasText: '有 1 个引用节点已删除' })
    await warning.waitFor()
    const clear = warning.getByRole('button', { name: '清除失效引用', exact: true })
    await clear.scrollIntoViewIfNeeded()
    for (const control of [warning, clear, page.getByRole('button', { name: '关闭节点编辑器', exact: true }), page.getByRole('button', { name: '生成', exact: true })]) {
      const box = await control.boundingBox()
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
        `Stale reference warning and recovery must fit ${viewport.width}x${viewport.height}: ${JSON.stringify(box)}`)
    }
    await page.screenshot({ path: path.join(artifacts, `stale-${viewport.width}.png`) })
    await clear.click()
    await warning.waitFor({ state: 'hidden' })
    results.push({ viewport: `${viewport.width}x${viewport.height}`, staleReferenceWarningAndRecovery: true })
  }
  assert.deepEqual(errors, [], 'no browser errors')
  console.log(JSON.stringify({ results, browserErrors: errors, artifacts }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
