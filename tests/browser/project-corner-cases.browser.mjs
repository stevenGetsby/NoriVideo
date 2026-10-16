// Regression for four previously reproduced UI bugs. All APIs below are local
// mocks; this never writes production data or calls paid generation/storage.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/project-corner-cases')
await mkdir(artifacts, { recursive: true })
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || '/tmp/nori-browser-tools-local', 'package.json'))
const { chromium } = tools('playwright-core')
const bundleDirectory = process.env.NORI_BROWSER_PREBUILT_DIR || path.join(root, 'test-results/project-hierarchy/bundles')
const files = {}
for (const kind of ['project-hierarchy', 'project-assets-management']) {
  for (const extension of ['js', 'css']) {
    files[`/${kind}.${extension}`] = await readFile(path.join(bundleDirectory, `${kind}.${extension}`))
  }
}
files['/global.css'] = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH || '.next/static/css/app/[locale]/layout.css')
const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')
  if (files[url.pathname]) {
    response.setHeader('Content-Type', url.pathname.endsWith('.js') ? 'text/javascript' : 'text/css')
    response.end(files[url.pathname])
    return
  }
  const kind = url.searchParams.get('view') === 'toolbox' ? 'project-assets-management' : 'project-hierarchy'
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/${kind}.css"><div id="root"></div><script src="/${kind}.js"></script></html>`)
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const errors = []
const cases = []
const dates = { createdAt: '2026-10-13T00:00:00Z', updatedAt: '2026-10-13T00:00:00Z' }
function parent(id, name, works = []) {
  return {
    id, name, ...dates, kind: 'project', canManage: true, canCreateWorks: true,
    canDelete: works.length === 0, workCount: works.length,
    works: works.map((work) => ({ ...dates, ...work, kind: 'work', projectId: id, canManage: true, canMove: true })),
  }
}
function initialParents() {
  return [
    parent('parent-a', '项目甲', [{ id: 'leaf-a', name: '作品 A' }]),
    parent('parent-b', '项目乙', [{ id: 'leaf-b', name: '作品 B' }]),
  ]
}
async function open({
  query = '', rows = initialParents(), viewport = { width: 1024, height: 600 },
  failSecondPage = false, denyCreation = false,
} = {}) {
  const context = await browser.newContext({ viewport })
  const page = await context.newPage()
  page.setDefaultTimeout(15000)
  page.on('pageerror', (error) => errors.push(error.message))
  let parents = structuredClone(rows)
  let failure = failSecondPage
  let heldResolve
  let pageTwoRequested
  const secondPageSeen = new Promise((resolve) => { pageTwoRequested = resolve })
  const requests = []
  const writes = []
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    requests.push({ path: url.pathname, query: url.searchParams.toString(), method: request.method() })
    let payload = {}
    let status = 200
    if (url.pathname === '/api/works/projects/move') {
      const body = request.postDataJSON()
      writes.push(body)
      assert.deepEqual(body.workIds, body.projectIds)
      assert.equal(body.targetProjectId, body.targetWorkId)
      const moved = parents.flatMap((item) => item.works.filter((work) => body.workIds.includes(work.id)))
      parents = parents.map((item) => {
        const works = item.works.filter((work) => !body.workIds.includes(work.id))
        if (item.id === body.targetProjectId) works.push(...moved)
        return parent(item.id, item.name, works)
      })
      payload = { moved: moved.length, targetProjectId: body.targetProjectId }
    } else if (url.pathname === '/api/works') {
      const search = url.searchParams.get('search')?.toLowerCase() || ''
      const matched = parents.filter((item) => !search || item.name.toLowerCase().includes(search)
        || item.works.some((work) => work.name.toLowerCase().includes(search)))
      payload = {
        projectHierarchy: {
          version: 2,
          projects: matched.map((item) => ({ ...item, canCreateWorks: !denyCreation })),
        },
        pagination: { total: parents.length, totalPages: 1 },
      }
    } else if (url.pathname === '/api/projects') {
      const pageNumber = Number(url.searchParams.get('page'))
      const first = Array.from({ length: 100 }, (_, i) => ({ id: `work-${i + 1}`, name: `作品 ${i + 1}` }))
      if (pageNumber === 2) {
        pageTwoRequested()
        if (query.includes('holdPage=1')) await new Promise((resolve) => { heldResolve = resolve })
        if (failure) {
          status = 503
          payload = { error: { message: '第二页暂不可用' } }
        } else payload = { works: [{ id: 'work-101', name: '作品 101' }], pagination: { totalPages: 2, total: 101 } }
      } else payload = { projects: first, pagination: { totalPages: 2, total: 101 } }
    } else if (url.pathname === '/api/user/balance') {
      payload = { balancePoints: 1000, generationAllowed: true, pointsPerCny: 100, dailyLimitPoints: null }
    } else if (url.pathname.endsWith('/generation-config')) {
      payload = { imageModels: [], videoModels: [],
        defaults: { imageModel: '', videoModel: '', aspectRatio: '16:9', resolution: '2K' } }
    } else if (url.pathname.endsWith('/scripts')) payload = { scripts: [] }
    else if (url.pathname.endsWith('/toolbox/assets')) payload = { assets: [] }
    else if (url.pathname.endsWith('/member-candidates')) payload = { candidates: [], pagination: { totalPages: 1 } }
    else if (request.method() !== 'GET') throw new Error(`Unexpected test write: ${url.pathname}`)
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })
  })
  await page.goto(base + query)
  return {
    page, context, requests, writes, parents: () => parents,
    recoverSecondPage: () => { failure = false },
    secondPageSeen,
    releaseSecondPage: () => { heldResolve?.() },
  }
}
async function bounded(locator) {
  const box = await locator.boundingBox()
  const size = locator.page().viewportSize()
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= size.width + 1
    && box.y + box.height <= size.height + 1, `Outside viewport: ${JSON.stringify(box)}`)
}
try {
  const filtered = await open({ query: '?search=' + encodeURIComponent('作品 A') })
  await filtered.page.getByRole('heading', { name: '作品 A', exact: true }).waitFor()
  assert.equal(await filtered.page.getByRole('heading', { name: '项目乙', exact: true }).count(), 0)
  await filtered.page.getByRole('button', { name: '打开 作品 A 菜单', exact: true }).click()
  await filtered.page.getByRole('menuitem', { name: '移动到项目', exact: true }).click()
  const move = filtered.page.getByRole('dialog', { name: '移动作品', exact: true })
  await move.getByLabel('搜索并选择目标项目').selectOption('parent-b')
  await move.getByRole('button', { name: '确定', exact: true }).click()
  await move.waitFor({ state: 'hidden' })
  await filtered.page.locator('[data-project-id="parent-b"]').getByRole('heading', { name: '作品 A', exact: true }).waitFor()
  assert.deepEqual(filtered.parents()[1].works.map((work) => work.id).sort(), ['leaf-a', 'leaf-b'])
  cases.push('filtered-single-work-move-retains-all-targets-and-work-id')
  await filtered.context.close()

  const batch = await open({ query: '?search=' + encodeURIComponent('作品 A') })
  await batch.page.getByRole('button', { name: '打开 项目甲 菜单', exact: true }).click()
  await batch.page.getByRole('menuitem', { name: '批量移动作品', exact: true }).click()
  await batch.page.getByRole('button', { name: '全选', exact: true }).click()
  await batch.page.getByRole('button', { name: '移动到项目', exact: true }).click()
  const batchMove = batch.page.getByRole('dialog', { name: '移动作品', exact: true })
  await batchMove.getByLabel('搜索并选择目标项目').selectOption('parent-b')
  await batchMove.getByRole('button', { name: '取消', exact: true }).click()
  assert.equal(batch.writes.length, 0, 'Cancel must not move a work')
  cases.push('filtered-batch-move-keeps-targets-cancel-has-no-write')
  await batch.context.close()

  for (const protocol of [
    'create_work=1&parent_project_id=parent-a',
    'create_project=1&work_id=parent-a',
  ]) {
    const deep = await open({ query: `?${protocol}&search=${encodeURIComponent('项目乙')}` })
    const dialog = deep.page.getByRole('dialog', { name: '创建作品', exact: true })
    await dialog.getByText('所属项目 · 项目甲', { exact: true }).waitFor()
    await bounded(dialog)
    assert.equal(await deep.page.getByText('目标项目不存在，或当前账号没有访问权限。', { exact: true }).count(), 0)
    assert.equal(deep.writes.length, 0)
    cases.push(`filtered-valid-deep-link:${protocol.split('=')[0]}`)
    await deep.context.close()
  }
  const missing = await open({ query: '?create_work=1&parent_project_id=missing' })
  await missing.page.getByRole('alert').getByText('目标项目不存在，或当前账号没有访问权限。', { exact: true }).waitFor()
  assert.equal(await missing.page.getByRole('dialog', { name: '创建作品', exact: true }).count(), 0)
  await missing.context.close()
  const denied = await open({ query: '?create_work=1&parent_project_id=parent-a', denyCreation: true })
  await denied.page.getByRole('alert').getByText('当前账号没有在该项目中新建作品的权限。', { exact: true }).waitFor()
  assert.equal(await denied.page.getByRole('dialog', { name: '创建作品', exact: true }).count(), 0)
  cases.push('invalid-or-forbidden-deep-links-remain-blocked')
  await denied.context.close()

  for (const viewport of [
    { width: 1024, height: 600 }, { width: 768, height: 480 }, { width: 390, height: 700 },
  ]) {
    const menu = await open({ viewport, rows: Array.from({ length: 10 }, (_, i) => parent(`parent-${i}`, `项目 ${i}`)) })
    const trigger = menu.page.getByRole('button', { name: '打开 项目 6 菜单', exact: true })
    await trigger.waitFor()
    await trigger.evaluate((element) => {
      const scroll = document.querySelector('.works-scroll')
      const scale = parseFloat(getComputedStyle(document.querySelector('.fos-app')).zoom) || 1
      scroll.scrollTop += (element.getBoundingClientRect().top - (window.innerHeight - 65)) / scale
    })
    await trigger.click()
    const popup = menu.page.getByRole('menu', { name: '项目 6 项目操作', exact: true })
    await popup.waitFor()
    await bounded(popup)
    await bounded(popup.getByRole('menuitem', { name: '删除项目', exact: true }))
    await popup.getByRole('menuitem', { name: '重命名', exact: true }).click()
    const rename = menu.page.getByRole('dialog', { name: '重命名项目', exact: true })
    await rename.waitFor()
    await bounded(rename)
    await rename.getByRole('button', { name: '取消', exact: true }).click()
    await trigger.focus()
    await menu.page.keyboard.press('ArrowDown')
    await popup.getByRole('menuitem', { name: '设置成员', exact: true }).waitFor()
    assert.equal(await popup.getByRole('menuitem', { name: '设置成员', exact: true }).evaluate((element) => element === document.activeElement), true)
    await menu.page.keyboard.press('Escape')
    await popup.waitFor({ state: 'hidden' })
    assert.equal(await trigger.evaluate((element) => element === document.activeElement), true)
    await trigger.click()
    await popup.waitFor()
    await menu.page.screenshot({ path: path.join(artifacts, `${viewport.width}-bottom-menu.png`) })
    assert.equal(menu.writes.length, 0)
    cases.push(`${viewport.width}x${viewport.height}:bottom-menu-bounded-clickable-keyboard-focus`)
    await menu.context.close()
  }

  const toolbox = await open({ query: '?view=toolbox&holdPage=1' })
  await toolbox.secondPageSeen
  const owner = toolbox.page.getByRole('combobox', { name: '归属作品', exact: true })
  assert.equal(await owner.isDisabled(), true)
  assert.equal(await owner.locator('option[value="work-1"]').count(), 0, 'Do not expose an incomplete first page')
  toolbox.releaseSecondPage()
  await owner.locator('option[value="work-101"]').waitFor({ state: 'attached' })
  await owner.selectOption('work-101')
  assert.equal(await owner.inputValue(), 'work-101')
  assert.equal(await owner.locator('option').count(), 101)
  cases.push('toolbox-all-101-works-late-page-loading-and-selection')
  await toolbox.context.close()

  const failed = await open({ query: '?view=toolbox', failSecondPage: true })
  await failed.page.getByRole('alert').getByText('第二页暂不可用', { exact: true }).waitFor()
  const failedOwner = failed.page.getByRole('combobox', { name: '归属作品', exact: true })
  assert.equal(await failedOwner.locator('option[value="work-1"]').count(), 0)
  assert.equal(await failed.page.getByRole('button', { name: '生成图片', exact: true }).isDisabled(), true)
  failed.recoverSecondPage()
  await failed.page.getByRole('button', { name: '重新加载作品', exact: true }).click()
  await failedOwner.locator('option[value="work-101"]').waitFor({ state: 'attached' })
  assert.equal(await failed.page.getByRole('button', { name: '重新加载作品', exact: true }).count(), 0)
  assert.equal(failed.writes.length, 0)
  cases.push('toolbox-later-page-failure-no-partial-list-and-successful-retry')
  await failed.context.close()
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, cases, artifacts, productionWrites: false, generationSubmitted: false }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
