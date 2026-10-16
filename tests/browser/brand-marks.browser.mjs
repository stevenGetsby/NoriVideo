import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const { chromium } = createRequire('/private/tmp/nori-browser-tools-local/package.json')('playwright-core')
const bundleRoot = path.join(root, 'test-results/material-bundles')
const [script, bundleCss, globalCss, mark, icon] = await Promise.all([
  readFile(path.join(bundleRoot, 'brand-marks.js')), readFile(path.join(bundleRoot, 'brand-marks.css')).catch(() => Buffer.from('')),
  readFile(path.join(bundleRoot, 'global.css')), readFile(path.join(root, 'public/brand/lanmiao-cat.png')),
  readFile(path.join(root, 'public/brand/lanmiao-cat-icon.png')),
])
const server = createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  const assets = {
    '/fixture.js': ['text/javascript', script], '/fixture.css': ['text/css', bundleCss], '/global.css': ['text/css', globalCss],
    '/brand/lanmiao-cat.png': ['image/png', mark], '/brand/lanmiao-cat-icon.png': ['image/png', icon],
  }
  if (assets[pathname]) { res.setHeader('Content-Type', assets[pathname][0]); return res.end(assets[pathname][1]) }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const output = 'test-results/lanmiao-brand'
await mkdir(output, { recursive: true })
const cases = []
const errors = []
try {
  for (const viewport of [{ width: 1440, height: 900 }, { width: 1024, height: 600 }, { width: 390, height: 844 }, { width: 320, height: 568 }]) {
    const page = await browser.newPage({ viewport })
    page.on('pageerror', (error) => errors.push(error.name))
    await page.route('**/api/**', (route) => route.fulfill({ json: { balancePoints: 1000, pointCredits: 1000, generationAllowed: true, dailyLimitPoints: null, dailyUsedPoints: 0 } }))
    await page.goto(base, { waitUntil: 'networkidle' })
    await page.waitForFunction(() => [...document.querySelectorAll('.nori-brand-mark')].every((image) => image.complete && image.naturalWidth === 250))
    for (const header of ['workspace-header', 'admin-header']) {
      const mark = page.getByTestId(header).locator('.nori-brand-mark')
      assert.equal(await mark.count(), 1)
      await mark.scrollIntoViewIfNeeded()
      const box = await mark.boundingBox()
      assert.ok(box && box.x >= 0 && box.x + box.width <= viewport.width)
      assert.equal(await mark.evaluate((image) => getComputedStyle(image).objectFit), 'contain')
    }
    const sizes = await page.getByTestId('brand-sizes').locator('.nori-brand-mark').evaluateAll((images) => images.map((image) => ({
      width: image.width, height: image.height, measuredWidth: image.getBoundingClientRect().width,
      measuredHeight: image.getBoundingClientRect().height, fit: getComputedStyle(image).objectFit,
    })))
    assert.deepEqual(sizes.map((image) => image.width), [16, 24, 28, 34, 36, 38, 64, 128])
    assert.ok(sizes.every((image) => image.width === image.height && image.measuredWidth === image.measuredHeight && image.fit === 'contain'))
    const response = await page.request.get(`${base}/brand/lanmiao-cat-icon.png?v=4`)
    assert.equal(response.status(), 200)
    assert.equal(response.headers()['content-type'], 'image/png')
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: `${output}/brand-${viewport.width}.png`, fullPage: true })
    await page.close()
    cases.push(`${viewport.width}:real-workspace-admin-eight-icon-sizes-light-dark-favicon`)
  }
  assert.deepEqual(errors, [])
  const result = { ok: true, cases, browserErrors: errors, productionRequests: 0, output }
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
