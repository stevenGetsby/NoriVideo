// Real FosScreenwriter + FosVideoRepaintTask; every network API is local mock.
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
const targetScript = '第1集\n1-1\n场景：北美公寓 - 夜 - 暖光\n人物：Mia\n△Mia 抬头看向窗外。'
const sourceStoryboard = '第1集 · 源分镜\n\nShot 1 · E01-P001\n时间码：00:00:00.000 → 00:00:01.000'
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
  source_storyboard: { shots: [], excluded_ranges: [] },
  adaptation_contract: { story_invariants: ['主角要找回妹妹'], do_not_localize: [] },
  quality_report: {},
}

const understandCalls = []
const adaptCalls = []
const saveCalls = []
const scriptListCalls = []
let scripts = []
let failStoryboard = false
let cancelNextUnderstand = false
let saveDelayMs = 0
const errors = []

function json(route, body, status = 200) {
  return route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })
}

function sourceResult() {
  return {
    success: true,
    result: {
      fileHandle: 'test-handle',
      script: sourceScript,
      storyboard: '',
      analysis,
      durationSeconds: 2,
      usage: { inputTokens: 10, outputTokens: 5 },
      validation: { valid: true, errors: [], warnings: [] },
    },
  }
}

function storyboardResult() {
  return {
    success: true,
    result: {
      fileHandle: 'test-handle',
      storyboard: sourceStoryboard,
      analysis,
      usage: { inputTokens: 8, outputTokens: 4 },
      validation: { valid: true, errors: [], warnings: [] },
    },
  }
}

const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  page.on('pageerror', (error) => errors.push(error.stack || error.message))
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
        if (saveDelayMs) await new Promise((resolve) => setTimeout(resolve, saveDelayMs))
        const saved = {
          id: 'vr_test_draft',
          title: body.title,
          type: '视频转绘',
          status: 'draft',
          createdAt: '2026-11-08T00:00:00.000Z',
          updatedAt: '2026-11-08T00:00:00.000Z',
          episodes: [{ id: 'vr_test_draft-ep-1', title: '第 1 集', body: body.targetScript }],
          lineage: body.sourceFileName,
        }
        scripts = [saved, ...scripts]
        return await json(route, { success: true, script: saved })
      }
      if (pathname.startsWith('/api/video-repaint/scripts/')) {
        return await json(route, { success: true })
      }
      if (pathname === '/api/video-repaint/understand' && method === 'POST') {
        const contentType = request.headers()['content-type'] || ''
        if (contentType.includes('application/json')) {
          const body = request.postDataJSON()
          understandCalls.push({ stage: 'storyboard', body })
          if (failStoryboard) {
            return await json(route, { success: false, error: { code: 'EXTERNAL_ERROR', message: '模拟源分镜提取失败' } }, 503)
          }
          return await json(route, storyboardResult())
        }
        const body = request.postDataBuffer()
        const text = body ? body.toString('latin1') : ''
        understandCalls.push({
          stage: 'upload',
          contentType,
          hasFile: text.includes('name="file"'),
          hasMode: text.includes('name="mode"'),
          hasDuration: text.includes('name="durationSeconds"'),
        })
        if (cancelNextUnderstand) {
          cancelNextUnderstand = false
          await new Promise((resolve) => setTimeout(resolve, 700))
        }
        return await json(route, sourceResult())
      }
      if (pathname === '/api/video-repaint/adapt' && method === 'POST') {
        const body = request.postDataJSON()
        adaptCalls.push(body)
        return await json(route, {
          success: true,
          result: {
            script: targetScript,
            mode: 'llm',
            model: 'nori::nori-gpt',
            usage: { inputTokens: 20, outputTokens: 10 },
          },
        })
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
  await page.screenshot({ path: path.join(artifacts, '01-writer-home.png'), fullPage: true })

  await page.locator('.create-card').click()
  await page.waitForSelector('.rv2-wizard--embedded .rv2-setup')
  assert.ok((await page.locator('.rv2-rail').innerText()).includes('真实处理流程'))

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
  await page.screenshot({ path: path.join(artifacts, '02-setup-with-video.png'), fullPage: true })

  await page.locator('.rv2-submit-btn').click()
  await page.waitForSelector('.rv2-review-page', { timeout: 30_000 })
  assert.equal(understandCalls.length, 2, 'One upload stage plus one storyboard stage')
  assert.equal(understandCalls[0].stage, 'upload')
  assert.ok(understandCalls[0].contentType.includes('multipart/form-data'))
  assert.equal(understandCalls[0].hasFile, true)
  assert.equal(understandCalls[0].hasMode, true)
  assert.equal(understandCalls[0].hasDuration, true)
  assert.equal(understandCalls[1].stage, 'storyboard')
  assert.equal(understandCalls[1].body.stage, 'storyboard')
  assert.equal(understandCalls[1].body.fileHandle, 'test-handle')
  assert.equal(typeof understandCalls[1].body.sourceAnalysis, 'object')
  assert.equal(JSON.stringify(understandCalls[1].body).includes('sample.mp4'), false, 'Storyboard stage must not re-upload the file')

  assert.equal(await page.locator('.rv2-script-editor').inputValue(), sourceScript)
  assert.ok((await page.locator('.rv2-result-mode').innerText()).includes('沿用原剧本'))
  assert.ok((await page.locator('.rv2-script-source').innerText()).includes('测试人物抬头'))
  assert.equal(adaptCalls.length, 0, 'No brief must stay free and skip the text LLM')
  await page.screenshot({ path: path.join(artifacts, '03-review-source-copy.png'), fullPage: true })

  await page.locator('#rv2-review-brief').fill('改为北美现代都市语境')
  await page.locator('.rv2-btn--adapt').click()
  await page.waitForSelector('.rv2-result-mode--llm')
  assert.equal(await page.locator('.rv2-script-editor').inputValue(), targetScript)
  assert.equal(adaptCalls.length, 1)
  assert.equal(adaptCalls[0].title, 'sample · 视频转绘')
  assert.equal(adaptCalls[0].sourceScript, sourceScript)
  assert.equal(adaptCalls[0].adaptationBrief, '改为北美现代都市语境')
  assert.deepEqual(adaptCalls[0].sourceAnalysis, analysis)
  await page.screenshot({ path: path.join(artifacts, '04-review-adapted.png'), fullPage: true })

  const editedTarget = `${targetScript}\n本行由测试编辑`
  await page.locator('.rv2-script-editor').fill(editedTarget)
  saveDelayMs = 400
  await page.evaluate(() => {
    const button = [...document.querySelectorAll('button')].find((item) => item.textContent?.includes('确认并保存为草稿'))
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
  })
  await page.waitForSelector('.rv2-done', { timeout: 30_000 })
  assert.equal(saveCalls.length, 1, 'Double click must submit exactly one save request')
  assert.ok(saveCalls[0].clientRequestId)
  assert.equal(saveCalls[0].resultMode, 'llm')
  assert.equal(saveCalls[0].sourceScript, sourceScript)
  assert.ok(saveCalls[0].targetScript.includes('本行由测试编辑'))
  assert.ok(saveCalls[0].sourceStoryboard.includes('Shot 1'))
  assert.ok((await page.locator('.rv2-local-note').innerText()).includes('vr_test_draft'))
  await page.screenshot({ path: path.join(artifacts, '05-saved.png'), fullPage: true })

  await page.locator('.rv2-done-btn').click()
  await page.waitForSelector('.create-card')
  assert.equal(await page.locator('.list-title').first().innerText(), 'sample · 视频转绘')
  assert.ok((await page.locator('.writer-detail-meta').innerText()).includes('转绘自 sample.mp4'))
  assert.equal(await page.locator('.rv2-wizard').count(), 0, 'Back must leave the embedded task')
  await page.screenshot({ path: path.join(artifacts, '06-workbench-saved.png'), fullPage: true })

  // Cancellation before the provider result must return to setup without a storyboard call.
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
  await page.waitForSelector('.rv2-main-submit-overlay')
  await page.getByRole('button', { name: '取消本次处理', exact: true }).click()
  await page.waitForSelector('.rv2-setup')
  await page.getByText('已取消本次视频反译', { exact: false }).waitFor()
  assert.equal(understandCalls.length, beforeCancel + 1, 'Cancellation must stop before the storyboard stage')
  await page.waitForTimeout(800)

  // Failure after the source script is ready must keep an editable source-copy review.
  const beforeFailure = understandCalls.length
  failStoryboard = true
  await page.locator('.rv2-submit-btn').click()
  await page.waitForSelector('.rv2-review-page', { timeout: 30_000 })
  await page.waitForFunction(() => document.body.innerText.includes('已保留原剧本'))
  assert.equal(await page.locator('.rv2-script-editor').inputValue(), sourceScript)
  assert.ok((await page.locator('.rv2-result-mode').innerText()).includes('沿用原剧本'))
  assert.equal(understandCalls.length, beforeFailure + 2, 'Recovery still records the failed storyboard attempt')
  await page.screenshot({ path: path.join(artifacts, '07-storyboard-recovery.png'), fullPage: true })
  failStoryboard = false

  await page.locator('.rv2-back-btn').click()
  await page.waitForSelector('.create-card')
  assert.equal(await page.locator('.rv2-wizard').count(), 0)
  assert.deepEqual(errors, [])

  const result = {
    ok: true,
    embeddedInScreenwriter: true,
    invalidSetupBlocked: true,
    unsupportedFileBlocked: true,
    uploadAndStoryboardStages: 2,
    storyboardDidNotReupload: true,
    sourceCopySkippedLlm: true,
    adaptationCalls: 1,
    duplicateSubmitPrevented: true,
    duplicateSavePrevented: true,
    savePersistedToWorkbench: true,
    cancellationRecovered: true,
    storyboardFailureRecovered: true,
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
