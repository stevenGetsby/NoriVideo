import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile, unlink } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import postcss from 'postcss'
import tailwindcss from '@tailwindcss/postcss'
import { build } from 'esbuild'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/canvas-editing-theme/E3')
await mkdir(artifacts, { recursive: true })
const bundle = await build({ entryPoints: ['tests/browser/theme-switch.fixture.tsx'], bundle: true, write: false, outdir: '/fixture.js', outExtension: { '.js': '.js', '.css': '.raw.css' }, jsx: 'automatic', platform: 'browser', external: ['tailwindcss'], alias: { '@': path.join(root, 'src'), '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'), 'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'), 'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'), 'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'), 'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx') }, define: { 'process.env.NODE_ENV': '"development"' } })
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const rawCss = bundle.outputFiles.find((file) => file.path.endsWith('.raw.css'))?.contents
assert.ok(script && rawCss)
const globalCss = await readFile(path.join(root, 'src/app/globals.css'), 'utf8')
const css = Buffer.from((await postcss([tailwindcss()]).process(`${globalCss}\n${Buffer.from(rawCss).toString()}`, { from: path.join(root, 'src/app/globals.css'), map: false })).css)
let ssrPreference = 'dark'
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); return }
  if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return }
  const preference = request.url === '/ssr' ? ssrPreference : 'dark'
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><html lang="zh" data-nori-theme="${preference === 'light' ? 'light' : 'dark'}" data-nori-theme-pref="${preference}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="${preference === 'light' || preference === 'system' ? '#f5f6fa' : '#0d0d0d'}"><link rel="stylesheet" href="/fixture.css"><script>var d=document.documentElement;if(d.dataset.noriThemePref==='system')d.dataset.noriTheme=matchMedia('(prefers-color-scheme: light)').matches?'light':'dark'</script></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>`)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  const theme = () => page.locator('html').evaluate((element) => ({ preference: element.dataset.noriThemePref, resolved: element.dataset.noriTheme }))
  const cookie = async (expected) => assert.ok((await page.context().cookies()).some((item) => item.name === 'nori-theme' && item.value === expected))
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.getByRole('radio', { name: '日间', exact: true }).click()
  await page.waitForFunction(() => document.documentElement.dataset.noriTheme === 'light' && document.querySelector('[data-testid="theme-preference"]')?.dataset.resolved === 'light')
  await cookie('light')
  assert.equal(await page.locator('meta[name="theme-color"]').getAttribute('content'), '#f5f6fa')
  const forcedDark = await page.evaluate(() => ['forced-dark-preview', 'forced-dark-login'].map((id) => {
    const element = document.querySelector(`[data-testid="${id}"]`)
    const style = getComputedStyle(element)
    return { id, bg: style.getPropertyValue('--nori-bg-1').trim(), ink: style.getPropertyValue('--nori-ink').trim(), scheme: style.colorScheme, white: style.getPropertyValue('--color-white').trim() }
  }))
  for (const item of forcedDark) assert.deepEqual(item, { id: item.id, bg: '12 12 17', ink: '255 255 255', scheme: 'dark', white: '#ffffff' }, JSON.stringify(forcedDark))
  assert.equal(await page.locator('[data-testid="forced-dark-preview"] span').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(27, 27, 35)')
  await page.getByRole('button', { name: '关闭', exact: true }).click()
  await page.getByRole('button', { name: '画布工具', exact: true }).click()
  const cycle = page.getByTestId('canvas-theme-cycle')
  await cycle.waitFor()
  await page.waitForTimeout(100)
  await cycle.click()
  await cookie('system')
  await page.emulateMedia({ colorScheme: 'light' })
  await page.waitForFunction(() => document.documentElement.dataset.noriTheme === 'light')
  await page.emulateMedia({ colorScheme: 'dark' })
  await page.waitForFunction(() => document.documentElement.dataset.noriTheme === 'dark')
  assert.equal(await cycle.getAttribute('aria-label'), '外观：跟随系统')
  await cycle.click()
  await cookie('dark')
  await cycle.click()
  await cookie('light')
  await cycle.click()
  await cookie('system')
  await page.getByRole('radio', { name: '日间', exact: true }).click()
  assert.equal(await page.getByRole('radio', { name: '日间', exact: true }).getAttribute('aria-checked'), 'true')
  await page.reload({ waitUntil: 'domcontentloaded' })
  await page.getByRole('radio', { name: '日间', exact: true }).waitFor()
  await page.screenshot({ path: path.join(artifacts, 'theme-switch-light.png') })
  const ssr = await browser.newPage({ javaScriptEnabled: false })
  ssrPreference = 'light'
  await ssr.goto(`${base}/ssr`)
  assert.deepEqual(await ssr.locator('html').evaluate((element) => ({ preference: element.dataset.noriThemePref, resolved: element.dataset.noriTheme })), { preference: 'light', resolved: 'light' })
  ssrPreference = 'system'
  await ssr.goto(`${base}/ssr`)
  assert.deepEqual(await ssr.locator('html').evaluate((element) => ({ preference: element.dataset.noriThemePref, resolved: element.dataset.noriTheme })), { preference: 'system', resolved: 'dark' })
  await ssr.screenshot({ path: path.join(artifacts, 'ssr-light-no-js.png') })
  assert.equal(await ssr.locator('script[src="/fixture.js"]').evaluate((element) => element.tagName), 'SCRIPT')
  await ssr.close()
  const serverBundle = await build({ entryPoints: ['src/lib/theme/useNoriTheme.ts'], bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', external: ['react'] })
  const serverModule = path.join(artifacts, 'server-theme.cjs')
  await writeFile(serverModule, serverBundle.outputFiles[0].contents)
  const { useNoriTheme } = createRequire(import.meta.url)(serverModule)
  await unlink(serverModule)
  const serverRender = await import('react-dom/server')
  const React = await import('react')
  const ServerThemeProbe = () => { const state = useNoriTheme(); return React.createElement('span', null, `${state.preference}/${state.resolved}`) }
  assert.equal(serverRender.renderToString(React.createElement(ServerThemeProbe)), '<span>dark/dark</span>')
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, results: ['account-switch', 'cookie', 'ssr-light', 'system-before-paint', 'system-live-change', 'canvas-cycle', 'forced-dark', 'theme-color-meta', 'server-render'], artifacts }))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
