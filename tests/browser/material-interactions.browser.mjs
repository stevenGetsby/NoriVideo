// Real components and CSS, local intercepted APIs only: never uses paid models or production data.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import { mkdir, readFile } from 'node:fs/promises'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const output = path.join(root, 'test-results/material-interactions')
await mkdir(output, { recursive: true })
const bundleDirectory = process.env.NORI_BROWSER_PREBUILT_DIR
assert.ok(bundleDirectory && process.env.NORI_BROWSER_GLOBAL_CSS_PATH, 'Build current real-component fixtures and application CSS first')
const [js, css, globalCss] = await Promise.all([
  readFile(path.join(bundleDirectory, 'material-interactions.js')),
  readFile(path.join(bundleDirectory, 'material-interactions.css')),
  readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH),
])
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); return res.end(js) }
  if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); return res.end(css) }
  if (req.url === '/global.css') { res.setHeader('Content-Type', 'text/css'); return res.end(globalCss) }
  res.setHeader('Content-Type', 'text/html')
  res.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const errors = []
const cases = []
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLfcAAAAASUVORK5CYII=', 'base64')
const imageUrl = 'data:image/png;base64,' + png.toString('base64')
const material = (id, projectId, title = id, overrides = {}) => ({
  id, projectId, projectName: projectId === 'global' ? '账号素材' : projectId === 'project-1' ? '当前作品' : '其他作品',
  title, ownerName: '测试资产师', source: 'upload', type: 'image', status: 'ready',
  url: imageUrl, resultUrl: imageUrl, storageKey: null, isFavorited: false, metadata: { assetCategory: 'character' },
  canEdit: true, personal: projectId === 'personal', personalOwnerId: projectId === 'personal' ? 'member-1' : null,
  createdAt: '2026-10-14T00:00:00Z', updatedAt: '2026-10-14T00:00:00Z', ...overrides,
})
let latestPage
async function open(view, viewport, child = false, initialState = {}) {
  const page = await browser.newPage({ viewport })
  latestPage = page
  page.on('pageerror', (error) => errors.push(error.message))
  const state = {
    materials: [material('own-a', 'project-1', '自己的角色一'), material('own-b', 'project-1', '自己的角色二'),
      material('shared', 'project-shared', '同项目共享素材'), material('foreign', 'project-2', '别的作品素材'), material('account', 'global', '账号角色')],
    writes: [], reads: [], uploads: [], failUpload: false, denyDelete: false, denyRename: false, partialDelete: false,
    holdNextRead: false, releaseRead: null, heldRead: null,
    toolboxReads: 0, toolboxHistory: [], failHistory: false,
    failVoiceBinding: false,
    voiceUploads: [], failStructuredVoice: true,
    failUploadName: null,
    projectDetailFailures: 0,
    ...initialState,
  }
  page.state = state
  await page.route('**/api/**', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    let payload = {}
    let status = 200
    if (req.method() !== 'GET') state.writes.push({ path: url.pathname, method: req.method(), body: req.headers()['content-type']?.includes('json') ? req.postDataJSON() : req.postData() })
    if (url.pathname === '/api/projects/project-1') {
      if (state.projectDetailFailures > 0) {
        state.projectDetailFailures--
        status = 503
        payload = { message: '模拟项目归属读取失败' }
      } else payload = { work: { id: 'project-1', name: '当前作品', workId: 'work-1', workName: '测试项目' } }
    } else if (url.pathname === '/api/projects') {
      payload = { projects: [{ id: 'project-1', name: '当前作品', workId: 'work-1', workName: '测试项目' }, { id: 'project-2', name: '其他作品', workId: 'work-2', workName: '其他项目' }, { id: 'project-shared', name: '同项目第二作品', workId: 'work-1', workName: '测试项目' }], pagination: { totalPages: 1 } }
    } else if (url.pathname === '/api/projects/project-2') {
      payload = { work: { id: 'project-2', name: '其他作品', workId: 'work-2', workName: '其他项目' } }
    } else if (url.pathname === '/api/assets') payload = { assets: [] }
    else if (url.pathname === '/api/frameos/materials' && req.method() === 'GET') {
      state.reads.push(Object.fromEntries(url.searchParams))
      const project = url.searchParams.get('projectId')
      const work = url.searchParams.get('workId')
      const all = (!project && !work) || (!work && url.searchParams.get('available') === '1')
      const workProjects = work === 'work-1' ? ['project-1', 'project-shared'] : work === 'work-2' ? ['project-2'] : []
      const scope = url.searchParams.get('scope')
      const creator = url.searchParams.get('creator')
      const source = url.searchParams.get('source')
      let materials = state.materials.filter((item) => (scope === 'personal' ? item.projectId === 'personal' : scope === 'project' ? !item.personal && (all || workProjects.includes(item.projectId) || (!work && item.projectId === project)) : source ? item.projectId === project : (all || workProjects.includes(item.projectId) || (!work && item.projectId === project)))
        && (!creator || item.ownerName === creator) && (!source || item.source === source))
      materials = materials.map((item) => {
        const voice = state.materials.find((candidate) => candidate.id === item.metadata?.voiceMaterialId)
        return { ...item, voice: voice ? { materialId: voice.id, title: voice.title, url: voice.url } : null }
      })
      if (url.searchParams.get('state') === 'deleted') materials = []
      payload = { materials, projects: [{ id: 'project-1', name: '当前作品' }, { id: 'project-2', name: '其他作品' }],
        creators: [{ id: 'creator-a', name: '测试资产师' }, { id: 'creator-b', name: '其他创建人' }],
        projects: [{ id: 'project-1', name: '当前作品', workId: 'work-1' }, { id: 'project-2', name: '其他作品', workId: 'work-2' }],
        capabilities: { trash: { supported: true, count: 0 } } }
      if (state.holdNextRead) {
        state.holdNextRead = false
        await new Promise((resolve) => { state.releaseRead = resolve })
      }
    } else if (url.pathname === '/api/frameos/materials' && req.method() === 'POST') {
      const form = await new Response(req.postDataBuffer(), { headers: { 'Content-Type': req.headers()['content-type'] } }).formData()
      const file = form.get('file')
      state.uploads.push(file.name)
      await new Promise((resolve) => setTimeout(resolve, 60))
      if (state.failUploadName === file.name) {
        status = 400; payload = { message: '模拟音色文件无效，请更换文件' }
      }
      else if (state.failUpload && file.name === '失败.png') {
        state.failUpload = false
        status = 500
        payload = { message: '模拟单个上传失败' }
      } else {
        const created = material(`upload-${state.uploads.length}`, form.get('projectId'), form.get('title'),
          { type: file.type.startsWith('audio/') ? 'audio' : 'image', metadata: { assetCategory: form.get('assetCategory'), ...(file.type.startsWith('audio/') ? { durationSeconds: 3 } : {}) } })
        state.materials.push(created)
        payload = { material: created }
      }
    } else if (url.pathname === '/api/frameos/materials/bulk-delete') {
      if (state.denyDelete) { state.denyDelete = false; status = 409; payload = { message: '所选素材仍被画布引用，整批未删除' } }
      else {
        const ids = req.postDataJSON().materialIds
        if (state.partialDelete) {
          const deletedIds = ids.filter((materialId) => materialId !== 'own-b')
          state.materials = state.materials.filter((item) => !deletedIds.includes(item.id))
          payload = { success: true, materialIds: deletedIds, deletedCount: deletedIds.length, skippedCount: 1, results: [
            ...deletedIds.map((materialId) => ({ materialId, deleted: true, reason: null })),
            { materialId: 'own-b', deleted: false, reason: '素材仍被 1 个当前画布引用。' },
          ] }
        } else {
          state.materials = state.materials.filter((item) => !ids.includes(item.id))
          payload = { success: true, materialIds: ids, deletedCount: ids.length, skippedCount: 0, results: ids.map((materialId) => ({ materialId, deleted: true, reason: null })) }
        }
      }
    } else if (url.pathname.startsWith('/api/frameos/materials/') && req.method() === 'DELETE') {
      const id = url.pathname.split('/').at(-1)
      state.materials = state.materials.filter((item) => item.id !== id)
      payload = { success: true, materialId: id, trashed: true }
    } else if (url.pathname.startsWith('/api/frameos/materials/') && req.method() === 'PATCH') {
      if (state.failVoiceBinding && req.postDataJSON().voiceMaterialId) {
        status = 409; payload = { message: '模拟音色绑定失败，可重试' }; state.failVoiceBinding = false
      }
      else if (state.denyRename) { status = 409; payload = { message: '素材已更新，请重试' } }
      else {
        const id = url.pathname.split('/').at(-1)
        const body = req.postDataJSON()
        const previous = state.materials.find((item) => item.id === id)
        const voiceCleared = Boolean(previous?.projectId === 'personal' && body.projectId && body.projectId !== 'personal' && previous.metadata?.voiceMaterialId && !state.materials.some((voice) => voice.id === previous.metadata.voiceMaterialId && ['global', 'global-asset-hub', body.projectId].includes(voice.projectId)))
        state.materials = state.materials.map((item) => item.id === id ? {
          ...item, ...body,
          ...(body.projectId ? {
            personal: body.projectId === 'personal', personalOwnerId: body.projectId === 'personal' ? 'member-1' : null,
            projectName: body.projectId === 'personal' ? '个人素材' : body.projectId === 'global' ? '账号素材' : body.projectId === 'project-1' ? '当前作品' : '其他作品',
            metadata: item.projectId === 'personal' && body.projectId !== 'personal' && item.metadata?.voiceMaterialId && !state.materials.some((voice) => voice.id === item.metadata.voiceMaterialId && ['global', 'global-asset-hub', body.projectId].includes(voice.projectId))
              ? { ...item.metadata, voiceMaterialId: undefined } : item.metadata,
          } : {}),
          ...(body.voiceMaterialId !== undefined ? { metadata: { ...item.metadata, voiceMaterialId: body.voiceMaterialId } } : {}),
        } : item)
        payload = { material: state.materials.find((item) => item.id === id), voiceCleared, message: voiceCleared ? '素材已共享到项目。原私人音色不可被其他成员访问，已解除角色卡音色绑定；音频文件仍保留在个人素材中。' : null }
      }
    } else if (url.pathname.includes('/canvas/templates')) payload = { templates: [] }
    else if (url.pathname.includes('/generation-config')) {
      const common = { provider: 'nori', available: true, firstLastFrame: true, supportGenerateAudio: true,
        options: { resolution: ['720p', '2K'], duration: [5, 10] } }
      payload = { imageModels: [{ ...common, modelKey: 'nori::nori-image', name: '生图模型' }],
        videoModels: [{ ...common, modelKey: 'nori::norivideo2.5', name: '生视频模型' }],
        defaults: { imageModel: 'nori::nori-image', videoModel: 'nori::norivideo2.5', aspectRatio: '16:9', resolution: '720p' } }
    } else if (url.pathname === '/api/user/balance') payload = { balancePoints: 1000, generationAllowed: true, dailyLimitPoints: null }
    else if (url.pathname === '/api/frameos/toolbox/assets') {
      state.toolboxReads++
      if (state.failHistory) { status = 500; payload = { message: '模拟历史刷新失败' }; state.failHistory = false }
      else payload = { assets: state.toolboxHistory }
    }
    else if (url.pathname === '/api/frameos/toolbox/generate') payload = { success: true, tasks: [{ taskId: 'task-test', assetId: 'asset-test' }] }
    else if (url.pathname.endsWith('/download')) {
      return route.fulfill({ status: 200, contentType: 'video/mp4', headers: { 'X-Nori-Filename': encodeURIComponent('机甲三国_测试_视频001_马俊.mp4') }, body: png })
    }
    else if (url.pathname === '/api/novel-promotion/project-1/character-voice') {
      const form = await new Response(req.postDataBuffer(), { headers: { 'Content-Type': req.headers()['content-type'] } }).formData()
      const file = form.get('file')
      state.voiceUploads.push({ name: file.name, characterId: form.get('characterId') })
      if (file.name === '赵云.mp3' && state.failStructuredVoice) { state.failStructuredVoice = false; status = 500; payload = { message: '音色单个失败' } }
      else payload = { success: true, audioUrl: null }
    }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) }).catch(() => {})
  })
  await page.goto(`${base}/?view=${view}${child ? '&session=child' : ''}`)
  await waitForRead(page, (reads) => reads.length > 0, initialState.projectDetailFailures ? 100 : 10_000).catch(() => {})
  return page
}
async function bounded(locator) {
  const box = await locator.boundingBox()
  const viewport = locator.page().viewportSize()
  const element = await locator.evaluate((node) => {
    const ancestors = []
    let current = node
    while (current && ancestors.length < 5) {
      const style = getComputedStyle(current)
      ancestors.push({ element: current.outerHTML.slice(0, 240), rect: current.getBoundingClientRect().toJSON(), zoom: style.zoom, width: style.width, minWidth: style.minWidth, flex: style.flex })
      current = current.parentElement
    }
    return ancestors
  }).catch(() => 'unavailable')
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1, `Out of viewport: ${JSON.stringify(box)}; viewport: ${JSON.stringify(viewport)}; element: ${JSON.stringify(element)}`)
}
async function waitForRead(page, predicate, timeout = 10_000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    if (predicate(page.state.reads)) return
    await new Promise((resolve) => setTimeout(resolve, 25))
  }
  throw new Error(`Material read timeout: ${JSON.stringify(page.state.reads)}`)
}
try {
  for (const viewport of [{ width: 1024, height: 600 }, { width: 768, height: 480 }, { width: 390, height: 700 }]) {
    const page = await open('picker', viewport)
    await page.getByText('自己的角色一', { exact: true }).waitFor()
    assert.equal(await page.getByText('别的作品素材', { exact: true }).count(), 1, JSON.stringify(page.state.reads))
    assert.equal(await page.getByText('账号角色', { exact: true }).count(), 1)
    assert.equal(page.state.reads[0].available, '1', JSON.stringify(page.state.reads))
    assert.equal(page.state.reads[0].workId ?? null, null, JSON.stringify(page.state.reads))
    assert.equal(page.state.reads[0].projectId ?? null, null, JSON.stringify(page.state.reads))
    const dialog = page.getByRole('dialog', { name: '选择项目素材', exact: true })
    await bounded(dialog)
    await bounded(page.getByRole('button', { name: '关闭素材选择器' }))
    await page.getByRole('combobox', { name: '素材范围', exact: true }).selectOption('personal')
    await waitForRead(page, (reads) => reads.at(-1)?.scope === 'personal', 5_000).catch(async (error) => {
    throw new Error(`${error.message}\nReads: ${JSON.stringify(page.state.reads)}\nPage: ${await page.locator('body').innerText()}`)
  })
    assert.equal(await page.getByText('自己的角色一', { exact: true }).count(), 0)
    assert.equal(await page.getByRole('button', { name: '收藏', exact: true }).count(), 0)
    assert.equal(page.state.reads.at(-1).scope, 'personal')
    assert.equal(page.state.reads.at(-1).projectId ?? null, null)
    if (viewport.width < 768 || viewport.height <= 600) await page.getByRole('combobox', { name: '素材范围', exact: true }).selectOption('upload')
    else await page.getByRole('button', { name: /^上传素材/ }).click()
    await waitForRead(page, (reads) => reads.at(-1)?.source === 'upload').catch(async (error) => {
      throw new Error(`${error.message}\nReads: ${JSON.stringify(page.state.reads)}\nPage: ${await page.locator('body').innerText()}`)
    })
    await page.getByText('自己的角色一', { exact: true }).waitFor().catch(async (error) => {
      throw new Error(`${error.message}\nReads: ${JSON.stringify(page.state.reads)}\nPage: ${await page.locator('body').innerText()}`)
    })
    if (viewport.width < 768 || viewport.height <= 600) await page.getByRole('combobox', { name: '素材范围', exact: true }).selectOption('all')
    else await page.getByRole('button', { name: /^全部可访问资产/ }).click()
    await page.getByText('别的作品素材', { exact: true }).waitFor()
    assert.equal(page.state.reads.at(-1).workId ?? null, null, JSON.stringify(page.state.reads))
    assert.equal(page.state.reads.at(-1).projectId ?? null, null, JSON.stringify(page.state.reads))
    await page.getByText('账号角色', { exact: true }).waitFor()
    if (viewport.width < 768 || viewport.height <= 600) await page.getByRole('combobox', { name: '素材范围', exact: true }).selectOption('project:project-1')
    else await page.getByRole('button', { name: /^当前作品/ }).click()
    await page.getByText('自己的角色一', { exact: true }).waitFor()
    await bounded(page.getByText('自己的角色一', { exact: true }))
    await page.screenshot({ path: path.join(output, `${viewport.width}-picker.png`) })
    await page.getByRole('button', { name: '关闭素材选择器' }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.close()
    cases.push(`${viewport.width}:project-default-source-and-explicit-cross-project`)
  }

  const single = await open('picker-single', { width: 390, height: 700 })
  const singleDialog = single.getByRole('dialog', { name: '选择项目素材', exact: true })
  await singleDialog.getByText('自己的角色一', { exact: true }).click()
  await singleDialog.getByText('自己的角色二', { exact: true }).click()
  const singleConfirm = singleDialog.getByRole('button', { name: '确定并关闭', exact: true })
  await bounded(singleConfirm)
  await singleConfirm.click()
  await singleDialog.waitFor({ state: 'hidden' })
  assert.equal(await single.getByLabel('已确认素材').innerText(), '自己的角色二')
  await single.close()
  cases.push('single-confirm-callback-replaces-selection-and-closes')

  const unavailableScope = await open('picker', { width: 390, height: 700 }, false, { projectDetailFailures: 1 })
  await unavailableScope.getByText('模拟项目归属读取失败', { exact: true }).waitFor()
  assert.equal(unavailableScope.state.projectDetailFailures, 0, JSON.stringify({ reads: unavailableScope.state.reads, text: await unavailableScope.locator('body').innerText() }))
  assert.equal(unavailableScope.state.reads.length, 0, `Unresolved project ownership must never fall back to a global asset read: ${JSON.stringify(unavailableScope.state.reads)}`)
  await unavailableScope.getByRole('button', { name: '重新加载项目归属', exact: true }).click()
  await unavailableScope.getByText('自己的角色一', { exact: true }).waitFor()
  assert.equal(unavailableScope.state.reads[0].workId ?? null, null)
  assert.equal(unavailableScope.state.reads[0].scope, 'all')
  await unavailableScope.close()
  cases.push('project-scope-failure-blocks-global-read-and-recovers-with-retry')

  const voicePicker = await open('picker', { width: 390, height: 700 })
  voicePicker.state.materials.push(material('voice-1', 'project-1', '角色音色', { type: 'audio' }))
  const voiceDialog = voicePicker.getByRole('dialog', { name: '选择项目素材', exact: true })
  await voiceDialog.getByRole('button', { name: '筛选', exact: true }).click()
  const voiceRead = voicePicker.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/frameos/materials' && url.searchParams.get('type') === 'audio'
  })
  await voiceDialog.getByRole('combobox', { name: '资产分类', exact: true }).selectOption('voice')
  await voiceRead
  await voiceDialog.getByText('角色音色', { exact: true }).waitFor()
  assert.equal(await voiceDialog.getByText('自己的角色一', { exact: true }).count(), 0)
  assert.equal(voicePicker.state.reads.at(-1).type, 'audio')
  await voiceDialog.getByRole('button', { name: '收起筛选', exact: true }).click()
  await voiceDialog.getByText('角色音色', { exact: true }).click()
  await voiceDialog.getByRole('button', { name: /^确定并关闭/ }).click()
  assert.equal(await voicePicker.getByLabel('已确认素材').innerText(), '角色音色')
  await voicePicker.close()
  cases.push('shared-picker-voice-classification-uses-audio-without-media-type-mutation')

  const library = await open('materials', { width: 768, height: 480 })
  await library.getByRole('button', { name: '编辑素材 自己的角色一' }).waitFor()
  assert.equal(library.state.reads[0].workId, 'work-1', JSON.stringify(library.state.reads))
  assert.equal(library.state.reads[0].projectId ?? null, null, JSON.stringify(library.state.reads))
  assert.equal(await library.getByText('测试项目', { exact: true }).count() > 0, true)
  assert.equal(await library.getByText('其他项目', { exact: true }).count() > 0, true)
  assert.equal(await library.getByRole('button', { name: /同项目第二作品/ }).count(), 1)
  await library.getByRole('button', { name: '其他作品', exact: true }).click()
  await library.getByText('别的作品素材', { exact: true }).waitFor({ state: 'visible', timeout: 10_000 }).catch(async (error) => {
    throw new Error(`${error.message}\nLibrary: ${await library.locator('body').innerText()}\nReads: ${JSON.stringify(library.state.reads)}`)
  })
  assert.equal(await library.getByText('自己的角色一', { exact: true }).count(), 0)
  assert.equal(library.state.reads.at(-1).workId, 'work-2')
  await library.getByRole('button', { name: /当前作品/ }).click()
  await library.getByRole('button', { name: '编辑素材 自己的角色一' }).waitFor()
  assert.equal(await library.getByText('账号角色', { exact: true }).count(), 0)
  await library.locator('.fml-voice-badge').first().waitFor()
  assert.ok(await library.getByText('缺音色', { exact: true }).count() > 0)
  await library.getByRole('combobox', { name: '创建人', exact: true }).selectOption('其他创建人')
  await library.getByText('暂无匹配素材', { exact: false }).waitFor()
  assert.equal(library.state.reads.at(-1).creatorExact, '1')
  await library.getByRole('combobox', { name: '创建人', exact: true }).selectOption('')
  await library.getByText('自己的角色一', { exact: true }).click()
  const preview = library.getByTestId('material-large-preview')
  await bounded(preview)
  await preview.getByRole('button', { name: '修改名称', exact: true }).click()
  const rename = library.getByRole('dialog', { name: '编辑素材', exact: true })
  await bounded(rename)
  await rename.getByRole('textbox').fill('  改名后的素材  ')
  library.state.denyRename = true
  await rename.getByRole('button', { name: '保存修改', exact: true }).click()
  await rename.getByText('素材已更新，请重试', { exact: true }).waitFor()
  library.state.denyRename = false
  await rename.getByRole('button', { name: '保存修改', exact: true }).click()
  await rename.waitFor({ state: 'hidden' })
  await preview.getByRole('heading', { name: '改名后的素材', exact: true }).waitFor()
  assert.equal(await preview.getByText('资产归类', { exact: true }).count(), 0)
  assert.equal(await preview.getByRole('combobox', { name: '素材类型筛选', exact: true }).count(), 0)
  await preview.getByRole('button', { name: '关闭大图预览', exact: true }).click()
  await preview.waitFor({ state: 'hidden' })
  await library.getByRole('button', { name: '全选上传素材', exact: true }).click()
  assert.equal(await library.getByRole('button', { name: '取消选择 同项目共享素材', exact: true }).count(), 1, 'Project members may delete shared upload assets')
  library.state.denyDelete = true
  await library.getByRole('button', { name: '批量删除 (3)', exact: true }).click()
  const deletion = library.getByRole('dialog', { name: '批量删除上传素材', exact: true })
  await bounded(deletion)
  await deletion.getByRole('button', { name: '确认批量删除', exact: true }).click()
  await library.getByText('所选素材仍被画布引用，整批未删除', { exact: true }).waitFor()
  assert.equal(library.state.materials.filter((item) => item.projectId === 'project-1' || item.projectId === 'project-shared').length, 3)
  await deletion.waitFor({ state: 'visible' })
  await deletion.getByRole('button', { name: '取消', exact: true }).click()
  await deletion.waitFor({ state: 'hidden' })
  await library.getByRole('button', { name: '批量删除 (3)', exact: true }).click()
  await library.getByRole('dialog', { name: '批量删除上传素材', exact: true }).getByRole('button', { name: '确认批量删除', exact: true }).click()
  await deletion.waitFor({ state: 'hidden' })
  assert.equal(library.state.materials.filter((item) => item.projectId === 'project-1' || item.projectId === 'project-shared').length, 0)
  assert.equal(library.state.materials.filter((item) => item.projectId !== 'project-1' && item.projectId !== 'project-shared').length, 2)
  await library.close()
  cases.push('creator-select-preview-rename-failure-retry-and-atomic-delete')

  const allMaterials = await open('materials-all', { width: 768, height: 480 })
  await allMaterials.getByRole('button', { name: '全选上传素材', exact: true }).click()
  await allMaterials.getByRole('button', { name: '批量删除 (5)', exact: true }).click()
  const allDeletion = allMaterials.getByRole('dialog', { name: '批量删除上传素材', exact: true })
  await allDeletion.getByRole('button', { name: '确认批量删除', exact: true }).click()
  await allDeletion.waitFor({ state: 'hidden' })
  assert.equal(allMaterials.state.materials.length, 0)
  await allMaterials.close()
  cases.push('account-wide-library-keeps-upload-deletion-available-without-a-selected-work')

  for (const viewport of [{ width: 768, height: 480 }, { width: 390, height: 700 }]) {
    const assets = await open('assets', viewport)
    await assets.getByRole('checkbox', { name: '选择资产 账号角色' }).waitFor()
    await assets.getByText('缺音色', { exact: true }).first().waitFor()
    assert.equal(await assets.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, 'Asset library toolbar must not overflow horizontally')
    const cardBox = await assets.locator('.fal-asset-card').first().boundingBox()
    const checkBox = await assets.getByRole('checkbox', { name: '选择资产 账号角色' }).boundingBox()
    assert.ok(checkBox.y >= cardBox.y && checkBox.y + checkBox.height <= cardBox.y + cardBox.height, 'Selection checkbox must remain inside its own card')
    await assets.getByRole('button', { name: '批量上传图片', exact: true }).click()
    const upload = assets.getByRole('dialog', { name: '批量上传素材', exact: true })
    await bounded(upload)
    await bounded(upload.getByRole('button', { name: '开始上传', exact: true }))
    assets.state.failUpload = true
    await upload.locator('input[type="file"]').first().setInputFiles([
      { name: '成功.png', mimeType: 'image/png', buffer: png }, { name: '失败.png', mimeType: 'image/png', buffer: png },
    ])
    await upload.getByRole('button', { name: '开始上传', exact: true }).click()
    await upload.getByText('已上传 1 / 2 · 部分失败，可仅重试失败项', { exact: true }).waitFor()
    await upload.getByRole('button', { name: '重试未成功项', exact: true }).click()
    await upload.waitFor({ state: 'hidden' })
    assert.deepEqual(assets.state.uploads, ['成功.png', '失败.png', '失败.png'])
    await assets.getByRole('checkbox', { name: '选择资产 成功' }).waitFor()
    await assets.getByRole('checkbox', { name: '选择资产 成功' }).check()
    await assets.getByRole('checkbox', { name: '选择资产 失败' }).check()
    await assets.getByRole('button', { name: '批量删除 (2)', exact: true }).click()
    const deletion = assets.getByRole('dialog', { name: '批量删除上传资产', exact: true })
    await bounded(deletion)
    await bounded(deletion.getByRole('button', { name: '确认批量删除', exact: true }))
    await deletion.getByRole('button', { name: '确认批量删除', exact: true }).click()
    await deletion.waitFor({ state: 'hidden' })
    assert.equal(assets.state.materials.filter((item) => item.projectId === 'personal').length, 0)
    await assets.screenshot({ path: path.join(output, `${viewport.width}-asset-library.png`) })
    await assets.close()
    cases.push(`${viewport.width}:upload-auto-close-partial-failure-retry-and-asset-bulk-delete`)
  }

  const voiceBadge = await open('assets', { width: 1280, height: 720 })
  await voiceBadge.getByText('缺音色', { exact: true }).first().waitFor()
  assert.equal(await voiceBadge.locator('.fal-asset-card').first().locator('.fal-voice-badge').count(), 1)
  const badgeBox = await voiceBadge.locator('.fal-voice-badge').first().boundingBox()
  const badgeCardBox = await voiceBadge.locator('.fal-asset-card').first().boundingBox()
  assert.ok(badgeBox && badgeCardBox && badgeBox.y >= badgeCardBox.y && badgeBox.y + badgeBox.height <= badgeCardBox.y + badgeCardBox.height, 'Voice badge must stay inside its card')
  assert.equal(await voiceBadge.getByRole('button', { name: /只看缺音色/ }).count(), 1)
  voiceBadge.state.materials.push(material('badge-voice', 'global', '账号角色音色', { type: 'audio', metadata: { assetCategory: 'voice' } }))
  voiceBadge.state.materials = voiceBadge.state.materials.map((item) => item.id === 'account'
    ? { ...item, metadata: { ...item.metadata, voiceMaterialId: 'badge-voice' } }
    : item)
  await voiceBadge.reload()
  await voiceBadge.getByText('有音色', { exact: true }).first().waitFor()
  assert.equal(await voiceBadge.getByText('缺音色', { exact: true }).count(), 0)
  await voiceBadge.getByRole('button', { name: /只看缺音色/ }).click()
  await voiceBadge.getByText('当前角色都已绑定音色', { exact: true }).waitFor()
  await voiceBadge.screenshot({ path: path.join(output, 'voice-badges.png') })
  await voiceBadge.close()
  cases.push('character-voice-badges-and-missing-voice-filter')

  const child = await open('assets', { width: 768, height: 480 }, true)
  await child.getByRole('checkbox', { name: '选择资产 账号角色' }).waitFor()
  assert.equal(await child.locator('.fal-asset-card').count() > 0, true)
  assert.equal(await child.getByRole('button', { name: '批量上传图片', exact: true }).isEnabled(), true)
  assert.equal(await child.getByRole('button', { name: '批量删除', exact: false }).count() > 0, true)
  assert.equal(await child.getByRole('checkbox').count() > 0, true)
  assert.equal(await child.getByRole('button', { name: '重命名资产', exact: false }).count() > 0, true)
  await child.close()
  cases.push('active-subaccount-retains-shared-asset-editing-without-functional-role-templates')

  const canvasAssets = await open('canvas-assets', { width: 1024, height: 600 })
  await canvasAssets.getByText('自己的角色一', { exact: true }).waitFor()
  assert.equal(canvasAssets.state.reads[0].workId, 'work-1')
  assert.equal(canvasAssets.state.reads[0].available, '1')
  assert.equal(canvasAssets.state.reads[0].projectId ?? null, null)
  await canvasAssets.getByRole('combobox', { name: '来源作品', exact: true }).selectOption('project-1')
  await canvasAssets.waitForFunction(() => document.querySelector('.nori-canvas-project-assets-list')?.textContent?.includes('自己的角色一'))
  assert.equal(await canvasAssets.getByText('同项目共享素材', { exact: true }).count(), 0)
  assert.equal(canvasAssets.state.reads.at(-1).projectId, 'project-1')
  assert.equal(canvasAssets.state.reads.at(-1).available, '0')
  assert.equal(canvasAssets.state.reads.at(-1).workId ?? null, null)
  await canvasAssets.getByRole('button', { name: '全选', exact: true }).click()
  const dragHandle = canvasAssets.getByRole('button', { name: '拖拽全部已选素材', exact: true })
  await bounded(dragHandle)
  const dragged = await dragHandle.evaluate((element) => {
    const transfer = new DataTransfer()
    element.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: transfer }))
    return JSON.parse(transfer.getData('application/x-nori-canvas-material-collection'))
  })
  assert.deepEqual(dragged.map((item) => item.id), ['own-a', 'own-b'])
  assert.equal(await canvasAssets.getByText('别的作品素材', { exact: true }).count(), 0)
  await canvasAssets.getByRole('combobox', { name: '来源作品', exact: true }).selectOption('all')
  await canvasAssets.getByText('别的作品素材', { exact: true }).waitFor()
  assert.equal(canvasAssets.state.reads.at(-1).workId ?? null, null)
  assert.equal(canvasAssets.state.reads.at(-1).projectId ?? null, null)
  assert.equal(canvasAssets.state.reads.at(-1).available, '1')
  await canvasAssets.close()
  cases.push('canvas-side-library-scopes-project-shared-single-project-and-explicit-accessible')

  const racing = await open('canvas-assets', { width: 1024, height: 600 })
  await racing.getByText('自己的角色一', { exact: true }).waitFor()
  racing.state.holdNextRead = true
  const heldSingleProjectRead = racing.waitForRequest((request) => {
    const url = new URL(request.url())
    return url.pathname === '/api/frameos/materials' && url.searchParams.get('projectId') === 'project-1'
  })
  await racing.getByRole('combobox', { name: '来源作品', exact: true }).selectOption('project-1')
  await heldSingleProjectRead
  const accessibleRead = racing.waitForResponse((response) => {
    const url = new URL(response.url())
    return url.pathname === '/api/frameos/materials' && !url.searchParams.has('projectId') && !url.searchParams.has('workId')
  })
  await racing.getByRole('combobox', { name: '来源作品', exact: true }).selectOption('all')
  await accessibleRead
  await racing.getByText('别的作品素材', { exact: true }).waitFor()
  racing.state.releaseRead()
  await racing.waitForTimeout(100)
  assert.equal(racing.state.reads.at(-1).workId ?? null, null)
  assert.equal(await racing.getByText('别的作品素材', { exact: true }).count(), 1)
  await racing.close()
  cases.push('late-single-project-response-cannot-replace-newer-accessible-scope')

  const unavailableCanvasScope = await open('canvas-assets', { width: 390, height: 700 }, false, { projectDetailFailures: 1 })
  await unavailableCanvasScope.getByText('模拟项目归属读取失败', { exact: true }).waitFor()
  assert.equal(unavailableCanvasScope.state.reads.length, 0)
  await unavailableCanvasScope.getByRole('button', { name: '重新加载项目归属', exact: true }).click()
  await unavailableCanvasScope.getByText('自己的角色一', { exact: true }).waitFor()
  await bounded(unavailableCanvasScope.getByRole('button', { name: '刷新资产列表', exact: true }))
  await bounded(unavailableCanvasScope.getByRole('combobox', { name: '来源作品', exact: true }))
  await unavailableCanvasScope.screenshot({ path: path.join(output, 'canvas-assets-mobile.png') })
  assert.equal(unavailableCanvasScope.state.reads.filter((read) => !read.projectId).at(-1)?.workId ?? null, 'work-1')
  assert.equal(unavailableCanvasScope.state.reads[0].available, '1')
  assert.equal(await unavailableCanvasScope.getByRole('button', { name: '缺音色 (3)', exact: true }).count(), 1)
  unavailableCanvasScope.state.materials.push(material('sibling-voice', 'project-shared', '同项目角色音色', { type: 'audio' }))
  unavailableCanvasScope.state.materials = unavailableCanvasScope.state.materials.map((item) => item.id === 'shared'
    ? { ...item, metadata: { ...item.metadata, voiceMaterialId: 'sibling-voice' } }
    : item)
  await unavailableCanvasScope.getByRole('button', { name: '刷新资产列表', exact: true }).click()
  await unavailableCanvasScope.getByRole('button', { name: '缺音色 (2)', exact: true }).waitFor()
  const sharedRole = unavailableCanvasScope.locator('article').filter({ hasText: '同项目共享素材' })
  await sharedRole.getByText('有音色', { exact: true }).waitFor()
  await unavailableCanvasScope.close()
  cases.push('canvas-side-library-unresolved-project-never-falls-back-to-global')

  for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 700 }]) {
    const toolbox = await open('toolbox', viewport)
    const functions = toolbox.getByRole('combobox', { name: '工具箱功能', exact: true })
    await functions.waitFor()
    await bounded(functions)
    for (const value of ['video', 'material', 'image']) {
      await functions.selectOption(value)
      assert.equal(await functions.inputValue(), value)
    }
    await toolbox.getByRole('button', { name: '选择人物', exact: true }).scrollIntoViewIfNeeded()
    await bounded(toolbox.getByRole('button', { name: '选择人物', exact: true }))
    await toolbox.getByRole('button', { name: '生成图片', exact: true }).scrollIntoViewIfNeeded()
    await bounded(toolbox.getByRole('button', { name: '生成图片', exact: true }))
    await toolbox.screenshot({ path: path.join(output, `${viewport.width}-toolbox-dropdown.png`) })
    assert.equal(await toolbox.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await toolbox.close()
    cases.push(`${viewport.width}:toolbox-function-dropdown-no-horizontal-overflow`)
  }
  const regeneration = await open('toolbox', { width: 1280, height: 900 })
  regeneration.state.toolboxHistory = [{
    id: 'source-asset', type: 'image', status: 'ready', url: imageUrl, materialId: 'source-material',
    modelId: 'nori::nori-image', params: { title: '原始素材', prompt: '原始提示词', aspectRatio: '16:9', quality: 'high' },
    task: { id: 'source-task', status: 'completed', costPoints: 1 },
  }]
  await regeneration.getByRole('button', { name: '刷新', exact: true }).click()
  await regeneration.getByRole('button', { name: /原始素材/ }).click()
  const details = regeneration.getByRole('region', { name: '已载入素材详情', exact: true })
  await details.waitFor()
  assert.equal(await regeneration.locator('aside input').first().inputValue(), '原始素材')
  assert.equal(await regeneration.locator('aside textarea').inputValue(), '原始提示词')
  await regeneration.locator('aside input').first().fill('修改后的新素材')
  await regeneration.locator('aside textarea').fill('修改后的提示词')
  await regeneration.getByRole('button', { name: '生成图片', exact: true }).click()
  await regeneration.getByText('生成任务已提交，完成后会自动进入资产库。', { exact: true }).waitFor()
  const regenerationBody = regeneration.state.writes.find((write) => write.path === '/api/frameos/toolbox/generate').body
  assert.equal(regenerationBody.title, '修改后的新素材')
  assert.equal(regenerationBody.prompt, '修改后的提示词')
  assert.ok(regenerationBody.idempotencyKey)
  assert.equal(regenerationBody.assetId ?? null, null)
  assert.equal(regenerationBody.requestHash ?? null, null)
  assert.ok(!JSON.stringify(regenerationBody).includes('source-asset'))
  assert.ok(!JSON.stringify(regenerationBody).includes('source-task'))
  assert.equal(regeneration.state.toolboxHistory[0].params.title, '原始素材')
  assert.equal(regeneration.state.toolboxHistory[0].params.prompt, '原始提示词')
  await regeneration.screenshot({ path: path.join(output, 'toolbox-regeneration.png'), fullPage: true })
  await regeneration.close()
  cases.push('history-details-edit-new-idempotency-key-and-source-immutability')

  const interactions = await open('toolbox', { width: 1024, height: 600 })
  await interactions.getByRole('button', { name: '选择人物', exact: true }).waitFor()
  for (const label of ['人物', '场景', '道具', '音色']) assert.ok(await interactions.getByText(label, { exact: true }).count())
  await interactions.getByRole('button', { name: '选择人物', exact: true }).click()
  const referenceDialog = interactions.getByRole('dialog', { name: '选择角色资产', exact: true })
  await referenceDialog.getByText('自己的角色一', { exact: true }).click()
  await referenceDialog.getByText('自己的角色二', { exact: true }).click()
  const confirm = referenceDialog.getByRole('button', { name: /^确定并关闭/ })
  await bounded(confirm)
  await confirm.click()
  await referenceDialog.waitFor({ state: 'hidden' })
  assert.equal(await interactions.locator('aside').getByText('1. 自己的角色一', { exact: true }).count(), 1)
  await interactions.getByRole('combobox', { name: '工具箱功能' }).selectOption('video')
  await interactions.getByRole('combobox', { name: '视频生成模式' }).selectOption('reference')
  await interactions.getByRole('button', { name: '选择人物', exact: true }).click()
  const videoRefs = interactions.getByRole('dialog', { name: '选择角色资产', exact: true })
  await videoRefs.getByText('自己的角色一', { exact: true }).click()
  await videoRefs.getByRole('button', { name: /^确定并关闭/ }).click()
  await videoRefs.waitFor({ state: 'hidden' })
  await interactions.getByLabel('同步生成声音').uncheck()
  await interactions.getByRole('combobox', { name: '视频生成模式' }).selectOption('text')
  assert.equal(await interactions.getByRole('button', { name: '选择人物' }).count(), 0)
  await interactions.locator('aside input[type="text"], aside input:not([type])').first().fill('纯文生测试')
  await interactions.locator('aside textarea').fill('雨夜城市街头')
  const generationButton = interactions.getByRole('button', { name: '生成视频', exact: true })
  await generationButton.waitFor({ state: 'visible' })
  await generationButton.click()
  await interactions.getByText('生成任务已提交，完成后会自动进入资产库。', { exact: true }).waitFor()
  const requestBody = interactions.state.writes.find((write) => write.path === '/api/frameos/toolbox/generate').body
  assert.equal(requestBody.workId, 'work-1')
  assert.equal(requestBody.projectId, 'project-1')
  assert.deepEqual(requestBody.referenceMaterialIds, [])
  assert.deepEqual(requestBody.referenceMaterials, [])
  assert.equal(requestBody.textOnly, true)
  assert.equal(requestBody.options.generateAudio, false, 'Mode switch must preserve the explicit sound choice')
  const readsBeforeRefresh = interactions.state.toolboxReads
  interactions.state.toolboxHistory = [{ id: 'refreshed-asset', type: 'video', status: 'ready', url: imageUrl, materialId: 'refreshed-material', params: { title: '刷新后的新视频' } }]
  await interactions.getByRole('button', { name: '刷新', exact: true }).click()
  await interactions.getByText('刷新后的新视频', { exact: true }).waitFor()
  await interactions.getByRole('status').filter({ hasText: '已刷新' }).waitFor()
  assert.ok(interactions.state.toolboxReads > readsBeforeRefresh)
  interactions.state.failHistory = true
  await interactions.getByRole('button', { name: '刷新', exact: true }).click()
  await interactions.getByText('模拟历史刷新失败', { exact: true }).waitFor()
  assert.equal(await interactions.getByText('刷新后的新视频', { exact: true }).count(), 1, 'Failure must keep last successful history')
  await interactions.getByRole('button', { name: '刷新', exact: true }).click()
  await interactions.getByRole('button', { name: '刷新', exact: true }).waitFor({ state: 'visible' })
  await interactions.close()
  cases.push('categorized-batch-references-confirm-pure-text-history-refresh-and-failure')

  for (const viewport of [{ width: 768, height: 480 }, { width: 390, height: 700 }]) {
    const paired = await open('assets', viewport)
    await paired.getByRole('button', { name: '批量上传图片', exact: true }).click()
    const upload = paired.getByRole('dialog', { name: '批量上传素材', exact: true })
    await upload.locator('input[type="file"]').first().setInputFiles([{ name: '关羽.png', mimeType: 'image/png', buffer: png }])
    await upload.getByLabel('批量角色音色文件').setInputFiles([{ name: '关羽.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('test-audio') }])
    assert.equal(await upload.getByLabel('对应音色 关羽.png').inputValue(), '关羽.mp3')
    paired.state.failVoiceBinding = true
    await upload.getByRole('button', { name: '开始上传', exact: true }).click()
    await upload.getByText('模拟音色绑定失败，可重试', { exact: true }).waitFor()
    await bounded(upload.getByRole('button', { name: '重试未成功项', exact: true }))
    await upload.getByRole('button', { name: '重试未成功项', exact: true }).click()
    await upload.waitFor({ state: 'hidden' })
    assert.deepEqual(paired.state.uploads, ['关羽.png', '关羽.mp3'], 'Binding failure retry must not reupload either file')
    await paired.getByText('关羽', { exact: true }).waitFor()
    const role = paired.locator('.fal-asset-card').filter({ hasText: '关羽' })
    await role.getByRole('button', { name: '管理角色音色', exact: true }).click()
    const voice = paired.getByRole('dialog', { name: '设置角色音色 关羽', exact: true })
    await bounded(voice)
    await bounded(voice.getByRole('button', { name: '确定并关闭', exact: true }))
    await voice.getByRole('button', { name: '解除音色', exact: true }).click()
    await voice.waitFor({ state: 'hidden' })
    await role.getByRole('button', { name: '设置角色音色', exact: true }).waitFor()
    await paired.close()
    cases.push(`${viewport.width}:role-image-audio-pairing-binding-retry-no-duplicate-and-unbind`)
  }

  const directories = await open('toolbox', { width: 1024, height: 600 })
  await directories.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const handle = await root.getDirectoryHandle('项目固定下载测试', { create: true })
    window.showDirectoryPicker = async () => handle
  })
  await directories.getByRole('button', { name: '设置本地下载目录', exact: true }).click()
  await directories.getByRole('button', { name: '更改本地下载目录', exact: true }).waitFor()
  await directories.getByRole('combobox', { name: '工具箱功能' }).selectOption('video')
  directories.state.toolboxHistory = [{ id: 'download-video', type: 'video', status: 'ready', url: imageUrl, materialId: 'video-material', params: { title: '命名下载视频' } }]
  await directories.getByRole('button', { name: '刷新', exact: true }).click()
  await directories.getByRole('button', { name: '按项目规则下载视频', exact: true }).click()
  await directories.getByText('已保存到本地固定目录：机甲三国_测试_视频001_马俊.mp4', { exact: true }).waitFor()
  await directories.getByRole('button', { name: '按项目规则下载视频', exact: true }).click()
  await directories.getByText('已保存到本地固定目录：机甲三国_测试_视频001_马俊 (2).mp4', { exact: true }).waitFor()
  const savedNames = await directories.evaluate(async () => {
    const root = await navigator.storage.getDirectory()
    const folder = await root.getDirectoryHandle('项目固定下载测试')
    const names = []
    for await (const [name] of folder.entries()) names.push(name)
    return names
  })
  assert.equal(savedNames.length, 2)
  await directories.reload()
  await directories.getByRole('button', { name: '更改本地下载目录', exact: true }).waitFor()
  await directories.getByRole('combobox', { name: '归属作品' }).selectOption('project-2')
  await directories.getByRole('button', { name: '设置本地下载目录', exact: true }).waitFor()
  await directories.getByRole('combobox', { name: '归属作品' }).selectOption('project-1')
  await directories.getByRole('button', { name: '更改本地下载目录', exact: true }).waitFor()
  await directories.evaluate(() => window.changeFixtureAccount({ id: 'child-1', name: '子账号', role: 'storyboard', permissions: ['canvasWrite', 'toolboxUse'], workspaceOwnerId: 'user-1' }))
  await directories.getByRole('button', { name: '设置本地下载目录', exact: true }).waitFor()
  await directories.close()
  cases.push('real-directory-handle-indexeddb-reload-creator-naming-no-overwrite-member-project-isolation')
  const replacement = await open('assets', { width: 390, height: 700 })
  await replacement.getByRole('button', { name: '批量上传图片', exact: true }).click()
  const replacementDialog = replacement.getByRole('dialog', { name: '批量上传素材', exact: true })
  await replacementDialog.locator('input[type="file"]').first().setInputFiles([{ name: '关羽.png', mimeType: 'image/png', buffer: png }])
  await replacementDialog.getByLabel('批量角色音色文件').setInputFiles([{ name: '关羽_voice.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('bad') }])
  replacement.state.failUploadName = '关羽_voice.mp3'
  await replacementDialog.getByRole('button', { name: '开始上传', exact: true }).click()
  await replacementDialog.getByText('模拟音色文件无效，请更换文件', { exact: true }).waitFor()
  await replacementDialog.getByLabel('批量角色音色文件').setInputFiles([{ name: '关羽.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('replacement') }])
  await replacementDialog.getByLabel('素材名称 关羽.png').fill('关羽新名称')
  await replacementDialog.getByRole('button', { name: '重试未成功项', exact: true }).click()
  await replacementDialog.waitFor({ state: 'hidden' })
  assert.deepEqual(replacement.state.uploads, ['关羽.png', '关羽_voice.mp3', '关羽.mp3'])
  await replacement.getByText('关羽新名称', { exact: true }).waitFor()
  await replacement.close()
  cases.push('failed-audio-can-be-replaced-and-role-renamed-without-reuploading-successful-image')

  const unfinished = await open('picker', { width: 390, height: 700 })
  unfinished.state.materials.push(material('pending-material', 'project-1', '尚未生成完成', { status: 'processing', url: null }))
  await unfinished.getByRole('button', { name: '刷新', exact: true }).click()
  const pending = unfinished.getByRole('button').filter({ hasText: '尚未生成完成' })
  assert.equal(await pending.isDisabled(), true)
  await unfinished.close()
  cases.push('unfinished-or-missing-url-materials-cannot-be-selected-as-generation-inputs')
  for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 700 }]) {
    const timbre = await open('timbre', viewport)
    await timbre.getByRole('button', { name: '批量按角色名绑定', exact: true }).click()
    await timbre.locator('#batch-character-voices').setInputFiles([
      { name: '关羽.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('test-audio') },
      { name: '赵云.mp3', mimeType: 'audio/mpeg', buffer: Buffer.from('test-audio') },
    ])
    const start = timbre.getByRole('button', { name: '开始批量绑定音色', exact: true })
    await start.scrollIntoViewIfNeeded()
    await bounded(start)
    await start.click()
    await timbre.getByText(/成功绑定 1 个角色；失败 1 个/).waitFor()
    await start.click()
    await timbre.getByText('成功绑定 1 个角色。', { exact: true }).waitFor()
    assert.deepEqual(timbre.state.voiceUploads.map((item) => item.name), ['关羽.mp3', '赵云.mp3', '赵云.mp3'])
    assert.equal(await timbre.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await timbre.close()
    cases.push(`${viewport.width}:structured-character-batch-voice-small-screen-retries-only-failed-file`)
  }
  const personalLibrary = await open('materials', { width: 1280, height: 900 }, false, {
    materials: [material('personal-a', 'personal', '私人角色', { metadata: { assetCategory: 'character', voiceMaterialId: 'private-voice' } }), material('private-voice', 'personal', '私人音色', { type: 'audio', metadata: { assetCategory: 'character' } }), material('own-b', 'project-1', '被引用项目素材')],
  })
  await personalLibrary.getByRole('button', { name: '个人素材', exact: true }).click()
  await personalLibrary.getByRole('button', { name: '编辑素材 私人角色', exact: true }).click()
  const personalEditor = personalLibrary.getByRole('dialog', { name: '编辑素材', exact: true })
  await personalEditor.getByRole('textbox', { name: '编辑素材名称', exact: true }).fill('共享角色')
  await personalEditor.getByRole('combobox', { name: '编辑素材归属', exact: true }).selectOption('project-1')
  await personalEditor.getByRole('button', { name: '保存修改', exact: true }).click()
  await personalEditor.waitFor({ state: 'hidden' })
  await personalLibrary.getByText('已解除角色卡音色绑定', { exact: false }).waitFor()
  assert.equal(personalLibrary.state.materials.find((item) => item.id === 'personal-a').metadata.voiceMaterialId ?? null, null)
  assert.equal(personalLibrary.state.materials.some((item) => item.id === 'private-voice'), true)
  const moveWrite = personalLibrary.state.writes.find((write) => write.method === 'PATCH' && write.body.projectId === 'project-1')
  assert.deepEqual(moveWrite.body, { title: '共享角色', projectId: 'project-1' })
  assert.equal(personalLibrary.state.materials.find((item) => item.id === 'personal-a').personalOwnerId, null)
  await personalLibrary.getByRole('button', { name: '当前作品 等项目资产', exact: true }).click()
  await personalLibrary.getByText('共享角色', { exact: true }).waitFor()
  await personalLibrary.getByRole('button', { name: '全选上传素材', exact: true }).click()
  personalLibrary.state.partialDelete = true
  await personalLibrary.getByRole('button', { name: '批量删除 (2)', exact: true }).click()
  await personalLibrary.getByRole('dialog', { name: '批量删除上传素材', exact: true }).getByRole('button', { name: '确认批量删除', exact: true }).click()
  await personalLibrary.getByText(/素材仍被 1 个当前画布引用/).waitFor()
  assert.equal(personalLibrary.state.materials.some((item) => item.id === 'own-b'), true)
  assert.equal(personalLibrary.state.materials.some((item) => item.id === 'personal-a'), false)
  await personalLibrary.close()
  cases.push('personal-edit-share-preserves-id-and-batch-deletion-keeps-referenced-item')

  const personalAssets = await open('assets', { width: 1024, height: 700 })
  await personalAssets.getByRole('button', { name: '批量上传图片', exact: true }).click()
  const personalUpload = personalAssets.getByRole('dialog', { name: '批量上传素材', exact: true })
  assert.equal(await personalUpload.getByRole('combobox', { name: '素材归属', exact: true }).inputValue(), 'personal')
  await personalUpload.locator('input[type="file"]').first().setInputFiles([{ name: '个人角色.png', mimeType: 'image/png', buffer: png }])
  await personalUpload.getByRole('button', { name: '开始上传', exact: true }).click()
  await personalUpload.waitFor({ state: 'hidden' })
  await personalAssets.getByRole('checkbox', { name: '选择资产 个人角色', exact: true }).waitFor()
  assert.equal(personalAssets.state.reads.at(-1).scope, 'personal')
  assert.equal(personalAssets.state.materials.find((item) => item.title === '个人角色').personalOwnerId, 'member-1')
  await personalAssets.screenshot({ path: path.join(output, 'personal-assets.png') })
  await personalAssets.close()
  cases.push('classified-upload-defaults-personal-and-appears-in-personal-asset-source')

  assert.deepEqual(errors, [], `Browser errors: ${JSON.stringify(errors)}`)
  console.log(JSON.stringify({ status: 'passed', cases }, null, 2))
} catch (error) {
  if (latestPage && !latestPage.isClosed()) await latestPage.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
