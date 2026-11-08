// Real account/project components with isolated local API responses. No
// database, production or paid-generation calls.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || '/tmp/nori-browser-tools-local', 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/account-project-access')
await mkdir(artifacts, { recursive: true })
const [bundle, appCss] = await Promise.all([
  build({
    entryPoints: ['tests/browser/account-project-access.fixture.tsx'], bundle: true, write: false,
    outdir: '/fixture', jsx: 'automatic', platform: 'browser',
    alias: {
      '@': path.join(root, 'src'),
      '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
      'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
      'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    },
    define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  }),
  readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH || '.next/static/css/app/[locale]/layout.css'),
])
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.contents
assert.ok(script && css)
const server = createServer((request, response) => {
  const file = { '/fixture.js': script, '/fixture.css': css, '/global.css': appCss }[request.url]
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
const browser = await chromium.launch({ headless: true, executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const errors = []
const writes = []
let projectMembers = [
  { userId: 'leader-b', name: '项目组长', role: 'member', accountRole: 'writer', isCreator: true, canRemove: false, permissions: null },
]
const emptyUsage = { calls: 0, cost: 0, byType: [] }
const account = (id, username, projectLeader = false) => ({
  id, username, role: 'writer', status: 'active', projectLeader,
  isPlatformAdmin: false, isManager: false, parentAccountId: 'manager-1', workspaceOwnerId: 'manager-1',
  credits: { coins: 0, points: 0 }, dailyLimitPoints: null, usageToday: null,
  createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z', lastLoginAt: null,
  usage: emptyUsage,
})
const workspace = {
  manager: { ...account('manager-1', '管理账号'), role: 'admin', isManager: true, credits: { coins: 0, points: 10000 } },
  subaccounts: [], usage: { ...emptyUsage, projects: 1, assets: 0 },
}
const work = (id, name) => ({ id, name, createdAt: '2026-11-07T00:00:00.000Z', updatedAt: '2026-11-07T00:00:00.000Z' })
const hierarchy = [
  { ...work('work-owned', '我创建的项目'), kind: 'project', canManage: true, canCreateWorks: true, canDelete: true, canManageMembers: true, workCount: 2,
    works: [
      { ...work('work-own-leaf', '自己创建的作品'), kind: 'work', projectId: 'work-owned', canManage: true, canMove: true, canManageMembers: true, canDelete: true },
      { ...work('work-other-leaf', '他人创建的作品'), kind: 'work', projectId: 'work-owned', canManage: true, canMove: false, canManageMembers: false, canDelete: false },
    ] },
  { ...work('work-member', '参与的项目'), kind: 'project', canManage: false, canCreateWorks: true, canDelete: false, canManageMembers: false, workCount: 1,
    works: [{ ...work('work-member-leaf', '参与的作品'), kind: 'work', projectId: 'work-member', canManage: true, canMove: false, canManageMembers: false, canDelete: false }] },
]
let page
try {
  page = await browser.newPage({ viewport: { width: 1440, height: 1000 } })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/**', async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    const method = request.method()
    let payload = {}
    if (url.pathname === '/api/admin/accounts') {
      if (method === 'POST') {
        const body = request.postDataJSON()
        writes.push({ method, body })
        assert.equal(body.accountType, 'subaccount')
        assert.equal(Object.hasOwn(body, 'permissions'), false)
        assert.equal(Object.hasOwn(body, 'role'), false)
        const created = account(`account-${workspace.subaccounts.length + 1}`, body.username, body.projectLeader)
        workspace.subaccounts.push(created)
        payload = { success: true, account: created }
        return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(payload) })
      }
      if (method === 'GET') return route.fulfill({ json: { workspaces: [workspace] } })
    }
    const edit = url.pathname.match(/^\/api\/admin\/accounts\/([^/]+)$/)
    if (edit && method === 'PATCH') {
      const body = request.postDataJSON()
      writes.push({ method, body })
      assert.equal(Object.hasOwn(body, 'permissions'), false)
      assert.equal(Object.hasOwn(body, 'role'), false)
      const updated = { ...workspace.subaccounts.find((item) => item.id === edit[1]), ...body }
      workspace.subaccounts = workspace.subaccounts.map((item) => item.id === edit[1] ? updated : item)
      return route.fulfill({ json: { success: true, account: updated } })
    }
    if (url.pathname === '/api/works') {
      return route.fulfill({ json: { projectHierarchy: { version: 2, projects: hierarchy }, pagination: { total: hierarchy.length, totalPages: 1 } } })
    }
    if (url.pathname === '/api/user/balance') return route.fulfill({ json: { balancePoints: 1000, generationAllowed: true } })
    if (url.pathname === '/api/works/work-owned/member-candidates') {
      return route.fulfill({ json: { candidates: [{ id: 'account-1', name: 'member-a', role: 'writer', roleLabel: null, status: 'active', permissions: ['read'] }], pagination: { totalPages: 1 } } })
    }
    if (url.pathname === '/api/works/work-owned/members') {
      const body = method === 'GET' ? null : request.postDataJSON()
      if (body) {
        writes.push({ method, body })
        assert.deepEqual(body, { userId: 'account-1' })
        if (method === 'DELETE') projectMembers = projectMembers.filter((member) => member.userId !== body.userId)
        if (method === 'POST' && !projectMembers.some((member) => member.userId === body.userId)) {
          projectMembers.push({ userId: body.userId, name: 'member-a', role: 'member', accountRole: 'writer', isCreator: false, canRemove: true, permissions: null })
        }
      }
      return route.fulfill({ json: { members: projectMembers } })
    }
    return route.fulfill({ json: {} })
  })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '子账号管理', exact: true }).waitFor()
  await page.getByText('统一创作能力', { exact: true }).first().waitFor()
  assert.equal(await page.getByText('快捷权限模板（可选）', { exact: true }).count(), 0)
  assert.equal(await page.getByText('功能权限', { exact: true }).count(), 0)

  for (const [username, projectLeader] of [['member-a', false], ['leader-b', true]]) {
    await page.getByRole('button', { name: '添加子账号', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '添加子账号', exact: true })
    await dialog.getByPlaceholder('例如 writer-01', { exact: true }).fill(username)
    await dialog.getByPlaceholder('至少 8 位；首次登录或重置后需修改', { exact: true }).fill('fixture-not-a-real-password')
    const leader = dialog.getByRole('checkbox', { name: /设为项目组长/ })
    assert.equal(await leader.isChecked(), false)
    if (projectLeader) await leader.check()
    await dialog.getByRole('button', { name: '创建账号', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
  }
  assert.equal(await page.getByText('项目组长', { exact: true }).count(), 1)
  assert.equal(await page.getByText('创作成员', { exact: true }).count(), 1)
  assert.deepEqual(writes.filter((entry) => entry.method === 'POST').map((entry) => entry.body.projectLeader), [false, true])

  const leaderRow = page.locator('.grid').filter({ has: page.getByText('leader-b', { exact: true }) }).filter({ has: page.getByRole('button', { name: '编辑', exact: true }) }).last()
  await leaderRow.getByRole('button', { name: '编辑', exact: true }).click()
  let edit = page.getByRole('dialog', { name: '编辑 leader-b', exact: true })
  await edit.getByRole('checkbox', { name: /设为项目组长/ }).uncheck()
  await edit.getByRole('button', { name: '保存修改', exact: true }).click()
  await edit.waitFor({ state: 'hidden' })
  assert.equal(await page.getByText('项目组长', { exact: true }).count(), 0)
  assert.equal(writes.at(-1).body.projectLeader, false)
  await leaderRow.getByRole('button', { name: '编辑', exact: true }).click()
  edit = page.getByRole('dialog', { name: '编辑 leader-b', exact: true })
  await edit.getByRole('checkbox', { name: /设为项目组长/ }).check()
  await edit.getByRole('button', { name: '保存修改', exact: true }).click()
  await edit.waitFor({ state: 'hidden' })
  await page.getByText('项目组长', { exact: true }).waitFor()
  await page.screenshot({ path: path.join(artifacts, '01-account-management.png'), fullPage: true })

  await page.goto(`${base}/?view=projects&session=child`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('heading', { name: '我的项目', exact: true }).waitFor()
  await page.locator('[data-work-id="work-owned"]').waitFor()
  assert.equal(await page.getByRole('button', { name: '新建项目', exact: true }).count(), 0)
  await page.getByRole('button', { name: '打开 他人创建的作品 菜单', exact: true }).click()
  assert.equal(await page.getByRole('menuitem', { name: '删除作品', exact: true }).count(), 0)
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '打开 自己创建的作品 菜单', exact: true }).click()
  assert.equal(await page.getByRole('menuitem', { name: '删除作品', exact: true }).count(), 1)

  await page.evaluate(() => window.setFixtureSession({ id: 'manager-1', actorId: 'leader-b', workspaceOwnerId: 'manager-1', name: '组长', role: 'writer', permissions: ['read'], projectLeader: true }))
  await page.getByRole('button', { name: '新建项目', exact: true }).waitFor()
  await page.getByRole('button', { name: '打开 我创建的项目 菜单', exact: true }).click()
  await page.getByRole('menuitem', { name: '设置成员', exact: true }).click()
  const members = page.getByRole('dialog', { name: '设置项目成员 · 我创建的项目', exact: true })
  await members.waitFor()
  assert.equal(await members.getByLabel('搜索成员', { exact: true }).count(), 1)
  assert.equal(await members.locator('.works-member-permission-editor').count(), 0)
  await members.getByLabel('搜索成员', { exact: true }).fill('member')
  const option = members.getByRole('option', { name: /member-a/ })
  await option.waitFor()
  await option.click()
  await members.getByRole('button', { name: '保存', exact: true }).click()
  await members.getByText('member-a', { exact: true }).waitFor()
  await members.getByRole('button', { name: '移除 member-a', exact: true }).click()
  await members.getByRole('button', { name: '保存', exact: true }).click()
  await members.getByText('member-a', { exact: true }).waitFor({ state: 'hidden' })
  assert.deepEqual(writes.slice(-2), [
    { method: 'POST', body: { userId: 'account-1' } },
    { method: 'DELETE', body: { userId: 'account-1' } },
  ])
  await members.getByRole('button', { name: '关闭', exact: true }).first().click()
  await page.evaluate(() => window.setFixtureSession({ id: 'manager-1', actorId: 'leader-b', workspaceOwnerId: 'manager-1', name: '成员', role: 'writer', permissions: ['read'], projectLeader: false }))
  assert.equal(await page.getByRole('button', { name: '新建项目', exact: true }).count(), 0)
  await page.screenshot({ path: path.join(artifacts, '02-member-after-revoke.png'), fullPage: true })
  assert.deepEqual(errors, [])
  console.log(JSON.stringify({ ok: true, artifacts, cases: ['multiple-subaccounts', 'grant-and-revoke-project-leader', 'no-functional-permission-matrix', 'member-and-leader-project-entry', 'creator-only-delete', 'leader-member-management'], productionWrites: false }, null, 2))
} catch (error) {
  if (page) await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
