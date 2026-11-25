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
    const image = graph.nodes.find((node) => node.id === 'ref-1')
    const target = graph.nodes.find((node) => node.id === 'gen-1')
    for (let index = 3; index <= 8; index++) {
      const id = `ref-${index}`
      graph.nodes.push({ ...image, id, position: { x: 90, y: index * 250 }, data: { ...image.data, title: `参考素材${index}` } })
      graph.edges.push({ ...graph.edges[0], id: `edge-${id}`, sourceNodeId: id, targetNodeId: target.id })
    }
    target.data.generation.referenceSummary = graph.nodes.filter((node) => node.id.startsWith('ref-')).map((node) => ({
      id: node.id, title: node.data.title, type: node.type, previewUrl: node.data.contentUrl,
    }))
    await route.fulfill({ json: graph })
  })
  await page.goto(base)
  await page.getByRole('button', { name: '收起', exact: true }).click()
  const promptContextMenu = await page.locator('.nori-canvas-generator-prompt textarea').evaluate((element) => {
    const event = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 })
    return !element.dispatchEvent(event)
  })
  assert.equal(promptContextMenu, true, 'Right-click in the prompt must suppress the browser menu')
  assert.equal(await page.getByRole('menu').count(), 0, 'Right-click in the prompt must not open a canvas action menu')
  const toolbarContextMenu = await page.locator('.nori-canvas-tool-rail button').first().evaluate((element) => {
    return !element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2 }))
  })
  assert.equal(toolbarContextMenu, true, 'Right-click on the canvas toolbar must suppress the browser menu')
  const viewport = page.locator('.react-flow__viewport')
  const target = page.locator('.react-flow__node[data-id="ref-1"]')
  const menu = page.getByRole('menu', { name: '引用素材操作' })
  const reloadFixture = async () => {
    await page.reload()
    await page.getByRole('button', { name: '收起', exact: true }).click()
    const recovery = page.getByRole('dialog', { name: '恢复本地未同步画布' })
    const hasRecovery = await recovery.waitFor({ timeout: 2000 }).then(() => true, () => false)
    if (hasRecovery) {
      await recovery.getByRole('button', { name: '使用服务器' }).click()
      await recovery.waitFor({ state: 'hidden' })
    }
  }
  for (const selector of ['.nori-canvas-generator-ref', '.nori-canvas-reference-strip button']) {
    const thumbnail = page.locator(`${selector}[data-canvas-reference-node-id="ref-1"]`)
    await thumbnail.waitFor()
    const beforeMenu = await viewport.evaluate(async (element) => {
      let previous = element.style.transform
      let stableSince = performance.now()
      while (performance.now() - stableSince < 150) {
        await new Promise(requestAnimationFrame)
        if (element.style.transform !== previous) {
          previous = element.style.transform
          stableSince = performance.now()
        }
      }
      return previous
    })
    await thumbnail.click({ button: 'right' })
    const locate = menu.getByRole('menuitem', { name: '定位到节点' })
    await locate.waitFor()
    assert.equal(await viewport.evaluate((element) => element.style.transform), beforeMenu)

    if (selector === '.nori-canvas-reference-strip button') {
      await page.mouse.click(1390, 780)
      await menu.waitFor({ state: 'hidden', timeout: 2000 })
      assert.equal(await viewport.evaluate((element) => element.style.transform), beforeMenu)

      await thumbnail.click({ button: 'right' })
      await locate.waitFor()
      await page.getByRole('button', { name: '放大预览 @参考素材4' }).click()
      await menu.waitFor({ state: 'hidden', timeout: 2000 })
      const preview = page.getByRole('dialog', { name: '@参考素材4预览' })
      await preview.getByTitle('关闭 (Esc)').click()
      await thumbnail.click({ button: 'right' })
    }
    await locate.click()
    await menu.waitFor({ state: 'hidden' })
    await page.waitForFunction((node) => {
      const bounds = node.getBoundingClientRect()
      return Math.abs(bounds.x + bounds.width / 2 - innerWidth / 2) < 2
        && Math.abs(bounds.y + bounds.height / 2 - innerHeight / 2) < 2
    }, await target.elementHandle(), { timeout: 5000 })
    await reloadFixture()
  }
  console.log('PASS: both thumbnail menus locate the source only after clicking Locate')
  const editorThumbnail = page.locator('.nori-canvas-generator-ref[data-canvas-reference-node-id="ref-1"]')
  const editorPrompt = page.locator('.nori-canvas-generator-prompt textarea')
  await editorThumbnail.click({ button: 'right' })
  await menu.waitFor()
  const beforeDismiss = await viewport.evaluate((element) => element.style.transform)
  await editorPrompt.click()
  await menu.waitFor({ state: 'hidden', timeout: 2000 })
  assert.equal(await editorPrompt.evaluate((element) => element === document.activeElement), true)
  assert.equal(await viewport.evaluate((element) => element.style.transform), beforeDismiss)

  await editorThumbnail.click({ button: 'right' })
  await menu.waitFor()
  const thumbnails = page.locator('.nori-canvas-generator-ref-item')
  const expandReferences = page.getByRole('button', { name: '展开其余 2 项引用缩略图' })
  await expandReferences.waitFor()
  assert.equal(await thumbnails.count(), 6)
  await expandReferences.click()
  await menu.waitFor({ state: 'hidden', timeout: 2000 })
  assert.equal(await thumbnails.count(), 8)
  await page.getByRole('button', { name: '收起引用缩略图' }).click()
  assert.equal(await thumbnails.count(), 6)
  const strip = page.locator('.nori-canvas-reference-strip')
  const cardThumbnails = strip.locator('button[data-canvas-reference-node-id]')
  assert.equal(await cardThumbnails.count(), 4)
  assert.equal(await strip.innerText(), '+4')
  assert.equal(await strip.getByRole('button').count(), 4)
  assert.equal(await strip.locator('.nori-canvas-reference-thumbnails').evaluate((element) => getComputedStyle(element).overflowX), 'visible')
  const previewToggle = page.getByRole('switch', { name: '放大模式' })
  const referenceImage = page.locator('.nori-canvas-generator-ref[title^="参考素材1"]')
  const imagePreview = page.getByRole('region', { name: '预览 参考素材1' })
  await referenceImage.hover()
  assert.equal(await imagePreview.count(), 0)
  await previewToggle.check()
  await referenceImage.hover()
  await imagePreview.getByRole('img', { name: '参考素材1' }).waitFor()
  assert.ok((await imagePreview.boundingBox()).width > (await referenceImage.boundingBox()).width)
  await page.mouse.move(5, 5)
  assert.equal(await imagePreview.count(), 0)
  const reopenEditor = async () => {
    await page.getByRole('button', { name: '关闭节点编辑器' }).click()
    await previewToggle.waitFor({ state: 'hidden' })
    const generator = page.locator('.react-flow__node[data-id="gen-1"]')
    await generator.click()
    if (!(await previewToggle.isVisible())) await generator.click()
    await previewToggle.waitFor({ timeout: 5000 })
  }
  await reopenEditor()
  await page.waitForFunction(() => document.querySelector('.nori-canvas-reference-preview-toggle input')?.checked === true, null, { timeout: 3000 })
  await page.setViewportSize({ width: 1440, height: 1440 })
  const prompt = page.locator('.nori-canvas-generator-prompt textarea')
  await prompt.fill('合成测试正文。'.repeat(1000))
  await page.locator('.nori-canvas-generator').evaluate((panel) => {
    // Reproduce a panel sized above the default prompt height while typing.
    panel.setAttribute('data-canvas-editor-resized', 'true')
    panel.style.height = '650px'
  })
  await page.waitForFunction(() => {
    const textarea = document.querySelector('.nori-canvas-generator-prompt textarea')
    const layer = textarea?.parentElement
    const highlight = layer?.querySelector('.mention-prompt-highlight')
    return textarea && layer && highlight && textarea.clientHeight > 260
      && Math.abs(layer.clientHeight - textarea.clientHeight) <= 1
      && Math.abs(highlight.clientHeight - textarea.clientHeight) <= 1
  }, null, { timeout: 3000 })
  await page.locator('.nori-canvas-generator').evaluate((panel) => {
    panel.removeAttribute('data-canvas-editor-resized')
    panel.style.removeProperty('height')
  })
  await prompt.fill('合成测试正文。')
  await page.setViewportSize({ width: 1440, height: 900 })
  const referenceAudio = page.locator('.nori-canvas-generator-ref[title^="环境雨声"]')
  await referenceAudio.hover()
  const player = page.getByRole('region', { name: '预览 环境雨声' }).locator('audio[controls]')
  await page.waitForFunction(() => {
    const audio = document.querySelector('audio[aria-label="播放 环境雨声"]')
    return audio instanceof HTMLAudioElement && !audio.paused && audio.currentTime > 0
  }, null, { timeout: 3000 })
  const playingAudio = await player.elementHandle()
  await page.mouse.move(5, 5)
  assert.equal(await player.count(), 0)
  assert.equal(await playingAudio.evaluate((audio) => audio.paused), true)
  await previewToggle.uncheck()
  assert.equal(await player.count(), 0)
  await reopenEditor()
  assert.equal(await previewToggle.isChecked(), false)
  console.log('PASS: reference preview enlarges images and exposes audio controls only when enabled')

  const modelTrigger = page.getByRole('button', { name: '选择生成模型' })
  await modelTrigger.click()
  const models = page.getByRole('menu', { name: '生成模型' })
  await models.getByRole('menuitemradio', { checked: true }).waitFor()
  await models.getByRole('menuitemradio', { checked: false }).first().click()
  assert.equal(await models.count(), 0)
  const editor = page.locator('.nori-canvas-generator')
  await editor.getByRole('button', { name: '展开大编辑器' }).click()
  const corner = editor.getByLabel('调整提示词框大小')
  const before = await editor.boundingBox()
  const grip = await corner.boundingBox()
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2)
  await page.mouse.down()
  await page.mouse.move(grip.x - 84, grip.y - 90, { steps: 6 })
  await page.mouse.up()
  const after = await editor.boundingBox()
  assert.ok(after.width < before.width - 60)
  assert.ok(after.height < before.height - 60)
  assert.equal(await page.locator('.nori-canvas-generator-width-handle').count(), 0)
  await editor.getByRole('button', { name: '返回画布' }).first().click()

  await page.getByRole('button', { name: /^管理引用/ }).click()
  const manager = page.getByRole('dialog', { name: '管理引用' })
  const imageRow = manager.locator('.canvas-editor-reference-row').filter({ hasText: '参考素材1' })
  await imageRow.getByRole('button', { name: '暂停使用' }).click()
  await imageRow.getByText('图片参考 · 已连线').waitFor()
  await manager.getByRole('button', { name: '完成' }).click()
  await page.getByRole('button', { name: '查看传参' }).click()
  const payload = page.getByRole('dialog', { name: '传参预览' })
  await payload.waitFor()
  assert.equal(await payload.getByText('参考素材1').count(), 0)
  assert.equal(await payload.getByRole('checkbox').count(), 0)
  await page.mouse.click(30, 45)
  assert.equal(await payload.count(), 0)
  console.log('PASS: model menu, expanded resize, pause preserves wire, and read-only preview')
  await page.getByRole('button', { name: '生成参数', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '生成参数设置' })
  await settings.getByRole('button', { name: '9:16', exact: true }).click()
  await settings.getByRole('button', { name: '关闭生成参数' }).click()
  await previewToggle.check()
  const modelLabel = await modelTrigger.innerText()
  await page.locator('.nori-canvas-tool-rail button').first().click()
  await page.locator('.nori-canvas-add-panel').getByRole('button', { name: /视频.*生成或引用视频/ }).click()
  await modelTrigger.waitFor()
  assert.equal(await modelTrigger.innerText(), modelLabel)
  await page.getByRole('button', { name: '添加引用素材' }).click()
  await page.getByRole('menuitem', { name: /从画布选择/ }).click()
  const picker = page.getByTestId('canvas-reference-picker')
  await picker.locator('.nori-canvas-reference-picker-tile', { hasText: '参考素材1' }).click()
  await picker.getByRole('button', { name: '添加引用', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.nori-canvas-reference-preview-toggle input')?.checked === true, null, { timeout: 3000 })
  await previewToggle.uncheck()
  await page.getByRole('button', { name: '生成参数', exact: true }).click()
  assert.equal(await settings.getByRole('button', { name: '9:16', exact: true }).getAttribute('aria-pressed'), 'true')
  await settings.getByRole('button', { name: '16:9', exact: true }).click()
  await settings.getByRole('button', { name: '关闭生成参数' }).click()
  await page.locator('.nori-canvas-tool-rail button').first().click()
  await page.locator('.nori-canvas-add-panel').getByRole('button', { name: /视频.*生成或引用视频/ }).click()
  await page.getByRole('button', { name: '生成参数', exact: true }).click()
  assert.equal(await settings.getByRole('button', { name: '16:9', exact: true }).getAttribute('aria-pressed'), 'true')
  await settings.getByRole('button', { name: '关闭生成参数' }).click()
  await reloadFixture()
  await previewToggle.waitFor()
  assert.equal(await previewToggle.isChecked(), false)
  console.log('PASS: canvas video nodes share saved preview mode and inherit generation parameters')
  assert.deepEqual(errors, [])
} finally {
  await browser?.close()
  lines.close()
  demo.kill()
}
