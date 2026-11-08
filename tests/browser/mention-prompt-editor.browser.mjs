import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/mention-prompt-editor')
await mkdir(artifacts, { recursive: true })
const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/mention-prompt-editor.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).contents
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script) }
  else if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css) }
  else {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const page = await browser.newPage({ viewport: { width: 1000, height: 800 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
const editor = () => page.getByRole('combobox')
const value = () => editor().inputValue()
async function cursor(index) {
  await editor().evaluate((element, position) => { element.focus(); element.setSelectionRange(position, position) }, index)
}
async function choose(name) {
  await page.getByRole('option', { name: `@${name}`, exact: true }).click()
}
async function paste(text) {
  await editor().evaluate((element, pasted) => {
    const transfer = new DataTransfer()
    transfer.setData('text/plain', pasted)
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }))
  }, text)
}
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await editor().fill('开始 @张')
  await page.getByRole('listbox').waitFor()
  await choose('张三丰')
  assert.equal(await value(), '开始 @张三丰 ')
  assert.equal(await editor().evaluate((element) => element.selectionStart), '开始 @张三丰 '.length)
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  assert.equal(await value(), '开始 @张')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z')
  assert.equal(await value(), '开始 @张三丰 ')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  await page.keyboard.press('Enter')
  assert.equal(await value(), '开始 @张三丰 ')

  await editor().fill('前 @张三丰 后')
  await cursor(6)
  await page.keyboard.press('Backspace')
  await page.keyboard.type('丰')
  await page.waitForFunction(() => document.querySelector('[role="listbox"]'))
  await choose('张三丰')
  assert.equal(await value(), '前 @张三丰 后', 'Deleting a Chinese character must not leave a trailing duplicate')

  await editor().fill('@雨')
  await page.getByRole('listbox').waitFor()
  await editor().dispatchEvent('compositionstart')
  await editor().dispatchEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 229, nativeEvent: { isComposing: true, keyCode: 229 } })
  await editor().dispatchEvent('compositionend')
  assert.equal(await value(), '@雨', 'IME Enter must not select a mention')
  await choose('雨夜街巷')
  assert.equal(await value(), '@雨夜街巷 ')

  await editor().fill('')
  await paste('张三丰穿过雨夜街巷')
  assert.equal(await value(), '@张三丰穿过@雨夜街巷')
  assert.deepEqual(JSON.parse(await page.getByTestId('pasted-assets').textContent()), ['asset-zhang', 'asset-rain'])
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z')
  assert.equal(await value(), '')
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+Shift+z' : 'Control+Shift+z')
  assert.equal(await value(), '@张三丰穿过@雨夜街巷')

  await page.getByRole('button', { name: '外部重置' }).evaluate((element) => element.click())
  await page.waitForFunction(() => document.querySelector('[role="listbox"]'))
  await editor().fill('')
  await page.waitForFunction(() => !document.querySelector('[role="listbox"]'))
  await page.keyboard.press('Enter')
  assert.equal(await value(), '\n', 'A stale external @query cannot replace cleared text')
  assert.deepEqual(errors, [])
  await page.screenshot({ path: path.join(artifacts, 'mention-editor.png'), fullPage: true })
  console.log('[mention-prompt-editor] Chinese deletion, live caret, IME, paste binding and undo/redo passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
