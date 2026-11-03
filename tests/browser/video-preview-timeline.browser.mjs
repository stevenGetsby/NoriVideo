import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { spawnSync } from 'node:child_process'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const media = await readFile(path.join(root, 'test-results/canvas-ui-regression/sample.mp4'))
const artifacts = path.join(root, 'test-results/canvas-video-timeline')
await mkdir(artifacts, { recursive: true })
const cutsPath = path.join(artifacts, 'three-shots.mp4')
const colors = ['0xd04848', '0x3a5ad8', '0x3fb87a']
const ffmpeg = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...colors.flatMap((color) => ['-f', 'lavfi', '-i', `color=c=${color}:s=320x180:r=25:d=1`]), '-f', 'lavfi', '-i', 'sine=frequency=440:duration=3', '-filter_complex', '[0][1][2]concat=n=3:v=1:a=0[v]', '-map', '[v]', '-map', '3:a', '-c:a', 'aac', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', cutsPath])
const cutsMedia = ffmpeg.status === 0 ? await readFile(cutsPath) : null
const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/canvas-ui-regression.fixture.tsx'], bundle: true, write: false, outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: { '@': path.join(root, 'src'), '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'), 'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'), 'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx') },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).contents
const appCss = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH, 'utf8')
const server = createServer((request, response) => {
  if (request.url.startsWith('/api/storage/sign')) {
    const body = cutsMedia && request.headers.referer?.includes('clip=cuts') ? cutsMedia : media
    const match = request.headers.range?.match(/^bytes=(\d+)-(\d*)$/)
    const start = match ? Math.min(Number(match[1]), body.length - 1) : 0
    const end = match?.[2] ? Math.min(Number(match[2]), body.length - 1) : body.length - 1
    response.writeHead(match ? 206 : 200, { 'Content-Type': 'video/mp4', 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1, ...(match ? { 'Content-Range': `bytes ${start}-${end}/${body.length}` } : {}) })
    response.end(body.subarray(start, end + 1))
  } else if (request.url === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script) }
  else if (request.url === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css) }
  else if (request.url === '/global.css') { response.setHeader('Content-Type', 'text/css'); response.end(appCss) }
  else { response.setHeader('Content-Type', 'text/html'); response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>') }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] })
const errors = []
const near = (a, b, tolerance = 0.012) => Math.abs(a - b) <= tolerance
async function openPreview(page, query) {
  page.on('pageerror', (error) => errors.push(error.message))
  await page.goto(`${base}/?view=dialogs&kind=video-preview${query}`)
  await page.locator('.nori-video-timeline').waitFor()
  await page.waitForFunction(() => document.querySelector('.nori-video-stage video')?.readyState >= 2)
  await page.locator('.nori-video-stage video').evaluate((video) => video.pause())
}
const videoTime = (page) => page.locator('.nori-video-stage video').evaluate((video) => video.currentTime)
async function waitTime(page, expected, tolerance = 0.012) {
  await page.waitForFunction(([value, delta]) => Math.abs(document.querySelector('.nori-video-stage video')?.currentTime - value) <= delta, [expected, tolerance])
}
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  await openPreview(page, '&keep=1')
  const preview = page.locator('.nori-canvas-media-preview')
  const timeline = preview.locator('.nori-video-timeline')
  const inspector = preview.getByRole('complementary', { name: '关键帧面板' })
  await inspector.waitFor()
  await page.waitForFunction(() => document.querySelector('.nori-video-workspace')?.dataset.fpsSource === '实测')
  const fps = Number.parseFloat(await timeline.locator('.nori-video-timeline-head.is-ruler').textContent())
  assert.equal(fps, 25)
  const frameAt = (index) => Math.round(index / fps * 10000) / 10000 + 0.001

  const layout = await page.evaluate(() => {
    const main = document.querySelector('.nori-canvas-media-preview > main').getBoundingClientRect()
    const workspace = document.querySelector('.nori-video-workspace').getBoundingClientRect()
    const video = document.querySelector('.nori-video-stage video').getBoundingClientRect()
    const stage = document.querySelector('.nori-video-stage').getBoundingClientRect()
    return { stage: [stage.top, stage.bottom, stage.height], video: [video.top, video.bottom, video.width], main: main.width, workspace: workspace.width, videoInside: video.left >= stage.left - 1 && video.right <= stage.right + 1 && video.bottom <= stage.bottom + 1, videoHeight: video.height }
  })
  assert.ok(Math.abs(layout.main - layout.workspace) < 2, 'workspace fills the dialog width')
  await page.screenshot({ path: path.join(artifacts, 'initial-1440.png') })
  assert.ok(layout.videoInside && layout.videoHeight > 200, `video fits inside the stage ${JSON.stringify(layout)}`)
  await page.waitForFunction(() => document.querySelectorAll('.nori-video-timeline-tile.is-ready').length > 2)
  await page.waitForFunction(() => !document.querySelector('.nori-video-timeline-wave.is-loading'))
  assert.equal(await timeline.locator('.nori-video-timeline-wave.is-silent').count(), 1, 'silent soundtrack is labelled')

  await preview.locator('.nori-video-stage video').evaluate((video) => { video.currentTime = 0.5 })
  await waitTime(page, 0.5, 0.002)
  await preview.getByRole('button', { name: '下一帧', exact: true }).click()
  const first = frameAt(Math.floor(0.5 * fps + 1e-6) + 1)
  await waitTime(page, first)
  await timeline.getByRole('button', { name: '标记关键帧', exact: true }).click()
  await timeline.getByRole('button', { name: '查看关键帧 1', exact: true }).waitFor()
  await inspector.getByRole('button', { name: '跳转到关键帧 1', exact: true }).waitFor()
  for (let index = 0; index < 5; index += 1) await page.keyboard.press('ArrowRight')
  const second = frameAt(Math.floor(first * fps + 1e-6) + 5)
  await waitTime(page, second)
  await page.keyboard.press('k')
  await timeline.getByRole('button', { name: '查看关键帧 2', exact: true }).waitFor()
  await page.waitForFunction(() => window.__videoKeyframes?.length === 2)
  assert.match(await preview.locator('.nori-video-stage-badges .is-keyframe').textContent(), /关键帧 2/)

  const clip = await timeline.locator('.nori-video-timeline-clip').boundingBox()
  await page.mouse.move(clip.x + clip.width * 0.7, clip.y + clip.height / 2)
  await timeline.locator('.nori-video-timeline-hover > div.is-ready').waitFor()
  await page.screenshot({ path: path.join(artifacts, 'hover-preview.png') })
  const hoverBox = await timeline.locator('.nori-video-timeline-hover').boundingBox()
  assert.ok(hoverBox.x >= 0 && hoverBox.x + hoverBox.width <= 1440 && hoverBox.y > 0)

  await timeline.getByLabel('时间线缩放').fill('60')
  await page.waitForFunction(() => document.querySelector('.nori-video-timeline-content')?.getBoundingClientRect().width > document.querySelector('.nori-video-timeline-viewport')?.clientWidth * 1.5)
  const ruler = await timeline.locator('.nori-video-timeline-ruler').boundingBox()
  const viewport = await timeline.locator('.nori-video-timeline-viewport').boundingBox()
  const before = await videoTime(page)
  await page.mouse.click(viewport.x + viewport.width - 20, ruler.y + ruler.height / 2)
  await page.waitForFunction((value) => document.querySelector('.nori-video-stage video')?.currentTime > value + 0.05, before)
  await preview.getByRole('button', { name: '上一个关键帧', exact: true }).click()
  await waitTime(page, second)
  await page.keyboard.press('ArrowUp')
  await waitTime(page, first)
  await page.keyboard.press('ArrowDown')
  await waitTime(page, second)

  const marker = timeline.getByRole('button', { name: '查看关键帧 2', exact: true })
  const markerBox = await marker.boundingBox()
  await page.mouse.move(markerBox.x + markerBox.width / 2, markerBox.y + markerBox.height / 2)
  await page.mouse.down()
  await page.mouse.move(markerBox.x + markerBox.width / 2 + 80, markerBox.y + markerBox.height / 2, { steps: 6 })
  await page.mouse.up()
  await page.waitForFunction((value) => window.__videoKeyframes?.length === 2 && window.__videoKeyframes[1].time > value + 0.02, second - 0.001)

  await page.keyboard.press('Shift+Z')
  await page.waitForFunction(() => Math.abs(document.querySelector('.nori-video-timeline-content')?.getBoundingClientRect().width - document.querySelector('.nori-video-timeline-viewport')?.clientWidth) < 2)
  await inspector.getByRole('button', { name: '保存 2 个关键帧到画布', exact: true }).click()
  await page.waitForFunction(() => window.__capturedFrames === 2)
  await inspector.getByRole('button', { name: '关键帧均已保存', exact: true }).waitFor()
  assert.equal(await inspector.locator('.nori-video-inspector-item small', { hasText: '已保存' }).count(), 2)

  await timeline.getByRole('button', { name: '查看关键帧 1', exact: true }).click()
  await page.keyboard.press('Delete')
  await page.waitForFunction(() => window.__videoKeyframes?.length === 1)
  assert.equal(await timeline.getByRole('button', { name: '查看关键帧 2', exact: true }).count(), 0)

  await preview.getByLabel('播放速度').selectOption('1.5')
  assert.equal(await preview.locator('.nori-video-stage video').evaluate((video) => video.playbackRate), 1.5)
  await preview.getByRole('button', { name: '循环播放', exact: true }).click()
  assert.equal(await preview.locator('.nori-video-stage video').evaluate((video) => video.loop), true)
  await page.keyboard.press('m')
  assert.equal(await preview.locator('.nori-video-stage video').evaluate((video) => video.muted), true)
  await timeline.getByRole('button', { name: '开启原声', exact: true }).waitFor()
  await page.keyboard.press('m')
  assert.equal(await preview.locator('.nori-video-stage video').evaluate((video) => video.muted), false)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => !document.querySelector('.nori-video-stage video')?.paused)
  await page.keyboard.press('Space')
  await page.waitForFunction(() => document.querySelector('.nori-video-stage video')?.paused)

  await timeline.getByRole('button', { name: '关键帧面板', exact: true }).click()
  await inspector.waitFor({ state: 'detached' })
  await timeline.getByRole('button', { name: '关键帧面板', exact: true }).click()
  await inspector.waitFor()
  await timeline.getByRole('button', { name: '截取当前帧', exact: true }).click()
  await page.waitForFunction(() => window.__capturedFrames === 3)
  await page.screenshot({ path: path.join(artifacts, 'workspace-1440.png') })
  await page.close()

  let shots = null
  if (cutsMedia) {
    const cuts = await browser.newPage({ viewport: { width: 1280, height: 800 } })
    await openPreview(cuts, '&clip=cuts')
    await cuts.locator('.nori-video-timeline-wave.is-ready svg path').waitFor()
    await cuts.locator('.nori-video-timeline').getByRole('button', { name: '智能识别镜头', exact: true }).click()
    await cuts.waitForFunction(() => window.__videoKeyframes?.length >= 2, null, { timeout: 30000 })
    await cuts.locator('.nori-video-timeline').getByRole('button', { name: '智能识别镜头', exact: true }).waitFor()
    shots = await cuts.evaluate(() => window.__videoKeyframes.map((keyframe) => ({ time: keyframe.time, kind: keyframe.kind })))
    assert.equal(shots.length, 2)
    assert.ok(shots.every((shot) => shot.kind === 'shot'))
    assert.ok(near(shots[0].time, 1, 0.001) && near(shots[1].time, 2, 0.001), `shot cuts land on exact frames: ${JSON.stringify(shots)}`)
    assert.equal(await cuts.locator('.nori-video-timeline-cut').count(), 2)
    await cuts.screenshot({ path: path.join(artifacts, 'shot-detection.png') })
    await cuts.close()
  }

  for (const [width, height] of [[1440, 900], [1280, 720], [768, 480], [390, 700]]) {
    const small = await browser.newPage({ viewport: { width, height } })
    await openPreview(small, '')
    await small.waitForFunction(() => document.querySelectorAll('.nori-video-timeline-tile.is-ready').length > 0)
    await small.screenshot({ path: path.join(artifacts, `${width}x${height}.png`) })
    const geometry = await small.evaluate(() => {
      const dialog = document.querySelector('.nori-canvas-media-preview')
      const workspace = document.querySelector('.nori-video-workspace')
      const stage = document.querySelector('.nori-video-stage').getBoundingClientRect()
      const video = document.querySelector('.nori-video-stage video').getBoundingClientRect()
      const timeline = document.querySelector('.nori-video-timeline').getBoundingClientRect()
      return {
        dialog: dialog.scrollWidth <= dialog.clientWidth + 2 && dialog.getBoundingClientRect().right <= innerWidth,
        workspace: workspace.scrollWidth <= workspace.clientWidth + 2,
        video: video.height > 40 && video.bottom <= stage.bottom + 1,
        timeline: timeline.bottom <= innerHeight && timeline.height > 90,
      }
    })
    assert.deepEqual(geometry, { dialog: true, workspace: true, video: true, timeline: true }, `${width}x${height}`)
    await small.getByRole('button', { name: '关闭 (Esc)', exact: true }).click()
    await small.locator('.nori-canvas-media-preview').waitFor({ state: 'hidden' })
    await small.close()
  }

  const readonly = await browser.newPage({ viewport: { width: 1280, height: 720 } })
  await openPreview(readonly, '-readonly')
  assert.equal(await readonly.getByRole('button', { name: '标记关键帧', exact: true }).isDisabled(), true)
  assert.equal(await readonly.getByRole('button', { name: '智能识别镜头', exact: true }).isDisabled(), true)
  assert.equal(await readonly.getByRole('button', { name: '截取当前帧', exact: true }).count(), 0)
  await readonly.keyboard.press('k')
  assert.equal(await readonly.locator('.nori-video-timeline-keyframes button').count(), 0)
  await readonly.close()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, fps, layout: true, filmstrip: true, waveform: true, frameNavigation: true, keyframes: true, hoverPreview: true, zoomSeek: true, markerDrag: true, batchSave: true, shots, responsive: true, readOnly: true, screenshots: artifacts }, null, 2))
} catch (error) {
  console.error(error)
  process.exitCode = 1
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
