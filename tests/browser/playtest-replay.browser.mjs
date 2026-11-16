// Diagnose: 影游试玩选择后剧情片段重复播放
// Serves the REAL InteractivePlayer (compiled from tests/browser/playtest-replay.fixture.tsx)
// with the real story program JSON injected, a stubbed /api/storage/sign that serves ONE
// short mp4 for every video URL, and drives Playwright through:
//   1. scene 1 plays to its end  2. choice panel appears (3s timeout)
//   3. click "收"               4. observe what the next <video> plays
// Logs every video src/currentTime/ended event so we can see whether the same
// segment URL re-mounts and replays, or a different node plays.
//   REPLAY_TRACE=1  extra verbose console
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')

const program = JSON.parse(await readFile('/tmp/story-program.json', 'utf8'))
const video = await readFile(path.join(root, 'test-results/canvas-pan-performance/sample-720p.mp4'))
const artifacts = path.join(root, 'test-results/playtest-replay')
await mkdir(artifacts, { recursive: true })

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/playtest-replay.fixture.tsx'],
  bundle: true, write: false, outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
  },
  define: {
    'process.env.NODE_ENV': '"production"',
    'process.env': '{}',
    __PROGRAM__: JSON.stringify(program),
  },
  minify: false,
  keepNames: true,
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.contents

console.log('[debug] bundle bytes =', script?.length ?? 'missing', 'css bytes =', css?.length ?? 0)
console.log('[debug] script first 300 chars =', JSON.stringify(script ? Buffer.from(script).toString('utf8').slice(0, 300) : ''))

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/fixture.js') {
    response.writeHead(200, { 'Content-Type': 'application/javascript' })
    response.end(script)
  } else if (url.pathname === '/fixture.css') {
    response.writeHead(200, { 'Content-Type': 'text/css' })
    response.end(css ?? '')
  } else if (url.pathname === '/api/storage/sign') {
    const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = match ? Math.min(Number(match[1]), video.length - 1) : 0
    const end = match?.[2] ? Math.min(Number(match[2]), video.length - 1) : video.length - 1
    response.writeHead(match ? 206 : 200, {
      'Content-Type': 'video/mp4',
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${video.length}`,
      'Accept-Ranges': 'bytes',
    })
    response.end(video.subarray(start, end + 1))
  } else {
    response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const port = server.address().port

const browser = await chromium.launch({
  headless: true,
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--headless=new', '--disable-gpu', '--no-first-run'],
})
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })

// Expose a log sink so in-page eval can report events in order.
const events = []
page.on('console', (msg) => {
  const text = msg.text()
  if (text.startsWith('[replay]')) events.push(text)
  else console.log(`[page:${msg.type()}]`, text)
})
page.on('pageerror', (err) => console.log('[pageerror]', err.message))
await page.exposeFunction('pushEvent', (line) => events.push(line))

// Instrument <video> elements as they appear.
await page.addInitScript(() => {
  const boot = () => {
    if (!document.documentElement) return setTimeout(boot, 0)
    const seen = new WeakSet()
    const hook = () => {
      document.querySelectorAll('video').forEach((video) => {
        if (seen.has(video)) return
        seen.add(video)
        const tag = `v${seen.size}`
        const report = (label) => {
          const line = `[replay] ${label} ${tag} src=${(video.src || '').split('?')[0].split('/').pop()} key-attr=${video.getAttribute('data-testid') || ''} currentTime=${video.currentTime.toFixed(2)} ended=${video.ended} paused=${video.paused}`
          if (window.pushEvent) window.pushEvent(line)
          else console.log(line)
        }
        video.addEventListener('loadstart', () => report('loadstart'))
        video.addEventListener('loadedmetadata', () => report('loadedmetadata'))
        video.addEventListener('play', () => report('play'))
        video.addEventListener('ended', () => report('ended'))
        video.addEventListener('error', () => report('error'))
      })
    }
    new MutationObserver(hook).observe(document.documentElement, { childList: true, subtree: true })
    hook()
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot)
  else boot()
})

await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'load' })
await page.waitForTimeout(1500)
console.log('[debug] root html =', JSON.stringify(await page.evaluate(() => document.getElementById('root')?.innerHTML?.slice(0, 500))))

const state = async (label) => {
  const info = await page.evaluate(() => {
    const video = document.querySelector('video')
    const panel = document.querySelector('[data-testid="choice-panel"]')
    const pending = document.querySelector('[data-testid="pending-chip"]')
    const overlay = document.querySelector('.nori-int-overlay, [class*="InteractionOverlay"], [data-testid*="interaction"]')
    const continueBtn = Array.from(document.querySelectorAll('button')).find((b) => b.textContent?.includes('继续'))
    const hudStop = document.querySelector('.nori-player-trail li:last-child')
    return {
      video: video ? { src: video.src.split('?')[0].split('/').pop(), currentTime: video.currentTime, ended: video.ended, paused: video.paused } : null,
      panelOpen: !!panel,
      pending: pending?.textContent ?? null,
      overlayOpen: !!overlay,
      continueVisible: !!continueBtn,
      lastTrail: hudStop?.textContent ?? null,
    }
  })
  console.log(`\n== ${label} ==`)
  console.log(JSON.stringify(info, null, 2))
  return info
}

// Wait for the first scene's <video> to be present and started.
await page.waitForSelector('video', { timeout: 5000 })
await page.waitForFunction(() => {
  const video = document.querySelector('video')
  return video && !video.paused && video.currentTime > 0
}, null, { timeout: 5000 })
await state('scene1 playing')

// Force the first scene to end so we land on the choice panel (avoids waiting 45s real time).
// NOTE: this also mirrors what a real "视频自然播完" would do — handleEnded → onContinue → advanceRun.
await page.evaluate(() => {
  const video = document.querySelector('video')
  if (video) {
    video.currentTime = Math.max(0, video.duration - 0.25)
  }
})

// Wait for the choice panel (may take a tick for ended event + state update).
await page.waitForSelector('[data-testid="choice-panel"]', { timeout: 8000 })
await state('choice panel open')

// Click "收" quickly, well inside the 3s timeout window.
const shou = page.locator('[data-option-id="opt_f38339c3"]')
await shou.click()
await state('immediately after clicking 收')

// Let whatever comes next settle for a moment, then sample a few times.
await page.waitForTimeout(300)
await state('choose +300ms')
await page.waitForTimeout(1500)
await state('choose +1800ms')
await page.waitForTimeout(3000)
await state('choose +4800ms')

await page.screenshot({ path: path.join(artifacts, 'after-choice.png'), fullPage: false })

console.log('\n== event log ==')
for (const line of events) console.log(line)

await browser.close()
server.close()
