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
const artifacts = path.join(root, 'test-results/canvas-editing-theme/B4')
await mkdir(artifacts, { recursive: true })
const bundle = await build({
  entryPoints: ['tests/browser/account-password-eye.fixture.tsx'],
  bundle: true,
  write: false,
  outdir: '/fixture.js',
  outExtension: { '.js': '.js', '.css': '.raw.css' },
  jsx: 'automatic',
  platform: 'browser',
  external: ['tailwindcss'],
  alias: {
    '@': path.join(root, 'src'),
    'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'),
  },
  define: { 'process.env.NODE_ENV': '"development"' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const rawCss = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.contents
assert.ok(script, 'fixture must contain JavaScript')
const globalCss = await readFile(path.join(root, 'src/app/globals.css'), 'utf8')
const css = Buffer.from((await postcss([tailwindcss()]).process(globalCss, {
  from: path.join(root, 'src/app/globals.css'),
  map: false,
})).css)
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
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' })
  let dialog = page.getByRole('dialog', { name: '添加子账号' })
  let input = dialog.getByPlaceholder('至少 8 位；首次登录或重置后需修改')
  await input.fill('abc12345')
  await dialog.getByPlaceholder('例如 writer-01').click()
  let toggle = dialog.getByRole('button', { name: '显示密码' })
  const visible = await toggle.evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return rect.width === 28 && rect.height === 28 && getComputedStyle(element).visibility !== 'hidden'
  })
  assert.equal(visible, true, '28px toggle remains visible after blur')
  await toggle.click()
  assert.equal(await input.getAttribute('type'), 'text')
  assert.equal(await input.inputValue(), 'abc12345')
  await dialog.getByRole('button', { name: '隐藏密码' }).click()
  assert.equal(await input.getAttribute('type'), 'password')
  assert.equal(await input.inputValue(), 'abc12345')
  await page.screenshot({ path: path.join(artifacts, 'after.png') })
  await dialog.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '新建账号', exact: true }).click()
  dialog = page.getByRole('dialog', { name: '添加子账号' })
  input = dialog.getByPlaceholder('至少 8 位；首次登录或重置后需修改')
  toggle = dialog.getByRole('button', { name: '显示密码' })
  await toggle.waitFor()
  assert.equal(await input.getAttribute('type'), 'password')
  assert.equal(await input.inputValue(), 'abc12345')
  await toggle.click()
  assert.equal(await input.getAttribute('type'), 'text')
  await input.fill('')
  await page.waitForFunction(() => document.querySelector('.nori-password-field input')?.getAttribute('type') === 'password')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, artifacts }))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
