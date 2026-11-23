// 独立浏览器验证：生成节点「引用素材」行最右侧的素材库加号。
// 只渲染真实 CanvasGenerator，不登录、不写数据库、不调用生成接口。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { build } from 'esbuild'

const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || process.cwd(), 'package.json'))
const { chromium } = tools('playwright-core')
const root = process.cwd()
const artifacts = path.join(root, 'test-results/generator-refs')
await mkdir(artifacts, { recursive: true })

let appCss
if (process.env.NORI_BROWSER_GLOBAL_CSS_PATH) {
  appCss = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH, 'utf8')
} else {
  const workspace = new URL(process.env.NORI_WORKSPACE_URL || 'http://127.0.0.1:3000')
  assert.ok(['localhost', '127.0.0.1'].includes(workspace.hostname), 'Only a local workspace may supply test styles')
  const loginPage = await (await fetch(new URL('/zh/auth/signin', workspace))).text()
  const stylePaths = [...loginPage.matchAll(/<link\b[^>]*>/g)]
    .filter(([tag]) => tag.includes('rel="stylesheet"'))
    .map(([tag]) => tag.match(/href="([^"]+)"/)?.[1])
    .filter((href) => href?.startsWith('/_next/static/'))
  assert.ok(stylePaths.length, 'Local workspace must be running')
  appCss = (await Promise.all(stylePaths.map(async (href) => (
    await (await fetch(new URL(href, workspace))).text()
  )))).join('\n')
}

const bundle = process.env.NORI_BROWSER_PREBUILT_DIR ? {
  outputFiles: await Promise.all(['js', 'css'].map(async (extension) => ({
    path: `/fixture/fixture.${extension}`,
    contents: await readFile(path.join(process.env.NORI_BROWSER_PREBUILT_DIR, `generator-refs.${extension}`)),
  }))),
} : await build({
  entryPoints: ['tests/browser/generator-refs.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
  },
  define: { 'process.env': '{}', 'process.env.NODE_ENV': '"development"' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).contents

const server = createServer(async (req, res) => {
  if (req.url === '/fixture.js') {
    res.setHeader('Content-Type', 'text/javascript'); res.end(script)
  } else if (req.url === '/test-video.mp4') {
    const media = execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'color=c=blue:s=320x180:r=24:d=60', '-an', '-c:v', 'libx264', '-preset', 'ultrafast', '-movflags', 'frag_keyframe+empty_moov', '-f', 'mp4', 'pipe:1'], { maxBuffer: 8 * 1024 * 1024 })
    res.setHeader('Content-Type', 'video/mp4'); res.end(media)
  } else if (req.url === '/fixture.css') {
    res.setHeader('Content-Type', 'text/css'); res.end(css)
  } else if (req.url === '/global.css') {
    res.setHeader('Content-Type', 'text/css'); res.end(appCss)
  } else {
    res.setHeader('Content-Type', 'text/html')
    res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))
await page.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  const isLocal = ['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === base.split(':')[2]
  if (isLocal && !url.pathname.startsWith('/api/')) {
    const swatchColor = url.pathname.match(/^\/swatch-([0-9a-f]{6})\.svg$/)?.[1]
    if (swatchColor) {
      return await route.fulfill({ status: 200, contentType: 'image/svg+xml', body: `<svg xmlns="http://www.w3.org/2000/svg" width="160" height="160"><rect width="160" height="160" fill="#${swatchColor}"/></svg>` })
    }
    if (route.request().resourceType() === 'image') return await route.fulfill({ status: 204, contentType: 'image/png', body: '' })
    return await route.continue()
  }
  const referer = new URL(route.request().headers().referer || 'http://localhost')
  const resolutionQuery = url.searchParams.get('resolutions') || referer.searchParams.get('resolutions')
  const maxImageReferences = Number(url.searchParams.get('maximage') || referer.searchParams.get('maximage') || 9)
  const videoModel = {
    modelKey: 'kuaizi::doubao-seedance-2-5-260628',
    name: 'doubao-seedance-2-5-260628',
    provider: 'nori',
    tier: 'pro',
    configured: true,
    available: true,
    firstLastFrame: true,
    supportGenerateAudio: true,
    options: {
      duration: [4, 5, 6, 8, 10],
      resolution: resolutionQuery === '720p'
        ? ['720p']
        : resolutionQuery === '1080p' ? ['480p', '720p', '1080p'] : ['480p', '720p'],
      aspectRatio: ['16:9', '9:16', '1:1'],
      generateAudio: [true, false],
    },
    inputSchema: {
      image: { min: 0, max: maxImageReferences },
      video: { min: 0, max: 3 },
      audio: { min: 0, max: 3, maxTotalDurationSeconds: 15 },
      requiredFields: ['prompt'],
    },
  }
  const body = url.pathname.includes('generation-quote')
    ? { points: 120, costCny: 1.2 }
    : url.pathname.includes('generation-config')
    ? {
      textModels: [],
      imageModels: [{ ...videoModel, modelKey: 'openlux::gpt-image-2.5-sunburst', name: 'gpt-image-2.5-sunburst' }],
      videoModels: [videoModel],
      audioModels: [{ modelKey: 'nori::nori-audio', name: 'speech-2.8-hd', tier: 'standard', configured: true, available: true, options: {}, audioModes: ['tts', 'music', 'sfx'] }],
      model3dModels: [],
      defaults: {
        textModel: null, imageModel: 'openlux::gpt-image-2.5-sunburst', editModel: null, storyboardModel: null,
        videoModel: 'kuaizi::doubao-seedance-2-5-260628', audioModel: 'nori::nori-audio', model3dModel: null,
        aspectRatio: '16:9', resolution: '720p',
      },
    }
    : url.pathname.includes('voices')
      ? { voices: [] }
      : { balancePoints: 1200, generationAllowed: true }
  await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) })
})

const results = []
try {
  for (const [query, expectedType] of [
    ['', 'all'],
    ['?mode=image', 'image'],
    ['?mode=firstlastframe', 'image'],
    ['?type=audio', 'audio'],
    ['?type=image', 'image'],
    ['?refs=1', 'all'],
    ['?refs=1&voice=1', 'all'],
    ['?refs=1&voice=1&voicetoggle=1', 'all'],
  ]) {
    await page.goto(`${base}/${query}`)
    const row = page.locator('.nori-canvas-generator-refs')
    await row.waitFor()
    const add = row.getByRole('button', { name: '添加引用素材' })
    assert.equal(await add.count(), 1, `expected exactly one add button for ${query || 'video'}`)
    const boxes = await row.locator('> *').evaluateAll((items) => items.map((item) => {
      const r = item.getBoundingClientRect()
      return { label: item.getAttribute('aria-label') || item.textContent?.trim() || item.className, x: r.x, right: r.right }
    }))
    const addIndex = boxes.findIndex((box) => box.label === '添加引用素材')
    assert.equal(addIndex, boxes.length - 1, `add button must be the last item for ${query || 'video'}`)
    const others = boxes.filter((box) => box.label !== '添加引用素材')
    if (others.length > 0) {
      assert.ok(boxes[addIndex].x >= Math.max(...others.map((box) => box.x)), `add button must sit at the right edge for ${query || 'video'}`)
    }
    if (query === '?refs=1&voice=1') {
      const badges = page.locator('.nori-canvas-generator-ref-voice')
      assert.equal(await badges.count(), 2, 'bound and missing character voices must both show a badge')
      const badgeState = await badges.evaluateAll((items) => items.map((item) => {
        const card = item.closest('.nori-canvas-generator-ref')
        const badge = item.getBoundingClientRect()
        const cardBox = card?.getBoundingClientRect()
        return {
          text: item.textContent?.trim(),
          tone: item.className,
          insideCard: Boolean(cardBox
            && badge.top >= cardBox.top && badge.left >= cardBox.left
            && badge.right <= cardBox.right && badge.bottom <= cardBox.bottom),
        }
      }))
      assert.deepEqual(badgeState.map((item) => item.text).sort(), ['缺音色', '音色'], 'unexpected voice badge labels')
      assert.ok(badgeState.every((item) => item.insideCard), 'voice badges must not be clipped by the 52px reference card')
      assert.ok(badgeState.some((item) => item.tone.includes('is-bound')))
      assert.ok(badgeState.some((item) => item.tone.includes('is-missing')))
      const hint = page.locator('.nori-canvas-generator-voice-hint')
      await hint.waitFor()
      const hintText = await hint.textContent()
      assert.match(hintText, /全能参考将自动带入 1 个角色音色/)
      assert.match(hintText, /另有 1 个角色缺音色/)
      assert.ok((await hint.getAttribute('class'))?.includes('is-warning'), 'missing voice in reference mode must be warned')
    }
    if (query === '?refs=1&voice=1&voicetoggle=1') {
      const toggle = page.getByRole('button', { name: '拆卸角色音色 苏晚卿', exact: true })
      assert.equal(await toggle.count(), 1, 'a bound character voice exposes one detach toggle')
      assert.equal(await page.locator('.nori-canvas-generator-ref-voice-toggle').count(), 1, 'a character without a voice has no detach toggle')
      const toggleBox = await toggle.boundingBox()
      const itemBox = await toggle.locator('xpath=ancestor::span[contains(@class,"nori-canvas-generator-ref-item")]').boundingBox()
      assert.ok(toggleBox && itemBox && toggleBox.x >= itemBox.x - 0.5 && toggleBox.x + toggleBox.width <= itemBox.x + itemBox.width + 0.5 && toggleBox.y + toggleBox.height <= itemBox.y + itemBox.height + 0.5, 'the toggle stays inside the 42px reference tile')
      assert.equal(await page.locator('.nori-canvas-generator-ref.is-selected').count() > 0, true)
      const selectedBefore = await page.locator('.nori-canvas-generator-ref.is-selected').count()
      await toggle.click()
      await page.getByRole('button', { name: '恢复携带角色音色 苏晚卿', exact: true }).waitFor()
      assert.equal(await page.getByTestId('voice-toggle-calls').textContent(), 'img-1', 'the toggle reports the character node id')
      assert.equal(await page.locator('.nori-canvas-generator-ref.is-selected').count(), selectedBefore, 'toggling the voice must not change which references are used')
      assert.match(await page.locator('.nori-canvas-generator-ref-voice-toggle').textContent(), /已拆卸/)
      assert.ok((await page.locator('.nori-canvas-generator-ref-voice-toggle').getAttribute('class')).includes('is-detached'))
      const detachedHint = await page.locator('.nori-canvas-generator-voice-hint').textContent()
      assert.match(detachedHint, /1 个已拆卸|1 个角色音色已拆卸/)
      assert.match(detachedHint, /另有 1 个角色缺音色|不会带入角色音频/)
      await page.screenshot({ path: path.join(artifacts, 'voice-detached.png') })
      await page.getByRole('button', { name: '恢复携带角色音色 苏晚卿', exact: true }).click()
      await page.getByRole('button', { name: '拆卸角色音色 苏晚卿', exact: true }).waitFor()
      assert.equal(await page.getByTestId('voice-toggle-calls').textContent(), 'img-1,img-1')
    }
    await add.click()
    const addMenu = page.getByRole('menu', { name: '添加引用素材', exact: true })
    await addMenu.waitFor()
    assert.equal(await addMenu.getByRole('menuitem').count(), 2, `the add menu offers canvas and library for ${query || 'video'}`)
    assert.equal(await addMenu.getByRole('menuitem', { name: /从画布选择/ }).count(), 1)
    assert.equal(await addMenu.getByRole('menuitem', { name: /从素材库选择/ }).count(), 1)
    await page.screenshot({ path: path.join(artifacts, `refs-${results.length}.png`) })
    await page.keyboard.press('Escape')
    await addMenu.waitFor({ state: 'detached' })
    assert.equal(await page.evaluate(() => window.__fixture.closeCalls), 0, 'Escape on the add menu must not close the node editor')
    const expectedModel = expectedType === 'audio'
      ? { key: 'nori::nori-audio', name: 'speech-2.8-hd' }
      : query.includes('type=image')
        ? { key: 'openlux::gpt-image-2.5-sunburst', name: 'gpt-image-2.5-sunburst' }
        : { key: 'kuaizi::doubao-seedance-2-5-260628', name: 'doubao-seedance-2-5-260628' }
    const modelSelect = page.locator(`.nori-canvas-generator-select select:has(option[value="${expectedModel.key}"])`)
    assert.equal(await modelSelect.count(), 1, `exactly one model select must contain ${expectedModel.key} for ${query}`)
    assert.equal(await modelSelect.inputValue(), expectedModel.key)
    assert.equal(await modelSelect.locator('option:checked').textContent(), expectedModel.name, 'The UI must show the actual selected model id')
    const modelText = await modelSelect.innerText()
    assert.doesNotMatch(modelText, /LanMiaoTV|Nori Image|kuaizi|huimengi|openlux| · (?:Mini|Fast|标准|Pro)/i, 'No provider or packaged model tier is user-visible')
    if (expectedType !== 'audio') {
      await page.locator('.nori-canvas-parameter-trigger').click()
      if (query === '?mode=firstlastframe') {
        // 已保存的首尾帧节点不能被错误降级成全能参考。
        const mode = await page.locator('.nori-canvas-generator-parameter-grid select').first().inputValue()
        assert.equal(mode, 'firstlastframe', 'saved first/last frame mode must survive configuration loading')
      }
      await page.keyboard.press('Escape')
    }
    await add.click()
    await addMenu.getByRole('menuitem', { name: /从素材库选择/ }).click()
    const added = JSON.parse(await page.getByTestId('added-request').textContent())
    assert.equal(added.type, expectedType, `picker media type for ${query || 'video'}`)
    assert.ok(added.maxSelected >= 1)
    results.push({ query: query || '(default video)', type: added.type, maxSelected: added.maxSelected, items: boxes.length })
  }
  // ---- 从画布选择引用素材 ----
  const refsRow = page.locator('.nori-canvas-generator-refs')
  const pickMenu = page.getByRole('menu', { name: '添加引用素材', exact: true })
  const picker = page.getByTestId('canvas-reference-picker')
  const pickerTile = (name) => picker.locator('.nori-canvas-reference-picker-tile', { hasText: name })
  const pickerNames = () => picker.locator('.nori-canvas-reference-picker-name').allTextContents()
  const pickerSummary = () => picker.locator('.nori-canvas-reference-picker-summary > b').textContent()
  const pickerHint = () => picker.locator('.nori-canvas-reference-picker-summary > small').textContent()
  const confirmButton = () => picker.getByRole('button', { name: '添加引用', exact: true })
  const pickOrder = async (name) => (await pickerTile(name).locator('.nori-canvas-reference-picker-order').textContent()).trim()
  const lastDraftIds = () => page.evaluate(() => window.__fixture.drafts.at(-1)?.generation?.referenceNodeIds ?? null)
  const activeLabel = () => page.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? null)
  const waitForDraftIds = (length) => page.waitForFunction((expected) => window.__fixture.drafts.at(-1)?.generation?.referenceNodeIds?.length === expected, length)
  const gotoPicker = async (query) => {
    await page.goto(`${base}/${query}`)
    await refsRow.waitFor()
  }
  const openMenu = async () => {
    await refsRow.getByRole('button', { name: '添加引用素材', exact: true }).click()
    await pickMenu.waitFor()
  }
  const openPicker = async () => {
    await openMenu()
    await pickMenu.getByRole('menuitem', { name: /从画布选择/ }).click()
    await picker.waitFor()
    await pickMenu.waitFor({ state: 'detached' })
  }
  const closePickerWithEscape = async () => {
    await page.keyboard.press('Escape')
    await picker.waitFor({ state: 'detached' })
  }

  await page.setViewportSize({ width: 1280, height: 900 })
  await gotoPicker('?picker=1&pickermedia=1&refs=1')
  await openMenu()
  assert.equal(await pickMenu.getByRole('menuitem', { name: /从画布选择/ }).locator('small').textContent(), '7', 'the menu counts every referenceable canvas asset')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.includes('从画布选择')), true, 'opening the menu focuses its first enabled item')
  const menuBox = await pickMenu.boundingBox()
  assert.ok(menuBox && menuBox.x >= 0 && menuBox.y >= 0 && menuBox.x + menuBox.width <= 1280 && menuBox.y + menuBox.height <= 900, 'the add menu stays inside the viewport')
  await page.screenshot({ path: path.join(artifacts, 'canvas-picker-menu.png') })
  await pickMenu.getByRole('menuitem', { name: /从画布选择/ }).click()
  await picker.waitFor()
  await pickMenu.waitFor({ state: 'detached' })
  assert.equal(await activeLabel(), '搜索画布素材', 'the search box is focused when the dialog opens')
  assert.deepEqual(await pickerNames(), ['苏晚卿', '林间小屋', '城市夜景', '海边日落', '镜头二 无封面', '镜头一 海边', '旁白录音'], 'newest canvas assets come first; text, pending nodes and the generator are not offered')
  assert.deepEqual(await picker.locator('.nori-canvas-reference-picker-types > button').allTextContents(), ['全部 7', '图片 4', '视频 2', '音频 1'])
  const referencedTile = pickerTile('苏晚卿')
  assert.equal(await referencedTile.getAttribute('aria-disabled'), 'true')
  assert.match(await referencedTile.locator('em').textContent(), /已引用/)
  assert.match(await pickerTile('林间小屋').locator('em').textContent(), /角色/)
  await referencedTile.click({ force: true })
  assert.equal(await pickerSummary(), '已选 0 个', 'an asset that is already a reference cannot be picked again')
  assert.equal(await confirmButton().isDisabled(), true)
  await page.screenshot({ path: path.join(artifacts, 'canvas-picker-all.png') })

  await picker.getByRole('button', { name: '视频 2', exact: true }).click()
  assert.deepEqual(await pickerNames(), ['镜头二 无封面', '镜头一 海边'])
  assert.equal(await picker.getByRole('button', { name: '视频 2', exact: true }).getAttribute('aria-pressed'), 'true')
  await picker.getByRole('button', { name: '全部 7', exact: true }).click()
  const pickerSearch = picker.getByRole('textbox', { name: '搜索画布素材' })
  await pickerSearch.fill('海')
  assert.deepEqual(await pickerNames(), ['海边日落', '镜头一 海边'], 'fuzzy search ranks the prefix match first')
  await pickerSearch.fill('海日')
  assert.deepEqual(await pickerNames(), ['海边日落'], 'characters in order match too')
  await pickerSearch.fill('不存在的素材')
  assert.equal(await picker.locator('.nori-canvas-reference-picker-empty').textContent(), '没有匹配“不存在的素材”的画布素材')
  await pickerSearch.fill('')
  assert.equal((await pickerNames()).length, 7)

  await pickerTile('城市夜景').click()
  await pickerTile('海边日落').click()
  await pickerTile('镜头一 海边').click()
  assert.deepEqual([await pickOrder('城市夜景'), await pickOrder('海边日落'), await pickOrder('镜头一 海边')], ['2', '3', '4'], 'pick order continues after the existing reference')
  assert.equal(await pickerSummary(), '已选 3 个')
  const capacity = await pickerHint()
  assert.match(capacity, /图片还可添加 6 个/)
  assert.match(capacity, /视频还可添加 2 个/)
  assert.match(capacity, /音频还可添加 3 个/)
  await pickerTile('海边日落').click()
  assert.deepEqual([await pickOrder('城市夜景'), await pickOrder('镜头一 海边')], ['2', '3'], 'deselecting renumbers the remaining picks')
  await pickerTile('海边日落').click()
  assert.equal(await pickOrder('海边日落'), '4', 'a re-picked asset goes to the end')
  await page.screenshot({ path: path.join(artifacts, 'canvas-picker-selected.png') })
  await confirmButton().click()
  await picker.waitFor({ state: 'detached' })
  assert.equal(await page.getByTestId('added-request').textContent(), 'none', 'canvas picking never goes through the material library callback')
  await waitForDraftIds(4)
  assert.deepEqual(await lastDraftIds(), ['img-1', 'pick-img-2', 'pick-vid-1', 'pick-img-1'], 'picked assets are appended in pick order')
  assert.equal(await refsRow.locator('.nori-canvas-generator-ref-item').count(), 4, 'picked assets become reference tiles without any wire')
  assert.deepEqual(await refsRow.locator('.nori-canvas-generator-ref-order').allTextContents(), ['1', '2', '3', '4'])
  assert.equal(await activeLabel(), '添加引用素材', 'focus returns to the add button')
  await page.screenshot({ path: path.join(artifacts, 'canvas-picker-confirmed.png') })
  await refsRow.getByRole('button', { name: '移除引用素材 城市夜景', exact: true }).click()
  await waitForDraftIds(3)
  assert.deepEqual(await lastDraftIds(), ['img-1', 'pick-vid-1', 'pick-img-1'])
  await openPicker()
  assert.equal(await picker.locator('.nori-canvas-reference-picker-tile.is-referenced').count(), 3, 'every current reference is marked, nothing else')
  assert.equal(await pickerTile('城市夜景').getAttribute('aria-disabled'), 'false', 'a removed reference can be picked again')
  await picker.click({ position: { x: 6, y: 6 } })
  await picker.waitFor({ state: 'detached' })
  results.push({ canvasPickerBasics: true, pickedOrder: await lastDraftIds() })

  await gotoPicker('?picker=1&refs=1&maximage=2')
  await openPicker()
  assert.deepEqual(await pickerNames(), ['苏晚卿', '林间小屋', '城市夜景', '海边日落'])
  assert.match(await pickerHint(), /图片还可添加 1 个/)
  await pickerTile('林间小屋').click()
  assert.match(await pickerHint(), /图片还可添加 0 个/)
  assert.ok((await pickerTile('城市夜景').getAttribute('class')).includes('is-limited'))
  await pickerTile('城市夜景').click({ force: true })
  assert.equal(await picker.getByRole('alert').textContent(), '当前模型最多再引用 1 个图片，已选满。')
  assert.equal(await pickerSummary(), '已选 1 个', 'a pick beyond the model limit is rejected')
  await pickerTile('林间小屋').click()
  await picker.getByRole('alert').waitFor({ state: 'detached' })
  await pickerTile('城市夜景').click()
  assert.equal(await pickerSummary(), '已选 1 个')
  await confirmButton().click()
  await picker.waitFor({ state: 'detached' })
  await waitForDraftIds(2)
  assert.deepEqual(await lastDraftIds(), ['img-1', 'pick-img-2'])
  await openPicker()
  assert.equal(await picker.locator('.nori-canvas-reference-picker-summary > small').count(), 0, 'no capacity hint once the model limit is reached')
  assert.ok((await pickerTile('海边日落').getAttribute('class')).includes('is-limited'))
  await pickerTile('海边日落').click({ force: true })
  assert.equal(await confirmButton().isDisabled(), true, 'nothing can be added past the limit')
  await closePickerWithEscape()
  results.push({ canvasPickerModelLimit: true })

  await gotoPicker('?mode=firstlastframe&picker=1&pickermedia=1')
  await openPicker()
  assert.deepEqual(await pickerNames(), ['林间小屋', '城市夜景', '海边日落'], 'first/last frame mode only takes images')
  assert.equal(await picker.locator('.nori-canvas-reference-picker-types').count(), 0, 'a single media type needs no type chips')
  await pickerTile('海边日落').click()
  await pickerTile('城市夜景').click()
  assert.deepEqual([await pickOrder('海边日落'), await pickOrder('城市夜景')], ['首', '尾'])
  await pickerTile('林间小屋').click({ force: true })
  assert.equal(await picker.getByRole('alert').textContent(), '当前模型最多再引用 2 个图片，已选满。')
  await confirmButton().click()
  await picker.waitFor({ state: 'detached' })
  await waitForDraftIds(2)
  assert.deepEqual(await lastDraftIds(), ['pick-img-1', 'pick-img-2'])
  assert.deepEqual(await refsRow.locator('.nori-canvas-generator-ref-order').allTextContents(), ['首', '尾'])
  results.push({ canvasPickerFirstLastFrame: true })

  await gotoPicker('?picker=1&wired=1')
  assert.equal(await refsRow.locator('.nori-canvas-generator-ref-item').count(), 1, 'the wired asset is listed but not selected')
  assert.equal(await refsRow.locator('.nori-canvas-generator-ref.is-selected').count(), 0)
  await openPicker()
  assert.match(await pickerTile('城市夜景').locator('em.is-wired').textContent(), /已连线/)
  await pickerTile('城市夜景').click()
  await confirmButton().click()
  await picker.waitFor({ state: 'detached' })
  await waitForDraftIds(1)
  assert.deepEqual(await lastDraftIds(), ['pick-img-2'])
  assert.equal(await refsRow.locator('.nori-canvas-generator-ref-item').count(), 1, 'a wired asset is not listed twice')
  assert.equal(await refsRow.locator('.nori-canvas-generator-ref.is-selected').count(), 1)
  results.push({ canvasPickerWiredAsset: true })

  await gotoPicker('?picker=1&pickermedia=1&refs=1')
  await page.evaluate(() => {
    window.__leakedKeys = []
    window.addEventListener('keydown', (event) => window.__leakedKeys.push(event.key))
  })
  const leakedKeys = () => page.evaluate(() => window.__leakedKeys)
  await openPicker()
  await page.keyboard.press('ArrowRight')
  await pickerTile('城市夜景').focus()
  await page.keyboard.press('ArrowRight')
  await page.keyboard.press('Backspace')
  await page.evaluate(() => document.activeElement?.blur())
  assert.equal(await page.evaluate(() => document.activeElement === document.body), true)
  await page.keyboard.press('Backspace')
  await page.keyboard.press('Delete')
  assert.deepEqual(await leakedKeys(), [], 'no key typed while the dialog is open reaches the canvas shortcuts')
  await closePickerWithEscape()
  assert.deepEqual(await leakedKeys(), [], 'Escape is consumed by the dialog even when focus fell to the page')
  assert.equal(await page.evaluate(() => window.__fixture.closeCalls), 0, 'closing the dialog must not close the node editor')
  assert.equal(await activeLabel(), '添加引用素材')
  await page.keyboard.press('ArrowRight')
  assert.deepEqual(await leakedKeys(), ['ArrowRight'], 'canvas shortcuts work again once the dialog is gone')
  await openMenu()
  await page.keyboard.press('Escape')
  await pickMenu.waitFor({ state: 'detached' })
  assert.equal(await page.evaluate(() => window.__fixture.closeCalls), 0, 'Escape on the menu only closes the menu')
  assert.equal(await activeLabel(), '添加引用素材')
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => window.__fixture.closeCalls === 1)
  results.push({ canvasPickerKeyboardIsolation: true })

  await gotoPicker('')
  await openMenu()
  const emptyCanvasItem = pickMenu.getByRole('menuitem', { name: /从画布选择/ })
  assert.equal(await emptyCanvasItem.isDisabled(), true)
  assert.equal(await emptyCanvasItem.locator('small').textContent(), '0')
  assert.equal(await emptyCanvasItem.getAttribute('title'), '画布上暂无当前模型可引用的素材')
  assert.equal(await page.evaluate(() => document.activeElement?.textContent?.includes('从素材库选择')), true, 'focus skips the disabled canvas item')
  await page.keyboard.press('Escape')
  await pickMenu.waitFor({ state: 'detached' })
  results.push({ canvasPickerEmptyCanvas: true })

  await gotoPicker('?type=image&picker=1&pickermedia=1')
  await openPicker()
  assert.deepEqual(await pickerNames(), ['林间小屋', '城市夜景', '海边日落'], 'an image generator is only offered images')
  await closePickerWithEscape()
  await gotoPicker('?type=audio&picker=1&pickermedia=1')
  await openMenu()
  const audioCanvasItem = pickMenu.getByRole('menuitem', { name: /从画布选择/ })
  assert.equal(await audioCanvasItem.isDisabled(), true, 'a speech model that takes no audio references offers nothing to pick from the canvas')
  assert.equal(await audioCanvasItem.locator('small').textContent(), '0')
  await page.keyboard.press('Escape')
  await pickMenu.waitFor({ state: 'detached' })
  results.push({ canvasPickerMediaTypes: true })

  await gotoPicker('?picker=1&pickermedia=1')
  await openPicker()
  const pickerMetrics = await page.evaluate(() => {
    const height = (selector) => document.querySelector(selector)?.getBoundingClientRect().height
    const body = document.querySelector('.nori-canvas-reference-picker-body')
    return {
      search: height('.nori-canvas-reference-picker-search input'),
      chip: height('.nori-canvas-reference-picker-types > button'),
      footerButtons: [...document.querySelectorAll('.nori-canvas-reference-picker > footer > button')].map((button) => button.getBoundingClientRect().height),
      horizontalOverflow: body.scrollWidth > body.clientWidth,
    }
  })
  assert.equal(pickerMetrics.search, 32, JSON.stringify(pickerMetrics))
  assert.equal(pickerMetrics.chip, 28, JSON.stringify(pickerMetrics))
  assert.deepEqual(pickerMetrics.footerButtons, [40, 40], JSON.stringify(pickerMetrics))
  assert.equal(pickerMetrics.horizontalOverflow, false)
  for (const viewport of [{ width: 390, height: 700 }, { width: 768, height: 480 }]) {
    await page.setViewportSize(viewport)
    const fit = await page.evaluate(() => {
      const box = (element) => { const r = element.getBoundingClientRect(); return { left: r.left, top: r.top, right: r.right, bottom: r.bottom } }
      return {
        dialog: box(document.querySelector('.nori-canvas-reference-picker')),
        actions: [...document.querySelectorAll('.nori-canvas-reference-picker > footer > button')].map(box),
        search: box(document.querySelector('.nori-canvas-reference-picker-search input')),
      }
    })
    for (const rect of [fit.dialog, ...fit.actions, fit.search]) {
      assert.ok(rect.left >= 0 && rect.top >= 0 && rect.right <= viewport.width && rect.bottom <= viewport.height, `picker controls must stay on screen at ${viewport.width}x${viewport.height}: ${JSON.stringify(fit)}`)
    }
    await page.screenshot({ path: path.join(artifacts, `canvas-picker-${viewport.width}.png`) })
  }
  await closePickerWithEscape()
  results.push({ canvasPickerControlSizesAndViewports: true })
  await page.setViewportSize({ width: 1280, height: 900 })

  for (const [query, expected] of [
    ['?superresolve=720p', '480p 生成 → 720p'],
    ['?superresolve=1080p', '720p 生成 → 1080p'],
    ['?superresolve=4k&resolutions=1080p', '1080p 生成 → 4K'],
  ]) {
    await page.goto(`${base}/${query}`)
    const trigger = page.locator('.nori-canvas-parameter-trigger')
    await trigger.waitFor()
    await page.waitForFunction((text) => document.querySelector('.nori-canvas-parameter-trigger')?.textContent?.includes(text), expected, { timeout: 3000 }).catch(async () => {
      await page.screenshot({ path: path.join(artifacts, 'superresolve-failure.png') })
      throw new Error(`${query}: expected ${expected}, received ${await trigger.innerText()}`)
    })
    assert.ok((await trigger.innerText()).includes(expected), `${query} must show the actual billed generation resolution`)
    await trigger.click()
    const settings = page.getByRole('dialog', { name: '生成参数设置', exact: true })
    await settings.getByText(`模型按 ${expected.split(' 生成')[0]} 生成并计费`, { exact: false }).waitFor()
    assert.equal(await page.getByRole('button', { name: '生成', exact: true }).isEnabled(), true)
    await page.screenshot({ path: path.join(artifacts, `superresolve-${expected.split(' → ')[1]}.png`) })
    results.push({ query, billedGenerationResolution: expected })
  }
  await page.goto(`${base}/?superresolve=720p&resolutions=720p`)
  const unsupportedTrigger = page.locator('.nori-canvas-parameter-trigger')
  await unsupportedTrigger.waitFor()
  assert.ok((await unsupportedTrigger.innerText()).includes('当前模型不支持'))
  assert.equal(await page.getByRole('button', { name: '生成', exact: true }).isDisabled(), true)
  await unsupportedTrigger.click()
  await page.getByText('当前模型没有低于超分目标的生成档位', { exact: false }).waitFor()
  results.push({ unsupportedSuperresolveTargetBlocked: true })

  for (const viewport of [{ width: 390, height: 700 }, { width: 768, height: 480 }, { width: 1024, height: 600 }]) {
    await page.setViewportSize(viewport)
    await page.goto(`${base}/?stale=1`)
    const warning = page.getByRole('alert').filter({ hasText: '有 1 个引用节点已删除' })
    await warning.waitFor()
    const clear = warning.getByRole('button', { name: '清除失效引用', exact: true })
    await clear.scrollIntoViewIfNeeded()
    for (const control of [warning, clear, page.getByRole('button', { name: '关闭节点编辑器', exact: true }), page.getByRole('button', { name: '生成', exact: true })]) {
      const box = await control.boundingBox()
      assert.ok(box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width && box.y + box.height <= viewport.height,
        `Stale reference warning and recovery must fit ${viewport.width}x${viewport.height}: ${JSON.stringify(box)}`)
    }
    await page.screenshot({ path: path.join(artifacts, `stale-${viewport.width}.png`) })
    await clear.click()
    await warning.waitFor({ state: 'hidden' })
    results.push({ viewport: `${viewport.width}x${viewport.height}`, staleReferenceWarningAndRecovery: true })
  }
  await page.setViewportSize({ width: 1024, height: 700 })
  await page.goto(`${base}/?refresh=1`)
  const textarea = page.locator('.nori-canvas-generator-prompt textarea')
  await textarea.waitFor()
  await textarea.fill(Array.from({ length: 36 }, (_, index) => `第 ${index + 1} 段长提示词，滚轮后应能看到这一行。`).join('\n'))
  await page.waitForTimeout(100)
  await textarea.hover()
  await page.mouse.wheel(0, 500)
  await page.waitForTimeout(100)
  const scrolled = await textarea.evaluate((element) => ({
    scrollTop: element.scrollTop,
    scrollHeight: element.scrollHeight,
    clientHeight: element.clientHeight,
    highlightScrollTop: element.parentElement?.querySelector('.mention-prompt-highlight')?.scrollTop,
    height: getComputedStyle(element).height,
    parentHeight: getComputedStyle(element.parentElement).height,
  }))
  assert.ok(scrolled.scrollTop > 0, 'wheel must scroll long prompt text')
  assert.equal(scrolled.highlightScrollTop, scrolled.scrollTop, 'highlight must follow textarea scroll')
  await page.getByRole('button', { name: '展开大编辑器', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  const fullscreen = page.locator('.nori-canvas-generator.is-fullscreen')
  await fullscreen.waitFor()
  const fullscreenGeometry = await fullscreen.locator('textarea').evaluate((element) => ({
    clientHeight: element.clientHeight,
    scrollHeight: element.scrollHeight,
    fullscreenHeight: document.querySelector('.nori-canvas-generator.is-fullscreen')?.clientHeight,
  }))
  assert.ok(fullscreenGeometry.clientHeight > 400 && fullscreenGeometry.clientHeight > fullscreenGeometry.fullscreenHeight * .6, `fullscreen prompt must occupy the available editor height: ${JSON.stringify(fullscreenGeometry)}`)
  assert.ok(fullscreenGeometry.scrollHeight > fullscreenGeometry.clientHeight, 'fullscreen prompt must scroll instead of clipping text')
  await fullscreen.locator('textarea').hover()
  await page.mouse.wheel(0, 500)
  await page.waitForTimeout(100)
  const fullscreenScrolled = await fullscreen.locator('textarea').evaluate((element) => ({
    scrollTop: element.scrollTop,
    highlightScrollTop: element.parentElement?.querySelector('.mention-prompt-highlight')?.scrollTop,
  }))
  assert.ok(fullscreenScrolled.scrollTop > 0, 'fullscreen prompt must scroll long text')
  assert.equal(fullscreenScrolled.highlightScrollTop, fullscreenScrolled.scrollTop, 'fullscreen highlight must follow textarea scroll')
  await page.screenshot({ path: path.join(artifacts, 'fullscreen-long-prompt.png') })
  await fullscreen.locator('.nori-canvas-generator-head-actions button[aria-label="返回画布"]').click()
  await textarea.fill('后台刷新前的完整草稿')
  await page.getByTestId('refresh-task').click()
  assert.equal(await textarea.inputValue(), '后台刷新前的完整草稿', 'task progress refresh must not reset a draft')
  results.push({ longPromptScroll: true, highlightScroll: true, refreshedDraft: true })

  await page.goto(`${base}/?video=1`)
  await page.getByRole('button', { name: '播放', exact: true }).click()
  await page.waitForFunction(() => {
    const video = document.querySelector('video')
    if (!video || video.readyState < 1) return false
    video.playbackRate = 16
    video.currentTime = 44.8
    return true
  })
  await page.waitForFunction(() => {
    const time = document.querySelector('.nori-canvas-video-bar > span')?.textContent || ''
    return Number.parseInt(time.split(':')[1], 10) > 45
  }, null, { timeout: 3000 })
  results.push({ playbackPast45Seconds: true })
  assert.deepEqual(errors, [], 'no browser errors')
  console.log(JSON.stringify({ results, browserErrors: errors, artifacts }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
