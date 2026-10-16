// Real project/asset UI, mocked local APIs: no production changes or paid calls.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/project-assets-management')
await mkdir(artifacts, { recursive: true })
let appCss
if (process.env.NORI_BROWSER_GLOBAL_CSS_PATH) {
  appCss = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH, 'utf8')
  assert.ok(appCss.includes('--nori-interface-scale'), 'Actual application CSS required')
} else {
  const workspace = new URL('http://127.0.0.1:3000')
  const html = await (await fetch(new URL('/zh/auth/signin', workspace))).text()
  const styleUrls = [...html.matchAll(/<link\b[^>]*>/g)].filter(([tag]) => tag.includes('rel="stylesheet"'))
    .map(([tag]) => tag.match(/href="([^"]+)"/)?.[1]).filter((href) => href?.startsWith('/_next/static/'))
  assert.ok(styleUrls.length, 'Guarded local app must be running')
  appCss = (await Promise.all(styleUrls.map(async (href) => {
    const response = await fetch(new URL(href, workspace))
    assert.ok(response.ok, `Global stylesheet unavailable: ${response.status}`)
    return response.text()
  }))).join('\n')
}
const bundle = process.env.NORI_BROWSER_PREBUILT_DIR ? {
  outputFiles: await Promise.all(['js', 'css'].map(async (extension) => ({
    path: `/fixture/fixture.${extension}`,
    contents: await readFile(path.join(process.env.NORI_BROWSER_PREBUILT_DIR, `project-assets-management.${extension}`)),
  }))),
} : await (await import('esbuild')).build({
  entryPoints: ['tests/browser/project-assets-management.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const server = createServer((request, response) => {
  if (request.url === '/global.css') { response.setHeader('Content-Type', 'text/css'); return response.end(appCss) }
  const file = bundle.outputFiles.find((file) => file.path.endsWith(request.url === '/fixture.css' ? '.css' : '.js'))
  if (request.url === '/fixture.js' || request.url === '/fixture.css') {
    response.setHeader('Content-Type', request.url.endsWith('.css') ? 'text/css' : 'text/javascript')
    return response.end(file.contents)
  }
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const errors = []
const results = []
let latest
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLfcAAAAASUVORK5CYII=', 'base64')

async function open(query, viewport = { width: 1024, height: 600 }) {
  const page = await browser.newPage({ viewport })
  latest = page
  page.on('pageerror', (error) => errors.push(error.message))
  let project = { id: 'project-1', name: '短剧作品', description: '原简介', canManage: true, canMove: true, canManageMembers: true, createdAt: '2026-10-12T00:00:00Z', updatedAt: '2026-10-12T00:00:00Z' }
  let deleted = false
  let materials = []
  const writes = []
  const uploads = []
  let failSecond = query.includes('retry')
  let failDetails = false
  let failCharacters = false
  let denyDelete = false
  let activeUploads = 0
  let maxUploads = 0
  let holdGlobal = false
  let heldRead
  let heldRequestResolve
  page.heldRequest = new Promise((resolve) => { heldRequestResolve = resolve })
  page.armOldGlobal = () => { holdGlobal = true }
  page.releaseOldGlobal = () => heldRead?.()
  page.failDetails = (value) => { failDetails = value }
  page.failCharacters = (value) => { failCharacters = value }
  page.denyDelete = (value) => { denyDelete = value }
  page.writes = writes
  page.uploads = uploads
  page.maxUploads = () => maxUploads
  if (query.includes('view=assets') && viewport.width === 390) {
    await page.addInitScript(() => { Object.defineProperty(Crypto.prototype, 'randomUUID', { value: undefined, configurable: true }) })
  }
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    let payload = {}
    let status = 200
    if (request.method() !== 'GET') writes.push({ path: url.pathname, method: request.method(), body: request.headers()['content-type']?.includes('json') ? request.postDataJSON() : null })
    if (url.pathname === '/api/works') {
      payload = { works: [{ id: 'work-1', name: '测试项目', canManage: true, canCreateProjects: true, projectCount: deleted ? 0 : 1, projects: deleted ? [] : [project] }], pagination: { total: 1, totalPages: 1 } }
    } else if (url.pathname === '/api/projects') payload = { projects: [{ id: project.id, name: project.name }, { id: 'project-2', name: '第二作品' }] }
    else if (url.pathname === '/api/projects/project-1') {
      if (request.method() === 'PATCH') {
        if (failDetails) { status = 500; payload = { message: '模拟作品信息保存失败' } }
        else { project = { ...project, ...request.postDataJSON() }; payload = { project } }
      } else if (request.method() === 'DELETE') { deleted = true; payload = { success: true } }
      else payload = { project }
    } else if (url.pathname === '/api/projects/project-1/data') payload = { project }
    else if (url.pathname === '/api/novel-promotion/project-1') payload = {
      projectStyle: 'live-action', videoRatio: '9:16', videoResolution: '720p', targetAudience: 'zh-platform',
      episodeDurationMode: 'per-episode', episodeDurationValue: 120, artStylePrompt: '', modelConfig: {},
    }
    else if (url.pathname === '/api/user/models') payload = { text: [], image: [], video: [] }
    else if (url.pathname.endsWith('/generation-config')) payload = {
      imageModels: [{ modelKey: 'nori::noriimage', name: 'NoriImage', provider: 'nori', configured: true, available: true, options: {}, inputSchema: { image: { min: 0, max: 9 }, video: { min: 0, max: 0 }, audio: { min: 0, max: 0 }, requiredFields: ['prompt'] } }],
      videoModels: [], defaults: { imageModel: 'nori::noriimage', aspectRatio: '16:9', resolution: '2K' },
    }
    else if (url.pathname === '/api/user/balance') payload = { balancePoints: 1000, generationAllowed: true, dailyUsedPoints: 0, dailyLimitPoints: null }
    else if (url.pathname.startsWith('/api/frameos/materials/') && request.method() === 'DELETE') {
      if (denyDelete) { status = 409; payload = { message: '该素材仍被画布引用，请先移除引用' } }
      else { materials = materials.filter((item) => item.id !== url.pathname.split('/').at(-1)); payload = { success: true, trashed: true } }
    }
    else if (url.pathname === '/api/assets') {
      if (failCharacters && url.searchParams.get('kind') === 'character') { status = 500; payload = { message: '模拟角色记录损坏' } }
      else payload = { assets: [] }
    } else if (url.pathname === '/api/frameos/materials') {
      if (request.method() === 'POST') {
        activeUploads++
        maxUploads = Math.max(maxUploads, activeUploads)
        const form = await new Response(request.postDataBuffer(), { headers: { 'Content-Type': request.headers()['content-type'] } }).formData()
        const data = { title: form.get('title'), projectId: form.get('projectId'), category: form.get('assetCategory'), file: form.get('file').name }
        uploads.push(data)
        await new Promise((resolve) => setTimeout(resolve, 100))
        if (failSecond && data.file === '角色2.png') { failSecond = false; status = 500; payload = { message: '模拟单张上传失败' } }
        else {
          const now = new Date().toISOString()
          const material = { id: `material-${materials.length + 1}`, title: data.title, projectId: data.projectId, type: 'image', source: 'upload', status: 'ready', url: 'data:image/png;base64,' + png.toString('base64'), metadata: { assetCategory: data.category }, createdAt: now, updatedAt: now }
          materials = [...materials, material]
          payload = { material }
        }
        activeUploads--
      } else {
        payload = { materials: materials.filter((item) => !url.searchParams.get('projectId') || item.projectId === url.searchParams.get('projectId')) }
        if (holdGlobal && url.searchParams.get('projectId') === 'global') {
          holdGlobal = false
          heldRequestResolve()
          await new Promise((resolve) => { heldRead = resolve })
        }
      }
    } else if (url.pathname.endsWith('/episodes')) payload = { episodes: [] }
    else if (url.pathname.endsWith('/assets')) payload = { characters: [], locations: [], props: [] }
    else if (url.pathname.endsWith('/assignments')) payload = { assignments: [] }
    else if (url.pathname.endsWith('/recycle-bin')) payload = { projects: [] }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) }).catch(() => {})
  })
  await page.goto(`${base}/${query}`)
  return page
}
async function bounded(locator) {
  const box = await locator.boundingBox()
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= (await locator.page().viewportSize()).width + 1 && box.y + box.height <= (await locator.page().viewportSize()).height + 1, `Out of viewport: ${JSON.stringify(box)}`)
}
try {
  for (const viewport of [{ width: 768, height: 480 }, { width: 390, height: 700 }]) {
    const credits = await open('?view=credit', viewport)
    const creditDialog = credits.getByRole('dialog', { name: '收回历史个人积分', exact: true })
    await creditDialog.waitFor()
    await bounded(creditDialog)
    await bounded(creditDialog.getByRole('button', { name: '确认收回', exact: true }))
    await bounded(creditDialog.getByRole('button', { name: '关闭', exact: true }))
    await credits.close()
  }
  const library = await open('?view=materials', { width: 768, height: 480 })
  await library.getByRole('button', { name: '本地上传', exact: true }).click()
  const libraryUpload = library.getByRole('dialog', { name: '批量上传素材', exact: true })
  await libraryUpload.locator('input[type="file"]').first().setInputFiles({ name: '库内删除测试.png', mimeType: 'image/png', buffer: png })
  await libraryUpload.getByRole('button', { name: '开始上传', exact: true }).click()
  await libraryUpload.waitFor({ state: 'hidden' })
  await library.getByRole('button', { name: '删除上传资产 库内删除测试', exact: true }).click()
  const libraryDeletion = library.getByRole('dialog', { name: '删除上传素材', exact: true })
  await bounded(libraryDeletion)
  await libraryDeletion.getByRole('button', { name: '确认删除', exact: true }).click()
  await libraryDeletion.waitFor({ state: 'hidden' })
  assert.equal(await library.getByRole('button', { name: '删除上传资产 库内删除测试', exact: true }).count(), 0)
  await library.close()
  for (const viewport of [{ width: 1024, height: 600 }, { width: 768, height: 480 }, { width: 390, height: 700 }]) {
    const page = await open('', viewport)
    const trigger = page.getByRole('button', { name: '打开 短剧作品 菜单', exact: true })
    await trigger.waitFor()
    await page.getByRole('button', { name: '新建作品', exact: true }).click()
    const creation = page.getByRole('dialog', { name: '创建作品', exact: true })
    await creation.waitFor()
    await bounded(creation)
    await bounded(creation.locator('.fos-dialog-foot'))
    assert.equal(await creation.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false)
    await creation.locator('.create-project-body').evaluate((body) => { body.scrollTop = body.scrollHeight })
    await bounded(creation.locator('.fos-dialog-foot'))
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}-create-in-shell.png`) })
    await creation.getByRole('button', { name: '关闭创建作品', exact: true }).click()
    await trigger.hover()
    assert.equal(await page.getByRole('menu', { name: '短剧作品 作品操作' }).count(), 0, 'Hover must not toggle away the next click')
    await trigger.click()
    const menu = page.getByRole('menu', { name: '短剧作品 作品操作' })
    await menu.waitFor()
    await bounded(menu)
    await menu.getByRole('menuitem', { name: '编辑作品', exact: true }).click()
    const edit = page.getByRole('dialog', { name: '编辑作品', exact: true })
    await edit.getByLabel('作品名称', { exact: true }).waitFor()
    await bounded(edit)
    await bounded(edit.getByRole('button', { name: '保存作品', exact: true }))
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}-edit-dialog.png`) })
    await edit.getByLabel('作品名称', { exact: true }).fill('编辑后的作品')
    await edit.getByLabel('作品简介', { exact: true }).fill('新的作品简介')
    await edit.getByRole('button', { name: '保存作品', exact: true }).click()
    await page.getByRole('button', { name: '打开 编辑后的作品 菜单', exact: true }).waitFor()
    assert.ok(page.writes.some((write) => write.body?.description === '新的作品简介'))
    await page.getByRole('button', { name: '打开 编辑后的作品 菜单', exact: true }).click()
    await page.getByRole('menuitem', { name: '重命名', exact: true }).click()
    const rename = page.getByRole('dialog', { name: '重命名作品' })
    await bounded(rename)
    await rename.locator('input').fill('重命名后的作品')
    await rename.getByRole('button', { name: '确定', exact: true }).click()
    await page.getByRole('button', { name: '打开 重命名后的作品 菜单', exact: true }).click()
    await page.getByRole('menuitem', { name: '删除作品', exact: true }).click()
    const deletion = page.getByRole('dialog', { name: '删除作品', exact: true })
    await bounded(deletion)
    assert.ok((await deletion.innerText()).includes('15 天内可恢复'))
    await deletion.getByRole('button', { name: '确认删除', exact: true }).click()
    await page.getByText('暂无作品', { exact: true }).waitFor()
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}-project-actions.png`) })
    results.push(`${viewport.width}:edit-rename-delete`)
    await page.close()
  }
  const child = await open('?session=child')
  await child.getByRole('button', { name: '打开 短剧作品 菜单', exact: true }).click()
  for (const name of ['重命名', '删除作品']) assert.equal(await child.getByRole('menuitem', { name, exact: true }).count(), 0)
  await child.getByRole('menuitem', { name: '编辑作品', exact: true }).click()
  const childEdit = child.getByRole('dialog', { name: '编辑作品', exact: true })
  await childEdit.getByLabel('作品名称', { exact: true }).waitFor()
  assert.equal(await childEdit.getByLabel('作品名称', { exact: true }).getAttribute('readonly'), null)
  await childEdit.getByLabel('作品名称', { exact: true }).fill('参与人员二次编辑')
  await childEdit.getByLabel('视频比例').selectOption('16:9')
  await childEdit.getByRole('button', { name: '保存作品', exact: true }).click()
  await childEdit.waitFor({ state: 'hidden' })
  assert.ok(child.writes.some((write) => write.path === '/api/novel-promotion/project-1'))
  assert.ok(child.writes.some((write) => write.path === '/api/projects/project-1' && write.body.name === '参与人员二次编辑'))
  await child.close()
  const childHeader = await open('?view=header&session=child')
  await childHeader.getByTestId('project-name').getByText('短剧作品', { exact: true }).waitFor()
  assert.equal(await childHeader.getByRole('button', { name: '作品操作' }).count(), 0)
  await childHeader.getByRole('button', { name: '作品设置', exact: true }).click()
  const childSettings = childHeader.getByRole('dialog', { name: '编辑作品', exact: true })
  await childSettings.getByLabel('作品名称', { exact: true }).waitFor()
  assert.equal(await childSettings.getByLabel('作品名称', { exact: true }).getAttribute('readonly'), null)
  await childSettings.getByLabel('视频比例').selectOption('16:9')
  await childSettings.getByRole('button', { name: '保存作品', exact: true }).click()
  await childSettings.waitFor({ state: 'hidden' })
  assert.ok(childHeader.writes.some((write) => write.path === '/api/novel-promotion/project-1' && write.body.videoRatio === '16:9'))
  assert.equal(childHeader.writes.filter((write) => write.path === '/api/projects/project-1').length, 0)
  await childHeader.close()
  const header = await open('?view=header')
  await header.getByTestId('project-name').getByText('短剧作品', { exact: true }).waitFor()
  await header.getByRole('button', { name: '作品操作' }).click()
  await header.getByRole('menuitem', { name: '重命名', exact: true }).click()
  await header.getByRole('dialog', { name: '重命名作品' }).locator('input').fill('实时新名称')
  await header.getByRole('button', { name: '确定', exact: true }).click()
  await header.getByTestId('project-name').getByText('实时新名称', { exact: true }).waitFor()
  await header.close()
  const narrowHeader = await open('?view=header', { width: 390, height: 700 })
  await narrowHeader.getByTestId('project-name').getByText('短剧作品', { exact: true }).waitFor()
  await narrowHeader.getByRole('button', { name: '作品操作' }).click()
  await narrowHeader.getByRole('menuitem', { name: '重命名', exact: true }).click()
  const narrowRename = narrowHeader.getByRole('dialog', { name: '重命名作品' })
  await narrowRename.locator('input').fill('长作品名称边界测试'.repeat(8).slice(0, 40))
  await narrowRename.getByRole('button', { name: '确定', exact: true }).click()
  const narrowMetrics = await narrowHeader.locator('.fos-stage-header h1').evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, right: rect.right, viewport: innerWidth }
  })
  assert.ok(narrowMetrics.right <= narrowMetrics.viewport + 1, `Long project header overflowed: ${JSON.stringify(narrowMetrics)}`)
  await narrowHeader.close()
  const longHeader = await open('?view=header', { width: 390, height: 700 })
  await longHeader.getByTestId('project-name').getByText('短剧作品', { exact: true }).waitFor()
  await longHeader.getByRole('button', { name: '作品操作' }).click()
  await longHeader.getByRole('menuitem', { name: '重命名', exact: true }).click()
  const name = '长作品名称边界测试'.repeat(8).slice(0, 40)
  await longHeader.getByRole('dialog', { name: '重命名作品' }).locator('input').fill(name)
  await longHeader.getByRole('button', { name: '确定', exact: true }).click()
  await longHeader.getByTestId('project-name').getByText(name, { exact: true }).waitFor()
  await bounded(longHeader.locator('.fos-stage-header h1'))
  await bounded(longHeader.getByRole('button', { name: '作品操作' }))
  await longHeader.screenshot({ path: path.join(artifacts, 'long-header-fixed.png') })
  await longHeader.close()

  for (const viewport of [{ width: 1280, height: 720 }, { width: 768, height: 480 }]) {
    const toolbox = await open('?view=toolbox', viewport)
    const add = toolbox.getByRole('button', { name: '选择人物', exact: true })
    await add.waitFor()
    await add.click()
    const picker = toolbox.getByRole('dialog', { name: '选择角色资产', exact: true })
    await picker.waitFor()
    const colors = await picker.locator('.material-picker-dialog').evaluate((element) => ({
      background: getComputedStyle(element).backgroundColor,
      text: getComputedStyle(element).color,
      token: getComputedStyle(element).getPropertyValue('--fos-bg-3').trim(),
    }))
    assert.equal(colors.background, 'rgb(28, 28, 28)', 'Picker must have an opaque dark background outside the shell')
    assert.equal(colors.text, 'rgb(255, 255, 255)')
    assert.equal(colors.token, '#1c1c1c')
    await picker.getByRole('button', { name: '本地上传', exact: true }).click()
    const title = picker.getByPlaceholder('素材名称（必填）')
    await title.fill('上传界面可见性验证')
    const inputColors = await title.evaluate((element) => ({ bg: getComputedStyle(element).backgroundColor, text: getComputedStyle(element).color }))
    assert.notEqual(inputColors.bg, 'rgba(0, 0, 0, 0)')
    assert.notEqual(inputColors.text, 'rgba(0, 0, 0, 0)')
    await bounded(picker.getByRole('button', { name: '关闭素材选择器' }))
    await bounded(picker.getByRole('button', { name: '上传并选用', exact: true }))
    await toolbox.screenshot({ path: path.join(artifacts, `${viewport.width}-toolbox-upload-visible.png`) })
    await picker.getByRole('button', { name: '关闭素材选择器' }).click()
    await toolbox.close()
  }

  const many = await open('?view=assets', { width: 768, height: 480 })
  await many.getByRole('button', { name: '短剧作品', exact: true }).click()
  await many.getByRole('button', { name: '批量上传图片', exact: true }).click()
  const manyUpload = many.getByRole('dialog', { name: '批量上传素材' })
  await manyUpload.locator('input[type="file"]').first().setInputFiles(Array.from({ length: 102 }, (_, i) => ({
    name: `非常长的资产文件名称用于验证多图上传列表不会把确认按钮挤出屏幕-${i}.png`, mimeType: 'image/png', buffer: png,
  })))
  assert.equal(await manyUpload.locator('[data-upload-status]').count(), 100)
  await manyUpload.getByText('每批最多 100 个文件', { exact: true }).waitFor()
  await manyUpload.locator('input[aria-label^="素材名称"]').last().scrollIntoViewIfNeeded()
  await bounded(manyUpload)
  await bounded(manyUpload.getByRole('button', { name: '关闭上传', exact: true }))
  await bounded(manyUpload.getByRole('button', { name: '开始上传', exact: true }))
  assert.equal(await manyUpload.evaluate((el) => el.scrollWidth > el.clientWidth + 1), false)
  assert.equal(many.uploads.length, 0, 'Selecting files must not begin uploading')
  await many.screenshot({ path: path.join(artifacts, '100-file-small-dialog.png') })
  await manyUpload.getByRole('button', { name: '关闭上传', exact: true }).click()
  await many.close()

  for (const viewport of [{ width: 1024, height: 600 }, { width: 768, height: 480 }, { width: 390, height: 700 }]) {
    const page = await open('?view=assets&retry=1', viewport)
    await page.getByRole('button', { name: '短剧作品', exact: true }).click()
    await page.getByRole('button', { name: '短剧作品/角色', exact: true }).click()
    await page.getByRole('button', { name: '批量上传图片', exact: true }).click()
    const upload = page.getByRole('dialog', { name: '批量上传素材' })
    assert.equal(await upload.getByLabel('归属作品', { exact: true }).inputValue(), 'project-1')
    assert.equal(await upload.getByLabel('归属作品', { exact: true }).isDisabled(), true)
    assert.equal(await upload.getByLabel('资产归类', { exact: true }).inputValue(), 'character')
    await upload.locator('input[type="file"]').first().setInputFiles(['角色1.png', '角色2.png', '角色3.png'].map((name) => ({ name, mimeType: 'image/png', buffer: png })))
    await bounded(upload)
    await bounded(upload.getByRole('button', { name: '开始上传', exact: true }))
    await upload.getByRole('button', { name: '开始上传', exact: true }).click()
    await upload.getByText('已上传 2 / 3 · 部分失败，可仅重试失败项', { exact: true }).waitFor()
    assert.equal(page.maxUploads(), 1)
    await upload.getByRole('button', { name: '重试未成功项', exact: true }).click()
    await upload.waitFor({ state: 'hidden' })
    assert.equal(page.uploads.filter((item) => item.file === '角色1.png').length, 1)
    await page.getByRole('button', { name: '短剧作品/环境', exact: true }).click()
    await page.getByRole('button', { name: '批量上传图片', exact: true }).click()
    assert.equal(await upload.getByLabel('资产归类', { exact: true }).isEnabled(), true, 'Next batch remains usable after successful uploads close the previous dialog')
    await upload.getByLabel('资产归类', { exact: true }).selectOption('location')
    assert.equal(await upload.getByLabel('资产归类', { exact: true }).inputValue(), 'location')
    await upload.locator('input[type="file"]').first().setInputFiles({ name: '夜景.png', mimeType: 'image/png', buffer: png })
    await upload.getByRole('button', { name: '开始上传', exact: true }).click()
    await upload.waitFor({ state: 'hidden' })
    assert.equal(await page.getByRole('button', { name: '短剧作品/环境', exact: true }).getAttribute('aria-current'), 'page')
    await page.getByText('夜景', { exact: true }).waitFor()
    assert.deepEqual(page.uploads.at(-1), { title: '夜景', projectId: 'project-1', category: 'location', file: '夜景.png' })
    await page.getByRole('button', { name: '删除上传资产 夜景', exact: true }).click()
    const deletion = page.getByRole('dialog', { name: '删除上传资产' })
    await bounded(deletion)
    await deletion.getByRole('button', { name: '取消', exact: true }).click()
    await page.getByText('夜景', { exact: true }).waitFor()
    page.denyDelete(true)
    await page.getByRole('button', { name: '删除上传资产 夜景', exact: true }).click()
    await deletion.getByRole('button', { name: '确认删除', exact: true }).click()
    await deletion.getByText(/仍被画布引用/).first().waitFor()
    page.denyDelete(false)
    await deletion.getByRole('button', { name: '确认删除', exact: true }).click()
    await deletion.waitFor({ state: 'hidden' })
    await page.getByText('当前账号暂无环境资产', { exact: true }).waitFor()
    assert.equal(await page.getByText('夜景', { exact: true }).count(), 0)
    await page.getByRole('button', { name: '第二作品', exact: true }).click()
    await page.getByText('当前账号暂无环境资产', { exact: true }).waitFor()
    assert.equal(await page.getByText('夜景', { exact: true }).count(), 0)
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}-batch-scenes.png`) })
    results.push(`${viewport.width}:batch-retry-character-then-scene`)
    await page.close()
  }
  const isolation = await open('?view=assets')
  await isolation.getByText('当前账号暂无角色资产', { exact: true }).waitFor()
  isolation.armOldGlobal()
  await isolation.getByRole('button', { name: '刷新', exact: true }).click()
  await isolation.heldRequest
  await isolation.getByRole('button', { name: '短剧作品', exact: true }).click()
  await isolation.getByRole('button', { name: '短剧作品/环境', exact: true }).click()
  await isolation.getByText('当前账号暂无环境资产', { exact: true }).waitFor()
  isolation.releaseOldGlobal()
  assert.equal(await isolation.getByRole('button', { name: '短剧作品/环境', exact: true }).getAttribute('aria-current'), 'page')
  isolation.failCharacters(true)
  await isolation.getByRole('button', { name: '短剧作品/角色', exact: true }).click()
  await isolation.getByText(/部分资产未加载/).waitFor()
  await isolation.getByRole('button', { name: '短剧作品/环境', exact: true }).click()
  await isolation.getByText('当前账号暂无环境资产', { exact: true }).waitFor()
  assert.equal(await isolation.getByText(/部分资产未加载/).count(), 0)
  await isolation.close()
  const partial = await open('')
  await partial.getByRole('button', { name: '打开 短剧作品 菜单', exact: true }).click()
  await partial.getByRole('menuitem', { name: '编辑作品', exact: true }).click()
  const edit = partial.getByRole('dialog', { name: '编辑作品', exact: true })
  await edit.getByLabel('作品名称', { exact: true }).fill('部分保存测试')
  partial.failDetails(true)
  await edit.getByRole('button', { name: '保存作品', exact: true }).click()
  await edit.getByText(/生成配置已保存，作品信息尚未保存/).waitFor()
  assert.equal(await edit.isVisible(), true)
  partial.failDetails(false)
  await edit.getByRole('button', { name: '保存作品', exact: true }).click()
  await partial.getByRole('button', { name: '打开 部分保存测试 菜单', exact: true }).waitFor()
  await partial.close()
  assert.deepEqual(errors, [], 'No uncaught browser errors')
  console.log(JSON.stringify({ ok: true, results, adminOnly: true, participantSettings: true, uploadedAssetDelete: true, referenceDeleteProtection: true, headerRefresh: true, longHeaderBounded: true, toolboxUploadOpaque: true, hundredFilesBounded: true, insecureUploadId: true, staleDirectoryRead: true, failedCharacterIsolation: true, partialSaveRetry: true, artifacts }, null, 2))
} catch (error) {
  await latest?.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
  console.error(JSON.stringify({ errors, text: (await latest?.locator('body').innerText().catch(() => '') || '').slice(0, 900) }))
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
