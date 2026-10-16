// Real UI components; all application APIs are mocked locally. No production
// database writes, storage writes, deployments or paid generations.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || '/tmp/nori-browser-tools-local', 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/project-hierarchy')
await mkdir(artifacts, { recursive: true })
const bundles = process.env.NORI_BROWSER_PREBUILT_DIR || path.join(artifacts, 'bundles')
const [script, css, globalCss] = await Promise.all([
  readFile(path.join(bundles, 'project-hierarchy.js')),
  readFile(path.join(bundles, 'project-hierarchy.css')),
  readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH || '.next/static/css/app/[locale]/layout.css'),
])
assert.ok(globalCss.includes('--nori-interface-scale'), 'Actual application styling required')
const server = createServer((request, response) => {
  const file = { '/fixture.js': script, '/fixture.css': css, '/global.css': globalCss }[request.url]
  if (file) {
    response.setHeader('Content-Type', request.url.endsWith('.js') ? 'text/javascript' : 'text/css')
    response.end(file)
    return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const errors = []
const results = []
let latest

async function open(viewport, query = '') {
  const page = await browser.newPage({ viewport })
  latest = page
  page.on('pageerror', (error) => errors.push(error.message))
  const child = query.includes('session=child')
  const dates = { createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' }
  let parents = [
    { id: 'parent-a', name: '项目甲', ...dates },
    { id: 'parent-b', name: '项目乙', ...dates },
  ]
  let works = [
    { id: 'leaf-a', name: '作品 A', workId: 'parent-a', ...dates },
    { id: 'leaf-b', name: '作品 B', workId: 'parent-a', ...dates },
  ]
  const recycled = []
  const writes = []
  function hierarchy() {
    return parents.map((project) => ({
      ...project, kind: 'project', canManage: !child, canCreateWorks: !child,
      canDelete: !works.some((work) => work.workId === project.id) && !recycled.some((work) => work.workId === project.id),
      workCount: works.filter((work) => work.workId === project.id).length,
      works: works.filter((work) => work.workId === project.id).map(({ workId, ...work }) => ({
        ...work, kind: 'work', projectId: workId, canManage: !child, canMove: !child, canManageMembers: !child,
      })),
    }))
  }
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    let payload = {}
    let status = 200
    const json = method === 'GET' || !request.headers()['content-type']?.includes('json') ? null : request.postDataJSON()
    if (method !== 'GET') writes.push({ path: url.pathname, method, body: json })
    if (url.pathname === '/api/works') {
      if (method === 'POST') {
        const parent = { id: 'new-parent', name: json.name, ...dates }
        parents.push(parent)
        payload = { project: { ...parent, kind: 'project' } }
        status = 201
      } else payload = {
        projectHierarchy: { version: 2, projects: hierarchy() },
        pagination: { total: parents.length, totalPages: 1 },
      }
    } else if (url.pathname === '/api/works/projects/move') {
      assert.deepEqual(json.workIds, json.projectIds)
      assert.equal(json.targetProjectId, json.targetWorkId)
      works = works.map((work) => json.workIds.includes(work.id) ? { ...work, workId: json.targetProjectId } : work)
      payload = { moved: json.workIds.length, targetProjectId: json.targetProjectId }
    } else if (url.pathname === '/api/works/parent-a' && method === 'PATCH') {
      parents = parents.map((parent) => parent.id === 'parent-a' ? { ...parent, ...json } : parent)
      payload = { project: parents.find((parent) => parent.id === 'parent-a') }
    } else if (url.pathname === '/api/projects' && method === 'POST') {
      const form = await new Response(request.postDataBuffer(), {
        headers: { 'Content-Type': request.headers()['content-type'] },
      }).formData()
      const parentId = form.get('parentProjectId')
      assert.equal(parentId, form.get('workId'))
      assert.ok(parents.some((parent) => parent.id === parentId))
      const work = { id: 'new-work', name: form.get('name'), workId: parentId, ...dates }
      works.push(work)
      writes.at(-1).body = { parentProjectId: parentId, name: work.name, leafId: work.id }
      payload = { work: { ...work, kind: 'work', projectId: parentId } }
      status = 201
    } else if (url.pathname === '/api/projects/recycle-bin') {
      payload = { projects: recycled.map((work) => ({
        ...work, workName: parents.find((parent) => parent.id === work.workId)?.name,
        deletedAt: dates.createdAt, remainingDays: 15, expired: false,
      })) }
    } else if (url.pathname === '/api/projects/leaf-b' && method === 'DELETE') {
      recycled.push(works.find((work) => work.id === 'leaf-b'))
      works = works.filter((work) => work.id !== 'leaf-b')
      payload = { success: true }
    } else if (url.pathname === '/api/projects/leaf-a' && method === 'PATCH') {
      works = works.map((work) => work.id === 'leaf-a' ? { ...work, ...json } : work)
      payload = { project: works.find((work) => work.id === 'leaf-a') }
    } else if (url.pathname === '/api/projects/leaf-a' || url.pathname === '/api/projects/leaf-a/data') {
      payload = { project: {
        ...works.find((work) => work.id === 'leaf-a'),
        parentProject: { id: 'parent-a', name: '项目甲' },
      } }
    } else if (url.pathname === '/api/novel-promotion/leaf-a') {
      payload = {
        projectStyle: 'live-action', targetAudience: 'global-platform',
        videoRatio: '9:16', videoResolution: '720p', episodeDurationMode: 'per-episode',
        episodeDurationValue: 120, artStylePrompt: '', modelConfig: {},
      }
    } else if (url.pathname === '/api/user/models') payload = { text: [], image: [], video: [] }
    else if (url.pathname === '/api/user/balance') payload = { balancePoints: 1000, generationAllowed: true }
    else if (url.pathname.endsWith('/scripts')) payload = { scripts: [] }
    else if (url.pathname.endsWith('/member-candidates')) payload = { candidates: [], pagination: { totalPages: 1 } }
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
  })
  await page.goto(base + query)
  return { page, writes, parents: () => parents, works: () => works }
}
async function bounded(locator) {
  const box = await locator.boundingBox()
  const viewport = locator.page().viewportSize()
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1
    && box.y + box.height <= viewport.height + 1, `Out of viewport: ${JSON.stringify(box)}`)
}
async function workMenu(page, workName) {
  await page.getByRole('button', { name: `打开 ${workName} 菜单`, exact: true }).click()
}

try {
  for (const viewport of [{ width: 1024, height: 600 }, { width: 390, height: 700 }]) {
    const state = await open(viewport)
    const { page } = state
    await page.getByRole('heading', { name: '我的项目', exact: true }).waitFor()
    await bounded(page.getByRole('heading', { name: '我的项目', exact: true }))
    await bounded(page.getByRole('button', { name: '新建项目', exact: true }))
    if (viewport.width === 390) assert.equal(await page.locator('.fos-sidebar').getAttribute('data-collapsed'), 'true')
    const parentA = page.locator('[data-work-id="parent-a"]')
    await parentA.getByRole('heading', { name: '项目甲', exact: true }).waitFor()
    assert.equal(await parentA.getByText('2 个作品', { exact: true }).count(), 1)
    assert.equal(await parentA.getByRole('heading', { name: '作品 A', exact: true }).count(), 1)
    assert.equal(await page.getByRole('heading', { name: '我的作品', exact: true }).count(), 0)

    await page.getByRole('button', { name: '新建项目', exact: true }).click()
    const createParent = page.getByRole('dialog', { name: '新建项目', exact: true })
    await bounded(createParent)
    await createParent.getByPlaceholder('请输入项目名称', { exact: true }).fill('新项目')
    await createParent.getByRole('button', { name: '创建', exact: true }).click()
    await page.locator('[data-work-id="new-parent"]').waitFor()
    assert.equal(state.parents().at(-1).name, '新项目')
    assert.equal(state.works().length, 2, 'Parent creation must not create a production work')

    await parentA.getByRole('button', { name: '新建作品', exact: true }).click()
    const createWork = page.getByRole('dialog', { name: '创建作品', exact: true })
    await createWork.getByText('所属项目 · 项目甲', { exact: true }).waitFor()
    await bounded(createWork)
    await bounded(createWork.getByRole('button', { name: '确认创建并进入工作台', exact: true }))
    await createWork.getByPlaceholder('请输入作品名称', { exact: true }).fill('新增作品')
    await createWork.getByRole('tab', { name: '空白作品', exact: true }).click()
    await createWork.getByRole('button', { name: '确认创建并进入工作台', exact: true }).click()
    await createWork.waitFor({ state: 'hidden' })
    assert.deepEqual(state.writes.find((write) => write.path === '/api/projects').body, {
      parentProjectId: 'parent-a', name: '新增作品', leafId: 'new-work',
    })
    await page.reload()
    await parentA.getByRole('heading', { name: '新增作品', exact: true }).waitFor()

    await workMenu(page, '作品 A')
    await page.getByRole('menuitem', { name: '移动到项目', exact: true }).click()
    const move = page.getByRole('dialog', { name: '移动作品', exact: true })
    await move.getByLabel('搜索并选择目标项目').selectOption('parent-b')
    await bounded(move)
    await move.getByRole('button', { name: '确定', exact: true }).click()
    await page.locator('[data-work-id="parent-b"]').getByRole('heading', { name: '作品 A', exact: true }).waitFor()
    assert.equal(state.works().find((work) => work.id === 'leaf-a').workId, 'parent-b')

    await workMenu(page, '作品 B')
    await page.getByRole('menuitem', { name: '删除作品', exact: true }).click()
    const deletion = page.getByRole('dialog', { name: '删除作品', exact: true })
    await deletion.getByRole('button', { name: '确认删除', exact: true }).click()
    await parentA.getByRole('heading', { name: '作品 B', exact: true }).waitFor({ state: 'hidden' })
    assert.ok(state.parents().some((parent) => parent.id === 'parent-a'), 'Deleting a work must retain the parent project')
    await page.getByRole('button', { name: '回收站', exact: true }).click()
    const recycle = page.getByRole('dialog', { name: '作品回收站', exact: true })
    await recycle.getByText('作品 B', { exact: true }).waitFor()
    assert.ok((await recycle.innerText()).includes('项目甲'), 'Recycle bin retains parent project')
    await bounded(recycle)
    await recycle.getByRole('button', { name: '关闭', exact: true }).click()
    await page.screenshot({ path: path.join(artifacts, `${viewport.width}-hierarchy.png`) })
    results.push(`${viewport.width}:project-create-work-create-parent-binding-move-recycle`)
    await page.close()
  }

  const child = await open({ width: 1024, height: 600 }, '?session=child')
  await child.page.locator('[data-work-id="parent-a"]').waitFor()
  assert.equal(await child.page.getByRole('button', { name: '新建项目', exact: true }).count(), 0)
  await workMenu(child.page, '作品 A')
  assert.equal(await child.page.getByRole('menuitem', { name: '删除作品', exact: true }).count(), 0)
  await child.page.getByRole('menuitem', { name: '编辑作品', exact: true }).click()
  const edit = child.page.getByRole('dialog', { name: '编辑作品', exact: true })
  await edit.getByLabel('作品名称', { exact: true }).fill('子账号编辑作品')
  const participantSave = child.page.waitForResponse((response) => (
    new URL(response.url()).pathname === '/api/projects/leaf-a'
    && response.request().method() === 'PATCH' && response.status() === 200
  ))
  await edit.getByRole('button', { name: '保存作品', exact: true }).click()
  await participantSave
  assert.ok(child.writes.some((write) => write.path === '/api/projects/leaf-a' && write.method === 'PATCH'))
  results.push('participant-work-edit-without-parent-admin-or-delete')
  await child.page.close()

  const header = await open({ width: 390, height: 700 }, '?view=header')
  await header.page.getByTestId('work-parent-project').waitFor()
  assert.ok((await header.page.getByTestId('work-parent-project').innerText()).includes('项目甲'))
  await header.page.getByRole('button', { name: '作品设置', exact: true }).click()
  await bounded(header.page.getByRole('dialog', { name: '编辑作品', exact: true }))
  results.push('work-header-parent-project-and-bounded-settings')
  await header.page.close()

  const canvas = await open({ width: 1024, height: 600 }, '?view=canvas')
  await canvas.page.getByTestId('global-canvas-active-work-picker').click()
  await canvas.page.getByText('选择项目', { exact: true }).waitFor()
  assert.equal(await canvas.page.getByPlaceholder('搜索项目', { exact: true }).count(), 1)
  await canvas.page.getByTestId('global-canvas-active-work-picker').click()
  await canvas.page.locator('.nori-canvas-project-picker').click()
  await canvas.page.getByText('项目甲 · 选择作品', { exact: true }).waitFor()
  assert.equal(await canvas.page.getByText('作品 B', { exact: true }).count(), 1)
  assert.equal(await canvas.page.getByText('作品 C', { exact: true }).count(), 0)
  assert.equal(await canvas.page.getByTestId('global-canvas-active-create-project').getAttribute('href'),
    '/projects?create_work=1&parent_project_id=parent-a')
  results.push('canvas-project-work-breadcrumb-and-sibling-filter')
  await canvas.page.close()
  assert.deepEqual(errors, [], 'No browser JavaScript errors')
  console.log(JSON.stringify({ ok: true, cases: results, artifacts, productionWrites: false }, null, 2))
} catch (error) {
  if (latest && !latest.isClosed()) await latest.screenshot({ path: path.join(artifacts, 'failure.png') }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
