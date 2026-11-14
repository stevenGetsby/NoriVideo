// Real FosScreenwriter + FosVideoRepaintTask; every network API is a local mock.
// No paid generation, no production data, and no provider credentials are used.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/video-repaint-writer')
await mkdir(artifacts, { recursive: true })

const sampleVideo = process.env.NORI_TEST_VIDEO_PATH || path.join(root, 'test-results/canvas-ui-regression/sample.mp4')
assert.ok(existsSync(sampleVideo), `A local mp4 fixture is required: ${sampleVideo}`)
const globalCssPath = process.env.NORI_BROWSER_GLOBAL_CSS_PATH || path.join(root, 'test-results/material-bundles/global.css')
assert.ok(existsSync(globalCssPath), `Compiled app CSS is required: ${globalCssPath}`)
const appCss = await readFile(globalCssPath)
const invalidVideo = path.join(artifacts, 'not-a-video.webm')
await writeFile(invalidVideo, Buffer.from('not a supported video'))

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/video-repaint-writer.fixture.tsx'],
  bundle: true,
  write: false,
  outdir: '/fixture',
  jsx: 'automatic',
  platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const fixtureCss = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.contents

const server = createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(script)
  } else if (request.url === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css')
    response.end(fixtureCss)
  } else if (request.url === '/global.css') {
    response.setHeader('Content-Type', 'text/css')
    response.end(appCss)
  } else {
    response.setHeader('Content-Type', 'text/html')
    response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const sourceScript = '第1集\n1-1\n场景：测试房间 - 夜 - 暗\n人物：测试人物\n△测试人物抬头。'
const outlineText = [
  '1. 目标市场版故事核与类型承诺',
  '乡镇家庭伦理，强情节、强因果。',
  '2. 目标语言与文字系统合同',
  '简体中文，口语化。',
  '3. 本地化总策略',
  '保留全部剧情功能。',
  '4. 权力结构映射',
  '家族长辈掌握话语权。',
  '5. 主要人物小传',
  '女主：乡镇护士。',
  '6. 阶段变体和身份伪装',
  '中段伪装成远房亲戚。',
  '7. 关键道具和身份锚点',
  '旧怀表。',
  '8. 尺度、禁忌和平台表达',
  '冲突克制，避免血腥。',
].join('\n')
const targetScriptText = [
  '《测试目标剧本》',
  '第 1 集 《测试单集》',
  '',
  '## S1 [测试房间 · 夜 · 内] 角色：测试人物',
  '造型：测试人物=深色外套',
  '',
  '### SH001 [00:00.0-00:02.0]',
  '镜头：中景',
  '画面：测试人物坐在桌边。',
  '表情动作：抬头。',
  '光影：暖色台灯。',
  '测试人物 (对口型·平静)：{完整测试台词。}',
].join('\n')
const firstStoryboard = [
  '## S1 [测试房间 · 夜 · 内] 角色：测试人物',
  '',
  '### SH001 [00:00.0-00:00.8]',
  '镜头：中景',
  '画面：测试人物坐在桌边。',
  '表情动作：抬头。',
  '光影：暖色台灯。',
  '复刻补充：无。',
  '',
  '### SH002 [00:00.8-00:01.4]',
  '镜头：近景',
  '画面：窗外雨夜。',
  '表情动作：无。',
  '光影：冷色路灯。',
  '复刻补充：雨声。',
].join('\n')
const fullStoryboard = [
  firstStoryboard,
  '',
  '### SH003 [00:01.4-00:01.8]',
  '镜头：特写',
  '画面：旧怀表。',
  '表情动作：手指收紧。',
  '光影：高光。',
  '复刻补充：无。',
  '',
  '### SH004 [00:01.8-00:02.0]',
  '镜头：全景',
  '画面：测试人物起身。',
  '表情动作：转身。',
  '光影：剪影。',
  '复刻补充：无。',
].join('\n')
const analysis = {
  schema_version: 'nori-video-repaint-analysis-v1',
  analysis_mode: 'board',
  series_metadata: {},
  source_episode: {
    episode_number: 1,
    duration_seconds: 2,
    formatted_text: sourceScript,
    scenes: [{ scene_id: 'E01-S01', scene_number: '1-1', beats: [{ beat_id: 'E01-S01-B01', type: 'stage_direction', text: '测试人物抬头。' }] }],
  },
  asset_candidates: { characters: [{ asset_ref: 'character_1', name_if_heard: '测试人物' }], locations: [{ location_ref: 'location_1', name_if_known: '测试房间' }], props: [] },
  adaptation_contract: { story_invariants: ['主角要找回妹妹'], do_not_localize: [] },
  quality_report: {},
}

const understandCalls = []
const outlineCalls = []
const targetScriptCalls = []
const saveCalls = []
const scriptListCalls = []
const errors = []
let scenario = 'main'
let scenarioStoryboardRounds = 0
let failNextOutline = true
let cancelNextUnderstand = false
let saveDelayMs = 0
const expectedOutlineFailures = new Set()
let scripts = [
  {
    id: 'vr_docs_seed',
    title: '已存转绘文档',
    type: '视频转绘',
    status: 'draft',
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
    layout: 'documents',
    episodes: [
      { id: 'vr_docs_seed-doc-script', title: '目标剧本', body: '种子剧本正文' },
      { id: 'vr_docs_seed-doc-outline', title: '目标设定总纲', body: '种子总纲正文' },
      { id: 'vr_docs_seed-doc-storyboard', title: '分镜', body: '### SH001 [00:00.0-00:01.0]' },
    ],
  },
  {
    id: 'vr_legacy_seed',
    title: '旧版分集剧本',
    type: '视频转绘',
    status: 'draft',
    createdAt: '2026-11-08T00:00:00.000Z',
    updatedAt: '2026-11-08T00:00:00.000Z',
    episodes: [{ id: 'vr_legacy_seed-ep-1', title: '第 1 集', body: '旧版正文' }],
  },
]

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function sse(route, events) {
  const body = events
    .map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
    .join('')
  return route.fulfill({
    status: 200,
    contentType: 'text/event-stream',
    headers: { 'Cache-Control': 'no-cache, no-transform' },
    body,
  })
}

function sourceResult() {
  return {
    success: true,
    result: {
      fileHandle: 'test-handle',
      script: sourceScript,
      analysis,
      durationSeconds: 2,
      cutHints: [0.4, 1.1, 1.7],
      usage: { inputTokens: 10, outputTokens: 5 },
      validation: { valid: true, errors: [], warnings: [] },
    },
  }
}

function storyboardResult(overrides) {
  return {
    success: true,
    result: {
      fileHandle: 'test-handle',
      storyboard: fullStoryboard,
      complete: true,
      coveredSeconds: 2,
      durationSeconds: 2,
      shotCount: 4,
      addedShots: 2,
      usage: { inputTokens: 8, outputTokens: 4 },
      validation: { valid: true, errors: [], warnings: [] },
      ...overrides,
    },
  }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
  page.on('console', (message) => {
    if (message.type() !== 'error') return
    const locationUrl = message.location().url
    if (expectedOutlineFailures.has(locationUrl)) {
      expectedOutlineFailures.delete(locationUrl)
      return
    }
    errors.push(`console: ${message.text()}`)
  })
  page.on('response', (response) => {
    if (response.url().includes('/api/video-repaint/outline') && response.status() === 503 && expectedOutlineFailures.has(response.url())) return
    if (response.url().includes('/api/') && response.status() >= 400) errors.push(`HTTP ${response.status()} ${response.url()}`)
  })
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const pathname = url.pathname
    const method = request.method()
    try {
      if (pathname === '/api/video-repaint/scripts' && method === 'GET') {
        scriptListCalls.push(pathname)
        return await json(route, { success: true, scripts })
      }
      if (pathname === '/api/video-repaint/scripts' && method === 'POST') {
        const body = request.postDataJSON()
        saveCalls.push(body)
        if (saveDelayMs) await sleep(saveDelayMs)
        const episodes = [
          ...(body.targetScript ? [{ id: 'vr_test_draft-doc-script', title: '目标剧本', body: body.targetScript }] : []),
          ...(body.outline ? [{ id: 'vr_test_draft-doc-outline', title: '目标设定总纲', body: body.outline }] : []),
          ...(body.storyboard ? [{ id: 'vr_test_draft-doc-storyboard', title: '分镜', body: body.storyboard }] : []),
        ]
        const saved = {
          id: 'vr_test_draft',
          title: body.title,
          type: '视频转绘',
          status: 'draft',
          createdAt: '2026-11-08T00:00:00.000Z',
          updatedAt: '2026-11-08T00:00:00.000Z',
          layout: 'documents',
          episodes,
          lineage: body.sourceFileName,
        }
        scripts = [saved, ...scripts]
        return await json(route, { success: true, script: saved })
      }
      if (pathname.startsWith('/api/video-repaint/scripts/')) {
        return await json(route, { success: true })
      }
      if (pathname === '/api/video-repaint/outline' && method === 'POST') {
        const body = request.postDataJSON()
        outlineCalls.push(body)
        if (scenario === 'main' && failNextOutline) {
          failNextOutline = false
          expectedOutlineFailures.add(url.href)
          await sleep(100)
          return await json(route, { success: false, error: { code: 'EXTERNAL_ERROR', message: '模拟目标设定总纲生成失败' } }, 503)
        }
        await sleep(scenario === 'main' ? 300 : 0)
        return await json(route, {
          success: true,
          result: {
            outline: outlineText,
            model: 'nori::nori-gpt',
            usage: { inputTokens: 20, outputTokens: 10 },
            missingSections: scenario === 'main' ? [9, 10] : [],
          },
        })
      }
      if (pathname === '/api/video-repaint/script' && method === 'POST') {
        const body = request.postDataJSON()
        targetScriptCalls.push(body)
        await sleep(100)
        return await json(route, {
          success: true,
          result: { targetScript: targetScriptText, model: 'nori::nori-gpt', usage: { inputTokens: 30, outputTokens: 15 } },
        })
      }
      if (pathname === '/api/video-repaint/understand' && method === 'POST') {
        const contentType = request.headers()['content-type'] || ''
        if (contentType.includes('application/json')) {
          const body = request.postDataJSON()
          scenarioStoryboardRounds += 1
          understandCalls.push({ stage: 'storyboard', body, round: scenarioStoryboardRounds })
          if (scenario === 'main' && scenarioStoryboardRounds === 1) {
            await sleep(600)
            return await sse(route, [
              ['progress', { stage: 'storyboard', outputChars: 30, shots: 1 }],
              ['progress', { stage: 'storyboard', shots: 2 }],
              ['result', storyboardResult({
                storyboard: firstStoryboard,
                complete: false,
                coveredSeconds: 0.8,
                shotCount: 2,
                addedShots: 2,
                validation: { valid: true, errors: [], warnings: ['SH002 时长可能过短'] },
              })],
            ])
          }
          if (scenario === 'main') {
            await sleep(3500)
            return await sse(route, [
              ['progress', { stage: 'storyboard', shots: 4 }],
              ['result', storyboardResult({
                validation: { valid: true, errors: [], warnings: ['SH003 缺少光影描述', 'SH004 时长可能过短'] },
              })],
            ])
          }
          if (scenario === 'incomplete' && scenarioStoryboardRounds === 1) {
            return await sse(route, [
              ['progress', { stage: 'storyboard', shots: 2 }],
              ['result', storyboardResult({
                storyboard: firstStoryboard,
                complete: false,
                coveredSeconds: 0.5,
                shotCount: 2,
                addedShots: 2,
              })],
            ])
          }
          if (scenario === 'script-only') {
            await sleep(100)
            return await sse(route, [
              ['progress', { stage: 'storyboard', shots: 4 }],
              ['result', storyboardResult({ addedShots: 4 })],
            ])
          }
          return await sse(route, [
            ['result', storyboardResult({
              storyboard: firstStoryboard,
              complete: false,
              coveredSeconds: 0.5,
              shotCount: 2,
              addedShots: 0,
            })],
          ])
        }
        const body = request.postDataBuffer()
        const text = body ? body.toString('latin1') : ''
        understandCalls.push({
          stage: 'upload',
          contentType,
          hasFile: text.includes('name="file"'),
          hasMode: text.includes('name="mode"'),
          hasDuration: text.includes('name="durationSeconds"'),
          hasAdaptationBrief: text.includes('name="adaptationBrief"'),
        })
        scenarioStoryboardRounds = 0
        if (cancelNextUnderstand) {
          cancelNextUnderstand = false
          await sleep(900)
        }
        return await sse(route, [
          ['progress', { stage: 'preprocess', elapsedSeconds: 1 }],
          ['progress', { stage: 'analyze', outputChars: 24 }],
          ['result', sourceResult()],
        ])
      }
      return await json(route, { success: false, error: { message: `Unexpected test request: ${method} ${pathname}` } }, 500)
    } catch (error) {
      errors.push(`route ${method} ${pathname}: ${error instanceof Error ? error.message : String(error)}`)
      try {
        await json(route, { success: false, error: { message: 'Mock route failed' } }, 500)
      } catch {}
    }
  })

  await page.goto(base, { waitUntil: 'networkidle' })
  await page.waitForSelector('.writer-page')
  await page.waitForSelector('.create-card')

  const pageText = await page.locator('body').innerText()
  assert.ok(pageText.includes('视频转绘'), 'The screenwriter create card must expose video repaint')
  assert.ok(!pageText.includes('视频转绘已停用'), 'The retired placeholder must not be shown')
  assert.equal(await page.locator('.create-card').count(), 1)

  // The workbench renders a seeded documents-layout script and a legacy episode script side by side.
  assert.equal(await page.locator('.list-row').count(), 2)
  const seededDocumentsRow = page.locator('.list-row', { hasText: '已存转绘文档' })
  assert.ok((await seededDocumentsRow.innerText()).includes('3 份文档'))
  assert.equal(await seededDocumentsRow.locator('.list-title-count').innerText(), '3 份文档')
  assert.equal(await page.locator('.rail-ep-num').count(), 0, 'Documents layout must not number the rail as episodes')
  assert.equal(await page.locator('.rail-item--add').count(), 0, 'Documents layout must not add episodes')
  assert.equal(await page.locator('.rail-action-btn').count(), 0, 'Documents layout must not delete documents')
  assert.equal(await page.locator('.writer-pane-document-title').innerText(), '目标剧本')
  assert.equal(await page.locator('.writer-pane-episode-title').count(), 0, 'Document titles are read-only')
  assert.ok(!(await page.locator('.writer-rail').innerText()).includes('E01'), 'Documents layout must not show E01')

  const legacyRow = page.locator('.list-row', { hasText: '旧版分集剧本' })
  assert.equal(await legacyRow.locator('.list-title-count').innerText(), '1 集')
  await legacyRow.click()
  await page.waitForFunction(() => document.querySelector('.rail-ep-num')?.textContent === 'E01')
  assert.equal(await page.locator('.rail-item--add').count(), 1, 'Legacy scripts keep 添加分集')
  assert.equal(await page.locator('.rail-action-btn').count(), 1, 'Legacy scripts keep 删除分集')
  assert.equal(await page.locator('.writer-pane-episode-title').count(), 1, 'Legacy episode titles stay editable')

  await page.locator('.create-card').click()
  await page.waitForSelector('.rv2-wizard--embedded .rv2-setup')
  assert.ok((await page.locator('.rv2-rail').innerText()).includes('真实处理流程'))
  assert.ok((await page.locator('.rv2-setup').innerText()).includes('目标设定总纲'))
  assert.ok((await page.locator('.rv2-setup').innerText()).includes('分镜可选，也能稍后生成'))
  assert.equal(await page.locator('input[name="repaint-output"]:checked').inputValue(), 'on')
  assert.equal(await page.locator('input[name="repaint-output"]').nth(0).isChecked(), true)
  assert.ok((await page.locator('.rv2-submit-btn').innerText()).includes('剧本和总纲'))
  assert.ok(!(await page.locator('.rv2-setup').innerText()).includes('转绘剧本'))

  await page.screenshot({ path: path.join(artifacts, '01-setup-1280.png'), fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(artifacts, '02-setup-390.png'), fullPage: true })
  await page.setViewportSize({ width: 1280, height: 800 })

  await page.locator('.rv2-submit-btn').click()
  await page.getByText('请填写任务名称', { exact: true }).waitFor()
  await page.getByText('请上传 1 个视频文件；当前一个视频固定作为一集处理', { exact: true }).waitFor()
  assert.equal(understandCalls.length, 0, 'Invalid setup must not call the upload API')

  await page.locator('.rv2-setup input[type=file]').setInputFiles(invalidVideo)
  await page.getByText('仅支持 mp4 / mov / avi 视频文件', { exact: true }).waitFor()
  assert.equal(await page.locator('.rv2-single-video').count(), 0)
  assert.equal(understandCalls.length, 0, 'Unsupported file must not call the upload API')

  await page.locator('.rv2-setup input[type=file]').setInputFiles(sampleVideo)
  await page.waitForSelector('.rv2-single-video')
  assert.equal(await page.locator('#rv2-title').inputValue(), 'sample · 视频转绘')
  assert.ok((await page.locator('#rv2-brief').getAttribute('placeholder')).includes('视频号中老年受众'))

  const brief = '面向中国视频号中老年受众的写实家庭伦理短剧，人物改成乡镇常见姓名，保留全部剧情功能'
  await page.locator('input[name="repaint-output"]').nth(1).check()
  await page.locator('#rv2-brief').fill(brief)
  await page.locator('.rv2-submit-btn').click()

  await page.waitForSelector('.rv2-progress-page', { timeout: 30_000 })
  await page.waitForSelector('.rv2-track-card--source.is-done', { timeout: 30_000 })
  const outlineTrack = page.locator('.rv2-track-card', { has: page.locator('.rv2-track-title', { hasText: '目标设定总纲' }) })
  const storyboardTrack = page.locator('.rv2-track-card', { hasText: '分镜' })
  await page.waitForFunction(() => {
    const cards = [...document.querySelectorAll('.rv2-track-card')]
    return cards.some((card) => card.textContent?.includes('目标设定总纲') && card.classList.contains('is-failed'))
  })
  assert.ok((await outlineTrack.innerText()).includes('模拟目标设定总纲生成失败'))
  assert.equal(await outlineTrack.getByRole('button', { name: '重试', exact: true }).count(), 1)
  assert.ok((await page.locator('.rv2-track-card--source').innerText()).includes('3 个剪辑点'))
  await page.screenshot({ path: path.join(artifacts, '03-progress-1280.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(artifacts, '04-progress-390.png') })
  await page.setViewportSize({ width: 1280, height: 800 })

  await outlineTrack.getByRole('button', { name: '重试', exact: true }).click()

  await page.waitForSelector('.rv2-doc-tabs', { timeout: 30_000 }).catch(async (error) => {
    console.log('REVIEW NOT OPEN', await page.locator('body').innerText(), errors)
    throw error
  })
  await page.waitForFunction(() => document.querySelector('.rv2-review-meta')?.textContent?.includes('剧本完成'), undefined, { timeout: 30_000 }).catch(async (error) => {
    console.log('SCRIPT NOT DONE', await page.locator('body').innerText(), errors, targetScriptCalls)
    throw error
  })
  await page.waitForFunction(() => document.querySelector('.rv2-review-meta')?.textContent?.includes('分镜完成'), undefined, { timeout: 30_000 })
  assert.equal(targetScriptCalls.length, 1)
  assert.equal(targetScriptCalls[0].outline, outlineText)
  assert.equal(targetScriptCalls[0].durationSeconds, 2)
  assert.equal(targetScriptCalls[0].sourceScript, sourceScript)
  assert.equal(await page.locator('.rv2-doc-editor[aria-label="目标剧本"]').inputValue(), targetScriptText)
  assert.equal(understandCalls[0].stage, 'upload')
  assert.ok(understandCalls[0].contentType.includes('multipart/form-data'))
  assert.equal(understandCalls[0].hasFile, true)
  assert.equal(understandCalls[0].hasMode, true)
  assert.equal(understandCalls[0].hasDuration, true)
  assert.equal(understandCalls[0].hasAdaptationBrief, false, 'The upload request must drop adaptationBrief')
  const storyboardCalls = understandCalls.filter((call) => call.stage === 'storyboard')
  assert.equal(storyboardCalls.length, 2, 'Stage B must ask for a second round when complete=false')
  assert.equal(storyboardCalls[0].body.stage, 'storyboard')
  assert.equal(storyboardCalls[0].body.fileHandle, 'test-handle')
  assert.equal(JSON.stringify(storyboardCalls[0].body).includes('sample.mp4'), false, 'Storyboard stage must not re-upload the file')
  assert.deepEqual(storyboardCalls[0].body.cutHints, [0.4, 1.1, 1.7])
  assert.equal(storyboardCalls[0].body.continuation, undefined)
  assert.deepEqual(storyboardCalls[1].body.continuation, { storyboard: firstStoryboard })
  assert.deepEqual(storyboardCalls[0].body.sourceAnalysis, analysis)
  assert.equal(outlineCalls.length, 2, 'The outline must retry after the mocked failure')
  assert.equal(outlineCalls[0].adaptationBrief, brief)
  assert.equal(outlineCalls[1].adaptationBrief, brief)
  assert.equal(outlineCalls[1].sourceScript, sourceScript)
  assert.deepEqual(outlineCalls[1].sourceAnalysis, analysis)

  const outlineEditor = page.locator('.rv2-doc-editor[aria-label="目标设定总纲"]')
  const storyboardEditor = page.locator('.rv2-doc-editor[aria-label="分镜"]')
  await page.locator('.rv2-doc-tabs button', { hasText: '目标设定总纲' }).click()
  assert.equal(await outlineEditor.inputValue(), outlineText)
  assert.ok((await page.locator('.rv2-doc-warning').innerText()).includes('总纲缺少以下章节'))
  assert.ok((await page.locator('.rv2-missing-list').innerText()).includes('9. 逐集转绘约束'))
  assert.ok((await page.locator('.rv2-missing-list').innerText()).includes('10. 文化契合度审计'))
  assert.equal(await page.locator('#rv2-review-brief').inputValue(), brief)
  await page.screenshot({ path: path.join(artifacts, '05-review-outline-1280.png') })

  await page.locator('.rv2-doc-tabs button', { hasText: '分镜' }).click()
  assert.equal(await storyboardEditor.inputValue(), fullStoryboard)
  assert.ok((await page.locator('.rv2-doc-facts').innerText()).includes('4 镜'))
  assert.ok((await page.locator('.rv2-doc-facts').innerText()).includes('00:02'))
  const warnings = page.locator('.rv2-warning-details')
  assert.ok((await warnings.locator('summary').innerText()).includes('校验提示 2 条'))
  await warnings.locator('summary').click()
  assert.ok((await warnings.innerText()).includes('SH003 缺少光影描述'))
  assert.ok((await warnings.innerText()).includes('SH004 时长可能过短'))
  await page.screenshot({ path: path.join(artifacts, '06-review-storyboard-1280.png') })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(artifacts, '07-review-storyboard-390.png') })
  await page.locator('.rv2-doc-tabs button', { hasText: '目标设定总纲' }).click()
  await page.screenshot({ path: path.join(artifacts, '08-review-outline-390.png') })
  await page.setViewportSize({ width: 1280, height: 800 })

  const editedScript = `${targetScriptText}\n本行由测试编辑`
  const editedOutline = `${outlineText}\n本行由测试编辑`
  const editedStoryboard = `${fullStoryboard}\n本行由测试编辑`
  await page.locator('.rv2-doc-tabs button', { hasText: '目标剧本' }).click()
  await page.locator('.rv2-doc-editor[aria-label="目标剧本"]').fill(editedScript)
  await page.locator('.rv2-doc-tabs button', { hasText: '目标设定总纲' }).click()
  await outlineEditor.fill(editedOutline)
  await page.locator('.rv2-doc-tabs button', { hasText: '分镜' }).click()
  await storyboardEditor.fill(editedStoryboard)

  saveDelayMs = 400
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('确认并保存为草稿'))
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForSelector('.rv2-done', { timeout: 30_000 })
  assert.equal(saveCalls.length, 1, 'Double click must submit exactly one save request')
  assert.ok(saveCalls[0].clientRequestId)
  assert.ok(saveCalls[0].outline.includes('本行由测试编辑'))
  assert.ok(saveCalls[0].storyboard.includes('本行由测试编辑'))
  assert.equal(saveCalls[0].sourceScript, sourceScript)
  assert.equal(saveCalls[0].adaptationBrief, brief)
  assert.equal(saveCalls[0].model, 'nori::nori-gpt')
  assert.equal(saveCalls[0].sourceFileName, 'sample.mp4')
  assert.deepEqual(saveCalls[0].sourceAnalysis, analysis)
  assert.equal(saveCalls[0].targetScript, editedScript)
  assert.ok((await page.locator('.rv2-local-note').innerText()).includes('vr_test_draft'))
  await page.screenshot({ path: path.join(artifacts, '09-saved-done.png') })

  await page.locator('.rv2-done-btn').click()
  await page.waitForSelector('.create-card')
  assert.equal(await page.locator('.list-title').first().innerText(), 'sample · 视频转绘')
  assert.equal(await page.locator('.list-title-count').first().innerText(), '3 份文档')
  assert.ok((await page.locator('.writer-detail-meta').innerText()).includes('转绘自 sample.mp4'))
  assert.equal(await page.locator('.rv2-wizard').count(), 0, 'Back must leave the embedded task')
  assert.equal(await page.locator('.rail-ep-num').count(), 0)
  assert.equal(await page.locator('.rail-item--add').count(), 0)
  assert.deepEqual(await page.locator('.writer-rail .rail-ep-title').allInnerTexts(), ['目标剧本', '目标设定总纲', '分镜'])
  assert.equal(await page.locator('.writer-pane-document-title').innerText(), '目标剧本')
  await page.locator('.writer-rail .rail-item', { hasText: '分镜' }).click()
  await page.waitForFunction(() => document.querySelector('.body-textarea')?.value.includes('本行由测试编辑'))
  await page.screenshot({ path: path.join(artifacts, '10-workbench-documents-1280.png') })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({ path: path.join(artifacts, '11-workbench-documents-390.png') })
  await page.setViewportSize({ width: 1280, height: 800 })
  await page.locator('.list-row', { hasText: '旧版分集剧本' }).click()
  await page.waitForFunction(() => document.querySelector('.rail-ep-num')?.textContent === 'E01')
  assert.equal(await page.locator('.writer-rail').getByText('添加分集', { exact: true }).count(), 1)
  await page.screenshot({ path: path.join(artifacts, '12-workbench-legacy-1280.png') })

  // Empty brief must still call the outline (the server writes in source-market mode) and an
  // incomplete storyboard must be reviewable with a clear coverage warning.
  scenario = 'incomplete'
  await page.locator('.create-card').click()
  await page.waitForSelector('.rv2-setup')
  await page.locator('.rv2-setup input[type=file]').setInputFiles(sampleVideo)
  await page.locator('#rv2-brief').fill('')
  await page.locator('input[name="repaint-output"]').nth(1).check()
  await page.locator('.rv2-submit-btn').click()
  await page.waitForSelector('.rv2-doc-tabs', { timeout: 30_000 })
  await page.waitForFunction(() => document.querySelector('.rv2-review-meta')?.textContent?.includes('分镜完成'), undefined, { timeout: 30_000 })
  assert.equal(outlineCalls.at(-1).adaptationBrief, '', 'The outline must run even with an empty brief')
  await page.locator('.rv2-doc-tabs button', { hasText: '分镜' }).click()
  assert.ok((await page.locator('.rv2-doc-warning').innerText()).includes('分镜尚未覆盖完整视频'))
  assert.ok((await page.locator('.rv2-doc-warning').innerText()).includes('00:01 / 总长 00:02'))
  await page.screenshot({ path: path.join(artifacts, '13-review-incomplete.png') })
  await page.locator('.rv2-back-btn').click()
  await page.waitForSelector('.create-card')
  // The default output must stop after script + outline. Storyboard can be generated later
  // and saved without changing the two primary documents.
  scenario = 'script-only'
  const callsBeforeScriptOnly = { upload: understandCalls.length, outline: outlineCalls.length, script: targetScriptCalls.length }
  await page.locator('.create-card').click()
  await page.waitForSelector('.rv2-setup')
  await page.locator('.rv2-setup input[type=file]').setInputFiles(sampleVideo)
  assert.equal(await page.locator('input[name="repaint-output"]').nth(0).isChecked(), true)
  await page.locator('.rv2-submit-btn').click()
  await page.waitForSelector('.rv2-doc-tabs', { timeout: 30_000 })
  await page.waitForFunction(() => document.querySelector('.rv2-review-meta')?.textContent?.includes('剧本完成'), undefined, { timeout: 30_000 })
  assert.equal(understandCalls.length, callsBeforeScriptOnly.upload + 1, 'Default output must not call storyboard')
  assert.equal(outlineCalls.length, callsBeforeScriptOnly.outline + 1)
  assert.equal(targetScriptCalls.length, callsBeforeScriptOnly.script + 1)
  assert.equal(await page.locator('.rv2-save-btn').isEnabled(), true, 'Script + outline save without storyboard')
  await page.locator('.rv2-doc-tabs button', { hasText: '分镜（可选）' }).click()
  assert.equal(await page.locator('.rv2-doc-editor[aria-label="分镜"]').inputValue(), '')
  await page.getByRole('button', { name: '生成分镜', exact: true }).click()
  await page.waitForFunction(() => document.querySelector('.rv2-review-meta')?.textContent?.includes('分镜完成'), undefined, { timeout: 30_000 })
  assert.equal(understandCalls.at(-1).stage, 'storyboard', 'On-demand storyboard reuses the uploaded file handle')
  await page.locator('.rv2-save-btn').click()
  await page.waitForSelector('.rv2-done', { timeout: 30_000 })
  assert.equal(saveCalls.at(-1).targetScript, targetScriptText)
  assert.equal(saveCalls.at(-1).storyboard, fullStoryboard)
  await page.locator('.rv2-done-btn').click()
  await page.waitForSelector('.create-card')
  scenario = 'cancel'
  await page.locator('.create-card').click()
  await page.waitForSelector('.rv2-setup')
  await page.locator('.rv2-setup input[type=file]').setInputFiles(sampleVideo)
  const beforeCancel = understandCalls.length
  cancelNextUnderstand = true
  await page.evaluate(() => {
    const button = document.querySelector('.rv2-submit-btn')
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForSelector('.rv2-progress-page')
  assert.ok((await page.locator('.rv2-track-card--source').innerText()).includes('正在上传视频'), 'Progress must name the active source stage')
  assert.ok((await page.locator('.rv2-track-card--source').innerText()).includes('已用时'), 'Progress must show elapsed time')
  await page.getByRole('button', { name: '取消本次处理', exact: true }).click()
  await page.waitForSelector('.rv2-setup')
  await page.getByText('已取消本次视频反译', { exact: false }).waitFor()
  assert.equal(understandCalls.length, beforeCancel + 1, 'Cancellation must stop before the storyboard stage')
  await page.waitForTimeout(1000)

  await page.locator('.rv2-back-btn').click()
  await page.waitForSelector('.create-card')
  assert.deepEqual(errors, [])

  const result = {
    ok: true,
    embeddedInScreenwriter: true,
    invalidSetupBlocked: true,
    unsupportedFileBlocked: true,
    uploadStageCalls: understandCalls.filter((call) => call.stage === 'upload').length,
    storyboardRoundsPerRun: 2,
    storyboardContinuationSent: true,
    outlineCalls: outlineCalls.length,
    outlineFailureRetried: true,
    outlineRanWithoutBrief: true,
    incompleteStoryboardWarned: true,
    duplicateSavePrevented: true,
    savePayloadHasBothDocuments: true,
    documentsLayoutRendered: true,
    legacyLayoutRendered: true,
    cancellationRecovered: true,
    browserErrors: errors,
    paidRequests: 0,
    productionRequests: 0,
    artifacts,
  }
  await writeFile(path.join(artifacts, 'results.json'), `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
