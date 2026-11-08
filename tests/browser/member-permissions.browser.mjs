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
const pageErrors = []
page.on('pageerror', (error) => pageErrors.push(error.message))
const writes = []
let members = [
  { userId: 'creator-1', name: '项目创建者', role: 'leader', accountRole: 'writer', isCreator: true, canRemove: false, permissions: ['workDelete', 'admin'] },
]
const candidate = { id: 'member-1', name: '创作成员', role: 'writer', roleLabel: null, status: 'active', permissions: ['admin'] }
await page.route('**/api/**', async (route) => {
  const request = route.request()
  const url = new URL(request.url())
  if (url.pathname.endsWith('/member-candidates')) {
    await route.fulfill({ json: { candidates: [candidate], pagination: { totalPages: 1 } } })
    return
  }
  if (request.method() === 'GET') {
    await route.fulfill({ json: { members, candidates: [] } })
    return
  }
  const body = request.postDataJSON()
  writes.push(body)
  assert.deepEqual(body, { userId: 'member-1' })
  if (request.method() === 'POST') {
    members = [...members, { userId: candidate.id, name: candidate.name, role: 'member', accountRole: candidate.role, isCreator: false, canRemove: true, permissions: ['admin'] }]
  }
  if (request.method() === 'DELETE') members = members.filter((member) => member.userId !== body.userId)
  await route.fulfill({ json: { success: true } })
})
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'domcontentloaded' })
  const dialog = page.getByRole('dialog', { name: '项目成员与权限' })
  await dialog.waitFor({ state: 'visible' })
  assert.equal(await dialog.locator('.works-member-permission-editor').count(), 0)
  assert.equal(await dialog.getByLabel('项目创建者 的成员角色').count(), 0)
  assert.equal(await dialog.getByRole('button', { name: '移除 项目创建者', exact: true }).count(), 0)
  assert.equal(await dialog.getByRole('button', { name: '保存', exact: true }).isDisabled(), true)
  await dialog.getByLabel('搜索成员', { exact: true }).fill('创作')
  const option = dialog.getByRole('option', { name: /创作成员/ })
  await option.waitFor()
  await option.click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.getByText('创作成员', { exact: true }).waitFor()
  await dialog.getByRole('button', { name: '保存', exact: true, disabled: true }).waitFor({ state: 'visible' })
  await dialog.getByRole('button', { name: '移除 创作成员', exact: true }).click()
  await dialog.getByRole('button', { name: '撤销移除 创作成员', exact: true }).click()
  assert.equal(writes.length, 1, 'Undoing a staged removal must not send an API request')
  await dialog.getByRole('button', { name: '移除 创作成员', exact: true }).click()
  await dialog.getByRole('button', { name: '保存', exact: true }).click()
  await dialog.getByText('创作成员', { exact: true }).waitFor({ state: 'hidden' })
  assert.deepEqual(writes, [{ userId: 'member-1' }, { userId: 'member-1' }])
  assert.deepEqual(pageErrors, [])
  await page.screenshot({ path: path.join(artifacts, '01-members-only.png'), fullPage: true })
  console.log(JSON.stringify({ ok: true, writes, pageErrors, artifacts }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
