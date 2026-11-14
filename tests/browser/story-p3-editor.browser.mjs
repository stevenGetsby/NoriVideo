// 影游 P3 editor: achievements / personality / map / ending flags / scene save points / option tags.
// The asset upload route is mocked: no real uploads are made.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/story-p3-editor')
await mkdir(artifacts, { recursive: true })
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/story-p3-editor.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: { '@': path.join(root, 'src') },
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

const uploads = []
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})

const PNG = { name: 'pic.png', mimeType: 'image/png', buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex') }
const waitSaves = (page, count) => page.waitForFunction((expected) => window.__p3Fixture.saves.length === expected, count)
const savedConfig = (page, index = -1) => page.evaluate((at) => window.__p3Fixture.saves.at(at)?.config, index)
const lastPatch = (page, label) => page.evaluate((wanted) => window.__p3Fixture.patches.filter((patch) => patch.label === wanted).at(-1), label)
const stripId = (list) => list.map(({ id, ...rest }) => rest)
const waitImage = (page, selector, src) =>
  page.waitForFunction(([needle, expected]) => document.querySelector(needle)?.querySelector('img')?.getAttribute('src') === expected, [selector, src])

const consoleErrors = (page) => {
  const errors = []
  page.on('pageerror', (error) => errors.push(String(error)))
  page.on('console', (message) => { if (message.type() === 'error') errors.push(message.text()) })
  return errors
}

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1400 } })
  const errors = consoleErrors(page)
  await page.route('**/api/interactive/work-1/assets', async (route) => {
    uploads.push({ method: route.request().method() })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/uploads/frame.png' }) })
  })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-id="choice-1"]', { timeout: 20_000 })

  const sceneCard = page.locator('[data-id="scene-1"]')
  const endingCard = page.locator('[data-id="ending-1"]')
  const choiceCard = page.locator('[data-id="choice-1"]')
  const saveButton = () => page.locator('.nori-ix-gameplay').getByRole('button', { name: '保存', exact: true })
  const tab = (name) => page.getByRole('tab', { name })

  // 0. Old works before the P3 fields: no personality chips, disabled ending flag with the hint.
  assert.equal(await page.locator('.nori-story-tag-chips').count(), 0)
  assert.equal(await endingCard.getByLabel('显示人格结果').isDisabled(), true)
  await endingCard.getByText('先在玩法设置里开启人格测试').waitFor()
  await sceneCard.getByText('地图未开启，存档点暂不生效').waitFor()

  // 1. 成就: six cards covering every condition kind plus a boolean value, rewards and a frame upload.
  await tab(/^成就/).click()
  for (let index = 0; index < 6; index += 1) {
    await page.getByRole('button', { name: '添加成就' }).click()
    await page.waitForFunction((expected) => document.querySelectorAll('.nori-ix-ach-card').length === expected, index + 1)
  }
  const cards = page.locator('.nori-ix-ach-card')
  const card = (index) => cards.nth(index)
  await card(0).getByLabel('成就图标表情').fill('🏆')
  await card(0).getByLabel('成就描述').fill('第一个成就')
  await card(0).getByLabel('选择结局').selectOption('p1:ending-1')
  await card(1).getByLabel('达成条件').selectOption('segment')
  await card(1).getByLabel('选择片段').selectOption('p1:scene-1')
  await card(2).getByLabel('达成条件').selectOption('value')
  assert.equal(await card(2).getByLabel('条件数值').inputValue(), 'coin')
  await card(2).getByLabel('比较方式').selectOption('>')
  await card(2).getByLabel('目标值').fill('3')
  await card(3).getByLabel('达成条件').selectOption('all_endings')
  await card(4).getByLabel('达成条件').selectOption('all_achievements')
  await card(5).getByLabel('达成条件').selectOption('value')
  await card(5).getByLabel('条件数值').selectOption('seen')
  assert.equal(await card(5).getByLabel('比较方式').inputValue(), '==')
  await card(5).getByLabel('目标值').selectOption('false')
  const titles = ['称号一', '称号二', '称号三', '称号四', '称号五', '称号六']
  for (let index = 0; index < 6; index += 1) await card(index).getByLabel('奖励称号').fill(titles[index])
  await card(0).locator('.nori-ix-ach-frame input[type="file"]').setInputFiles(PNG)
  await waitImage(page, '.nori-ix-ach-frame', '/uploads/frame.png')
  await card(0).getByText(/到达结局「好结局」/).waitFor()
  await card(0).getByText(/奖励：称号「称号一」 \+ 头像框/).waitFor()
  await page.getByText('已添加 6 / 40 个成就').waitFor()
  await saveButton().click()
  await waitSaves(page, 1)
  const achievementsPatch = await savedConfig(page, 0)
  assert.deepEqual(Object.keys(achievementsPatch), ['achievements'])
  assert.equal(achievementsPatch.achievements.length, 6)
  for (const item of achievementsPatch.achievements) assert.match(item.id, /^ach_[A-Za-z0-9]{1,8}$/)
  assert.equal(new Set(achievementsPatch.achievements.map((item) => item.id)).size, 6)
  assert.deepEqual(stripId(achievementsPatch.achievements), [
    { name: '成就1', description: '第一个成就', icon: '🏆', condition: { type: 'ending', projectId: 'p1', nodeId: 'ending-1' }, reward: { title: '称号一', frameUrl: '/uploads/frame.png' } },
    { name: '成就2', description: '', icon: null, condition: { type: 'segment', projectId: 'p1', nodeId: 'scene-1' }, reward: { title: '称号二', frameUrl: null } },
    { name: '成就3', description: '', icon: null, condition: { type: 'value', variableId: 'coin', op: '>', value: 3 }, reward: { title: '称号三', frameUrl: null } },
    { name: '成就4', description: '', icon: null, condition: { type: 'all_endings' }, reward: { title: '称号四', frameUrl: null } },
    { name: '成就5', description: '', icon: null, condition: { type: 'all_achievements' }, reward: { title: '称号五', frameUrl: null } },
    { name: '成就6', description: '', icon: null, condition: { type: 'value', variableId: 'seen', op: '==', value: false }, reward: { title: '称号六', frameUrl: null } },
  ])

  // 2. 人格测试: switch on and customise one type; only that type goes into the patch.
  await tab(/人格测试/).click()
  assert.equal(await page.getByPlaceholder('物流师').count(), 1)
  await page.getByLabel('开启人格测试').check()
  await page.getByLabel('ENFP 结果名称').fill('热情家')
  await page.getByRole('button', { name: '恢复 ENFP 默认' }).waitFor()
  await saveButton().click()
  await waitSaves(page, 2)
  assert.deepEqual(await savedConfig(page, 1), {
    personality: { enabled: true, results: { ENFP: { name: '热情家', description: '', imageUrl: null } } },
  })

  // 3. 地图: switch on, the warning explains that no segment is a save point yet.
  await tab(/地图/).click()
  assert.match(await page.locator('.nori-ix-map-count').textContent(), /已标记\s*0\s*个存档点/)
  await page.getByLabel('开启地图和存档').check()
  await page.getByText('还没有片段标记为存档点').waitFor()
  await saveButton().click()
  await waitSaves(page, 3)
  assert.deepEqual(await savedConfig(page, 2), { map: { enabled: true } })

  // 4. 商城: a bought reward (title + frame) survives the sanitizer.
  await tab(/商城/).click()
  await page.getByLabel('商品奖励称号').fill('王牌')
  await page.locator('.nori-ix-shop-reward input[type="file"]').setInputFiles(PNG)
  await waitImage(page, '.nori-ix-shop-reward', '/uploads/frame.png')
  await saveButton().click()
  await waitSaves(page, 4)
  const shopPatch = await savedConfig(page, 3)
  assert.deepEqual(Object.keys(shopPatch), ['shop'])
  assert.deepEqual(shopPatch.shop.items[0].reward, { title: '王牌', frameUrl: '/uploads/frame.png' })

  // 5. Ending: the first achievement already targets this ending, so 设为成就 starts on.
  // Unchecking removes it; checking again adds a fresh achievement named after the ending.
  assert.equal(await endingCard.getByLabel('设为成就').isChecked(), true)
  await endingCard.getByLabel('设为成就').uncheck()
  await waitSaves(page, 5)
  const removed = await savedConfig(page, 4)
  assert.equal(removed.achievements.length, 5)
  assert.equal(removed.achievements.some((item) => item.condition.type === 'ending' && item.condition.nodeId === 'ending-1'), false)
  await endingCard.getByLabel('设为成就').check()
  await waitSaves(page, 6)
  const added = await savedConfig(page, 5)
  assert.equal(added.achievements.length, 6)
  assert.equal(added.achievements.at(-1).name, '好结局')
  assert.deepEqual(added.achievements.at(-1).condition, { type: 'ending', projectId: 'p1', nodeId: 'ending-1' })
  assert.deepEqual(added.achievements.at(-1).reward, { title: '', frameUrl: null })
  assert.match(added.achievements.at(-1).id, /^ach_[A-Za-z0-9]{1,8}$/)
  await endingCard.getByRole('button', { name: '在玩法设置中编辑' }).click()
  assert.deepEqual(await page.evaluate(() => window.__p3Fixture.panels), ['gameplay'])

  // 显示人格结果 is now enabled because the test is on.
  await endingCard.getByLabel('显示人格结果').check()
  await page.waitForFunction(() => window.__p3Fixture.patches.some((patch) => patch.label === '设置显示人格结果'))
  assert.deepEqual((await lastPatch(page, '设置显示人格结果')).patch, { showPersonality: true })

  // 6. Scene save point: box, name and cover; the map count then sees it.
  await sceneCard.getByRole('checkbox', { name: '存档点', exact: true }).check()
  await sceneCard.getByLabel('存档点名称').fill('雨夜存档')
  await sceneCard.locator('.nori-story-save-point input[type="file"]').setInputFiles(PNG)
  await waitImage(page, '.nori-story-save-point', '/uploads/frame.png')
  assert.deepEqual((await lastPatch(page, '重命名存档点')).patch, { savePoint: { enabled: true, name: '雨夜存档', coverUrl: null } })
  await page.waitForFunction(() => {
    const entries = window.__p3Fixture.patches.filter((patch) => patch.label === '更换存档点封面')
    return entries.at(-1)?.patch.savePoint?.coverUrl === '/uploads/frame.png'
  })
  await page.waitForFunction(() => !document.querySelector('[data-id="scene-1"]')?.textContent?.includes('地图未开启，存档点暂不生效'))
  assert.equal(await sceneCard.getByText('地图未开启，存档点暂不生效').count(), 0)
  await tab(/地图/).click()
  assert.match(await page.locator('.nori-ix-map-count').textContent(), /已标记\s*1\s*个存档点/)
  assert.equal(await page.getByText('还没有片段标记为存档点').count(), 0)

  // 7. Option personality tags: one letter per pair, second click clears, key removed when empty.
  assert.equal(await choiceCard.locator('.nori-story-tag-chip').count(), 16)
  const tag = (letter, index = 0) => choiceCard.getByLabel(`人格标签 ${letter}`).nth(index)
  await tag('E').click()
  await page.waitForFunction(() => window.__p3Fixture.patches.filter((patch) => patch.label === '设置人格标签').length === 1)
  assert.deepEqual((await lastPatch(page, '设置人格标签')).patch.options[0].tags, ['E'])
  await tag('I').click()
  await page.waitForFunction(() => window.__p3Fixture.patches.filter((patch) => patch.label === '设置人格标签').length === 2)
  assert.deepEqual((await lastPatch(page, '设置人格标签')).patch.options[0].tags, ['I'])
  await tag('S').click()
  await page.waitForFunction(() => window.__p3Fixture.patches.filter((patch) => patch.label === '设置人格标签').length === 3)
  assert.deepEqual((await lastPatch(page, '设置人格标签')).patch.options[0].tags, ['I', 'S'])
  await tag('I').click()
  await tag('S').click()
  await page.waitForFunction(() => window.__p3Fixture.patches.filter((patch) => patch.label === '设置人格标签').length === 5)
  assert.equal('tags' in (await lastPatch(page, '设置人格标签')).patch.options[0], false)
  assert.equal(await tag('E').getAttribute('aria-pressed'), 'false')
  assert.equal(await tag('I').getAttribute('aria-pressed'), 'false')
  await tag('E').click()
  await page.waitForFunction(() => window.__p3Fixture.patches.filter((patch) => patch.label === '设置人格标签').length === 6)
  assert.deepEqual((await lastPatch(page, '设置人格标签')).patch.options[0].tags, ['E'])
  assert.equal(await tag('E').getAttribute('aria-pressed'), 'true')
  assert.equal(await tag('I').getAttribute('aria-pressed'), 'false')

  await page.screenshot({ path: path.join(artifacts, 'editor.png'), fullPage: true })
  assert.deepEqual(errors, [], `console errors:\n${errors.join('\n')}`)

  // 8. Read-only: every P3 control is disabled and there is nothing to save.
  const readonly = await browser.newPage({ viewport: { width: 1600, height: 1400 } })
  const readonlyErrors = consoleErrors(readonly)
  await readonly.route('**/api/interactive/work-1/assets', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/uploads/frame.png' }) }))
  await readonly.goto(`${base}/?readonly=1&seed=full`, { waitUntil: 'networkidle' })
  await readonly.waitForSelector('[data-id="choice-1"]', { timeout: 20_000 })
  const readonlyEnding = readonly.locator('[data-id="ending-1"]')
  const readonlyScene = readonly.locator('[data-id="scene-1"]')
  const readonlyChoice = readonly.locator('[data-id="choice-1"]')
  assert.equal(await readonlyEnding.getByLabel('设为成就').isDisabled(), true)
  assert.equal(await readonlyEnding.getByLabel('设为成就').isChecked(), true)
  assert.equal(await readonlyEnding.getByLabel('显示人格结果').isDisabled(), true)
  assert.equal(await readonlyScene.getByRole('checkbox', { name: '存档点', exact: true }).isDisabled(), true)
  assert.equal(await readonlyChoice.locator('.nori-story-tag-chip').count(), 16)
  assert.equal(await readonlyChoice.getByLabel('人格标签 E').first().isDisabled(), true)
  await readonly.getByRole('tab', { name: /^成就/ }).click()
  assert.equal(await readonly.getByLabel('成就名称').first().isEditable(), false)
  assert.equal(await readonly.getByRole('button', { name: '添加成就' }).count(), 0)
  assert.equal(await readonly.locator('.nori-ix-gameplay').getByRole('button', { name: '保存', exact: true }).count(), 0)
  await readonly.getByRole('tab', { name: /人格测试/ }).click()
  assert.equal(await readonly.getByLabel('ENFP 结果名称').isEditable(), false)
  assert.equal(await readonly.getByLabel('开启人格测试').isDisabled(), true)
  await readonly.getByRole('tab', { name: /地图/ }).click()
  assert.equal(await readonly.getByLabel('开启地图和存档').isDisabled(), true)
  await readonly.getByRole('tab', { name: /商城/ }).click()
  assert.equal(await readonly.getByLabel('商品奖励称号').isEditable(), false)
  await readonly.screenshot({ path: path.join(artifacts, 'readonly.png'), fullPage: true })
  assert.deepEqual(readonlyErrors, [], `read-only console errors:\n${readonlyErrors.join('\n')}`)

  // 9. An old config gains nothing: visiting every new tab leaves the save log empty.
  const legacy = await browser.newPage({ viewport: { width: 1600, height: 1400 } })
  const legacyErrors = consoleErrors(legacy)
  await legacy.goto(`${base}/?old=1`, { waitUntil: 'networkidle' })
  await legacy.waitForSelector('[data-id="choice-1"]', { timeout: 20_000 })
  assert.equal(await legacy.locator('.nori-story-tag-chips').count(), 0)
  assert.equal(await legacy.locator('[data-id="ending-1"]').getByLabel('显示人格结果').isDisabled(), true)
  await legacy.getByRole('tab', { name: /^成就/ }).click()
  assert.equal(await legacy.locator('.nori-ix-ach-card').count(), 0)
  assert.equal(await legacy.getByRole('button', { name: '添加成就' }).isEnabled(), true)
  assert.equal(await legacy.getByRole('tab', { name: /人格测试/ }).click().then(() => legacy.getByLabel('开启人格测试').isChecked()), false)
  await legacy.getByRole('tab', { name: /地图/ }).click()
  assert.equal(await legacy.getByLabel('开启地图和存档').isChecked(), false)
  assert.equal(await legacy.evaluate(() => window.__p3Fixture.saves.length), 0)
  await legacy.getByRole('tab', { name: /^成就/ }).click()
  assert.equal(await legacy.locator('.nori-ix-gameplay').getByRole('button', { name: '保存', exact: true }).isDisabled(), true)
  assert.deepEqual(legacyErrors, [], `old config console errors:\n${legacyErrors.join('\n')}`)

  // 10. 390px settings panel: no horizontal overflow, screenshot sanity.
  const narrow = await browser.newPage({ viewport: { width: 390, height: 900 } })
  const narrowErrors = consoleErrors(narrow)
  await narrow.goto(`${base}/?panel=1`, { waitUntil: 'networkidle' })
  await narrow.getByRole('tab', { name: /^成就/ }).click()
  await narrow.getByRole('button', { name: '添加成就' }).click()
  await narrow.waitForFunction(() => document.querySelectorAll('.nori-ix-ach-card').length === 1)
  await narrow.getByRole('tab', { name: /人格测试/ }).click()
  await narrow.getByLabel('开启人格测试').check()
  const overflow = await narrow.evaluate(() => ({
    page: document.documentElement.scrollWidth,
    panel: document.querySelector('.nori-ix-gameplay').scrollWidth,
    client: document.querySelector('.nori-ix-gameplay').clientWidth,
  }))
  assert.ok(overflow.page <= 390, `page overflows at 390px: ${overflow.page}`)
  assert.ok(overflow.panel <= overflow.client, `panel overflows at 390px: ${overflow.panel} > ${overflow.client}`)
  await narrow.screenshot({ path: path.join(artifacts, 'panel-390.png'), fullPage: true })
  assert.deepEqual(narrowErrors, [], `390px console errors:\n${narrowErrors.join('\n')}`)

  console.log('story-p3-editor: all checks passed')
} finally {
  await browser.close()
  server.close()
}
