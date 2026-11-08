// Real DefaultModelCards with controlled API-shaped model options; no external requests.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const directory = process.env.NORI_BROWSER_PREBUILT_DIR || path.join(root, 'test-results/material-bundles')
const [script, css, appCss] = await Promise.all([
  readFile(path.join(directory, 'default-model-names.js')),
  readFile(path.join(directory, 'default-model-names.css')),
  readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH || path.join(directory, 'global.css'), 'utf8'),
])
const server = createServer((request, response) => {
  const body = request.url === '/fixture.js' ? script
    : request.url === '/fixture.css' ? css
      : request.url === '/global.css' ? appCss : null
  if (body) {
    response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css')
    response.end(body)
    return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  const trigger = page.getByRole('button').filter({ hasText: 'gpt-image-2.5-sunburst' }).first()
  await trigger.waitFor()
  await trigger.click()
  await page.getByRole('button', { name: 'gpt-image-2.6-flare-c', exact: true }).waitFor()
  const text = await page.locator('body').innerText()
  for (const model of ['gpt-image-2.5-sunburst', 'gpt-image-2.6-flare-c', 'doubao-seedance-2-5-260628', 'speech-2.8-hd']) {
    assert.ok(text.includes(model), `Real model id must be visible: ${model}`)
  }
  assert.doesNotMatch(text, /LanMiaoTV|Nori Image|nori-image-pro|Internal .*alias| · (?:Mini|Fast|标准|Pro)/i)
  assert.equal(errors.length, 0, errors.join('\n'))
  console.log(JSON.stringify({ ok: true, browserErrors: errors }))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
