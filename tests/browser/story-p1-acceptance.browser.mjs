// 影游 P1 acceptance in headless Chromium: the spec examples at their real durations.
// 电梯逃生 (60s segment, 10 taps during 57s-60s), 逃跑 (10 taps at 30s, 勇气+1, nothing linked)
// and 丧尸扑来 (a mounted choice that freezes the picture and dies on time-out).
// The nodes are authored like canvas data and compiled by the real compileChapter. The only
// media is a locally generated 60s clip served with HTTP Range support: no paid calls.
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { createServer } from 'node:http'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/story-p1-acceptance')
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
  entryPoints: ['tests/browser/story-p1-acceptance.fixture.tsx'], bundle: true, write: false,
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
const videoState = () => video().evaluate((element) => ({ paused: element.paused, time: element.currentTime, ended: element.ended }))
const shot = (name) => page.screenshot({ path: path.join(artifacts, name) })
const waitOverlay = (kind, timeout = 5000) => page.waitForSelector(`[data-testid="interaction-overlay"][data-kind="${kind}"]`, { timeout })
const waitOverlayGone = (timeout = 4000) => page.waitForSelector('[data-testid="interaction-overlay"]', { state: 'detached', timeout })
const waitEnding = (title, timeout = 8000) => page.locator('.nori-player-card').getByText(title, { exact: true }).waitFor({ timeout })
const trail = () => page.locator('.nori-player-side li em').allTextContents()

async function open(scenario) {
  await page.goto(`${base}/?scenario=${scenario}`)
  await page.waitForSelector('[role="dialog"]')
  await video().waitFor()
  await until(async () => (await video().evaluate((element) => element.readyState)) >= 1, 'the clip metadata never loaded', 8000)
  const issues = await page.evaluate(() => window.__validation)
  assert.deepEqual(issues.filter((item) => item.level === 'error'), [], `${scenario} must validate without errors`)
}

/** Jumps the picture near a mounted second so the 60s examples run in a couple of real seconds. */
const seekTo = (seconds) => video().evaluate((element, target) => new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`seeking to ${target}s timed out`)), 8000)
  element.addEventListener('seeked', () => {
    clearTimeout(timer)
    resolve(element.currentTime)
  }, { once: true })
  element.currentTime = target
}), seconds)

const tapTimes = (count) => page.locator('[data-testid="tap-button"]').evaluate((element, times) => {
  for (let index = 0; index < times; index += 1) {
    element.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true }))
  }
}, count)

try {
  /* ---------- 1. 电梯逃生: the interaction opens at 57s, 10 taps succeed, the last 3s still play ---------- */
  await open('elevator')
  assert.ok((await video().evaluate((element) => element.duration)) > 59.5, 'the fixture clip must be a real 60s video')
  await seekTo(56.2)
  assert.equal(await overlay().count(), 0, 'the interaction must not be on screen before its start second')
  await waitOverlay('tap')
  const opened = await videoState()
  assert.ok(opened.time >= 56.95 && opened.time < 58, `the tap opens at the mounted 57s, not at ${opened.time}s`)
  assert.equal(opened.paused, false, '画面播放 must keep the picture running under a tap')
  assert.ok((await overlay().textContent()).includes('快按住电梯门！'))
  assert.equal(await page.locator('[data-testid="interaction-countdown"]').count(), 1)
  await shot('elevator-57s.png')
  await tapTimes(10)
  await waitOverlayGone()
  const tappedAt = Date.now()
  await page.waitForSelector('[data-testid="pending-chip"]', { timeout: 3000 })
  assert.equal(await page.locator('[data-testid="pending-chip"]').textContent(), '待切换：获救')
  const deferred = await videoState()
  assert.equal(deferred.paused, false, '本段播完再切 must keep the last seconds playing')
  assert.ok(deferred.time < 59.9, `the cut must wait for the segment end (picture at ${deferred.time}s)`)
  await until(async () => (await page.locator('[data-testid="pending-chip"]').count()) === 0, 'the deferred cut never followed the segment end', 8000)
  assert.ok(Date.now() - tappedAt >= 1800, 'the deferred cut must come only after the remaining picture has played')
  await page.getByText('这段剧情还没有画面').waitFor({ timeout: 3000 })
  await page.locator('.nori-player-continue').click()
  await waitEnding('救下朋友')
  assert.ok((await trail()).includes('→ 成功'))
  await shot('elevator-rescued.png')

  // 9 taps are not enough: the 3s window runs out together with the segment and cuts to the bad ending.
  await open('elevator')
  await seekTo(56.2)
  await waitOverlay('tap')
  await tapTimes(9)
  const failStarted = Date.now()
  await waitEnding('朋友被困', 7000)
  assert.ok(Date.now() - failStarted >= 1500, 'the 3s window must run before the failure cuts')
  assert.equal(await page.locator('.nori-player-card').getByText('救下朋友', { exact: true }).count(), 0)
  assert.ok((await trail()).includes('→ 失败'))
  await shot('elevator-trapped.png')

  /* ---------- 2. 逃跑: 10 taps at 30s give 勇气+1; nothing is linked, so the picture just plays on ---------- */
  await open('escape')
  await seekTo(29.2)
  assert.equal(await overlay().count(), 0)
  await waitOverlay('tap')
  assert.ok((await videoState()).time >= 29.95, 'the tap opens at the mounted 30s')
  assert.ok((await overlay().textContent()).includes('冲出去！'))
  await tapTimes(10)
  await waitOverlayGone()
  const courage = page.locator('.nori-player-vars tr', { hasText: '勇气' })
  assert.equal((await courage.locator('td').nth(1).textContent()).trim(), '1')
  assert.equal(await page.locator('[data-testid="pending-chip"]').count(), 0, 'an unlinked result has nothing to wait for')
  const before = await videoState()
  await page.waitForTimeout(500)
  const after = await videoState()
  assert.equal(after.paused, false, 'an unlinked result must not stop the picture')
  assert.ok(after.time > before.time + 0.3, 'an unlinked result must not rewind or hold the picture')
  assert.equal(await page.locator('.nori-player-card.is-ending').count(), 0, 'the story must not end right after the tap')
  await seekTo(58.5)
  await waitEnding('抵达出口', 6000)
  assert.ok((await trail()).includes('→ 成功'))

  /* ---------- 3. 丧尸扑来: a mounted choice freezes the picture; no answer in 3s is the death exit ---------- */
  await open('zombie')
  await seekTo(4.2)
  assert.equal(await overlay().count(), 0)
  await waitOverlay('choice')
  const choiceOpened = Date.now()
  const frozen = await videoState()
  assert.equal(frozen.paused, true, '限时抉择 挂在片段上 must freeze the picture')
  assert.ok(frozen.time >= 4.95 && frozen.time < 6, `the choice opens at the mounted 5s, not at ${frozen.time}s`)
  assert.equal(await page.locator('[data-testid="interaction-countdown"]').count(), 1)
  const labels = await overlay().locator('.nori-choice-option').allTextContents()
  assert.deepEqual(labels.map((label) => label.trim()), ['开枪', '逃跑'])
  assert.ok((await overlay().textContent()).includes('丧尸扑过来了！'))
  await shot('zombie-choice.png')
  await page.waitForTimeout(900)
  assert.equal((await videoState()).time, frozen.time, 'the frozen frame must not move while the options show')
  await waitEnding('被咬死', 6000)
  assert.ok(Date.now() - choiceOpened >= 2000, 'the time-out must take its full 3s before the death ending')
  assert.ok((await trail()).includes('→ 超时'))
  await shot('zombie-dead.png')

  await open('zombie')
  await seekTo(4.2)
  await waitOverlay('choice')
  await overlay().locator('[data-option-id="fight"]').click()
  await waitEnding('反杀成功', 4000)
  assert.ok((await trail()).includes('→ 开枪'))

  await open('zombie')
  await seekTo(4.2)
  await waitOverlay('choice')
  await overlay().locator('[data-option-id="flee"]').click()
  await waitEnding('逃出生天', 4000)

  const gradientElements = await page.locator('body *').evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element)
    return ['backgroundImage', 'maskImage'].some((property) => style[property].includes('gradient('))
      ? [element.className || element.tagName]
      : []
  }))
  assert.deepEqual(gradientElements, [], 'The trial player must not render decorative gradients')

  assert.deepEqual(errors, [])
  console.log('[story-p1-acceptance] 57s elevator (success defers, 9 taps fail), 30s escape (勇气+1, picture plays on) and zombie choice (freeze, time-out death, both answers) passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
