// 影游 P3 viewer side in headless Chromium: achievements + toasts, the MBTI result, shop
// rewards kept forever, the map and saves, scoped storage and the returning-viewer prompt.
// Media is inline SVG data URLs only: no generation, no paid calls, no production data changes.
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/story-player-p3')
await mkdir(artifacts, { recursive: true })

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/story-player-p3.fixture.tsx'], bundle: true, write: false,
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
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  if (pathname === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(script)
  } else if (pathname === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css')
    response.end(css)
  } else {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#root{height:100%;margin:0;background:#0d0f14;color:#f4f4f5;font-family:system-ui,sans-serif}</style>
<link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>`)
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 390, height: 844 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(message.text())
})

async function until(check, message, timeout = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

const shot = (name) => page.screenshot({ path: path.join(artifacts, name) })
const PROFILE_PREFIX = 'nori.story.profile.v1'
const SAVES_PREFIX = 'nori.story.saves.v1'
const profileKey = (scope) => `${PROFILE_PREFIX}:${scope}`
const savesKey = (scope) => `${SAVES_PREFIX}:${scope}`

const stored = (key) => page.evaluate((name) => {
  const raw = localStorage.getItem(name)
  return raw ? JSON.parse(raw) : null
}, key)
const storedKeys = () => page.evaluate(() => Object.keys(localStorage))
const hudFrame = () => page.locator('.nori-hud-avatar [data-testid="player-avatar"]').getAttribute('data-frame-url')
const hudTitle = () => page.locator('[data-testid="hud-title"]')
const sideValue = (id) => page.locator(`[data-variable-id="${id}"] td:nth-child(2)`).textContent()

/** Fresh browser storage (optionally one seeded record), then the requested scenario. */
async function open(name, { seedKey = null, seed = null, width = 390, height = 844 } = {}) {
  await page.setViewportSize({ width, height })
  await page.goto(`${base}/?scenario=empty`)
  await page.evaluate(({ key, value }) => {
    localStorage.clear()
    if (key && value !== null) localStorage.setItem(key, JSON.stringify(value))
  }, { key: seedKey, value: seed })
  await page.goto(`${base}/?scenario=${name}`)
}

async function waitHud() {
  await page.locator('[data-testid="player-hud"]').waitFor({ timeout: 10000 })
}

async function clickContinue() {
  const button = page.locator('.nori-player-continue')
  await button.waitFor({ timeout: 8000 })
  await button.click()
}

async function reachChoice() {
  await clickContinue()
  await page.locator('[data-testid="choice-panel"]').waitFor({ timeout: 8000 })
}

async function choose(id) {
  await page.locator(`[data-option-id="${id}"]`).click()
}

async function reachGoodEnding() {
  await reachChoice()
  await choose('a')
  await clickContinue()
  await page.locator('.nori-player-card.is-ending').waitFor({ timeout: 8000 })
}

async function assertSheetFits(testId) {
  const sheet = page.locator(`[data-testid="${testId}"]`)
  await sheet.waitFor()
  const panel = sheet.locator('.nori-records-panel')
  const box = await panel.boundingBox()
  const viewport = page.viewportSize()
  assert.ok(box && viewport, `${testId} panel must render`)
  assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    `${testId} panel must fit ${viewport.width}x${viewport.height}`)
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal page overflow')
  assert.ok(await panel.evaluate((element) => element.scrollWidth <= element.clientWidth + 1), `${testId} must not scroll horizontally`)
}

async function assertNoGradients(label) {
  const gradientElements = await page.locator('body *').evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element)
    return ['backgroundImage', 'maskImage'].some((property) => style[property].includes('gradient('))
      ? [String(element.className || element.tagName)]
      : []
  }))
  assert.deepEqual(gradientElements, [], `${label} must use solid colours only`)
}

try {
  /* ---------- A. an old work: no records UI, no prompt, no nori.story.* keys ---------- */
  await open('old')
  await waitHud()
  assert.equal(await page.locator('[data-testid="hud-achievements"]').count(), 0, 'an old work must not show the avatar button')
  assert.equal(await page.locator('[data-testid="hud-map"]').count(), 0, 'a work without a map must not show the map button')
  assert.equal(await page.locator('[data-testid="hud-shop"]').count(), 1, 'the plain shop stays')
  assert.equal(await page.locator('[data-testid="continue-prompt"]').count(), 0, 'a new visitor sees no continue prompt')
  await reachChoice()
  await choose('c')
  await page.locator('.nori-player-card.is-ending').waitFor({ timeout: 8000 })
  await page.waitForTimeout(300)
  assert.deepEqual(await storedKeys(), [], 'an old work must never write nori.story.* records')
  await shot('old-work-ending.png')
  await page.locator('[data-testid="close-player"]').click()
  await page.locator('#reopen').click()
  await waitHud()
  assert.equal(await page.locator('[data-testid="continue-prompt"]').count(), 0, 'reopening an old work must not prompt')

  /* ---------- B. the MBTI result on a flagged ending, and nothing without the flag/test ---------- */
  await open('full')
  await reachGoodEnding()
  const personality = page.locator('[data-testid="personality-card"]')
  await personality.waitFor()
  assert.equal(await personality.getAttribute('data-type'), 'ENFP')
  assert.equal((await page.locator('[data-testid="personality-type"]').textContent()).trim(), 'ENFP')
  assert.equal((await page.locator('[data-testid="personality-name"]').textContent()).trim(), '热情家')
  assert.ok(((await page.locator('[data-testid="personality-description"]').textContent()) || '').includes('一路热情'))
  assert.equal(await page.locator('.nori-player-card.has-personality').count(), 1)
  assert.ok(await page.locator('.nori-player-card.is-ending').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'the result card must not overflow')
  await shot('personality-portrait.png')

  for (const scenario of ['no-personality', 'personality-off', 'unflagged']) {
    await open(scenario)
    await reachGoodEnding()
    assert.equal(await page.locator('[data-testid="personality-card"]').count(), 0, `${scenario} must not show a result card`)
    assert.equal(await page.locator('.nori-player-card.has-personality').count(), 0)
  }

  /* ---------- C. achievements: toast, progress, all achievements, persistence, wardrobe ---------- */
  await open('full')
  await waitHud()
  const firstToast = page.locator('[data-testid="achievement-toast"]')
  await firstToast.waitFor({ timeout: 8000 })
  assert.equal(await firstToast.getAttribute('data-achievement-id'), 'a_first')
  const firstToastText = await firstToast.textContent()
  assert.ok(firstToastText.includes('初见雨夜'), 'the toast names the achievement')
  assert.ok(firstToastText.includes('成就达成'))
  assert.equal(await firstToast.getAttribute('role'), 'status')
  assert.equal((await page.locator('[data-testid="hud-achievement-badge"]').textContent()).trim(), '1/7')
  await shot('achievement-toast.png')

  await reachGoodEnding()
  await page.locator('[data-testid="hud-title"]').waitFor({ timeout: 8000 })
  assert.equal((await hudTitle().textContent()).trim(), '最强王者', 'the earned title goes on at once')
  const goldFrame = await page.locator('[data-testid="hud-achievements"] [data-testid="player-avatar"]').getAttribute('data-frame-url')
  assert.ok(goldFrame && goldFrame.startsWith('data:image/svg+xml'), 'the earned frame is drawn around the avatar')

  await page.locator('.nori-player-card.is-ending button', { hasText: '重新开始' }).click()
  await page.locator('.nori-player-continue').waitFor({ timeout: 8000 })
  await reachChoice()
  await choose('c')
  await page.locator('.nori-player-card.is-bad').waitFor({ timeout: 8000 })
  await until(async () => (await page.locator('[data-testid="hud-achievement-badge"]').textContent()).trim() === '7/7', 'all seven achievements must be earned')
  await shot('all-achievements-ending.png')

  await page.locator('[data-testid="hud-achievements"]').click()
  await page.locator('[data-testid="achievements-sheet"]').waitFor()
  assert.equal((await page.locator('[data-testid="achievement-progress"]').textContent()).trim(), '7/7')
  assert.equal(await page.locator('[data-testid="achievement-item"]').count(), 7)
  assert.equal(await page.locator('[data-testid="achievement-item"][data-earned="true"]').count(), 7)
  assert.equal(await page.locator('[data-testid="achievement-item"][data-earned="false"]').count(), 0)
  assert.equal(await page.locator('[data-testid="cosmetic-frame"]').count(), 2, 'the good ending and the all-achievements frame are owned')
  assert.equal(await page.locator('[data-testid="cosmetic-title"]').count(), 3, 'the good ending, all endings and all achievements titles are owned')
  assert.ok((await page.locator('[data-testid="achievement-hero"]').textContent()).includes('称号「最强王者」'))
  await assertSheetFits('achievements-sheet')
  await assertNoGradients('the achievements sheet')

  const crownEquip = page.locator('[data-testid="equip-cosmetic"][data-part="frame"][data-cosmetic-id="a:a_all"]')
  await crownEquip.click()
  await until(async () => (await hudFrame()) !== goldFrame, 'equipping the crown must change the HUD frame')
  const crownFrame = await hudFrame()
  assert.ok(crownFrame && crownFrame !== goldFrame)
  await page.locator('[data-testid="unequip-frame"]').click()
  await until(async () => (await hudFrame()) === '', 'unequipping must remove the frame')
  await page.locator('[data-testid="equip-cosmetic"][data-part="frame"][data-cosmetic-id="a:a_all"]').click()
  await until(async () => (await hudFrame()) === crownFrame, 'the crown must go back on')
  await page.locator('[data-testid="equip-cosmetic"][data-part="title"][data-cosmetic-id="a:a_all"]').click()
  await until(async () => (await hudTitle().count()) === 1 && (await hudTitle().textContent()).trim() === '通关达人', 'equipping the title must show it in the HUD')
  await page.locator('[data-testid="unequip-title"]').click()
  await until(async () => (await hudTitle().count()) === 0, 'unequipping the title must remove it')
  await shot('achievements-sheet-portrait.png')

  await page.keyboard.press('Escape')
  await page.locator('[data-testid="achievements-sheet"]').waitFor({ state: 'detached', timeout: 4000 })
  assert.equal(await page.locator('.nori-player').count(), 1, 'Esc must close the sheet before the player')

  await page.reload()
  await waitHud()
  assert.equal((await page.locator('[data-testid="hud-achievement-badge"]').textContent()).trim(), '7/7', 'achievements must survive a reload')
  assert.equal(await hudTitle().count(), 0, 'an unequipped title stays off after a reload')
  assert.equal(await hudFrame(), crownFrame, 'the equipped frame survives a reload')
  const storedProfile = await stored(profileKey('p3-full'))
  assert.equal(storedProfile.achievements.length, 7)
  assert.deepEqual(storedProfile.equipped, { title: null, frame: 'a:a_all' })

  /* ---------- D. a shop reward stays owned and sold out, across reloads ---------- */
  await open('full')
  await waitHud()
  await page.locator('[data-testid="hud-shop"]').click()
  await page.locator('[data-testid="shop-sheet"]').waitFor()
  const frameItem = page.locator('[data-testid="shop-item-s_frame"]')
  await page.locator('[data-testid="shop-buy-s_frame"]').click()
  await until(async () => (await frameItem.locator('.nori-shop-item-owned').count()) === 1, 'the bought frame must be owned')
  assert.ok((await frameItem.textContent()).includes('已拥有 ×1'))
  assert.ok((await frameItem.textContent()).includes('已售罄'))
  assert.equal(await page.locator('[data-testid="shop-buy-s_frame"]').isDisabled(), true)
  assert.equal((await sideValue('coin')).trim(), '0', 'a zero-price reward does not move the currency')
  await until(async () => (await hudFrame()) !== '', 'a bought frame goes on at once')
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="shop-sheet"]').waitFor({ state: 'detached', timeout: 4000 })
  assert.equal(await page.locator('.nori-player').count(), 1, 'Esc must close the shop before the player')

  await page.locator('[data-testid="hud-achievements"]').click()
  await page.locator('[data-testid="achievements-sheet"]').waitFor()
  const boughtFrame = page.locator('[data-testid="cosmetic-frame"][data-cosmetic-id="s:s_frame"]')
  await boughtFrame.waitFor()
  assert.equal(await boughtFrame.getAttribute('data-source'), 'shop')
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="achievements-sheet"]').waitFor({ state: 'detached', timeout: 4000 })
  await shot('shop-reward-bought.png')

  await page.reload()
  await waitHud()
  assert.ok((await hudFrame()) !== '', 'the bought frame survives a reload')
  await page.locator('[data-testid="hud-shop"]').click()
  await page.locator('[data-testid="shop-sheet"]').waitFor()
  const reloadedItem = page.locator('[data-testid="shop-item-s_frame"]')
  assert.ok((await reloadedItem.textContent()).includes('已售罄'), 'a bought reward is sold out forever')
  assert.equal(await page.locator('[data-testid="shop-buy-s_frame"]').isDisabled(), true)
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="shop-sheet"]').waitFor({ state: 'detached', timeout: 4000 })

  /* ---------- E. map + saves: unlock, checkpoint, manual save, prompt, no double effects ---------- */
  await open('map')
  await waitHud()
  assert.equal(await page.locator('[data-testid="hud-map"]').count(), 1)
  assert.equal(await page.locator('[data-testid="hud-achievements"]').count(), 0)
  assert.equal(await page.locator('[data-testid="hud-shop"]').count(), 0)
  await until(async () => {
    const saves = await stored(savesKey('p3-map'))
    return Boolean(saves?.auto && saves?.checkpoints?.['p:s1'])
  }, 'entering the first save point must record the auto save and its checkpoint')
  const savesAtStart = await stored(savesKey('p3-map'))
  assert.equal(savesAtStart.auto.snapshot.nodeId, 's1')
  assert.ok(await stored(profileKey('p3-map')))

  await page.locator('[data-testid="hud-map"]').click()
  await page.locator('[data-testid="map-sheet"]').waitFor()
  assert.equal(await page.locator('[data-testid="map-point"]').count(), 2)
  const pointS1 = page.locator('[data-testid="map-point"][data-point-key="p:s1"]')
  const pointS2 = page.locator('[data-testid="map-point"][data-point-key="p:s2"]')
  assert.equal(await pointS1.getAttribute('data-unlocked'), 'true')
  assert.equal(await pointS1.getAttribute('data-current'), 'true')
  assert.equal(await pointS2.getAttribute('data-unlocked'), 'false')
  assert.equal(await page.locator('[data-testid="map-point"][data-point-key="p:s2"] .nori-map-cover').count(), 0, 'a locked point shows no cover')
  assert.equal((await page.locator('[data-testid="map-point"][data-point-key="p:s2"] .nori-map-no-cover').textContent()).trim(), '锁')
  assert.equal(await page.locator('[data-testid="map-resume"][data-point-key="p:s1"]').count(), 1)
  await assertSheetFits('map-sheet')
  await assertNoGradients('the map sheet')

  await page.locator('[data-testid="map-tab-saves"]').click()
  await page.locator('[data-testid="save-panel"]').waitFor()
  assert.ok((await page.locator('[data-testid="save-auto"]').textContent()).includes('第一章 · 雨夜'))
  await page.locator('[data-testid="save-write-0"]').click()
  await page.locator('[data-testid="map-notice"]').waitFor()
  assert.equal((await page.locator('[data-testid="map-notice"]').textContent()).trim(), '已保存到存档位 1')
  assert.equal(await page.locator('[data-testid="save-slot-0"]').getAttribute('data-filled'), 'true')
  assert.ok((await page.locator('[data-testid="save-slot-0"]').textContent()).includes('第一章 · 雨夜'))
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="map-sheet"]').waitFor({ state: 'detached', timeout: 4000 })
  assert.equal(await page.locator('.nori-player').count(), 1, 'Esc must close the map sheet before the player')

  await reachChoice()
  await page.waitForSelector('[data-testid="interaction-countdown"]')
  await page.waitForTimeout(300)
  const countdown = page.locator('.nori-int-countdown i')
  const widthAt = () => countdown.evaluate((element) => parseFloat(element.style.width))
  await page.locator('[data-testid="hud-map"]').click()
  await page.locator('[data-testid="map-sheet"]').waitFor()
  await page.waitForTimeout(250)
  const frozen = await widthAt()
  await page.waitForTimeout(1000)
  assert.equal(await widthAt(), frozen, 'the choice countdown must freeze while a records sheet is open')
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="map-sheet"]').waitFor({ state: 'detached', timeout: 4000 })

  await choose('a')
  await page.locator('.nori-player-continue').waitFor({ timeout: 8000 })
  assert.equal((await sideValue('coin')).trim(), '1')
  await until(async () => {
    const saves = await stored(savesKey('p3-map'))
    return Boolean(saves?.checkpoints?.['p:s2'])
  }, 'the second save point must unlock its checkpoint')

  await page.locator('[data-testid="hud-map"]').click()
  await page.locator('[data-testid="map-sheet"]').waitFor()
  assert.equal(await page.locator('[data-testid="map-point"][data-point-key="p:s2"]').getAttribute('data-unlocked'), 'true')
  assert.equal(await page.locator('[data-testid="map-point"][data-point-key="p:s2"]').getAttribute('data-current'), 'true')
  await page.locator('[data-testid="map-resume"][data-point-key="p:s2"]').click()
  await page.locator('[data-testid="map-sheet"]').waitFor({ state: 'detached', timeout: 4000 })
  await page.locator('.nori-player-continue').waitFor({ timeout: 8000 })
  assert.equal((await sideValue('coin')).trim(), '1', 'loading a save point must not re-apply its +1 effect')
  assert.ok((await page.locator('.nori-player-side').textContent()).includes('街角'))

  await page.locator('[data-testid="hud-map"]').click()
  await page.locator('[data-testid="map-sheet"]').waitFor()
  await page.locator('[data-testid="map-tab-saves"]').click()
  await page.locator('[data-testid="save-write-1"]').click()
  await until(async () => (await page.locator('[data-testid="save-slot-1"]').getAttribute('data-filled')) === 'true', 'a manual save must fill its slot')
  await page.locator('[data-testid="save-delete-0"]').click()
  await until(async () => (await page.locator('[data-testid="save-slot-0"]').getAttribute('data-filled')) === 'false', 'deleting a slot must empty it')
  assert.ok((await page.locator('[data-testid="save-slot-1"]').textContent()).includes('第一章 · 街角'))
  await page.locator('[data-testid="save-load-1"]').click()
  await page.locator('[data-testid="map-sheet"]').waitFor({ state: 'detached', timeout: 4000 })
  await page.locator('.nori-player-continue').waitFor({ timeout: 8000 })
  assert.equal((await sideValue('coin')).trim(), '1', 'loading a manual save must not re-apply the segment effect')

  await clickContinue()
  await page.locator('.nori-player-card.is-ending').waitFor({ timeout: 8000 })
  await page.locator('[data-testid="hud-map"]').click()
  await page.locator('[data-testid="map-sheet"]').waitFor()
  await page.locator('[data-testid="map-tab-saves"]').click()
  assert.equal(await page.locator('[data-testid="save-write-0"]').isDisabled(), true, 'an ending cannot be saved')
  assert.equal(await page.locator('[data-testid="auto-load"]').isDisabled(), false)
  await page.locator('[data-testid="auto-load"]').click()
  await page.locator('[data-testid="map-sheet"]').waitFor({ state: 'detached', timeout: 4000 })
  await page.locator('.nori-player-continue').waitFor({ timeout: 8000 })
  assert.equal((await sideValue('coin')).trim(), '1', 'loading the auto save must not re-apply the segment effect')
  await clickContinue()
  await page.locator('.nori-player-card.is-ending').waitFor({ timeout: 8000 })
  await shot('map-ending.png')

  await page.locator('[data-testid="close-player"]').click()
  await page.locator('#reopen').click()
  await page.locator('[data-testid="continue-prompt"]').waitFor({ timeout: 8000 })
  assert.equal(await page.locator('[data-testid="player-hud"]').count(), 0, 'the HUD is hidden behind the continue prompt')
  assert.equal(await page.locator('.nori-player-continue').count(), 0, 'the story must not start before the viewer decides')
  assert.equal((await page.locator('[data-testid="continue-where"]').textContent()).trim(), '第一章 · 街角')
  assert.equal(await page.locator('[data-testid="close-player"]').count(), 1)
  await shot('continue-prompt.png')
  await page.locator('[data-testid="continue-resume"]').click()
  await page.locator('.nori-player-continue').waitFor({ timeout: 8000 })
  assert.equal((await sideValue('coin')).trim(), '1', 'resuming must restore the saved values')

  await page.locator('.nori-player-head button', { hasText: '重新开始' }).click()
  await page.locator('.nori-player-continue').waitFor({ timeout: 8000 })
  assert.equal((await sideValue('coin')).trim(), '0', '重新开始 restarts the run')
  assert.ok(await stored(profileKey('p3-map')), '重新开始 must not clear the profile')
  assert.ok((await stored(savesKey('p3-map')))?.checkpoints?.['p:s2'], '重新开始 must not clear the save-point checkpoints')

  await page.locator('[data-testid="clear-records"]').click()
  await until(async () => (await page.locator('[data-testid="clear-records"]').count()) === 0, 'clearing records must hide the danger action')
  await page.waitForTimeout(200)
  assert.equal(await stored(profileKey('p3-map')), null, '清除成就与存档 must remove the profile')
  assert.equal(await stored(savesKey('p3-map')), null, '清除成就与存档 must remove the saves')

  /* an old automatic save of an edited story says so and lets the story start normally */
  await open('map', {
    seedKey: savesKey('p3-map'),
    seed: {
      auto: { savedAt: Date.now(), snapshot: { v: 1, mode: 'story', projectId: 'p', nodeId: 'ghost', vars: {}, trail: [] } },
      slots: [null, null, null],
      checkpoints: {},
    },
  })
  await page.locator('[data-testid="continue-notice"]').waitFor({ timeout: 8000 })
  assert.equal((await page.locator('[data-testid="continue-notice"]').textContent()).trim(), '上次的进度已失效，将从头开始')
  assert.equal(await page.locator('[data-testid="continue-prompt"]').count(), 0)
  await page.locator('.nori-player-continue').waitFor({ timeout: 8000 })
  assert.ok((await page.locator('.nori-player-side').textContent()).includes('雨夜'))
  await until(async () => (await stored(savesKey('p3-map')))?.auto?.snapshot?.nodeId === 's1', 'an unusable automatic save must be replaced by the fresh start')

  /* ---------- F. a chapter trial keeps its own storage scope ---------- */
  await open('chapter')
  await waitHud()
  assert.equal(await page.locator('[data-testid="hud-achievements"]').count(), 1)
  assert.equal(await page.locator('[data-testid="hud-map"]').count(), 1)
  await until(async () => {
    const keys = await storedKeys()
    return keys.includes(profileKey('w:chapter:p')) && keys.includes(savesKey('w:chapter:p'))
  }, 'a chapter trial must write under its chapter-scoped key')
  const chapterKeys = await storedKeys()
  assert.ok(!chapterKeys.includes(profileKey('w')), 'a chapter trial must not write the full-story profile')
  assert.ok(!chapterKeys.includes(savesKey('w')), 'a chapter trial must not write the full-story saves')
  assert.ok((await page.locator('.nori-player-mode').textContent()).includes('单章试玩'))

  /* ---------- G. portrait and landscape sheets fit, no gradients, no console errors ---------- */
  await open('full', { width: 390, height: 844 })
  await waitHud()
  await page.locator('[data-testid="hud-achievements"]').click()
  await page.locator('[data-testid="achievements-sheet"]').waitFor()
  assert.ok(((await page.locator('[data-testid="achievements-sheet"]').getAttribute('class')) || '').includes('is-portrait'))
  await assertSheetFits('achievements-sheet')
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="achievements-sheet"]').waitFor({ state: 'detached', timeout: 4000 })

  await open('full-wide', { width: 844, height: 390 })
  await waitHud()
  await page.locator('[data-testid="hud-achievements"]').click()
  const wideSheet = page.locator('[data-testid="achievements-sheet"]')
  await wideSheet.waitFor()
  assert.ok(((await wideSheet.getAttribute('class')) || '').includes('is-landscape'))
  await assertSheetFits('achievements-sheet')
  await assertNoGradients('the landscape achievements sheet')
  await shot('achievements-sheet-landscape.png')
  await page.keyboard.press('Escape')
  await wideSheet.waitFor({ state: 'detached', timeout: 4000 })
  assert.equal(await page.locator('.nori-player').count(), 1)

  await reachGoodEnding()
  await page.locator('[data-testid="personality-card"]').waitFor()
  assert.ok(await page.locator('.nori-player-card.is-ending').evaluate((element) => element.scrollWidth <= element.clientWidth + 1), 'the landscape result card must not overflow')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'no horizontal page overflow at 844x390')
  await shot('personality-landscape.png')

  await open('map-wide', { width: 844, height: 390 })
  await waitHud()
  await page.locator('[data-testid="hud-map"]').click()
  const wideMap = page.locator('[data-testid="map-sheet"]')
  await wideMap.waitFor()
  assert.ok(((await wideMap.getAttribute('class')) || '').includes('is-landscape'))
  await assertSheetFits('map-sheet')
  await page.locator('[data-testid="map-tab-saves"]').click()
  await assertSheetFits('map-sheet')
  await assertNoGradients('the landscape map sheet')
  await shot('map-sheet-landscape.png')
  await page.keyboard.press('Escape')
  await wideMap.waitFor({ state: 'detached', timeout: 4000 })
  assert.equal(await page.locator('.nori-player').count(), 1)

  assert.deepEqual(errors, [])
  console.log('[story-player-p3] records opt-in, achievements + wardrobe, personality result, shop rewards, map/saves/continue prompt, scoped storage and landscape sheets passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
