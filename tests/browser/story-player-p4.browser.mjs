// 影游 P4 acceptance in headless Chromium: viewer speed, wall-clock interaction windows,
// the compact phone layout and the turned portrait stage. The only media is a local 60s clip
// served with HTTP Range support: no paid calls.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/p4-player')
await mkdir(artifacts, { recursive: true })

const clipPath = path.join(artifacts, 'story-clip-60.webm')
if (!existsSync(clipPath)) {
  const ffmpeg = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg'
  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=60:size=320x180:rate=15',
    '-c:v', 'libvpx', '-b:v', '150k', '-g', '15', '-an', clipPath,
  ], { stdio: 'ignore' })
}
const clip = await readFile(clipPath)

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/story-player-p4.fixture.tsx'], bundle: true, write: false,
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
  } else if (pathname === '/story-clip-60.webm') {
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
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
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
const overlay = () => page.locator('[data-testid="interaction-overlay"]')
const video = () => page.locator('[data-testid="scene-video"]')
const videoState = () => video().evaluate((element) => ({ paused: element.paused, time: element.currentTime, ended: element.ended, rate: element.playbackRate }))
const waitOverlay = (kind, timeout = 6000) => page.waitForSelector(`[data-testid="interaction-overlay"][data-kind="${kind}"]`, { timeout })
async function waitOverlayGone(timeout = 6000) {
  await page.waitForSelector('[data-testid="interaction-overlay"]', { state: 'detached', timeout })
}
const waitEnding = (title, timeout = 10000) => page.locator('.nori-player-card').getByText(title, { exact: true }).waitFor({ timeout })
const speedButton = () => page.locator('[data-testid="hud-speed"]')

async function open(name, { width = 1440, height = 960, aspect = '16:9' } = {}) {
  await page.setViewportSize({ width, height })
  await page.goto(`${base}/?scenario=${name}&aspect=${aspect}`)
  await page.waitForSelector('[role="dialog"]')
  await video().waitFor()
  await until(async () => (await video().evaluate((element) => element.readyState)) >= 1, 'the clip metadata never loaded', 8000)
  const issues = await page.evaluate(() => window.__validation)
  assert.deepEqual(issues.filter((item) => item.level === 'error'), [], `${name} must validate without errors`)
}

const seekTo = (seconds) => video().evaluate((element, target) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`seeking to ${target}s timed out`)), 8000)
  element.addEventListener('seeked', () => {
    clearTimeout(timer)
    resolve(element.currentTime)
  }, { once: true })
  element.currentTime = target
}), seconds)

const setSpeed = async (label) => {
  for (let clicks = 0; clicks < 3; clicks += 1) {
    if ((await speedButton().textContent()).trim() === label) return
    await speedButton().click()
    await page.waitForTimeout(60)
  }
  throw new Error(`could not reach speed ${label}`)
}

const viewport = () => page.viewportSize()
async function assertInside(locator, label) {
  const box = await locator.boundingBox()
  const size = viewport()
  assert.ok(box, `${label} must render`)
  assert.ok(box.x >= -1 && box.y >= -1 && box.x + box.width <= size.width + 1 && box.y + box.height <= size.height + 1,
    `${label} must stay inside ${size.width}x${size.height}, got ${JSON.stringify(box)}`)
}
async function assertNoPageOverflow(label) {
  const ok = await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)
  assert.ok(ok, `${label} must not scroll the page horizontally`)
}
async function centerOf(locator) {
  const box = await locator.boundingBox()
  assert.ok(box, 'interaction control must render')
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

/** Mounted tap at 57s with nobody pressing: the 3s window must take 3s of wall clock at any speed. */
async function measureTapWindow(clicks, label) {
  await open('tap57')
  if (clicks) await setSpeed(clicks === 1 ? '1.25x' : '1.5x')
  await seekTo(56.7)
  await waitOverlay('tap')
  const opened = Date.now()
  const state = await videoState()
  assert.equal(state.rate, 1, `${label}: a play window runs at real pace whatever the viewer speed`)
  assert.equal(state.paused, false, `${label}: a play window keeps the picture running`)
  await waitEnding('被困')
  const elapsed = Date.now() - opened
  assert.ok(elapsed >= 2550 && elapsed <= 3700, `${label}: the 3s window measured ${elapsed}ms`)
  await until(async () => (await videoState()).rate === (clicks === 0 ? 1 : clicks === 1 ? 1.25 : 1.5),
    `${label}: the speed must return after the window is cut away`, 4000)
}

/** Mounted choice at 57s that freezes the picture and exits on time-out after 3s. */
async function measureChoiceWindow(clicks, label) {
  await open('choice57')
  if (clicks) await setSpeed(clicks === 1 ? '1.25x' : '1.5x')
  await seekTo(56.7)
  await waitOverlay('choice')
  const opened = Date.now()
  const state = await videoState()
  assert.equal(state.paused, true, `${label}: freeze must pause the picture`)
  assert.equal(state.rate, 1, `${label}: freeze keeps a sane playbackRate`)
  await waitEnding('原地不动')
  const elapsed = Date.now() - opened
  assert.ok(elapsed >= 2550 && elapsed <= 3700, `${label}: the 3s choice measured ${elapsed}ms`)
  await until(async () => (await videoState()).rate === (clicks === 0 ? 1 : clicks === 1 ? 1.25 : 1.5),
    `${label}: the ending picture must use the chosen speed`, 4000)
}

/** Runs all five interactions with real mouse input and checks every visible control stays on screen. */
async function playKinds({ width, height, aspect, shots = false }) {
  await open('kinds', { width, height, aspect })
  assert.equal(await page.locator('.nori-player.is-compact').count(), 1, `kinds ${width}x${height}: compact layout`)
  assert.equal(await page.locator('.nori-player-head').count(), 0, 'compact hides the big header')
  assert.equal(await page.locator('.nori-player-side').isVisible(), false, 'compact hides the side panel')
  const stage = page.locator('.nori-player-stage')
  await assertInside(stage, 'the compact picture')
  await assertNoPageOverflow(`kinds ${width}x${height}`)
  const stageBox = await stage.boundingBox()
  assert.ok(Math.abs(stageBox.height - height) <= 1, `a 16:9 picture fills the height (${stageBox.height} of ${height})`)
  assert.equal(await page.locator('.nori-player-stage-wrap').evaluate((element) => getComputedStyle(element).paddingTop), '0px')
  if (aspect === '9:16') {
    assert.ok(stageBox.width < stageBox.height, 'a 9:16 picture stays portrait inside the wide player')
    assert.ok(Math.abs((stageBox.x + stageBox.width / 2) - width / 2) <= 2, 'a 9:16 picture is centred')
  }
  for (const [testId, label] of [['close-player', 'compact close'], ['compact-restart', 'compact restart']]) {
    await assertInside(page.locator(`[data-testid="${testId}"]`), label)
  }
  const fullscreen = page.locator('[data-testid="compact-fullscreen"]')
  const supported = await page.evaluate(() => Boolean(document.fullscreenEnabled))
  assert.equal(await fullscreen.count(), supported ? 1 : 0, 'the fullscreen button follows document.fullscreenEnabled')
  if (supported) await assertInside(fullscreen, 'compact fullscreen')
  await assertInside(speedButton(), 'compact speed button')

  await seekTo(1.7)
  await waitOverlay('tap')
  await assertInside(page.locator('[data-testid="tap-button"]'), 'compact tap button')
  if (shots) await shot('compact-844x390-tap.png')
  let point = await centerOf(page.locator('[data-testid="tap-button"]'))
  await page.mouse.click(point.x, point.y)
  await page.mouse.click(point.x, point.y)
  await waitOverlayGone()

  await seekTo(5.7)
  await waitOverlay('swipe')
  await assertInside(page.locator('[data-testid="swipe-button"]'), 'compact swipe button')
  if (shots) await shot('compact-667x375-swipe.png')
  point = await centerOf(page.locator('[data-testid="swipe-area"]'))
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.mouse.move(point.x, point.y - 90, { steps: 6 })
  await page.mouse.up()
  await waitOverlayGone()

  await seekTo(9.7)
  await waitOverlay('timing')
  await assertInside(page.locator('.nori-int-timing-bar'), 'compact timing bar')
  point = await centerOf(page.locator('[data-testid="timing-pad"]'))
  await page.mouse.click(point.x, point.y)
  await waitOverlayGone()

  await seekTo(13.7)
  await waitOverlay('hold')
  await assertInside(page.locator('[data-testid="hold-button"]'), 'compact hold button')
  point = await centerOf(page.locator('[data-testid="hold-button"]'))
  await page.mouse.move(point.x, point.y)
  await page.mouse.down()
  await page.waitForTimeout(1700)
  await page.mouse.up()
  await waitOverlayGone()

  await seekTo(17.7)
  await waitOverlay('choice')
  await assertInside(page.locator('.nori-choice-option').first(), 'compact choice card')
  if (shots) await shot('compact-844x390-choice.png')
  await page.locator('.nori-choice-option').first().click()
  await waitOverlayGone()

  await page.locator('.nori-player-continue').click()
  await waitEnding('结束')
  await assertInside(page.locator('.nori-player-card'), 'compact ending card')

  await page.locator('[data-testid="compact-restart"]').click()
  await until(async () => (await videoState()).time < 2, 'the compact restart must start the picture over', 4000)
  assert.equal(await overlay().count(), 0)
}

try {
  /* ---------- 1. the speed button only exists when the creator offered a choice ---------- */
  await open('novel')
  await page.locator('[data-testid="player-hud"]').waitFor()
  assert.equal(await speedButton().count(), 0, 'no playback settings: no speed button')
  assert.equal((await videoState()).rate, 1)

  await open('fast')
  await speedButton().waitFor()
  assert.equal((await speedButton().textContent()).trim(), '1x')
  assert.ok(((await speedButton().getAttribute('aria-label')) || '').includes('播放倍速 1x'))
  assert.equal((await videoState()).rate, 1)

  for (const [label, rate] of [['1.25x', 1.25], ['1.5x', 1.5], ['1x', 1]]) {
    await speedButton().click()
    await until(async () => (await speedButton().textContent()).trim() === label, `the HUD must show ${label}`)
    await until(async () => (await videoState()).rate === rate, `the picture must switch to ${label} immediately`, 1000)
  }

  // A mid-scene switch applies at once on a scene with no beats and time keeps moving.
  await seekTo(5)
  const beforeSwitch = await videoState()
  await speedButton().click()
  await until(async () => (await videoState()).rate === 1.25, 'a mid-scene switch must reach the media element at once', 1000)
  await page.waitForTimeout(350)
  const afterSwitch = await videoState()
  assert.ok(afterSwitch.time > beforeSwitch.time + 0.2, 'the picture must keep playing through a speed switch')
  assert.equal(await overlay().count(), 0)

  // The chosen speed is a viewer preference: restarting the run keeps it.
  await speedButton().click()
  assert.equal((await speedButton().textContent()).trim(), '1.5x')
  await page.locator('.nori-player-head button', { hasText: '重新开始' }).click()
  await until(async () => (await videoState()).rate === 1.5, 'the speed must survive a restart', 4000)
  assert.equal((await speedButton().textContent()).trim(), '1.5x')

  /* ---------- 2. the same beat scene outside its window runs at the viewer speed ---------- */
  await open('tap57')
  await speedButton().click()
  assert.equal((await speedButton().textContent()).trim(), '1.25x')
  await seekTo(40)
  await until(async () => (await videoState()).rate === 1.25, 'outside the window the viewer speed rules')
  await seekTo(56.7)
  await waitOverlay('tap')
  assert.equal((await videoState()).rate, 1, 'inside the window the picture runs at real pace')
  await speedButton().click()
  assert.equal((await speedButton().textContent()).trim(), '1.5x')
  assert.equal((await videoState()).rate, 1, 'a speed change during a beat waits for the beat to end')
  await waitEnding('被困')
  await until(async () => (await videoState()).rate === 1.5, 'the new speed applies once the beat is over', 4000)

  /* ---------- 3. wall-clock interaction windows at every speed ---------- */
  await measureTapWindow(0, 'tap @1x')
  await measureTapWindow(1, 'tap @1.25x')
  await measureTapWindow(2, 'tap @1.5x')
  await measureChoiceWindow(0, 'choice @1x')
  await measureChoiceWindow(1, 'choice @1.25x')
  await measureChoiceWindow(2, 'choice @1.5x')

  /* ---------- 4. slow motion is the fixed rate, not the viewer speed scaled ---------- */
  await open('slowbeat')
  await speedButton().click()
  await seekTo(19.7)
  await waitOverlay('tap')
  assert.equal((await videoState()).rate, 0.25, '慢动作 uses the fixed slow rate')
  await speedButton().click()
  assert.equal((await speedButton().textContent()).trim(), '1.5x')
  assert.equal((await videoState()).rate, 0.25, 'a speed change during slow motion waits for the beat')
  await waitOverlayGone()
  await until(async () => (await videoState()).rate === 1.5, 'the chosen speed returns once slow motion ends', 3000)
  const resumed = await videoState()
  await page.waitForTimeout(300)
  assert.ok((await videoState()).time > resumed.time && (await videoState()).paused === false, 'the picture resumes after the slow beat')

  /* ---------- 5. compact phone layout: all five kinds, both sizes, both aspects ---------- */
  await playKinds({ width: 844, height: 390, aspect: '16:9', shots: true })
  await playKinds({ width: 667, height: 375, aspect: '16:9' })
  await playKinds({ width: 844, height: 390, aspect: '9:16' })

  // The compact close button still calls the player's close handler.
  await open('kinds', { width: 844, height: 390 })
  await page.locator('[data-testid="close-player"]').click()
  await until(async () => (await page.evaluate(() => window.__playerClosed)) === true, 'the compact close button must close the player', 4000)

  // Records, shop and map stay reachable from the compact HUD.
  await open('extras', { width: 844, height: 390 })
  await page.locator('[data-testid="player-hud"]').waitFor({ timeout: 8000 })
  for (const testId of ['hud-achievements', 'hud-map', 'hud-shop', 'hud-speed']) {
    await assertInside(page.locator(`[data-testid="${testId}"]`), `compact ${testId}`)
  }
  await page.locator('[data-testid="hud-shop"]').click()
  await page.locator('[data-testid="shop-sheet"]').waitFor()
  await assertInside(page.locator('.nori-shop-panel'), 'compact shop panel')
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="shop-sheet"]').waitFor({ state: 'detached', timeout: 4000 })
  await page.locator('[data-testid="hud-map"]').click()
  await page.locator('[data-testid="map-sheet"]').waitFor()
  await assertInside(page.locator('.nori-records-panel'), 'compact map panel')
  await page.keyboard.press('Escape')
  await page.locator('[data-testid="map-sheet"]').waitFor({ state: 'detached', timeout: 4000 })

  /* ---------- 6. a 16:9 work on an upright phone turns, the hint shows, swipes map to the screen ---------- */
  await open('swipe', { width: 390, height: 844 })
  assert.equal(await page.locator('.nori-player.is-compact').count(), 1, 'a turned stage goes immersive')
  const hint = page.locator('[data-testid="rotate-hint"]')
  await hint.waitFor({ timeout: 3000 })
  assert.ok((await hint.textContent()).includes('横屏观看更沉浸'))
  assert.equal(await page.locator('.nori-player-head').count(), 0)
  const frame = page.locator('.nori-player-turn')
  const frameBox = await frame.boundingBox()
  assert.ok(frameBox && Math.abs(frameBox.width - 390) <= 1 && Math.abs(frameBox.height - 844) <= 1,
    `the turned frame must cover the phone, got ${JSON.stringify(frameBox)}`)
  await assertNoPageOverflow('the turned stage')

  await seekTo(1.7)
  await waitOverlay('swipe')
  await assertInside(page.locator('[data-testid="swipe-area"]'), 'turned swipe area')
  await shot('turned-390x844-swipe.png')
  await video().evaluate((element) => { element.dataset.keep = 'turn-test' })
  const swipeButton = page.locator('[data-testid="swipe-button"]')
  const drawnStart = await swipeButton.boundingBox()
  const grip = await centerOf(page.locator('[data-testid="swipe-area"]'))
  await page.mouse.move(grip.x, grip.y)
  await page.mouse.down()
  await page.mouse.move(grip.x, grip.y - 30, { steps: 5 })
  const drawnUp = await swipeButton.boundingBox()
  assert.ok(Math.abs(drawnUp.x - drawnStart.x) <= 3 && drawnStart.y - drawnUp.y >= 20 && drawnStart.y - drawnUp.y <= 40,
    `the drag must follow the finger on screen, got ${JSON.stringify({ drawnStart, drawnUp })}`)
  await page.mouse.move(grip.x, grip.y - 90, { steps: 5 })
  await page.mouse.up()
  await waitOverlayGone()

  await seekTo(29.7)
  await waitOverlay('swipe')
  const rightStart = await swipeButton.boundingBox()
  const grip2 = await centerOf(page.locator('[data-testid="swipe-area"]'))
  await page.mouse.move(grip2.x, grip2.y)
  await page.mouse.down()
  await page.mouse.move(grip2.x + 30, grip2.y, { steps: 4 })
  const drawnRight = await swipeButton.boundingBox()
  assert.ok(drawnRight.x - rightStart.x >= 20 && drawnRight.x - rightStart.x <= 40,
    `a screen-right drag must move the button right, got ${JSON.stringify({ rightStart, drawnRight })}`)
  await page.mouse.move(grip2.x + 90, grip2.y, { steps: 4 })
  await page.mouse.up()
  await waitOverlayGone()

  const beforeTurnOff = await videoState()
  await page.setViewportSize({ width: 844, height: 390 })
  await until(async () => (await page.locator('.nori-player-turn.is-turned').count()) === 0, 'turning the phone must unturn the stage', 3000)
  await until(async () => (await page.locator('[data-testid="rotate-hint"]').count()) === 0, 'the hint must be gone after turning', 3000)
  const keptMarker = await video().getAttribute('data-keep')
  assert.equal(keptMarker, 'turn-test', 'the same video element must survive the orientation change')
  const afterTurnOff = await videoState()
  assert.ok(afterTurnOff.time >= beforeTurnOff.time - 0.3, 'the run must not restart when the phone turns')
  assert.equal(afterTurnOff.ended, false)

  /* ---------- 7. a 9:16 work on an upright phone keeps the old full layout ---------- */
  await open('novel', { width: 390, height: 844, aspect: '9:16' })
  assert.equal(await page.locator('.nori-player.is-compact').count(), 0, '9:16 on a phone is not compact')
  await page.locator('.nori-player-head').waitFor()
  assert.equal(await page.locator('.nori-player-turn.is-turned').count(), 0)
  assert.equal(await hint.count(), 0)
  assert.equal(await page.locator('.nori-player-stage.is-portrait').count(), 1)
  await assertInside(page.locator('.nori-player-stage'), 'portrait picture')
  await assertInside(page.locator('[data-testid="close-player"]'), 'portrait close')
  const playing = await videoState()
  assert.equal(playing.paused, false)
  await page.waitForTimeout(400)
  assert.ok((await videoState()).time > playing.time, '9:16 stays playable')
  await shot('portrait-390x844.png')

  assert.deepEqual(errors, [])
  console.log('[story-player-p4] speed cycling and delivery, wall-clock windows at 1x/1.25x/1.5x, slow motion, compact 844x390 + 667x375 + 844x390-9:16 with all five kinds, turned 390x844 swipe mapping and orientation survival, portrait 9:16 passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
