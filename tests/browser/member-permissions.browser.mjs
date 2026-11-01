import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'

const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || process.cwd(), 'package.json'))
const { chromium } = tools('playwright-core')
const root = process.cwd()
const artifacts = path.join(root, 'test-results/member-permissions')
await mkdir(artifacts, { recursive: true })
const bundle = await build({
  entryPoints: ['tests/browser/member-permissions.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture.js', jsx: 'automatic', platform: 'browser',
  alias: { '@': path.join(root, 'src') }, define: { 'process.env.NODE_ENV': '"development"' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.contents
assert.ok(script && css)
const server = createServer((request, response) => {
  if (request.url === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(script)
    return
  }
  if (request.url === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css')
    response.end(css)
    return
  }
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const page = await browser.newPage({ viewport: { width: 1280, height: 960 } })
const savedGrants = []
let members = [
  { userId: 'creator-1', name: '项目创建者', role: 'leader', accountRole: 'writer', isCreator: true, canRemove: false, permissions: null },
  { userId: 'member-1', name: '普通生成师', role: 'member', accountRole: 'writer', isCreator: false, canRemove: true, permissions: null },
  { userId: 'custom-1', name: '自定义成员', role: 'member', accountRole: 'writer', isCreator: false, canRemove: true, permissions: ['projectCreate'] },
]
await page.route('**/api/**', async (route) => {
  const request = route.request()
  if (request.method() === 'GET') {
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ members, candidates: [] }) })
    return
  }
  if (request.method() === 'POST') {
    const grant = request.postDataJSON()
    savedGrants.push(grant)
    members = members.map((member) => member.userId === grant.userId ? { ...member, ...grant } : member)
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ success: true }) })
    return
  }
  await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' })
})
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' })
  const dialog = page.getByRole('dialog', { name: '项目成员与权限' })
  await dialog.waitFor({ state: 'visible' })
  await page.getByLabel('普通生成师 的成员角色').selectOption('leader')
  const summary = page.locator('.works-member-permission-editor summary').filter({ hasText: '普通生成师' })
  await summary.click()
  const checkboxes = page.locator('.works-member-permission-editor').filter({ hasText: '普通生成师' }).getByRole('checkbox')
  assert.equal(await checkboxes.count(), 9)
  for (let index = 0; index < await checkboxes.count(); index += 1) {
    assert.equal(await checkboxes.nth(index).isChecked(), true)
  }
  await page.screenshot({ path: path.join(artifacts, '01-leader-preset.png'), fullPage: true })
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByLabel('普通生成师 的成员角色').waitFor()
  assert.deepEqual(savedGrants[0], { userId: 'member-1', role: 'leader', permissions: null })

  await page.getByLabel('自定义成员 的成员角色').selectOption('leader')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByLabel('自定义成员 的成员角色').waitFor()
  assert.equal(savedGrants[1].role, 'leader')
  assert.equal(savedGrants[1].permissions.length, 10)
  assert.ok(savedGrants[1].permissions.includes('workDelete'))
  assert.ok(savedGrants[1].permissions.includes('projectManage'))

  await page.getByLabel('自定义成员 的成员角色').selectOption('member')
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await page.getByLabel('自定义成员 的成员角色').waitFor()
  assert.deepEqual(savedGrants[2], { userId: 'custom-1', role: 'member', permissions: ['projectCreate'] })
  console.log(JSON.stringify({ ok: true, savedGrants, artifacts }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
