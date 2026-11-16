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
  summary: { calls: 7, success: 5, failed: 2, cost: 6.6, averageLatencyMs: 1000, byType: [] },
  rows: [
    { provider: 'kuaizi', modelKey: 'kuaizi::doubao-seedance-2-0-260128', serviceType: 'video', operation: 'generate', calls: 3, success: 2, failed: 1, inputTokens: 0, outputTokens: 0, units: 15, averageLatencyMs: 1200, lastUsedAt: '2026-11-10T00:00:00.000Z', cost: 4.5 },
    { provider: 'kuaizi', modelKey: 'kuaizi::speech-2.8-hd', serviceType: 'audio', operation: 'generate', calls: 2, success: 2, failed: 0, inputTokens: 0, outputTokens: 0, units: 20, averageLatencyMs: 800, lastUsedAt: '2026-11-10T00:00:00.000Z', cost: 0.6 },
    { provider: 'tgg', modelKey: 'tgg::tgg-fixture-video', serviceType: 'video', operation: 'generate', calls: 2, success: 1, failed: 1, inputTokens: 0, outputTokens: 0, units: 5, averageLatencyMs: null, lastUsedAt: '2026-11-11T00:00:00.000Z', cost: 1.5 },
  ],
  byProvider: [
    { provider: 'kuaizi', calls: 5, success: 4, failed: 1, cost: 5.1, byType: [{ serviceType: 'video', calls: 3, cost: 4.5, units: 15 }, { serviceType: 'audio', calls: 2, cost: 0.6, units: 20 }] },
    { provider: 'tgg', calls: 2, success: 1, failed: 1, cost: 1.5, byType: [{ serviceType: 'video', calls: 2, cost: 1.5, units: 5 }] },
  ],
  storage: { objectCount: 0, knownBytes: 0 },
}
const providers = [
  ['deepseek', 'DeepSeek 官方', 'https://api.deepseek.com/v1', true],
  ['openlux', 'OpenLux API', 'https://api.openlux.ai/v1', true],
  ['kuaizi', 'Kuaizi API', 'https://aiopenapi.kuaizi.cn', true],
  ['huimengi', '绘梦工坊 API', 'https://api.huimengi.com', true],
  ['tgg', 'TGG Token API', 'https://tggtoken.org', false],
].map(([id, name, baseUrl, hasApiKey]) => ({ id, name, baseUrl, hasApiKey }))
const models = [
  ['deepseek', 'deepseek-chat', 'llm'], ['deepseek', 'deepseek-reasoner', 'llm'],
  ['openlux', 'gpt-image-2.5-flare', 'image'], ['openlux', 'gpt-image-2.5-sunburst', 'image'],
  ['huimengi', 'seedream-5.0-pro', 'image'], ['huimengi', 'qwen-image-3.0-pro', 'image'],
  ['kuaizi', 'doubao-seedance-2-0-260128', 'video'], ['huimengi', 'wan3.0-video', 'video'], ['huimengi', 'seedance-1.5-pro', 'video'],
  ['tgg', 'tgg-fixture-video', 'video'],
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
let videoCurrent = 'kuaizi'
let tggKeyConfigured = false
function makeVideoPlan(target) {
  const videoRoute = config.modelRouting['nori::seedance2.0'] || ''
  const rows = target === 'tgg' ? [
    { businessKey: 'nori::seedance2.0', name: 'seedance2.0-pro', from: videoRoute, to: 'tgg::tgg-fixture-video', action: videoRoute === 'tgg::tgg-fixture-video' ? 'keep' : 'switch' },
    { businessKey: 'nori::seedance2.0-mini', name: 'seedance2.0-mini', from: 'kuaizi::doubao-seedance-2-0-mini-260615', to: 'kuaizi::doubao-seedance-2-0-mini-260615', action: 'keep', reason: 'TGG 暂无对应模型' },
    { businessKey: 'nori::seedance2.0-fast', name: 'seedance2.0-fast', from: 'kuaizi::doubao-seedance-2-0-fast-260615', to: 'kuaizi::doubao-seedance-2-0-fast-260615', action: 'unavailable', reason: '该模型 TGG 未定价或能力未核实' },
  ] : [
    { businessKey: 'nori::seedance2.0', name: 'seedance2.0-pro', from: videoRoute, to: 'kuaizi::doubao-seedance-2-0-260128', action: videoRoute === 'kuaizi::doubao-seedance-2-0-260128' ? 'keep' : 'switch' },
  ]
  const blockers = []
  if (target === 'tgg' && !tggKeyConfigured) blockers.push('TGG 尚未配置 API Key')
  if (!rows.some((row) => row.action === 'switch') && videoCurrent !== target) blockers.push('没有可切换的模型')
  return { current: videoCurrent, target, rows, blockers, applied: false }
}
let savedPayload
const errors = []
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
  await page.route('**/api/**', (route) => route.fulfill({ status: 500, json: { error: 'Unexpected test request' } }))
  const servicesRouteHandler = async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname === '/api/admin/services/video-provider') {
      if (route.request().method() === 'GET') return route.fulfill({ json: { success: true, current: videoCurrent, inFlight: { kuaizi: 3, tgg: 0 } } })
      const body = route.request().postDataJSON()
      const plan = makeVideoPlan(body.target)
      if (body.dryRun === true) return route.fulfill({ json: { success: true, plan } })
      if (plan.blockers.length) return route.fulfill({ status: 409, json: { success: false, plan } })
      for (const row of plan.rows) if (row.action === 'switch') config.modelRouting[row.businessKey] = row.to
      videoCurrent = body.target
      return route.fulfill({ json: { success: true, plan: { ...plan, applied: true } } })
    }
    if (url.pathname !== '/api/admin/services') return route.fulfill({ status: 404, json: {} })
    if (route.request().method() === 'GET') return route.fulfill({ json: { config, health: [], usage } })
    assert.equal(route.request().method(), 'PUT')
    savedPayload = route.request().postDataJSON()
    config = { ...config, modelRouting: savedPayload.modelRouting, updatedAt: '2026-11-07T01:00:00.000Z' }
    return route.fulfill({ json: { config } })
  }
  await page.route('**/api/admin/services*', servicesRouteHandler)
  await page.route('**/api/admin/services/video-provider', servicesRouteHandler)
  await page.goto(`http://127.0.0.1:${server.address().port}?view=admin`, { waitUntil: 'networkidle' })
  await page.waitForSelector('.nori-admin-provider').catch(async (error) => {
    console.log(JSON.stringify({ body: await page.locator('body').innerText(), errors, requests: await page.evaluate(() => performance.getEntriesByType('resource').map((entry) => entry.name)) }))
    throw error
  })
  assert.equal(await page.locator('.nori-admin-provider').count(), 5)
  assert.equal(await page.locator('.nori-admin-provider.is-huimengi h3').innerText(), '绘梦工坊 API')
  assert.equal(await page.locator('.nori-admin-provider.is-tgg h3').innerText(), 'TGG Token API')
  assert.equal(await page.locator('.nori-admin-provider.is-tgg .nori-admin-connection-head p').innerText(), '视频服务（可与 Kuaizi 切换）')
  assert.equal(await page.locator('body').innerText().then((text) => text.includes('只需维护五套平台密钥')), true)
  assert.equal(await page.getByLabel('nori-image运行模型').locator('option').allTextContents().then((items) => items.some((text) => text.includes('huimengi:seedream-5.0-pro'))), true)
  assert.equal(await page.getByLabel('nori-audio运行模型').locator('option').allTextContents().then((items) => items.some((text) => text.includes('huimengi'))), false)

  const byProviderTable = page.getByRole('table', { name: '按服务商对账' })
  assert.deepEqual(await byProviderTable.locator('tbody tr').nth(0).locator('td').allTextContents(), ['kuaizi', '5', '1', '3 次 / 15 秒 / ¥4.50', '¥0.60', '¥5.10'])
  assert.deepEqual(await byProviderTable.locator('tbody tr').nth(1).locator('td').allTextContents(), ['tgg', '2', '1', '2 次 / 5 秒 / ¥1.50', '¥0.00', '¥1.50'])
  assert.equal(await page.locator('body').innerText().then((text) => text.includes('金额为按上游定价估算的成本，不等于向用户收取的积分')), true)

  await page.waitForFunction(() => document.body.innerText.includes('当前：Kuaizi'))
  assert.equal(await page.locator('body').innerText().then((text) => text.includes('进行中的任务：Kuaizi 3 个 · TGG 0 个（不受切换影响）')), true)
  const kuaiziRadio = page.getByRole('radio', { name: 'Kuaizi', exact: true })
  const tggRadio = page.getByRole('radio', { name: 'TGG', exact: true })
  assert.equal(await kuaiziRadio.getAttribute('aria-checked'), 'true')
  assert.equal(await kuaiziRadio.isDisabled(), true)
  assert.equal(await tggRadio.getAttribute('aria-checked'), 'false')
  assert.equal(await tggRadio.isDisabled(), false)

  await tggRadio.click()
  await page.waitForFunction(() => document.body.innerText.includes('阻断：TGG 尚未配置 API Key'))
  assert.equal(await page.getByRole('button', { name: '确认切换并立即生效' }).isDisabled(), true)
  assert.equal(await page.locator('body').innerText().then((text) => text.includes('进行中的任务继续在原服务商完成并按原服务商计成本；用户扣费不变。')), true)
  assert.equal(await page.locator('body').innerText().then((text) => text.includes('TGG 路径下 Seedance 真人素材合规由 TGG 侧决定，Kuaizi 的私有素材库流程不会参与。')), true)
  await page.screenshot({ path: path.join(artifacts, 'switch-blocked.png'), fullPage: true })
  await page.getByRole('button', { name: '取消', exact: true }).click()
  await page.waitForFunction(() => !document.body.innerText.includes('确认切换并立即生效'))

  tggKeyConfigured = true
  config = { ...config, providers: config.providers.map((provider) => provider.id === 'tgg' ? { ...provider, hasApiKey: true } : provider) }
  await page.getByLabel('nori-image运行模型').selectOption('huimengi::seedream-5.0-pro')
  await page.waitForFunction(() => document.body.innerText.includes('有未保存修改'))
  await tggRadio.click()
  await page.waitForFunction(() => document.body.innerText.includes('页面有未保存的修改，切换只改视频路由，其它修改仍需点右上角保存'))
  const previewText = await page.locator('body').innerText()
  assert.equal(previewText.includes('TGG 暂无对应模型'), true)
  assert.equal(previewText.includes('该模型 TGG 未定价或能力未核实'), true)
  assert.equal(previewText.includes('tgg-fixture-video'), true)
  assert.equal(await page.getByRole('button', { name: '确认切换并立即生效' }).isDisabled(), false)
  await page.screenshot({ path: path.join(artifacts, 'switch-preview.png'), fullPage: true })
  await page.getByRole('button', { name: '确认切换并立即生效' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('已切换到 TGG，新任务立即生效；进行中的 3 个任务不受影响'))
  await page.waitForFunction(() => document.querySelector('select[aria-label="seedance2.0-pro运行模型"]')?.value === 'tgg::tgg-fixture-video')
  assert.equal(await page.getByLabel('nori-image运行模型').inputValue(), 'huimengi::seedream-5.0-pro')
  assert.equal(await page.locator('body').innerText().then((text) => text.includes('有未保存修改')), true)
  assert.equal(await page.locator('body').innerText().then((text) => text.includes('当前：TGG')), true)
  assert.equal(await kuaiziRadio.isDisabled(), false)
  assert.equal(await tggRadio.isDisabled(), true)
  await page.screenshot({ path: path.join(artifacts, 'switched-tgg.png'), fullPage: true })

  await kuaiziRadio.click()
  await page.waitForFunction(() => document.body.innerText.includes('切换到 Kuaizi 后'))
  await page.getByRole('button', { name: '确认切换并立即生效' }).click()
  await page.waitForFunction(() => document.body.innerText.includes('已切换到 Kuaizi，新任务立即生效；进行中的 3 个任务不受影响'))
  await page.waitForFunction(() => document.querySelector('select[aria-label="seedance2.0-pro运行模型"]')?.value === 'kuaizi::doubao-seedance-2-0-260128')
  assert.equal(await page.getByLabel('nori-image运行模型').inputValue(), 'huimengi::seedream-5.0-pro')

  await page.getByLabel('seedance2.0-pro运行模型').selectOption('huimengi::wan3.0-video')
  await page.screenshot({ path: path.join(artifacts, 'switched-providers.png'), fullPage: true })
  await page.getByRole('button', { name: '保存并热加载', exact: true }).click()
  await page.waitForFunction(() => document.body.innerText.includes('配置已保存并热加载，不需要重启服务'))
  assert.equal(savedPayload.modelRouting['nori::nori-image'], 'huimengi::seedream-5.0-pro')
  assert.equal(savedPayload.modelRouting['nori::seedance2.0'], 'huimengi::wan3.0-video')
  assert.equal(savedPayload.modelRouting['nori::nori-audio'], 'kuaizi::speech-2.8-hd')
  assert.equal(savedPayload.providers.some((provider) => Object.hasOwn(provider, 'apiKey')), false)
  assert.deepEqual(errors, [])
  const result = {
    ok: true, providerCount: 5, tggCard: true, byProviderTable: true,
    switchBlockedWithoutKey: true, switchPreviewReasons: true, switchAppliedToTgg: true,
    draftPreservedAcrossSwitch: true, switchedBackToKuaizi: true,
    imageProviderSwitched: true, videoProviderSwitched: true, audioUnchanged: true, noSecretsReturned: true,
    browserErrors: errors, paidRequests: 0, productionRequests: 0, artifacts,
  }
  await writeFile(path.join(artifacts, 'results.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
