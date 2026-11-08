// Focused 影游 scene-writing regression in headless Chromium. The fixture uses
// the real StorySceneNode, editor and canvas contexts; no API or generation.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/interactive-scene-text')
await mkdir(artifacts, { recursive: true })
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/interactive-scene-text.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'),
    'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).contents

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  if (pathname === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(script)
  } else if (pathname === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css')
    response.end(css)
  } else {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#root{height:100%;margin:0;background:#0d0f14;color:#f4f4f5;font-family:system-ui,sans-serif}</style>
<link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>`)
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

const textarea = () => page.locator('.nori-scene-text-area')
const lines = async () => JSON.parse(await page.getByTestId('node-lines').textContent())
async function open(query = '') {
  await page.goto(`${base}/${query}`)
  await textarea().waitFor()
  assert.equal(errors.length, 0, errors.join('\n'))
}

try {
  await open()
  assert.equal(await textarea().inputValue(), '敌军压境。')
  assert.equal(await textarea().getAttribute('rows'), '3')
  assert.equal(await page.locator('.nori-scene-text-head label').textContent(), '剧情文字')
  assert.equal(await page.locator('.nori-scene-text-count').textContent(), '5 / 2000')

  // The text editor is the first thing in the card body; the media strip is
  // below it and is only a compact production status.
  assert.deepEqual(
    await page.locator('.nori-story-node-body > *').evaluateAll((elements) => elements.map((element) => element.className)),
    ['nori-scene-text', 'nori-story-effects', 'nori-story-scene-media-strip is-empty'],
  )
  assert.equal(await page.locator('.nori-story-scene-media-actions').count(), 0)
  assert.equal(await page.getByRole('button', { name: '生成视频' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '使用图片' }).count(), 0)
  assert.match(await page.locator('.nori-story-scene-media-strip').textContent(), /在制作层连接视频或图片节点/)

  // Text updates flow back into the node data, with newlines preserved.
  await textarea().fill('新的台词\n第二行')
  await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="node-lines"]').textContent) === '新的台词\n第二行')
  assert.equal(await lines(), '新的台词\n第二行')
  assert.equal(await page.locator('.nori-scene-text-count').textContent(), '8 / 2000')

  // Windows line endings are normalised instead of reaching the player.
  await textarea().fill('甲\r\n乙')
  await page.waitForFunction(() => JSON.parse(document.querySelector('[data-testid="node-lines"]').textContent) === '甲\n乙')
  assert.equal(await lines(), '甲\n乙')

  // A paste cannot exceed the code-point budget.
  await textarea().fill('x'.repeat(2500))
  await page.waitForFunction(() => document.querySelector('.nori-scene-text-area').value.length === 2000)
  assert.equal((await textarea().inputValue()).length, 2000)
  assert.equal(await page.locator('.nori-scene-text-count').textContent(), '2000 / 2000')
  assert.equal(await page.locator('.nori-scene-text-count.is-full').count(), 1)

  // The cut happens between code points, never inside a surrogate pair.
  await textarea().fill('a'.repeat(1999) + '😀')
  await page.waitForFunction(() => Array.from(document.querySelector('.nori-scene-text-area').value).length === 2000)
  const boundary = await textarea().evaluate((element) => ({ points: Array.from(element.value).length, tail: element.value.slice(-2) }))
  assert.deepEqual(boundary, { points: 2000, tail: '😀' })
  await page.screenshot({ path: path.join(artifacts, 'scene-text-editor.png'), fullPage: true })

  // Read-only keeps the writing surface visible but disables edits and actions.
  await open('?readonly=true')
  assert.equal(await textarea().isEditable(), false)
  assert.equal(await page.getByRole('button', { name: '生成视频' }).count(), 0)
  assert.equal(await page.getByRole('button', { name: '使用图片' }).count(), 0)
  assert.match(await page.locator('.nori-story-node.is-scene').textContent(), /文字片段/)

  // Existing media is shown, but only as a compact status row.
  await open('?media=ready')
  assert.equal(await page.locator('.nori-story-scene-media-strip.is-ready').count(), 1)
  assert.match(await page.locator('.nori-story-scene-media-strip.is-ready').textContent(), /图片画面/)
  assert.equal(await page.locator('.nori-story-scene-media-actions').count(), 0)
  assert.equal(await page.getByRole('button', { name: '生成视频' }).count(), 0)

  // Long legacy text still renders and stays inside the bounded textarea.
  await open('?long=true')
  assert.equal(await textarea().getAttribute('rows'), '10')
  assert.ok((await textarea().inputValue()).includes('\n第二行\n'))
  // Legacy CRLF is normalised by the editing surface and by compileChapter,
  // so it never reaches the player even before the author touches the text.
  assert.ok(!(await textarea().inputValue()).includes('\r'))

  assert.deepEqual(errors, [])
  console.log('[interactive-scene-text] text-first scene editing, media demotion, read-only and boundaries passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
