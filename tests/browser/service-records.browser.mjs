import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { readFile, mkdir, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = process.env.NORI_BROWSER_TOOLS_DIR || '/tmp/nori-browser-tools-local'
const { chromium } = createRequire(`${tools}/package.json`)('playwright-core')
const bundleRoot = path.join(root, 'test-results/material-bundles')
const [script, fixtureCss, globalCss] = await Promise.all([
  readFile(path.join(bundleRoot, 'service-records.js')),
  readFile(path.join(bundleRoot, 'service-records.css')).catch(() => Buffer.from('')),
  readFile(path.join(bundleRoot, 'global.css')),
])
const report = {
  records: [
    {
      id: 'billing-1', projectId: 'project-1', projectName: '海后穿书', workId: 'work-1', workName: '短剧项目',
      accountId: 'owner', accountName: '管理账号', accountRole: '组长', serviceType: 'video', operation: 'canvas_generation',
      modelKey: 'nori::seedance2.5', modelName: 'Seedance 2.5', status: 'success', inputTokens: 0, outputTokens: 100,
      units: 10, cost: 1, points: 100, createdAt: '2026-10-30T08:00:00.000Z',
    },
    {
      id: 'billing-2', projectId: 'project-2', projectName: '测试项目', workId: 'work-1', workName: '短剧项目',
      accountId: 'child', accountName: '孙晨曦', accountRole: '组长', serviceType: 'video', operation: 'canvas_generation',
      modelKey: 'nori::seedance2.5', modelName: 'Seedance 2.5', status: 'success', inputTokens: 0, outputTokens: 200,
      units: 20, cost: 2, points: 200, createdAt: '2026-10-30T09:00:00.000Z',
    },
    {
      id: 'billing-3', projectId: 'project-1', projectName: '海后穿书', workId: 'work-1', workName: '短剧项目',
      accountId: 'child', accountName: '孙晨曦', accountRole: '组长', serviceType: 'video', operation: 'canvas_generation',
      modelKey: 'nori::seedance2.5', modelName: 'Seedance 2.5', status: 'success', inputTokens: 0, outputTokens: 300,
      units: 30, cost: 3, points: 300, createdAt: '2026-10-30T10:00:00.000Z',
    },
  ],
  options: {
    works: [{ id: 'work-1', name: '短剧项目' }],
    projects: [
      { id: 'project-1', name: '海后穿书', workId: 'work-1' },
      { id: 'project-2', name: '测试项目', workId: 'work-1' },
    ],
    accounts: [{ id: 'owner', name: '管理账号', role: '组长' }, { id: 'child', name: '孙晨曦', role: '组长' }],
    services: ['video'], models: [{ id: 'nori::seedance2.5', name: 'Seedance 2.5' }],
  },
  generatedAt: '2026-10-31T08:00:00.000Z',
}
const server = createServer((req, res) => {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  const assets = {
    '/fixture.js': ['text/javascript', script], '/fixture.css': ['text/css', fixtureCss], '/global.css': ['text/css', globalCss],
  }
  if (assets[pathname]) { res.setHeader('Content-Type', assets[pathname][0]); return res.end(assets[pathname][1]) }
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.end('<!doctype html><html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const output = path.join(root, 'test-results/service-records')
await mkdir(output, { recursive: true })
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1000 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.addInitScript(() => { window.Date = class extends window.Date { constructor(...args) { super(...(args.length ? args : ['2026-10-31T12:00:00.000Z'])) } static now() { return new window.Date().getTime() } } })
  await page.route('**/api/service-records?limit=200', (route) => route.fulfill({ json: { report } }))
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: '不限', exact: true }).click()
  const cards = page.locator('section').filter({ has: page.locator('article') }).first().locator('article')
  await page.getByLabel('账号').selectOption('child')
  assert.equal(await cards.first().locator('strong').innerText(), '500')
  assert.match(await page.locator('main, body').innerText(), /2 条服务记录/)
  assert.equal(await page.locator('section').filter({ hasText: '成员消耗排行' }).innerText().then((text) => text.includes('孙晨曦')), true)
  await page.screenshot({ path: path.join(output, 'account-filter.png'), fullPage: true })
  await page.getByLabel('账号').selectOption('all')
  await page.getByLabel('作品').selectOption('project-1')
  assert.equal(await cards.first().locator('strong').innerText(), '400')
  assert.match(await page.locator('body').innerText(), /2 条服务记录/)
  await page.screenshot({ path: path.join(output, 'project-filter.png'), fullPage: true })
  assert.deepEqual(errors, [])
  const result = { ok: true, accountPoints: 500, projectPoints: 400, browserErrors: errors, productionRequests: 0, output }
  await writeFile(path.join(output, 'results.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
