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
  summary: { calls: 5, success: 4, failed: 1, cost: 5.1, averageLatencyMs: 1000, byType: [] },
  rows: [
    { provider: 'kuaizi', modelKey: 'kuaizi::doubao-seedance-2-0-260128', serviceType: 'video', operation: 'generate', calls: 3, success: 2, failed: 1, inputTokens: 0, outputTokens: 0, units: 15, averageLatencyMs: 1200, lastUsedAt: '2026-11-10T00:00:00.000Z', cost: 4.5 },
    { provider: 'kuaizi', modelKey: 'kuaizi::speech-2.8-hd', serviceType: 'audio', operation: 'generate', calls: 2, success: 2, failed: 0, inputTokens: 0, outputTokens: 0, units: 20, averageLatencyMs: 800, lastUsedAt: '2026-11-10T00:00:00.000Z', cost: 0.6 },
  ],
  byProvider: [
    { provider: 'kuaizi', calls: 5, success: 4, failed: 1, cost: 5.1, byType: [{ serviceType: 'video', calls: 3, cost: 4.5, units: 15 }, { serviceType: 'audio', calls: 2, cost: 0.6, units: 20 }] },
  ],
  storage: { objectCount: 0, knownBytes: 0 },
}
const providers = [
  ['deepseek', 'DeepSeek 官方', 'https://api.deepseek.com/v1', true],
  ['openlux', 'OpenLux API', 'https://api.openlux.ai/v1', true],
  ['kuaizi', 'Kuaizi API', 'https://aiopenapi.kuaizi.cn', true],
  ['huimengi', '绘梦工坊 API', 'https://api.huimengi.com', true],
  ['kimi', 'Kimi 官方', 'https://api.moonshot.ai/v1', false],
  ['openai', 'OpenAI 官方', 'https://api.openai.com/v1', false],
].map(([id, name, baseUrl, hasApiKey]) => ({ id, name, baseUrl, hasApiKey }))
const models = [
  ['deepseek', 'deepseek-chat', 'llm'], ['deepseek', 'deepseek-reasoner', 'llm'],
  ['openlux', 'gpt-image-2.5-flare', 'image'], ['openlux', 'gpt-image-2.5-sunburst', 'image'],
  ['huimengi', 'seedream-5.0-pro', 'image'], ['huimengi', 'qwen-image-3.0-pro', 'image'],
  ['kuaizi', 'doubao-seedance-2-0-260128', 'video'], ['huimengi', 'wan3.0-video', 'video'], ['huimengi', 'seedance-1.5-pro', 'video'],
  ['kuaizi', 'speech-2.8-hd', 'audio'],
].map(([provider, modelId, type]) => ({ provider, modelId, type, name: modelId }))
const businessModels = [
  ['nori::nori-gpt', 'nori-gpt', 'llm'], ['nori::nori-image', 'nori-image', 'image'],
  ['nori::seedance2.0', 'seedance2.0-pro', 'video'],
  ['nori::nori-audio', 'nori-audio', 'audio'], ['nori::nori-music', 'nori-music', 'audio'], ['nori::nori-sfx', 'nori-sfx', 'audio'],
].map(([key, name, type]) => ({ key, name, type, tier: 'standard', description: `${type} 测试业务模型` }))
let config = {
  sourceFile: 'services.mock.json', updatedAt: '2026-11-07T00:00:00.000Z', providers, models, businessModels,
  defaultModels: {},
  agentModels: {},
  canvasAgentModelCatalog: {
    defaultModelKey: null,
    models: [
      { modelKey: 'deepseek::fixture-agent', providerId: 'deepseek', modelId: 'fixture-agent', displayName: '已验证测试模型', protocol: 'chat-completions', toolStreamingVerified: true, unavailableReason: null },
      { modelKey: 'deepseek::fixture-pending', providerId: 'deepseek', modelId: 'fixture-pending', displayName: '待验证测试模型', protocol: 'chat-completions', toolStreamingVerified: false, unavailableReason: 'TOOL_STREAMING_UNVERIFIED' },
    ],
  },
  modelRouting: {
    'nori::nori-gpt': 'deepseek::deepseek-chat', 'nori::nori-image': 'openlux::gpt-image-2.5-sunburst',
    'nori::seedance2.0': 'kuaizi::doubao-seedance-2-0-260128',
    'nori::nori-audio': 'kuaizi::speech-2.8-hd', 'nori::nori-music': '', 'nori::nori-sfx': '',
    'nori::canvas-agent': '',
  },
  storage: { type: 'tos', endpoint: 'https://tos-cn-beijing.volces.com', publicEndpoint: 'https://tos-cn-beijing.volces.com', region: 'cn-beijing', bucket: 'nori-test', forcePathStyle: false, hasAccessKey: true, hasSecretKey: true },
}
let savedPayload
const errors = []
const videoProviderRequests = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  page.on('request', (request) => { if (request.url().includes('/video-provider')) videoProviderRequests.push(request.url()) })
  const fixtureOrigin = `http://127.0.0.1:${server.address().port}`
  await page.route('**/*', (route) => new URL(route.request().url()).origin === fixtureOrigin ? route.continue() : route.abort())
  await page.route('**/api/**', (route) => route.fulfill({ status: 500, json: { error: 'Unexpected test request' } }))
  await page.route('**/api/admin/services*', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/admin/services') return route.fulfill({ status: 404, json: {} })
    if (route.request().method() === 'GET') return route.fulfill({ json: { config, health: [], usage } })
    assert.equal(route.request().method(), 'PUT')
    savedPayload = route.request().postDataJSON()
    config = { ...config, modelRouting: savedPayload.modelRouting, agentModels: savedPayload.agentModels, updatedAt: '2026-11-07T01:00:00.000Z' }
    return route.fulfill({ json: { config } })
  })
  await page.goto(`http://127.0.0.1:${server.address().port}?view=admin`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.nori-admin-provider').catch(async (error) => {
    console.log(JSON.stringify({ body: await page.locator('body').innerText(), errors, requests: await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name)) }))
    throw error
  })
  assert.equal(await page.locator('.nori-admin-provider').count(), 6)
  assert.equal(await page.locator('.nori-admin-provider.is-huimengi h3').innerText(), '绘梦工坊 API')
  assert.equal(await page.getByRole('heading', { name: 'Kimi 官方', exact: true }).count(), 1)
  assert.equal(await page.getByRole('heading', { name: 'OpenAI 官方', exact: true }).count(), 1)
  assert.equal(await page.getByRole('checkbox', { name: '开放 待验证测试模型' }).isDisabled(), true)
  await page.getByRole('checkbox', { name: '开放 已验证测试模型' }).check()
  assert.equal(await page.getByLabel('喵导默认模型').inputValue(), 'deepseek::fixture-agent')

  const imageOptions = await page.getByLabel('nori-image运行模型').locator('option').allTextContents()
  assert.equal(imageOptions.includes('绘梦工坊 · seedream-5.0-pro'), true)
  assert.equal(imageOptions.includes('OpenLux · gpt-image-2.5-sunburst'), true)
  const videoOptions = await page.getByLabel('seedance2.0-pro运行模型').locator('option').allTextContents()
  assert.equal(videoOptions.includes('Kuaizi · doubao-seedance-2-0-260128'), true)
  const audioOptions = await page.getByLabel('nori-audio运行模型').locator('option').allTextContents()
  assert.equal(audioOptions.some((text) => text.includes('绘梦工坊')), false)
  assert.equal(await page.getByRole('radiogroup', { name: '视频上游服务商' }).count(), 0)
  assert.equal(await page.locator('body').innerText().then((text) => text.includes('确认切换并立即生效')), false)

  const byProviderTable = page.getByRole('table', { name: '按服务商对账' })
  assert.deepEqual(await byProviderTable.locator('tbody tr').nth(0).locator('td').allTextContents(), ['kuaizi', '5', '1', '3 次 / 15 秒 / ¥4.50', '¥0.60', '¥5.10'])
  assert.equal(await page.locator('body').innerText().then((text) => text.includes('金额为按上游定价估算的成本，不等于向用户收取的积分')), true)

  await page.getByLabel('seedance2.0-pro运行模型').selectOption('huimengi::wan3.0-video')
  await page.getByLabel('nori-image运行模型').selectOption('huimengi::seedream-5.0-pro')
  assert.equal(await page.getByLabel('seedance2.0-pro运行模型').inputValue(), 'huimengi::wan3.0-video')
  await page.waitForFunction(() => document.body.innerText.includes('有未保存修改'))
  await page.screenshot({ path: path.join(artifacts, 'per-model-routing.png'), fullPage: true })

  await page.getByRole('button', { name: '保存并热加载', exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('配置已保存并热加载，不需要重启服务'))
  assert.equal(savedPayload.modelRouting['nori::seedance2.0'], 'huimengi::wan3.0-video')
  assert.equal(savedPayload.modelRouting['nori::nori-image'], 'huimengi::seedream-5.0-pro')
  assert.equal(savedPayload.modelRouting['nori::nori-audio'], 'kuaizi::speech-2.8-hd')
  assert.equal(savedPayload.modelRouting['nori::canvas-agent'], 'deepseek::fixture-agent')
  assert.deepEqual(savedPayload.agentModels, { 'deepseek::fixture-agent': { canvasAgent: true } })
  assert.equal(savedPayload.providers.some((provider) => Object.hasOwn(provider, 'apiKey')), false)
  assert.deepEqual(videoProviderRequests, [])
  assert.deepEqual(errors, [])
  await page.getByLabel('用途', { exact: true }).selectOption('agent')
  assert.equal(await page.getByText('暂无已采集的服务用量', { exact: true }).count(), 1)
  const result = {
    ok: true, providerCount: 6, byProviderTable: true, agentModelGates: true,
    providerLabelsInOptions: true, videoSwitchCardRemoved: true, removedEndpointNotRequested: true,
    kuaiziAndHuimengiRoutedConcurrently: true, imageProviderSwitched: true, audioUnchanged: true, noSecretsReturned: true,
    browserErrors: errors, paidRequests: 0, productionRequests: 0, artifacts,
  }
  await writeFile(path.join(artifacts, 'results.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
