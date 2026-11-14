// Real trial player (试玩) with all five P1 interactions in headless Chromium.
// The only media is a locally generated clip served with HTTP Range support:
// no generation, no paid calls and no production data changes.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/story-player')
await mkdir(artifacts, { recursive: true })

const clipPath = path.join(artifacts, 'story-clip.webm')
if (!existsSync(clipPath)) {
  const ffmpeg = existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg'
  execFileSync(ffmpeg, [
    '-y', '-f', 'lavfi', '-i', 'testsrc=duration=8:size=320x180:rate=15',
    '-c:v', 'libvpx', '-b:v', '200k', '-an', clipPath,
  ], { stdio: 'ignore' })
}
const clip = await readFile(clipPath)

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/story-player.fixture.tsx'], bundle: true, write: false,
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
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
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

const overlay = () => page.locator('[data-testid="interaction-overlay"]')
const video = () => page.locator('[data-testid="scene-video"]')
const videoState = () => video().evaluate((element) => ({
  paused: element.paused,
  rate: element.playbackRate,
  time: element.currentTime,
  ended: element.ended,
}))
const shot = (name) => page.screenshot({ path: path.join(artifacts, name) })

async function open(name) {
  await page.goto(`${base}/?scenario=${name}`)
  await page.waitForSelector('[role="dialog"]')
}

const waitOverlay = (kind, timeout = 12000) => page.waitForSelector(`[data-testid="interaction-overlay"][data-kind="${kind}"]`, { timeout })
const waitOverlayGone = (timeout = 8000) => page.waitForSelector('[data-testid="interaction-overlay"]', { state: 'detached', timeout })
const waitEnding = (title, timeout = 15000) => page.locator('.nori-player-card').getByText(title, { exact: true }).waitFor({ timeout })

async function swipe(dx, dy) {
  const box = await page.locator('[data-testid="swipe-area"]').boundingBox()
  assert.ok(box, 'swipe area is missing')
  const x = box.x + box.width / 2
  const y = box.y + box.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + dx, y + dy, { steps: 5 })
  await page.mouse.up()
}

async function pressHold(milliseconds) {
  const box = await page.locator('[data-testid="hold-button"]').boundingBox()
  assert.ok(box, 'hold button is missing')
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(milliseconds)
  await page.mouse.up()
}

/** Hits the timing bar atomically from inside the page once the pointer is inside [min, max]. */
function hitTiming(min, max) {
  return page.evaluate(([low, high]) => new Promise((resolve, reject) => {
    const pad = document.querySelector('[data-testid="timing-pad"]')
    if (!pad) {
      reject(new Error('timing pad is missing'))
      return
    }
    const started = performance.now()
    const tick = () => {
      const position = Number(pad.getAttribute('data-position'))
      if (Number.isFinite(position) && position >= low && position <= high) {
        pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
        resolve(position)
        return
      }
      if (performance.now() - started > 8000) {
        reject(new Error(`timing pointer never entered ${low}..${high}`))
        return
      }
      requestAnimationFrame(tick)
    }
    tick()
  }), [min, max])
}

try {
  /* ---------- 1. mounted tap: success waits for the segment end, timeout cuts at once ---------- */
  await open('elevator')
  await video().waitFor()
  await waitOverlay('tap')
  assert.ok((await overlay().textContent()).includes('快按住电梯门！'), 'the creator hint must win')
  assert.equal(await page.locator('[data-testid="interaction-countdown"]').count(), 1)
  assert.equal(await page.locator('.nori-player-continue').count(), 0, '继续 must be hidden while an interaction is active')
  const tapBox = await page.locator('[data-testid="tap-button"]').boundingBox()
  assert.ok(tapBox && tapBox.width >= 56 && tapBox.height >= 56, 'the tap button must stay thumb-sized')
  await shot('mounted-tap-overlay.png')
  await page.locator('[data-testid="tap-button"]').evaluate((element) => {
    for (let index = 0; index < 10; index += 1) {
      element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
    }
  })
  await page.waitForSelector('[data-testid="interaction-overlay"]', { state: 'detached', timeout: 4000 })
  await page.waitForSelector('[data-testid="pending-chip"]', { timeout: 4000 })
  assert.equal(await page.locator('[data-testid="pending-chip"]').textContent(), '待切换：获救')
  const deferred = await videoState()
  assert.equal(deferred.paused, false, 'when:"after" must keep the segment playing')
  assert.ok(deferred.time < 7.9, 'the cut must not happen before the segment ends')
  await shot('deferred-cut-waits.png')
  await until(async () => (await page.locator('[data-testid="pending-chip"]').count()) === 0, 'the deferred cut never followed the video end', 8000)
  await page.getByText('这段剧情还没有画面').waitFor({ timeout: 4000 })
  await page.locator('.nori-player-continue').click()
  await waitEnding('救下朋友')

  await open('elevator')
  await waitOverlay('tap')
  const barLeft = () => page.locator('.nori-int-countdown i').evaluate((element) => parseFloat(element.style.width))
  const beforeBar = await barLeft()
  await page.waitForTimeout(450)
  const afterBar = await barLeft()
  assert.ok(afterBar < beforeBar, 'the interaction countdown must run in real time')
  await waitEnding('朋友被困', 6000)
  assert.ok((await page.locator('.nori-player-side li em').allTextContents()).includes('→ 失败'))
  await shot('mounted-tap-timeout.png')

  /* ---------- 2. standalone choice: the 3s timeout lands on the default option ---------- */
  await open('standalone-choice')
  const choicePanel = page.locator('[data-testid="choice-panel"]')
  await choicePanel.waitFor()
  assert.equal(await choicePanel.getAttribute('data-layout'), 'vertical')
  assert.ok((await choicePanel.textContent()).includes('门后传来声响'))
  assert.equal(await page.locator('[data-testid="interaction-countdown"]').count(), 1)
  const optionHeights = await page.locator('.nori-choice-option').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
  assert.ok(optionHeights.every((height) => height >= 56), 'choice cards must keep a 56px hit area')
  await shot('standalone-choice.png')
  await waitEnding('安全', 8000)
  assert.ok((await page.locator('.nori-player-side li em').allTextContents()).includes('→ 按兵不动'))

  /* ---------- 3. standalone swipe: correct direction succeeds, the wrong one fails ---------- */
  await open('swipe')
  await page.locator('.nori-player-continue').click()
  await waitOverlay('swipe')
  assert.ok((await overlay().textContent()).includes('按住拖动，向上'))
  await shot('swipe-up-overlay.png')
  await swipe(0, -120)
  await waitEnding('雨过天晴')

  await open('swipe')
  await page.locator('.nori-player-continue').click()
  await waitOverlay('swipe')
  await swipe(-120, 0)
  await waitEnding('落水')

  /* ---------- 4. timing: perfect / normal / miss at the matching pointer positions ---------- */
  await open('timing')
  await page.locator('.nori-player-continue').click()
  await page.waitForSelector('[data-testid="timing-pad"]')
  const zones = await page.locator('.nori-int-timing-zone').evaluateAll((elements) => elements.map((element) => ({
    cls: element.className,
    left: element.style.left,
    width: element.style.width,
  })))
  assert.deepEqual(zones.map((zone) => [zone.width, zone.left]), [['40%', '30%'], ['20%', '40%']])
  await page.waitForTimeout(250)
  await shot('timing-overlay.png')
  await hitTiming(0.45, 0.55)
  await waitEnding('完美')

  await open('timing')
  await page.locator('.nori-player-continue').click()
  await page.waitForSelector('[data-testid="timing-pad"]')
  await page.waitForTimeout(250)
  await hitTiming(0.32, 0.38)
  await waitEnding('普通')

  await open('timing')
  await page.locator('.nori-player-continue').click()
  await page.waitForSelector('[data-testid="timing-pad"]')
  await page.waitForTimeout(250)
  await hitTiming(0, 0.25)
  await waitEnding('失误')

  /* ---------- 5. hold: release inside the band, too early, and overcharge while held ---------- */
  await open('hold')
  await page.locator('.nori-player-continue').click()
  await waitOverlay('hold')
  assert.ok((await overlay().textContent()).includes('在绿色区间内松手'))
  await shot('hold-overlay.png')
  await pressHold(1850)
  await waitEnding('一箭中的')

  await open('hold')
  await page.locator('.nori-player-continue').click()
  await waitOverlay('hold')
  await pressHold(450)
  await waitEnding('手滑了')

  await open('hold')
  await page.locator('.nori-player-continue').click()
  await waitOverlay('hold')
  const holdBox = await page.locator('[data-testid="hold-button"]').boundingBox()
  assert.ok(holdBox, 'hold button is missing')
  await page.mouse.move(holdBox.x + holdBox.width / 2, holdBox.y + holdBox.height / 2)
  await page.mouse.down()
  await page.waitForTimeout(2350)
  await waitEnding('手滑了', 5000)
  await page.mouse.up()

  /* ---------- 6. unlinked mounted beat: picture keeps playing, effects reach the side panel ---------- */
  await open('unlinked')
  await video().waitFor()
  await waitOverlay('tap')
  assert.ok((await overlay().textContent()).includes('冲出去！'))
  await shot('unlinked-overlay.png')
  await page.locator('[data-testid="tap-button"]').dispatchEvent('pointerdown')
  await waitOverlayGone(4000)
  const courageRow = page.locator('.nori-player-vars tr', { hasText: '勇气' })
  assert.equal((await courageRow.locator('td').nth(1).textContent()).trim(), '1')
  assert.ok(((await courageRow.getAttribute('class')) || '').includes('is-changed'), 'the changed variable must be highlighted')
  const beforeAdvance = await videoState()
  await page.waitForTimeout(400)
  const duringAdvance = await videoState()
  assert.equal(duringAdvance.paused, false, 'an unlinked result must not stop the picture')
  assert.ok(duringAdvance.time > beforeAdvance.time, 'an unlinked result must not rewind the picture')
  await waitEnding('抵达出口', 12000)
  assert.ok((await page.locator('.nori-player-side li em').allTextContents()).includes('→ 成功'))

  /* ---------- 7. freeze / slow: playbackRate and paused state follow the beat, then restore ---------- */
  await open('freeze-slow')
  await video().waitFor()
  await waitOverlay('tap')
  const frozen = await videoState()
  assert.equal(frozen.paused, true, '画面定格 must pause the picture')
  assert.equal(frozen.rate, 1)
  await shot('freeze-beat.png')
  await waitOverlayGone(5000)
  await until(async () => (await videoState()).paused === false, 'the picture never resumed after the freeze beat', 4000)
  assert.equal((await videoState()).rate, 1)
  await waitOverlay('tap', 10000)
  const slowed = await videoState()
  assert.equal(slowed.paused, false)
  assert.equal(slowed.rate, 0.25, '画面慢放 must play at 0.25x')
  await shot('slow-beat.png')
  await waitOverlayGone(5000)
  await until(async () => (await videoState()).rate === 1, 'the playback rate never restored after the slow beat', 4000)

  /* ---------- 8. 失败重来: rewind to startSec - 2 and fire the same beat again ---------- */
  await open('retry')
  await video().waitFor()
  await waitOverlay('swipe')
  assert.equal((await videoState()).paused, false)
  await shot('retry-first-attempt.png')
  await swipe(-120, 0)
  await waitOverlayGone(4000)
  await until(async () => (await videoState()).time < 1.5, 'the failed beat never rewound to ~startSec - 2', 3000)
  await waitOverlay('swipe', 10000)
  await shot('retry-rearmed.png')
  await swipe(0, -120)
  await waitEnding('完成', 6000)

  /* ---------- 9. choice panel with pictures in both orientations ---------- */
  await open('choice-images-portrait')
  await page.locator('.nori-player-continue').click()
  const portraitPanel = page.locator('[data-testid="choice-panel"]')
  await portraitPanel.waitFor()
  assert.equal(await portraitPanel.getAttribute('data-layout'), 'vertical')
  assert.equal(await portraitPanel.locator('img').count(), 2)
  const portraitText = await portraitPanel.textContent()
  assert.ok(portraitText.includes('开门') && portraitText.includes('等待'))
  await shot('choice-images-portrait.png')
  const cardHeights = await portraitPanel.locator('.nori-choice-option').evaluateAll((elements) => elements.map((element) => element.getBoundingClientRect().height))
  assert.ok(cardHeights.every((height) => height >= 56), 'picture cards must keep a 56px hit area')
  await portraitPanel.locator('[data-option-id="o_a"]').click()
  await waitEnding('门后')

  await open('choice-images-landscape')
  await page.locator('.nori-player-continue').click()
  const landscapePanel = page.locator('[data-testid="choice-panel"]')
  await landscapePanel.waitFor()
  assert.equal(await landscapePanel.getAttribute('data-layout'), 'horizontal')
  assert.equal(await landscapePanel.locator('img').count(), 2)
  await shot('choice-images-landscape.png')

  const gradientElements = await page.locator('body *').evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element)
    return ['backgroundImage', 'maskImage'].some((property) => style[property].includes('gradient('))
      ? [element.className || element.tagName]
      : []
  }))
  assert.deepEqual(gradientElements, [], 'The trial player must not render decorative gradients')

  assert.deepEqual(errors, [])
  console.log('[story-player] elevator tap, deferred cut, timeout, standalone choice, swipe, timing, hold, unlinked effects, freeze/slow, retry and picture choices passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
