// 影游 P4 editor: the 倍速 tab in 玩法设置, plus the overview-side and canvas-overlay consumers.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/story-p4-editor')
await mkdir(artifacts, { recursive: true })
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')

// The overlay renders next-intl's Link, which needs a mounted Next router; a plain <a> stands in here.
const navigationStub = {
  name: 'p4-navigation-stub',
  setup(build) {
    build.onResolve({ filter: /i18n\/navigation$/ }, () => ({ path: 'navigation', namespace: 'p4-stub' }))
    build.onLoad({ filter: /.*/, namespace: 'p4-stub' }, () => ({
      loader: 'jsx',
      resolveDir: path.join(root, 'tests/browser'),
      contents: `import React from 'react'
const noop = () => {}
export const Link = React.forwardRef(({ href, children, ...rest }, ref) => <a ref={ref} href={typeof href === 'string' ? href : '#'} {...rest}>{children}</a>)
export const useRouter = () => ({ push: noop, replace: noop, back: noop, forward: noop, refresh: noop, prefetch: noop })
export const usePathname = () => '/'
export const redirect = noop
export const getPathname = () => '/'`,
    }))
  },
}

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/story-p4-editor.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: { '@': path.join(root, 'src') },
  plugins: [navigationStub],
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.contents ?? ''

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  if (pathname === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(script)
  } else if (pathname === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css')
    response.end(css)
  } else if (pathname.startsWith('/uploads/') || pathname.startsWith('/clips/')) {
    response.statusCode = 204
    response.end()
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
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})

const consoleErrors = (page) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  return errors
}
const waitSaves = (page, count) => page.waitForFunction((expected) => window.__p4Fixture.saves.length === expected, count)
const waitSideSaves = (page, count) => page.waitForFunction((expected) => window.__p4Fixture.sideSaves.length === expected, count)

try {
  // 1. Editor tab: 1x locked, preview copy, save payloads, remount after save.
  const page = await browser.newPage({ viewport: { width: 900, height: 1000 } })
  const errors = consoleErrors(page)
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('.nori-ix-gameplay-segments', { timeout: 20_000 })

  const tab = (name) => page.getByRole('tab', { name })
  const speedBox = (speed) => page.getByTestId(`playback-speed-${speed}`)
  const preview = page.getByTestId('playback-preview')
  const saveButton = () => page.locator('.nori-ix-gameplay').getByRole('button', { name: '保存', exact: true })
  const badgeText = () => page.locator('.nori-ix-gameplay-segments .is-on .nori-ix-gameplay-count').textContent()

  assert.equal(await page.locator('.nori-ix-gameplay-segments button').count(), 6)
  assert.equal(await tab(/^倍速/).count(), 1)
  assert.equal(await tab(/^倍速/).locator('b').count(), 0)
  await tab(/^倍速/).click()

  assert.equal(await speedBox(1).isChecked(), true)
  assert.equal(await speedBox(1).isDisabled(), true)
  assert.equal(await speedBox(1.25).isChecked(), false)
  assert.equal(await speedBox(1.5).isChecked(), false)
  assert.equal(await saveButton().isDisabled(), true)
  assert.equal(await preview.textContent(), '观众只有原速，不会显示倍速按钮')
  await page.getByText('互动倒计时和互动窗口按现实时间计时，不受倍速影响。').waitFor()

  await speedBox(1.25).check()
  assert.equal(await preview.textContent(), '观众可在 1x / 1.25x 间切换')
  assert.equal(await saveButton().isEnabled(), true)
  await speedBox(1.5).check()
  assert.equal(await preview.textContent(), '观众可在 1x / 1.25x / 1.5x 间切换')
  await saveButton().click()
  await waitSaves(page, 1)
  const first = await page.evaluate(() => window.__p4Fixture.saves[0].config)
  assert.deepEqual(Object.keys(first), ['playback'])
  assert.deepEqual(first.playback, { speeds: [1, 1.25, 1.5] })
  await page.waitForFunction(() => document.querySelector('.nori-ix-gameplay-segments .is-on .nori-ix-gameplay-count')?.textContent === '2')
  assert.equal(await saveButton().isDisabled(), true)

  // Re-entering the tab remounts the editor from the stored config.
  await tab(/^数值/).click()
  await tab(/^倍速/).click()
  assert.equal(await speedBox(1.25).isChecked(), true)
  assert.equal(await speedBox(1.5).isChecked(), true)
  assert.equal(await saveButton().isDisabled(), true)

  // Back to only 1x: the saved block still carries the explicit [1].
  await speedBox(1.5).uncheck()
  await speedBox(1.25).uncheck()
  assert.equal(await preview.textContent(), '观众只有原速，不会显示倍速按钮')
  assert.equal(await saveButton().isEnabled(), true)
  await saveButton().click()
  await waitSaves(page, 2)
  assert.deepEqual(await page.evaluate(() => window.__p4Fixture.saves[1].config), { playback: { speeds: [1] } })
  await page.waitForFunction(() => !document.querySelector('.nori-ix-gameplay-segments .is-on .nori-ix-gameplay-count'))
  await tab(/^数值/).click()
  await tab(/^倍速/).click()
  assert.equal(await speedBox(1).isChecked(), true)
  assert.equal(await speedBox(1.25).isChecked(), false)
  assert.equal(await speedBox(1.5).isChecked(), false)
  assert.equal(await saveButton().isDisabled(), true)
  assert.deepEqual(errors, [], `console errors:\n${errors.join('\n')}`)

  // 2. Read-only: every speed is locked and there is nothing to save.
  const readonly = await browser.newPage({ viewport: { width: 900, height: 1000 } })
  const readonlyErrors = consoleErrors(readonly)
  await readonly.goto(`${base}?readonly=1&seed=extra`, { waitUntil: 'networkidle' })
  await readonly.waitForSelector('.nori-ix-gameplay-segments', { timeout: 20_000 })
  await readonly.getByRole('tab', { name: /^倍速/ }).click()
  assert.equal(await readonly.getByTestId('playback-speed-1').isChecked(), true)
  assert.equal(await readonly.getByTestId('playback-speed-1').isDisabled(), true)
  assert.equal(await readonly.getByTestId('playback-speed-1.25').isChecked(), true)
  assert.equal(await readonly.getByTestId('playback-speed-1.25').isDisabled(), true)
  assert.equal(await readonly.getByTestId('playback-speed-1.5').isDisabled(), true)
  assert.equal(await readonly.locator('.nori-ix-playback input:not(:disabled)').count(), 0)
  assert.equal(await readonly.locator('.nori-ix-gameplay').getByRole('button', { name: '保存', exact: true }).count(), 0)
  assert.equal(await readonly.getByTestId('playback-preview').textContent(), '观众可在 1x / 1.25x 间切换')
  await readonly.screenshot({ path: path.join(artifacts, 'readonly.png'), fullPage: true })
  assert.deepEqual(readonlyErrors, [], `read-only console errors:\n${readonlyErrors.join('\n')}`)

  // 3. Layout: six tabs, every badge on, at the 360px side-panel width.
  const narrow = await browser.newPage({ viewport: { width: 360, height: 900 } })
  const narrowErrors = consoleErrors(narrow)
  await narrow.goto(`${base}?counts=1&seed=all`, { waitUntil: 'networkidle' })
  await narrow.waitForSelector('.nori-ix-gameplay-segments', { timeout: 20_000 })
  assert.equal(await narrow.locator('.nori-ix-gameplay-segments button').count(), 6)
  assert.equal(await narrow.locator('.nori-ix-gameplay-segments .nori-ix-gameplay-count').count(), 6)
  const overflow = await narrow.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    row: document.querySelector('.nori-ix-gameplay-segments').scrollWidth,
    rowClient: document.querySelector('.nori-ix-gameplay-segments').clientWidth,
    panel: document.querySelector('.nori-ix-gameplay').scrollWidth,
    panelClient: document.querySelector('.nori-ix-gameplay').clientWidth,
  }))
  assert.ok(overflow.page <= 360, `page overflows at 360px: ${overflow.page}`)
  assert.ok(overflow.row <= overflow.rowClient, `tab row overflows at 360px: ${overflow.row} > ${overflow.rowClient}`)
  assert.ok(overflow.panel <= overflow.panelClient, `panel overflows at 360px: ${overflow.panel} > ${overflow.panelClient}`)
  await narrow.getByRole('tab', { name: /^倍速/ }).click()
  await narrow.screenshot({ path: path.join(artifacts, 'panel-360.png'), fullPage: true })
  assert.deepEqual(narrowErrors, [], `360px console errors:\n${narrowErrors.join('\n')}`)

  // The canvas overlay panel is wider (460px) and should keep the row on one line.
  const wide = await browser.newPage({ viewport: { width: 460, height: 900 } })
  const wideErrors = consoleErrors(wide)
  await wide.goto(`${base}?counts=1&seed=all`, { waitUntil: 'networkidle' })
  await wide.waitForSelector('.nori-ix-gameplay-segments', { timeout: 20_000 })
  await wide.getByRole('tab', { name: /^倍速/ }).click()
  await wide.screenshot({ path: path.join(artifacts, 'panel-460.png'), fullPage: true })
  assert.deepEqual(wideErrors, [], `460px console errors:\n${wideErrors.join('\n')}`)

  // 4. Overview side panel passes the stored playback down to the editor.
  const side = await browser.newPage({ viewport: { width: 900, height: 1000 } })
  const sideErrors = consoleErrors(side)
  await side.goto(`${base}?mode=side&seed=extra`, { waitUntil: 'networkidle' })
  await side.getByRole('tab', { name: '玩法设置' }).click()
  const sideSpeedTab = side.locator('.nori-ix-side').getByRole('tab', { name: /^倍速/ })
  await sideSpeedTab.waitFor()
  assert.equal(await sideSpeedTab.locator('b').textContent(), '1')
  await sideSpeedTab.click()
  assert.equal(await side.getByTestId('playback-speed-1.25').isChecked(), true)
  assert.equal(await side.getByTestId('playback-speed-1.5').isChecked(), false)
  await side.getByTestId('playback-speed-1.5').check()
  await side.locator('.nori-ix-side').getByRole('button', { name: '保存', exact: true }).click()
  await waitSideSaves(side, 1)
  assert.deepEqual(await side.evaluate(() => window.__p4Fixture.sideSaves[0].config), { playback: { speeds: [1, 1.25, 1.5] } })
  await side.waitForFunction(() => document.querySelector('.nori-ix-side .is-on .nori-ix-gameplay-count')?.textContent === '2')
  assert.deepEqual(sideErrors, [], `overview side console errors:\n${sideErrors.join('\n')}`)

  // 5. Canvas overlay passes the stored playback down to the editor.
  const overlay = await browser.newPage({ viewport: { width: 900, height: 1000 } })
  const overlayErrors = consoleErrors(overlay)
  await overlay.goto(`${base}?mode=overlay&seed=extra`, { waitUntil: 'networkidle' })
  const panel = overlay.locator('.nori-story-panel')
  await panel.waitFor({ timeout: 20_000 })
  const overlaySpeedTab = panel.getByRole('tab', { name: /^倍速/ })
  assert.equal(await overlaySpeedTab.locator('b').textContent(), '1')
  await overlaySpeedTab.click()
  assert.equal(await panel.getByTestId('playback-speed-1.25').isChecked(), true)
  assert.equal(await panel.getByTestId('playback-speed-1.5').isChecked(), false)
  await panel.getByTestId('playback-speed-1.5').check()
  await panel.getByRole('button', { name: '保存', exact: true }).click()
  await waitSaves(overlay, 1)
  assert.deepEqual(await overlay.evaluate(() => window.__p4Fixture.saves[0].config), { playback: { speeds: [1, 1.25, 1.5] } })
  await panel.screenshot({ path: path.join(artifacts, 'overlay-panel.png') })
  assert.deepEqual(overlayErrors, [], `canvas overlay console errors:\n${overlayErrors.join('\n')}`)

  console.log('story-p4-editor: all checks passed')
} finally {
  await browser.close()
  server.close()
}
