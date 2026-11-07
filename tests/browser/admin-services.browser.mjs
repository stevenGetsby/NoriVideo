import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/admin-services')
await mkdir(artifacts, { recursive: true })
const appCss = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH || path.join(root, 'test-results/material-bundles/global.css'))
const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/admin-services.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.contents
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript'); response.end(script)
  } else if (request.url === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css'); response.end(css)
  } else if (request.url === '/global.css') {
    response.setHeader('Content-Type', 'text/css'); response.end(appCss)
  } else {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({ headless: true, executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const usage = {
  rangeDays: 30, collectedSince: '2026-11-01T00:00:00.000Z',
  summary: { calls: 0, success: 0, failed: 0, cost: 0, averageLatencyMs: null, byType: [] },
  rows: [], storage: { objectCount: 0, knownBytes: 0 },
}
const providers = [
  ['deepseek', 'DeepSeek 官方', 'https://api.deepseek.com/v1'],
  ['openlux', 'OpenLux API', 'https://api.openlux.ai/v1'],
  ['kuaizi', 'Kuaizi API', 'https://aiopenapi.kuaizi.cn'],
  ['huimengi', '绘梦工坊 API', 'https://api.huimengi.com'],
].map(([id, name, baseUrl]) => ({ id, name, baseUrl, hasApiKey: true }))
const models = [
  ['deepseek', 'deepseek-chat', 'llm'], ['deepseek', 'deepseek-reasoner', 'llm'],
  ['openlux', 'gpt-image-2.5-flare', 'image'], ['openlux', 'gpt-image-2.5-sunburst', 'image'],
  ['huimengi', 'seedream-5.0-pro', 'image'], ['huimengi', 'qwen-image-3.0-pro', 'image'],
  ['kuaizi', 'doubao-seedance-2-0-260128', 'video'], ['huimengi', 'wan3.0-video', 'video'], ['huimengi', 'seedance-1.5-pro', 'video'],
  ['kuaizi', 'speech-2.8-hd', 'audio'],
].map(([provider, modelId, type]) => ({ provider, modelId, type, name: `${provider}:${modelId}` }))
const businessModels = [
  ['nori::nori-gpt', 'nori-gpt', 'llm'], ['nori::nori-image', 'nori-image', 'image'], ['nori::seedance2.0', 'seedance2.0-pro', 'video'],
  ['nori::nori-audio', 'nori-audio', 'audio'], ['nori::nori-music', 'nori-music', 'audio'], ['nori::nori-sfx', 'nori-sfx', 'audio'],
].map(([key, name, type]) => ({ key, name, type, tier: 'standard', description: `${type} 测试业务模型` }))
let config = {
  sourceFile: 'services.mock.json', updatedAt: '2026-11-07T00:00:00.000Z', providers, models, businessModels,
  defaultModels: {},
  modelRouting: { 'nori::nori-gpt': 'deepseek::deepseek-chat', 'nori::nori-image': 'openlux::gpt-image-2.5-sunburst', 'nori::seedance2.0': 'kuaizi::doubao-seedance-2-0-260128', 'nori::nori-audio': 'kuaizi::speech-2.8-hd', 'nori::nori-music': '', 'nori::nori-sfx': '' },
  storage: { type: 'tos', endpoint: 'https://tos-cn-beijing.volces.com', publicEndpoint: 'https://tos-cn-beijing.volces.com', region: 'cn-beijing', bucket: 'nori-test', forcePathStyle: false, hasAccessKey: true, hasSecretKey: true },
}
let savedPayload
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  await page.route('**/api/**', (route) => route.fulfill({ status: 500, json: { error: 'Unexpected test request' } }))
  await page.route('**/api/admin/services*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/admin/services') return route.fulfill({ status: 404, json: {} })
    if (route.request().method() === 'GET') return route.fulfill({ json: { config, health: [], usage } })
    assert.equal(route.request().method(), 'PUT')
    savedPayload = route.request().postDataJSON()
    config = { ...config, modelRouting: savedPayload.modelRouting, updatedAt: '2026-11-07T01:00:00.000Z' }
    return route.fulfill({ json: { config } })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}?view=admin`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.nori-admin-provider').catch(async (error) => {
    console.log(JSON.stringify({ body: await page.locator('body').innerText(), errors, requests: await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name)) }))
    throw error
  })
  assert.equal(await page.locator('.nori-admin-provider').count(), 4)
  assert.equal(await page.locator('.nori-admin-provider.is-huimengi h3').innerText(), '绘梦工坊 API')
  assert.equal(await page.getByLabel('nori-image运行模型').locator('option').allTextContents().then((items) => items.some((text) => text.includes('huimengi:seedream-5.0-pro'))), true)
  assert.equal(await page.getByLabel('nori-audio运行模型').locator('option').allTextContents().then((items) => items.some((text) => text.includes('huimengi'))), false)
  await page.getByLabel('nori-image运行模型').selectOption('huimengi::seedream-5.0-pro')
  await page.getByLabel('seedance2.0-pro运行模型').selectOption('huimengi::wan3.0-video')
  await page.screenshot({ path: path.join(artifacts, 'switched-providers.png'), fullPage: true })
  await page.getByRole('button', { name: '保存并热加载', exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('配置已保存并热加载，不需要重启服务'))
  assert.equal(savedPayload.modelRouting['nori::nori-image'], 'huimengi::seedream-5.0-pro')
  assert.equal(savedPayload.modelRouting['nori::seedance2.0'], 'huimengi::wan3.0-video')
  assert.equal(savedPayload.modelRouting['nori::nori-audio'], 'kuaizi::speech-2.8-hd')
  assert.equal(savedPayload.providers.some((provider) => Object.hasOwn(provider, 'apiKey')), false)
  assert.deepEqual(errors, [])
  const result = { ok: true, providerCount: 4, imageProviderSwitched: true, videoProviderSwitched: true, audioUnchanged: true, noSecretsReturned: true, browserErrors: errors, paidRequests: 0, productionRequests: 0, artifacts }
  await writeFile(path.join(artifacts, 'results.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
