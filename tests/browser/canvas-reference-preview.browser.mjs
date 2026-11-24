// Actual CanvasGraph with synthetic, local-only API responses.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import path from 'node:path'
import { createInterface } from 'node:readline'

const require = createRequire(path.resolve(process.env.NORI_BROWSER_TOOLS_DIR || '.', 'package.json'))
const { chromium } = require('playwright-core')
const demo = spawn(process.execPath, ['--import', 'tsx', 'tests/browser/canvas-demo.mjs'], {
  env: { ...process.env, NORI_DEMO_PORT: '0' },
  stdio: ['ignore', 'pipe', 'inherit'],
})
const lines = createInterface({ input: demo.stdout })
let browser
try {
  const base = await new Promise((resolve, reject) => {
    lines.on('line', (line) => {
      const match = /^Canvas demo ready: (http:\/\/127\.0\.0\.1:\d+)$/.exec(line)
      if (match) resolve(match[1])
    })
    demo.once('error', reject)
    demo.once('exit', (code) => reject(new Error(`Canvas demo exited: ${code}`)))
  })
  const graphPath = '/api/projects/project-1/canvas/canvas-1'
  const initialGraph = await (await fetch(new URL(graphPath, base))).json()
  browser = await chromium.launch({ executablePath: process.env.NORI_BROWSER_EXECUTABLE_PATH })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/*', (route) => {
    if (new URL(route.request().url()).origin === base) return route.fallback()
    return route.abort()
  })
  const previewWave = Buffer.alloc(44 + 8000, 128)
  previewWave.write('RIFF', 0)
  previewWave.writeUInt32LE(previewWave.length - 8, 4)
  previewWave.write('WAVEfmt ', 8)
  previewWave.writeUInt32LE(16, 16)
  previewWave.writeUInt16LE(1, 20)
  previewWave.writeUInt16LE(1, 22)
  previewWave.writeUInt32LE(8000, 24)
  previewWave.writeUInt32LE(8000, 28)
  previewWave.writeUInt16LE(1, 32)
  previewWave.writeUInt16LE(8, 34)
  previewWave.write('data', 36)
  previewWave.writeUInt32LE(8000, 40)
  await page.route('**/preview-audio.wav', (route) => route.fulfill({ body: previewWave, contentType: 'audio/wav' }))
  await page.route(`**${graphPath}`, async (route) => {
    const graph = structuredClone(initialGraph)
    const source = graph.nodes.find((node) => node.id === 'ref-2')
    source.type = 'audio'
    source.data = { title: '环境雨声', mediaType: 'audio', audioUrl: '/preview-audio.wav', contentUrl: '/preview-audio.wav' }
    graph.edges.push({ ...graph.edges[0], id: 'audio-reference', sourceNodeId: 'ref-2', targetNodeId: 'gen-1' })
    await route.fulfill({ json: graph })
  })
  await page.goto(base)
  await page.getByRole('button', { name: '收起', exact: true }).click()
  const previewToggle = page.getByRole('switch', { name: '放大模式' })
  const referenceImage = page.locator('.nori-canvas-generator-ref[title^="参考素材1"]')
  const imagePreview = page.getByRole('region', { name: '预览 参考素材1' })
  await referenceImage.hover()
  assert.equal(await imagePreview.count(), 0)
  await previewToggle.check()
  await referenceImage.hover()
  await imagePreview.getByRole('img', { name: '参考素材1' }).waitFor()
  assert.ok((await imagePreview.boundingBox()).width > (await referenceImage.boundingBox()).width)
  const referenceAudio = page.locator('.nori-canvas-generator-ref[title^="环境雨声"]')
  await referenceAudio.hover()
  const player = page.getByRole('region', { name: '预览 环境雨声' }).locator('audio[controls]')
  await player.hover()
  assert.equal(await player.count(), 1)
  assert.equal(await player.evaluate((element) => element.paused), true)
  await player.evaluate(async (element) => {
    await element.play()
    if (element.paused) throw new Error('Audio playback did not start')
    element.pause()
  })
  await previewToggle.uncheck()
  assert.equal(await player.count(), 0)
  console.log('PASS: reference preview enlarges images and exposes audio controls only when enabled')
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  lines.close()
  demo.kill()
}
