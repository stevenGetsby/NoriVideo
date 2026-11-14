// 影游 P2 editor: value icons / HUD flags / caps, the hidden-option unlock rule and the shop.
// The asset upload route is mocked: no real uploads are made.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/story-gameplay-editor')
await mkdir(artifacts, { recursive: true })
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/story-gameplay-editor.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
  },
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
  } else if (pathname.startsWith('/clips/')) {
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

const uploads = []
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})

const card = (page) => page.locator('[data-id="choice-1"]')
const visible = async (locator, what) => {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 10_000 })
  } catch (cause) {
    throw new Error(`missing ${what}`, { cause })
  }
}
const lastUnlockPatch = (page) => page.evaluate(() => {
  const entries = window.__gameplayFixture.patches.filter((patch) => patch.label === '编辑解锁条件')
  return entries.at(-1)?.patch.options
})
const waitSaves = (page, count) => page.waitForFunction((expected) => window.__gameplayFixture.saves.length === expected, count)
const waitUnlockPatch = (page) => page.waitForFunction(() => window.__gameplayFixture.patches.some((patch) => patch.label === '编辑解锁条件'))

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1300 } })
  await page.route('**/api/interactive/work-1/assets', async (route) => {
    uploads.push({ method: route.request().method(), headers: route.request().headers() })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/uploads/icon.png' }) })
  })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-id="choice-1"]', { timeout: 20_000 })

  // 1. An option's 解锁条件 rule: the existing rule stays active, a new one starts locked on the first value.
  const chip = (index) => card(page).getByRole('button', { name: '解锁条件' }).nth(index)
  assert.match(await chip(0).getAttribute('class'), /is-active/)
  assert.doesNotMatch(await chip(1).getAttribute('class'), /is-active/)
  await chip(1).click()
  await waitUnlockPatch(page)
  assert.deepEqual(await page.evaluate(() => window.__gameplayFixture.patches.filter((patch) => patch.label === '编辑解锁条件').at(-1).patch.options[1].unlock), {
    mode: 'locked', match: 'all', conditions: [{ variableId: 'coin', op: '>=', value: 1 }], shopItemId: null,
  })
  await visible(card(page).getByText('每个选项都有解锁条件'), 'all options gated hint')
  await visible(card(page).getByText('先在玩法设置里开启商城并添加商品'), 'shop missing hint')

  // 2. The gameplay panel opens from the unlock editor.
  await card(page).getByRole('button', { name: '打开玩法设置' }).click()
  assert.deepEqual(await page.evaluate(() => window.__gameplayFixture.panels), ['gameplay'])

  // 3. 数值: emoji icon, HUD checkbox, permanent scope, cap warning and an uploaded picture icon.
  const names = page.getByLabel('变量名称')
  assert.equal(await names.count(), 2)
  assert.equal(await names.nth(0).inputValue(), '金币')
  await page.getByRole('button', { name: '显示设置' }).nth(0).click()
  await page.getByLabel('变量图标表情').fill('🪙')
  await page.getByLabel('显示在右上角').check()
  await page.getByLabel('数值保留').selectOption('permanent')
  await page.getByLabel('上限').fill('2')
  await visible(page.getByText('初始值 3 高于上限 2'), 'cap warning')
  await page.getByRole('button', { name: '显示设置' }).nth(1).click()
  await page.locator('.nori-ix-var').nth(1).locator('input[type="file"]').setInputFiles({
    name: 'icon.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  })
  await page.waitForFunction(() => Array.from(document.querySelectorAll('.nori-ix-var')).at(1)?.querySelector('.nori-ix-icon-preview img')?.getAttribute('src') === '/uploads/icon.png')
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].method, 'POST')

  await page.getByRole('button', { name: '保存', exact: true }).click()
  await waitSaves(page, 1)
  const variablesPatch = await page.evaluate(() => window.__gameplayFixture.saves[0].config)
  assert.deepEqual(Object.keys(variablesPatch), ['variables'])
  assert.deepEqual(variablesPatch.variables[0], { id: 'coin', name: '金币', type: 'number', initial: 3, max: 2, icon: '🪙', showInHud: true, scope: 'permanent' })
  assert.deepEqual(variablesPatch.variables[1], { id: 'key', name: '钥匙', type: 'number', initial: 0, icon: '/uploads/icon.png' })

  // 4. 商城: enable, pick the currency, edit an item, add + move another, then save.
  await page.getByRole('tab', { name: '商城' }).click()
  await visible(page.getByText('没有选择货币时，购买只是模拟'), 'simulation note')
  await page.getByLabel('开启商城').check()
  await page.getByLabel('商城货币').selectOption('coin')
  await page.getByLabel('商品名称').first().fill('金库钥匙')
  await page.getByLabel('商品描述').first().fill('打开金库大门')
  await page.getByLabel('商品价格').first().fill('5.5')
  await page.getByLabel('每局限购').first().fill('3')
  await page.getByLabel('商品图标表情').first().fill('🔑')
  await page.getByRole('button', { name: '添加商品' }).click()
  await page.getByLabel('商品名称').nth(1).fill('补血药')
  await page.getByLabel('商品描述').nth(1).fill('恢复生命')
  await page.getByLabel('商品价格').nth(1).fill('1')
  await page.getByLabel('每局限购').nth(1).fill('0')
  await page.getByRole('button', { name: '变量效果' }).nth(1).click()
  await page.getByRole('button', { name: '上移商品' }).nth(1).click()
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await waitSaves(page, 2)
  const shopPatch = await page.evaluate(() => window.__gameplayFixture.saves[1].config.shop)
  assert.equal(shopPatch.enabled, true)
  assert.equal(shopPatch.currencyVariableId, 'coin')
  assert.equal(shopPatch.items.length, 2)
  assert.equal(shopPatch.items[0].name, '补血药')
  assert.match(shopPatch.items[0].id, /^shop_[A-Za-z0-9]{1,8}$/)
  assert.equal(shopPatch.items[0].price, 1)
  assert.equal(shopPatch.items[0].limit, 0)
  assert.deepEqual(shopPatch.items[0].effects, [{ variableId: 'coin', op: 'add', value: 1 }])
  assert.deepEqual(shopPatch.items[1], {
    id: 'shop_key', name: '金库钥匙', icon: '🔑', description: '打开金库大门', price: 5.5, limit: 3,
    effects: [{ variableId: 'key', op: 'add', value: 1 }],
  })

  // 5. Switching 数值 → 开关 drops the cap but keeps icon / HUD / scope.
  await page.getByRole('tab', { name: '数值' }).click()
  await page.getByLabel('变量类型').first().selectOption('boolean')
  await page.getByRole('button', { name: '保存', exact: true }).click()
  await waitSaves(page, 3)
  const switched = await page.evaluate(() => window.__gameplayFixture.saves[2].config.variables[0])
  assert.deepEqual(switched, { id: 'coin', name: '金币', type: 'boolean', initial: false, icon: '🪙', showInHud: true, scope: 'permanent' })
  assert.equal('max' in switched, false)

  // 6. Once the shop is enabled, the locked option can link one of its items.
  await card(page).getByLabel('关联商品').selectOption('shop_key')
  await page.waitForFunction(() => {
    const entries = window.__gameplayFixture.patches.filter((patch) => patch.label === '编辑解锁条件')
    return entries.at(-1)?.patch.options[1].unlock.shopItemId === 'shop_key'
  })

  // 7. Hidden mode drops the shop link; 清除 removes the unlock key entirely.
  await chip(0).click()
  await page.getByLabel('条件不满足时').selectOption('hidden')
  const hidden = await lastUnlockPatch(page)
  assert.equal(hidden[0].unlock.mode, 'hidden')
  assert.equal(hidden[0].unlock.shopItemId, null)
  await page.getByRole('button', { name: '清除' }).click()
  await page.waitForFunction(() => {
    const entries = window.__gameplayFixture.patches.filter((patch) => patch.label === '编辑解锁条件')
    return entries.length > 0 && !('unlock' in entries.at(-1).patch.options[0])
  })
  assert.equal(await card(page).getByText('每个选项都有解锁条件').count(), 0)
  await page.screenshot({ path: path.join(artifacts, 'editor.png'), fullPage: true })

  // 8. Read-only disables every editor control.
  const readonly = await browser.newPage({ viewport: { width: 1600, height: 1300 } })
  await readonly.goto(`${base}/?readonly=1`, { waitUntil: 'networkidle' })
  await readonly.waitForSelector('[data-id="choice-1"]', { timeout: 20_000 })
  const readonlyCard = readonly.locator('[data-id="choice-1"]')
  await readonlyCard.getByRole('button', { name: '解锁条件' }).nth(0).click()
  assert.equal(await readonlyCard.getByLabel('条件不满足时').isDisabled(), true)
  assert.equal(await readonlyCard.getByLabel('条件满足方式').isDisabled(), true)
  assert.equal(await readonlyCard.getByRole('button', { name: '清除' }).isDisabled(), true)
  await visible(readonlyCard.getByText('先在玩法设置里开启商城并添加商品'), 'read-only shop hint')
  assert.equal(await readonly.getByLabel('变量名称').first().isEditable(), false)
  assert.equal(await readonly.getByRole('button', { name: '添加变量' }).count(), 0)
  assert.equal(await readonly.getByRole('button', { name: '保存', exact: true }).count(), 0)
  await readonly.getByRole('tab', { name: '商城' }).click()
  assert.equal(await readonly.getByLabel('开启商城').isDisabled(), true)
  assert.equal(await readonly.getByLabel('商品名称').first().isEditable(), false)
  assert.equal(await readonly.getByRole('button', { name: '添加商品' }).count(), 0)
  await readonly.screenshot({ path: path.join(artifacts, 'readonly.png'), fullPage: true })

  console.log('story-gameplay-editor: all checks passed')
} finally {
  await browser.close()
  server.close()
}
