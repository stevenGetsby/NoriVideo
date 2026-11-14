// 影游 P2 player side in headless Chromium: value HUD, hidden/locked options, the shop sheet
// and permanent values. The only media is a locally generated clip served with Range support:
// no generation, no paid calls and no production data changes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/story-player-economy')
await mkdir(artifacts, { recursive: true })

const clipPath = path.join(artifacts, 'story-clip.webm')
if (!existsSync(clipPath)) {
  const ffmpeg = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg'
  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=6:size=320x180:rate=15',
    '-c:v', 'libvpx', '-b:v', '200k', '-an', clipPath,
  ], { stdio: 'ignore' })
}
const clip = await readFile(clipPath)

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/story-player-economy.fixture.tsx'], bundle: true, write: false,
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

function serveClip(request, response) {
  response.setHeader('Content-Type', 'video/webm')
  response.setHeader('Accept-Ranges', 'bytes')
  response.setHeader('Cache-Control', 'no-store')
  const range = request.headers.range
  const match = range && /^bytes=(\d*)-(\d*)$/.exec(range)
  if (match) {
    let start = match[1] === '' ? null : Number(match[1])
    let end = match[2] === '' ? null : Number(match[2])
    if (start === null && end !== null) {
      start = Math.max(0, clip.length - end)
      end = clip.length - 1
    }
    if (start === null) start = 0
    if (end === null) end = clip.length - 1
    end = Math.min(end, clip.length - 1)
    if (start > end || start >= clip.length) {
      response.statusCode = 416
      response.setHeader('Content-Range', `bytes */${clip.length}`)
      response.end()
      return
    }
    response.statusCode = 206
    response.setHeader('Content-Range', `bytes ${start}-${end}/${clip.length}`)
    response.setHeader('Content-Length', end - start + 1)
    if (request.method === 'HEAD') {
      response.end()
      return
    }
    response.end(clip.subarray(start, end + 1))
    return
  }
  response.setHeader('Content-Length', clip.length)
  if (request.method === 'HEAD') {
    response.end()
    return
  }
  response.end(clip)
}

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  if (pathname === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(script)
  } else if (pathname === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css')
    response.end(css)
  } else if (pathname === '/story-clip.webm') {
    serveClip(request, response)
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

async function until(check, message, timeout = 10000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(message)
}

const shot = (name) => page.screenshot({ path: path.join(artifacts, name) })
const PERMANENT_PREFIX = 'nori.story.permanent.v1'

/** Fresh browser storage scoped per work, then a fresh player. */
async function open(name, { storageKey = null, seed = null, width = 390, height = 844 } = {}) {
  await page.setViewportSize({ width, height })
  await page.goto(`${base}/?scenario=empty`)
  await page.evaluate(({ key, value }) => {
    localStorage.clear()
    if (key && value) localStorage.setItem(key, JSON.stringify(value))
  }, { key: storageKey, value: seed })
  await page.goto(`${base}/?scenario=${name}`)
  await page.waitForSelector('[role="dialog"]')
}

/** The vault story starts on a video scene: 继续 (or the video ending) lands on the door choice. */
async function reachDoor() {
  const panel = page.locator('[data-testid="choice-panel"]')
  if ((await panel.count()) === 0) {
    await page.locator('.nori-player-continue').first().click({ timeout: 3000 }).catch(() => {})
  }
  await panel.waitFor({ timeout: 12000 })
  await page.locator('[data-option-id="o_push"]').waitFor({ timeout: 5000 })
}

/** A real pointer tap; Playwright's locator.click refuses aria-disabled cards even though the DOM allows the tap. */
async function tapCard(optionId) {
  const box = await page.locator(`[data-option-id="${optionId}"]`).boundingBox()
  assert.ok(box, `choice card ${optionId} must render`)
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2)
}

const sideValue = (id) => page.locator(`[data-variable-id="${id}"] td:nth-child(2)`).textContent()
const storedPermanent = (storageKey) => page.evaluate((key) => {
  const raw = localStorage.getItem(key)
  return raw ? JSON.parse(raw) : null
}, `${PERMANENT_PREFIX}:${storageKey}`)

try {
  /* ---------- 1. HUD, locked card, shop focus and Esc in portrait ---------- */
  await open('vault')
  await page.waitForSelector('[data-testid="player-hud"]')
  const coinChip = page.locator('[data-testid="hud-variable-coin"]')
  await coinChip.waitFor()
  assert.equal((await coinChip.locator('.nori-hud-value').textContent()).trim(), '3')
  assert.equal(await coinChip.getAttribute('title'), '金币')
  const chipText = await coinChip.textContent()
  assert.ok(chipText.includes('🪙'), 'the coin chip must show the emoji icon')
  assert.ok(chipText.includes('/10'), 'the coin chip must show its cap')
  assert.equal(await page.locator('[data-testid="hud-shop"]').count(), 1)
  assert.equal(await page.locator('[data-testid="player-hud"]').evaluate((element) => getComputedStyle(element).pointerEvents), 'none')
  assert.equal(await page.locator('[data-testid="hud-shop"]').evaluate((element) => getComputedStyle(element).pointerEvents), 'auto')
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), 'the HUD must not widen the phone layout')
  await shot('hud-portrait.png')

  await reachDoor()
  const pushCard = page.locator('[data-option-id="o_push"]')
  const lockedCard = page.locator('[data-option-id="o_open"]')
  assert.equal(await pushCard.getAttribute('data-locked'), null)
  assert.equal(await lockedCard.getAttribute('data-locked'), 'true')
  assert.equal(await lockedCard.getAttribute('aria-disabled'), 'true')
  assert.ok(((await lockedCard.getAttribute('class')) || '').includes('is-locked'))
  assert.equal(await lockedCard.getAttribute('disabled'), null, 'a locked card must not use the native disabled attribute')
  assert.equal(await lockedCard.locator('.nori-choice-option-lock').count(), 1)
  assert.ok((await lockedCard.textContent()).includes('开门'))
  assert.equal(await page.locator('[data-option-id="o_peek"]').count(), 0, 'a hidden option must not be listed')
  const hudBox = await page.locator('[data-testid="player-hud"]').boundingBox()
  const firstCardBox = await page.locator('.nori-choice-option').first().boundingBox()
  assert.ok(hudBox && firstCardBox, 'HUD and choice cards must render')
  assert.ok(hudBox.y + hudBox.height <= firstCardBox.y, 'the HUD must never cover the choice cards')
  await shot('locked-choice-portrait.png')

  await tapCard('o_open')
  const sheet = page.locator('[data-testid="shop-sheet"]')
  await sheet.waitFor()
  assert.ok(((await sheet.getAttribute('class')) || '').includes('is-portrait'))
  const keyItem = page.locator('[data-testid="shop-item-key_item"]')
  assert.equal(await keyItem.getAttribute('data-focused'), 'true')
  assert.ok((await keyItem.textContent()).includes('🔑'))
  assert.ok((await keyItem.textContent()).includes('能打开金库门'))
  assert.ok((await keyItem.textContent()).includes('售价 5'))
  assert.ok((await page.locator('[data-testid="shop-balance"]').textContent()).includes('3'))
  const poorBuy = page.locator('[data-testid="shop-buy-key_item"]')
  assert.equal(await poorBuy.isDisabled(), true)
  assert.equal((await poorBuy.textContent()).trim(), '余额不足')
  await shot('shop-focused-poor-portrait.png')

  await page.keyboard.press('Escape')
  await sheet.waitFor({ state: 'detached', timeout: 4000 })
  assert.equal(await page.locator('[role="dialog"]').count(), 1, 'Esc must close the sheet first, not the player')
  assert.equal(await page.locator('[data-testid="choice-panel"]').count(), 1)
  assert.equal(await page.locator('[data-testid="hud-shop"]').count(), 1)

  /* ---------- 2. buying unlocks 开门 in place and reaches the hidden ending ---------- */
  await open('vault-rich', { storageKey: `${PERMANENT_PREFIX}:economy-rich` })
  await page.waitForSelector('[data-testid="hud-variable-coin"]')
  assert.equal((await page.locator('[data-testid="hud-variable-coin"] .nori-hud-value').textContent()).trim(), '8')
  await reachDoor()
  await tapCard('o_open')
  const richSheet = page.locator('[data-testid="shop-sheet"]')
  await richSheet.waitFor()
  assert.equal(await page.locator('[data-testid="shop-item-key_item"]').getAttribute('data-focused'), 'true')
  const richBuy = page.locator('[data-testid="shop-buy-key_item"]')
  assert.equal(await richBuy.isDisabled(), false)
  assert.equal((await richBuy.textContent()).trim(), '购买')
  await richBuy.click()
  await until(async () => (await keyItem.locator('.nori-shop-item-owned').count()) === 1, 'the key must be marked as owned after buying')
  assert.ok((await keyItem.textContent()).includes('已拥有 ×1'))
  assert.ok((await keyItem.textContent()).includes('已售罄'))
  assert.equal(await page.locator('[data-testid="shop-buy-key_item"]').isDisabled(), true)
  assert.equal((await page.locator('[data-testid="shop-buy-key_item"]').textContent()).trim(), '已售罄')
  assert.equal((await sideValue('coin')).trim(), '3', 'buying the key must deduct 5 coins')
  assert.equal((await sideValue('key')).trim(), '1', 'buying the key must add the key')
  assert.ok((await page.locator('[data-testid="hud-variable-coin"] .nori-hud-value').textContent()).trim() === '3')
  await shot('shop-key-bought.png')

  await page.locator('[data-testid="shop-buy-tonic"]').click()
  await until(async () => (await sideValue('coin')).trim() === '2', 'the tonic must cost 1 coin')
  await until(async () => {
    const stored = await storedPermanent('economy-rich')
    return stored?.brave === 1
  }, 'the permanent courage value must be written to localStorage')
  const stored = await storedPermanent('economy-rich')
  assert.equal(stored.seen, false)
  assert.ok((await page.locator('[data-variable-id="brave"]').textContent()).includes('永久'))
  assert.equal(await page.locator('[data-testid="clear-permanent"]').count(), 1)
  assert.ok((await page.locator('[data-variable-id="brave"]').textContent()).includes('跟随存档'))
  assert.equal(await page.locator('[data-option-id="o_open"]').getAttribute('data-locked'), null)
  await page.locator('[data-testid="shop-close"]').click()
  await richSheet.waitFor({ state: 'detached', timeout: 4000 })

  assert.equal(await page.locator('[data-option-id="o_open"][data-locked="true"]').count(), 0, 'the bought key must unlock 开门 without a restart')
  assert.equal(await page.locator('[data-testid="choice-panel"]').count(), 1, 'buying must not restart the choice')
  await page.locator('[data-option-id="o_open"]').click()
  const continueButton = page.locator('.nori-player-continue')
  const endingCard = page.locator('.nori-player-card.is-hidden')
  await page.waitForSelector('.nori-player-continue, .nori-player-card.is-hidden', { timeout: 12000 })
  if (await continueButton.count()) await continueButton.first().click()
  await endingCard.waitFor({ timeout: 12000 })
  assert.ok((await endingCard.textContent()).includes('隐藏结局'))
  const trail = await page.locator('.nori-player-side li em').allTextContents()
  assert.ok(trail.includes('→ 开门'), 'the path must record the key-opened door')
  await shot('hidden-ending.png')

  /* ---------- 3. a timed choice is frozen while the shop is open ---------- */
  await open('vault-timed')
  await reachDoor()
  const countdownBar = page.locator('.nori-int-countdown i')
  await page.waitForSelector('[data-testid="interaction-countdown"]')
  await tapCard('o_open')
  await page.waitForSelector('[data-testid="shop-sheet"]')
  // Let the shop's pause effect commit before sampling the frozen bar.
  await page.waitForTimeout(300)
  const widthAt = () => countdownBar.evaluate((element) => parseFloat(element.style.width))
  const frozenWidth = await widthAt()
  await page.waitForTimeout(1000)
  assert.equal(await widthAt(), frozenWidth, 'the choice countdown must not move while the shop is open')
  await page.waitForTimeout(3500)
  assert.equal(await page.locator('.nori-player-card').count(), 0, 'the timed choice must not expire while the shop is open')
  assert.equal(await page.locator('[data-testid="choice-panel"]').count(), 1)
  await shot('timed-choice-paused.png')
  await page.keyboard.press('Escape')
  await page.waitForSelector('[data-testid="shop-sheet"]', { state: 'detached', timeout: 4000 })
  const timeoutCard = page.locator('.nori-player-card')
  await timeoutCard.waitFor({ timeout: 12000 })
  const timeoutTrail = await page.locator('.nori-player-side li em').allTextContents()
  assert.ok(timeoutTrail.includes('→ 硬闯'), 'a locked default must give way to the first pickable option')
  assert.ok(!timeoutTrail.includes('→ 开门'), 'a locked default must never be auto-picked')

  /* ---------- 4. permanent values seed a fresh player and hidden options appear ---------- */
  await open('vault-seeded', { storageKey: `${PERMANENT_PREFIX}:economy-seeded`, seed: { brave: 3 } })
  const braveChip = page.locator('[data-testid="hud-variable-brave"]')
  await braveChip.waitFor()
  assert.equal(await braveChip.getAttribute('title'), '勇气')
  assert.equal((await braveChip.locator('.nori-hud-value').textContent()).trim(), '3')
  assert.ok((await page.locator('[data-variable-id="brave"]').textContent()).includes('永久'))
  assert.equal((await sideValue('brave')).trim(), '3')
  await reachDoor()
  const peekCard = page.locator('[data-option-id="o_peek"]')
  await peekCard.waitFor()
  assert.ok((await peekCard.textContent()).includes('偷看'))
  assert.equal(await peekCard.getAttribute('data-locked'), null)
  await shot('seeded-hidden-option.png')

  await page.locator('.nori-player-head button', { hasText: '重新开始' }).click()
  await page.waitForSelector('[data-testid="hud-variable-brave"]')
  assert.equal((await page.locator('[data-testid="hud-variable-brave"] .nori-hud-value').textContent()).trim(), '3', '重新开始 must keep permanent values')
  assert.equal((await sideValue('brave')).trim(), '3')
  await page.locator('[data-testid="clear-permanent"]').click()
  await until(async () => (await storedPermanent('economy-seeded')) === null, '清除永久数据 must remove the browser record')
  await until(async () => (await sideValue('brave')).trim() === '0', '清除永久数据 must restart from the initial courage')
  assert.equal((await page.locator('[data-testid="hud-variable-brave"] .nori-hud-value').textContent()).trim(), '0')

  /* ---------- 5. no storageKey: nothing is read or written ---------- */
  await open('vault-bare')
  await page.waitForSelector('[data-testid="hud-variable-brave"]')
  assert.equal((await page.locator('[data-testid="hud-variable-brave"] .nori-hud-value').textContent()).trim(), '0')
  assert.equal(await page.locator('[data-testid="clear-permanent"]').count(), 0)
  await reachDoor()
  assert.equal(await page.locator('[data-option-id="o_peek"]').count(), 0, 'without saved courage the hidden option stays hidden')
  await page.waitForTimeout(300)
  assert.equal(await page.evaluate(() => localStorage.length), 0, 'without a storageKey no permanent record may be written')

  /* ---------- 6. a locked card without a shop item shows the inline hint ---------- */
  await open('vault-hint')
  await reachDoor()
  await tapCard('o_wait')
  const hint = page.locator('[data-testid="locked-hint"]')
  await hint.waitFor({ timeout: 4000 })
  assert.equal((await hint.textContent()).trim(), '还没有解锁')
  assert.equal(await page.locator('[data-testid="choice-panel"]').count(), 1, 'a locked tap must never advance')
  assert.equal(await page.locator('[data-testid="shop-sheet"]').count(), 0)
  await shot('locked-hint.png')
  await hint.waitFor({ state: 'detached', timeout: 6000 })

  /* ---------- 7. landscape sheet, solid colours only ---------- */
  await open('vault-landscape', { width: 1440, height: 900 })
  await page.locator('[data-testid="hud-shop"]').click()
  const landscapeSheet = page.locator('[data-testid="shop-sheet"]')
  await landscapeSheet.waitFor()
  assert.ok(((await landscapeSheet.getAttribute('class')) || '').includes('is-landscape'))
  const panelBox = await page.locator('.nori-shop-panel').boundingBox()
  const stageBox = await page.locator('.nori-player-stage').boundingBox()
  assert.ok(panelBox && stageBox, 'the landscape panel and stage must render')
  assert.ok(panelBox.width <= 522, 'the landscape panel must stay a centred dialog width')
  assert.ok(Math.abs((panelBox.x + panelBox.width / 2) - (stageBox.x + stageBox.width / 2)) <= 2, 'the landscape panel must be centred')
  const gradientElements = await page.locator('body *').evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element)
    return ['backgroundImage', 'maskImage'].some((property) => style[property].includes('gradient('))
      ? [element.className || element.tagName]
      : []
  }))
  assert.deepEqual(gradientElements, [], 'the HUD and shop must not render decorative gradients')
  await shot('shop-landscape.png')
  await page.locator('[data-testid="shop-close"]').click()
  await landscapeSheet.waitFor({ state: 'detached', timeout: 4000 })
  assert.equal(await page.locator('[role="dialog"]').count(), 1)

  assert.deepEqual(errors, [])
  console.log('[story-player-economy] HUD, locked cards, shop focus, buying + live unlock, paused countdown, permanent seeding, storage opt-out and landscape sheet passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
