// Story interaction cards (快速点击 / 方向滑动 / 时机点击 / 长按蓄力 / 限时抉择) and the
// scene timeline in headless Chromium. The asset upload route is mocked: no real uploads.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/story-interaction-nodes')
await mkdir(artifacts, { recursive: true })
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/story-interaction-nodes.fixture.tsx'], bundle: true, write: false,
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

const card = (page, id) => page.locator(`[data-id="${id}"]`)
const visible = async (locator, what) => {
  try {
    await locator.first().waitFor({ state: 'visible', timeout: 10_000 })
  } catch (cause) {
    throw new Error(`missing ${what}`, { cause })
  }
}
const field = (page, id, label) => card(page, id).getByLabel(label)

try {
  const page = await browser.newPage({ viewport: { width: 1600, height: 1300 } })
  await page.route('**/api/interactive/work-1/assets', async (route) => {
    uploads.push({ method: route.request().method(), headers: route.request().headers() })
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ url: '/uploads/button.png' }) })
  })
  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('[data-id="i-tap"]', { timeout: 20_000 })

  // 1. every kind renders its own fields and result ports.
  await visible(card(page, 'i-tap').getByText('次数', { exact: true }), 'tap count label')
  await visible(card(page, 'i-tap').getByText('按钮图片', { exact: true }), 'tap image label')
  await visible(card(page, 'i-swipe').getByRole('radiogroup', { name: '滑动方向' }), 'swipe direction group')
  await visible(card(page, 'i-swipe').getByRole('radio', { name: '向上' }), 'swipe up')
  await visible(card(page, 'i-timing').getByText('道具图片', { exact: true }), 'timing prop image')
  await visible(card(page, 'i-hold').getByText('过量失败'), 'hold overcharge')
  await visible(card(page, 'i-choice').getByText('超时选', { exact: true }), 'choice timeout default')
  assert.equal(await field(page, 'i-tap', '次数').inputValue(), '10')
  assert.equal(await field(page, 'i-timing', '指针速度').inputValue(), '1')
  assert.equal(await field(page, 'i-timing', '完美区（%）').inputValue(), '10')
  assert.equal(await field(page, 'i-timing', '普通区（%）').inputValue(), '30')
  assert.equal(await field(page, 'i-hold', '蓄力时长（秒）').inputValue(), '2')
  assert.equal(await field(page, 'i-hold', '松手最小（%）').inputValue(), '80')
  assert.equal(await field(page, 'i-hold', '松手最大（%）').inputValue(), '100')
  assert.equal(await card(page, 'i-swipe').getByRole('radio', { name: '向上' }).getAttribute('aria-checked'), 'true')
  for (const label of ['成功', '失败']) await visible(card(page, 'i-tap').getByText(label, { exact: true }), `tap result ${label}`)
  for (const label of ['完美', '普通', '失误']) await visible(card(page, 'i-timing').getByText(label, { exact: true }), `timing result ${label}`)
  assert.equal(await card(page, 'i-choice').getByPlaceholder('选项一').inputValue(), '冲出去')
  await visible(card(page, 'i-choice').locator('[data-testid="choice-panel"]'), 'choice preview')
  assert.equal(await card(page, 'i-tap').getByText('挂在「电梯逃生」').count(), 1)
  assert.equal(await card(page, 'i-tap').getByLabel('成功切换时机').count(), 1)
  assert.equal(await card(page, 'i-tap').getByLabel('失败切换时机').count(), 1)

  // 2. the timeline renders one solid block per mounted beat.
  assert.equal(await card(page, 'scene-1').locator('.nori-story-beat-block').count(), 5)
  assert.equal(await page.locator('[data-testid="story-beat-i-tap"]').evaluate((element) => getComputedStyle(element).backgroundColor), 'rgb(163, 230, 53)')
  assert.equal(await page.locator('[data-testid="story-beat-i-tap"]').getAttribute('title'), '快速点击 · 第 5–8 秒')

  // 3. editing start / duration clamps to the video and warns about overlaps.
  const startInput = card(page, 'i-tap').locator('[data-testid="interaction-start"]')
  const durationInput = card(page, 'i-tap').locator('[data-testid="interaction-duration"]')
  await startInput.fill('999')
  assert.equal(await startInput.inputValue(), '57')
  await durationInput.fill('-3')
  assert.equal(await durationInput.inputValue(), '0.5')
  await startInput.fill('10')
  await visible(card(page, 'i-tap').getByText('与「方向滑动」重叠'), 'overlap warning')
  await visible(card(page, 'i-bad').getByText('超出视频时长'), 'outside-video warning')
  assert.equal(await card(page, 'i-bad').locator('[data-testid="interaction-start"]').inputValue(), '18')

  // 4. unknown video length degrades to chips, an empty scene invites adding, an unmounted stop only has 限时.
  await visible(card(page, 'scene-3').locator('[data-testid="story-beat-chip-i-free"]'), 'unknown-length chip')
  await visible(card(page, 'scene-3').getByText('视频时长未知：在互动节点里填写开始秒数'), 'unknown-length note')
  await visible(card(page, 'scene-4').getByText('在底部互动口添加互动'), 'empty timeline hint')
  await visible(card(page, 'i-unmounted').getByText('未挂载：接在上一步之后，上一步结束时触发'), 'unmounted status')
  assert.equal(await card(page, 'i-unmounted').locator('[data-testid="interaction-start"]').count(), 0)
  assert.equal(await card(page, 'i-unmounted').locator('[data-testid="interaction-duration"]').inputValue(), '3')

  // 5. dragging a block commits exactly one startSec, snapped clear of its neighbour.
  await startInput.fill('5')
  await durationInput.fill('3')
  await page.waitForFunction(() => document.querySelector('[data-testid="story-beat-i-tap"]')?.getAttribute('data-start-sec') === '5')
  const block = page.locator('[data-testid="story-beat-i-tap"]')
  const track = page.locator('[data-testid="story-beat-track-scene-1"]')
  const blockBox = await block.boundingBox()
  const trackBox = await track.boundingBox()
  assert.ok(blockBox && trackBox, 'timeline geometry')
  await page.mouse.move(blockBox.x + blockBox.width / 2, blockBox.y + blockBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(blockBox.x + blockBox.width / 2 + trackBox.width * 0.1, blockBox.y + blockBox.height / 2, { steps: 10 })
  await page.mouse.up()
  await page.waitForFunction(() => document.querySelector('[data-testid="story-beat-i-tap"]')?.getAttribute('data-start-sec') === '7')
  const commits = await page.evaluate(() => window.__storyFixture.patches.filter((patch) => patch.nodeId === 'i-tap' && patch.label === '调整互动时间'))
  assert.equal(commits.length, 1)
  assert.equal(commits[0].patch.startSec, 7)
  const neighbourStart = Number(await page.locator('[data-testid="story-beat-i-swipe"]').getAttribute('data-start-sec'))
  assert.ok(7 + 3 <= neighbourStart, 'drag kept the windows apart')

  // 6. clicking a block focuses its interaction node.
  await block.click()
  assert.ok((await page.evaluate(() => window.__storyFixture.focused)).includes('i-tap'))

  // 7. the choice preview follows the layout and style toggles; mounted options carry cut/retry.
  const choicePreview = card(page, 'i-choice').locator('[data-testid="choice-panel"]')
  assert.equal(await choicePreview.getAttribute('data-layout'), 'vertical')
  await card(page, 'i-choice').locator('[data-testid="choice-layout"]').selectOption('horizontal')
  assert.equal(await choicePreview.getAttribute('data-layout'), 'horizontal')
  await card(page, 'i-choice').locator('[data-testid="choice-layout"]').selectOption('vertical')
  assert.equal(await choicePreview.getAttribute('data-layout'), 'vertical')
  await card(page, 'i-choice').locator('[data-testid="choice-style"]').selectOption('both')
  assert.equal(await choicePreview.getAttribute('data-panel-style'), 'both')
  assert.equal(await card(page, 'i-choice').locator('[aria-label="选项切换时机"]').count(), 2)
  await card(page, 'i-choice').locator('[aria-label="选项切换时机"]').first().selectOption('after')
  const whenPatch = await page.evaluate(() => {
    const entries = window.__storyFixture.patches.filter((patch) => patch.nodeId === 'i-choice' && patch.label === '设置选项切换时机')
    return entries.at(-1)?.patch.options?.[0]?.when
  })
  assert.equal(whenPatch, 'after')
  await card(page, 'i-choice').locator('[data-testid="choice-countdown"]').selectOption('5')
  assert.equal(await card(page, 'i-choice').locator('[data-testid="interaction-duration"]').inputValue(), '5')

  // 8. uploading a picture posts to the work's asset endpoint and stores the returned url.
  await card(page, 'i-tap').locator('input[type="file"]').setInputFiles({
    name: 'button.png',
    mimeType: 'image/png',
    buffer: Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex'),
  })
  await page.waitForFunction(() => window.__storyFixture.patches.some((patch) => patch.nodeId === 'i-tap' && patch.patch.buttonImageUrl === '/uploads/button.png'))
  assert.equal(uploads.length, 1)
  assert.equal(uploads[0].method, 'POST')
  assert.match(uploads[0].headers['content-type'] || '', /multipart\/form-data/)
  await page.waitForFunction(() => document.querySelector('[data-id="i-tap"] .nori-story-image-thumb img')?.getAttribute('src') === '/uploads/button.png')

  await page.screenshot({ path: path.join(artifacts, 'editor.png'), fullPage: true })

  // 9. read-only blocks every edit and every upload.
  const readonly = await browser.newPage({ viewport: { width: 1600, height: 1300 } })
  await readonly.goto(`${base}/?readonly=1`, { waitUntil: 'networkidle' })
  await readonly.waitForSelector('[data-id="i-tap"]', { timeout: 20_000 })
  assert.equal(await card(readonly, 'i-tap').locator('[data-testid="interaction-start"]').isDisabled(), true)
  assert.equal(await card(readonly, 'i-tap').locator('[data-testid="interaction-duration"]').isDisabled(), true)
  assert.equal(await card(readonly, 'i-tap').locator('[data-testid="story-image-upload"]').isDisabled(), true)
  assert.equal(await card(readonly, 'i-tap').getByRole('radio', { name: '慢放' }).isDisabled(), true)
  const readonlyBlock = readonly.locator('[data-testid="story-beat-i-tap"]')
  const readonlyBox = await readonlyBlock.boundingBox()
  const readonlyTrack = await readonly.locator('[data-testid="story-beat-track-scene-1"]').boundingBox()
  assert.ok(readonlyBox && readonlyTrack, 'read-only timeline geometry')
  await readonly.mouse.move(readonlyBox.x + readonlyBox.width / 2, readonlyBox.y + readonlyBox.height / 2)
  await readonly.mouse.down()
  await readonly.mouse.move(readonlyBox.x + readonlyBox.width / 2 + readonlyTrack.width * 0.1, readonlyBox.y + readonlyBox.height / 2, { steps: 5 })
  await readonly.mouse.up()
  assert.equal(await readonly.evaluate(() => window.__storyFixture.patches.length), 0)
  await readonlyBlock.click()
  assert.ok((await readonly.evaluate(() => window.__storyFixture.focused)).includes('i-tap'))
  await readonly.screenshot({ path: path.join(artifacts, 'readonly.png'), fullPage: true })

  console.log('story-interaction-nodes: all checks passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
