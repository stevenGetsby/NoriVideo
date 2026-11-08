import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/toolbox-regeneration')
await mkdir(artifacts, { recursive: true })
const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/toolbox-regeneration.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'),
    'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx'),
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
const image = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#3b5b7a"/></svg>')
const source = {
  id: 'source-asset', type: 'image', status: 'ready', url: image, materialId: 'source-material', modelId: 'nori::nori-image',
  params: { title: '原始素材', prompt: '原始提示词', aspectRatio: '16:9', quality: 'high' },
  task: { id: 'source-task', status: 'completed', costPoints: 1 },
}
const history = Array.from({ length: 25 }, (_, index) => ({
  ...source,
  id: `history-${index + 1}`,
  materialId: `material-${index + 1}`,
  params: { ...source.params, title: `历史素材 ${index + 1}`, prompt: `历史提示词 ${index + 1}` },
}))
const historyReads = []
const writes = []
const browser = await chromium.launch({ headless: true, executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.route('**/api/**', async (route) => {
  const url = new URL(route.request().url())
  const json = (body) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
  if (url.pathname === '/api/frameos/toolbox/generate') {
    writes.push(route.request().postDataJSON())
    return json({ success: true, tasks: [{ taskId: 'new-task', assetId: 'new-asset' }] })
  }
  if (url.pathname === '/api/frameos/toolbox/assets') {
    historyReads.push(Object.fromEntries(url.searchParams))
    const cursor = url.searchParams.get('cursor')
    const start = cursor ? history.findIndex((asset) => asset.id === cursor) + 1 : 0
    const assets = history.slice(start, start + 12)
    return json({ assets, pagination: { nextCursor: start + 12 < history.length ? assets.at(-1)?.id || null : null } })
  }
  if (url.pathname === '/api/projects') return json({ projects: [{ id: 'project-1', name: '当前作品', workId: 'work-1' }], pagination: { totalPages: 1 } })
  if (url.pathname.includes('/generation-config')) return json({
    imageModels: [{ provider: 'nori', available: true, modelKey: 'nori::nori-image', name: 'nori-image', options: { aspectRatio: ['16:9'], resolution: ['1K'] } }],
    videoModels: [], defaults: { imageModel: 'nori::nori-image', aspectRatio: '16:9', resolution: '1K' },
  })
  if (url.pathname === '/api/user/balance') return json({ balancePoints: 1000, generationAllowed: true })
  if (url.pathname === '/api/collaboration/assignments/counts') return json({ data: { counts: { todo: 0, pendingReview: 0 } } })
  return json({})
})
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`)
  await page.getByRole('button', { name: '选择历史素材：历史素材 1', exact: true }).waitFor({ timeout: 10_000 }).catch(async (error) => {
    throw new Error(`${error.message}\nCards: ${await page.locator('nav[aria-label="生成历史分页"]').locator('xpath=preceding-sibling::div[1]').evaluate((element) => element.innerHTML)}\nPage: ${await page.locator('body').innerText()}\nHistory reads: ${JSON.stringify(historyReads)}\nErrors: ${JSON.stringify(errors)}`)
  })
  assert.equal(await page.getByRole('button', { name: '上一页生成历史', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '下一页生成历史', exact: true }).click()
  await page.getByRole('button', { name: '选择历史素材：历史素材 13', exact: true }).waitFor({ timeout: 10_000 }).catch(async (error) => {
    throw new Error(`${error.message}\nCards: ${await page.locator('nav[aria-label="生成历史分页"]').locator('xpath=preceding-sibling::div[1]').evaluate((element) => element.innerHTML)}\nPage: ${await page.locator('body').innerText()}\nHistory reads: ${JSON.stringify(historyReads)}\nErrors: ${JSON.stringify(errors)}`)
  })
  assert.equal(historyReads.at(-1).cursor, 'history-12')
  await page.getByRole('button', { name: '选择历史素材：历史素材 13', exact: true }).click()
  await page.getByRole('region', { name: '已载入素材详情', exact: true }).waitFor()
  assert.equal(await page.locator('aside input').first().inputValue(), '历史素材 13')
  assert.equal(await page.locator('aside textarea').inputValue(), '历史提示词 13')
  await page.getByRole('button', { name: '下一页生成历史', exact: true }).click()
  await page.getByRole('button', { name: '选择历史素材：历史素材 25', exact: true }).waitFor()
  assert.equal(await page.locator('aside input').first().inputValue(), '历史素材 13', 'cross-page detail must remain loaded')
  assert.equal(await page.getByRole('button', { name: '下一页生成历史', exact: true }).isDisabled(), true)
  await page.getByRole('button', { name: '上一页生成历史', exact: true }).click()
  await page.getByRole('button', { name: '选择历史素材：历史素材 24', exact: true }).waitFor()
  assert.equal(await page.getByRole('button', { name: '选择历史素材：历史素材 1', exact: true }).count(), 0)
  await page.locator('aside input').first().fill('修改后的新素材')
  await page.locator('aside textarea').fill('修改后的提示词')
  await page.getByRole('button', { name: '生成图片', exact: true }).click()
  await page.getByText('生成任务已提交，完成后会自动进入资产库。', { exact: true }).waitFor()
  assert.equal(writes.length, 1)
  assert.equal(writes[0].title, '修改后的新素材')
  assert.equal(writes[0].prompt, '修改后的提示词')
  assert.ok(writes[0].idempotencyKey)
  assert.equal(writes[0].assetId ?? null, null)
  assert.equal(writes[0].requestHash ?? null, null)
  assert.ok(!JSON.stringify(writes[0]).includes('source-asset'))
  assert.ok(!JSON.stringify(writes[0]).includes('source-task'))
  assert.equal(source.params.title, '原始素材')
  assert.equal(source.params.prompt, '原始提示词')
  await page.getByRole('button', { name: '选择历史素材：历史素材 1', exact: true }).waitFor()
  assert.equal(historyReads.at(-1).cursor ?? null, null)
  await page.screenshot({ path: path.join(artifacts, 'loaded-history.png'), fullPage: true })
  assert.deepEqual(historyReads.map((read) => read.cursor || null).slice(0, 5), [null, 'history-12', 'history-24', 'history-12', null], 'Forward/backward navigation and new generation must each read the intended page once')
  await page.getByRole('button', { name: '下一页生成历史', exact: true }).waitFor({ state: 'visible' })
  assert.equal(await page.getByRole('button', { name: '下一页生成历史', exact: true }).isEnabled(), true)
  await page.getByRole('button', { name: '下一页生成历史', exact: true }).click()
  await page.getByRole('button', { name: '选择历史素材：历史素材 13', exact: true }).waitFor()
  await page.getByRole('button', { name: '下一页生成历史', exact: true }).click()
  await page.getByRole('button', { name: '选择历史素材：历史素材 25', exact: true }).waitFor()
  history.pop()
  await page.getByRole('button', { name: '刷新', exact: true }).click()
  await page.getByRole('button', { name: '选择历史素材：历史素材 13', exact: true }).waitFor().catch(async (error) => {
    throw new Error(`${error.message}\nPage: ${await page.locator('body').innerText()}\nReads: ${JSON.stringify(historyReads)}\nErrors: ${JSON.stringify(errors)}`)
  })
  assert.equal(await page.getByText('第 2 页 · 每页 12 条', { exact: true }).count(), 1)
  assert.equal(historyReads.at(-1).cursor, 'history-12', 'An emptied last page must load its previous cursor directly')
  assert.deepEqual(errors, [])
  console.log('[toolbox-regeneration] history details, edited draft and fresh idempotency payload passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
