// 独立浏览器验证：平台管理台的「每日用量上限」功能。
// 走真实登录、真实接口与真实数据库，创建一个临时管理账号，验证
// 创建时写入上限、列表展示今日用量、编辑时改上限、删除后不残留。
//
// 运行前确保目标实例已启动（默认 http://127.0.0.1:8088 管理台端口）：
//   NORI_BROWSER_TOOLS_DIR=/path/to/browser-tools \
//   NORI_CHECK_USER=xxx NORI_CHECK_PASSWORD=yyy \
//   node tests/browser/admin-daily-limit.browser.mjs
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'

const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || process.cwd(), 'package.json'))
const { chromium } = tools('playwright-core')

const adminUrl = (process.env.NORI_ADMIN_URL || 'http://127.0.0.1:8088').replace(/\/$/, '')
const username = process.env.NORI_CHECK_USER || ''
const password = process.env.NORI_CHECK_PASSWORD || ''
assert.ok(['127.0.0.1', 'localhost'].includes(new URL(adminUrl).hostname), '只允许对本地实例做界面实测')
assert.ok(username && password, '需要设置 NORI_CHECK_USER 与 NORI_CHECK_PASSWORD')

const artifacts = path.join(process.cwd(), 'test-results/admin-daily-limit')
await mkdir(artifacts, { recursive: true })

const browser = await chromium.launch({
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true,
})
const context = await browser.newContext({
  viewport: { width: 1600, height: 1100 },
  // The dedicated Admin image is normally reached through nginx. Local browser
  // checks use the backend port directly, so preserve the public-surface port.
  extraHTTPHeaders: { 'x-forwarded-port': '8080' },
})
const page = await context.newPage()

const accountWrites = []
page.on('request', (request) => {
  const url = new URL(request.url())
  if (url.pathname.startsWith('/api/admin/accounts') && ['POST', 'PATCH'].includes(request.method())) {
    accountWrites.push({ method: request.method(), body: request.postDataJSON?.() })
  }
})
page.on('dialog', (dialog) => void dialog.accept())

const managerName = `ui-check-manager-${Date.now().toString(36)}`
const steps = []

try {
  // 1. 真实登录平台管理台
  await page.goto(`${adminUrl}/zh/admin/signin`, { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => {
    const form = document.querySelector('.nori-admin-login-card form')
    const propsKey = form && Object.keys(form).find((key) => key.startsWith('__reactProps$'))
    return !!(propsKey && typeof form[propsKey]?.onSubmit === 'function')
  })
  await page.getByPlaceholder('请输入账号').fill(username)
  await page.getByPlaceholder('请输入密码').fill(password)
  // The grid form is sometimes reported as the hit-test target in headless
  // Chromium. requestSubmit still exercises the same browser submit path.
  await page.locator('.nori-admin-login-card form').evaluate((form) => form.requestSubmit())
  await page.waitForURL(/\/admin\/accounts/, { timeout: 30_000 })
  // 新装的实例可能还没有工作区，这一步只要求账号页完成渲染。
  await page.waitForSelector('.nori-admin-panel', { timeout: 30_000 })
  steps.push('登录平台管理台并进入账号与用量页')
  const previousTestName = process.env.NORI_CLEANUP_TEST_ACCOUNT || ''
  if (previousTestName) {
    assert.match(previousTestName, /^ui-check-manager-[a-z0-9]+$/)
    const cleaned = await page.evaluate(async (name) => {
      const response = await fetch('/api/admin/accounts', { credentials: 'same-origin', headers: { 'x-forwarded-port': '8080' } })
      const own = (await response.json()).workspaces?.find((item) => item.manager?.username === name)?.manager
      if (!own) return 200
      return (await fetch(`/api/admin/accounts/${encodeURIComponent(own.id)}`, {
        method: 'DELETE', credentials: 'same-origin', headers: { 'x-forwarded-port': '8080' },
      })).status
    }, previousTestName)
    assert.equal(cleaned, 200, '上次临时测试账号清理失败')
  }

  // 2. 创建管理账号时带上每日上限
  await page.getByRole('button', { name: '添加管理账号' }).dispatchEvent('click')
  const dialog = page.locator('.account-management-dialog')
  await dialog.waitFor({ state: 'visible' })
  assert.equal(await dialog.getByText('每日用量上限（积分）').count(), 1, '创建弹窗应包含每日用量上限字段')
  await dialog.locator('input').first().fill(managerName)
  await dialog.getByPlaceholder('至少 8 位').fill('UiCheckPassw0rd!')
  await dialog.getByLabel('每日用量模式').selectOption('limited')
  await dialog.getByLabel('每日用量上限（积分）').fill('1200')
  await page.screenshot({ path: path.join(artifacts, '01-create-dialog.png') })
  await dialog.getByRole('button', { name: '创建账号' }).dispatchEvent('click')
  await page.waitForFunction(
    (name) => Array.from(document.querySelectorAll('.nori-admin-workspace-card')).some((card) => card.textContent?.includes(name)),
    managerName,
    { timeout: 30_000 },
  )
  steps.push('创建管理账号并填写每日上限 1200')

  const createRequest = accountWrites.find((entry) => entry.method === 'POST')
  assert.ok(createRequest, '应发出创建账号请求')
  assert.equal(createRequest.body?.dailyPointLimit, 1200, '创建请求应带上 dailyPointLimit')

  const newCard = page.locator('.nori-admin-workspace-card').filter({ hasText: managerName })
  await newCard.waitFor({ state: 'visible' })
  const cardText = await newCard.innerText()
  assert.ok(cardText.includes('今日用量（积分）'), `工作区卡片应展示「今日用量（积分）」，实际：${cardText}`)
  assert.ok(/1,200/.test(cardText), `新账号卡片应显示上限 1,200，实际：${cardText}`)
  assert.ok(/剩余\s*1,200\s*积分/.test(cardText), `新账号今日剩余应为 1,200 积分，实际：${cardText}`)
  await page.screenshot({ path: path.join(artifacts, '02-created-card.png') })

  // 3. 编辑上限
  accountWrites.length = 0
  await newCard.getByRole('button', { name: '编辑账号' }).dispatchEvent('click')
  await dialog.waitFor({ state: 'visible' })
  const limitInput = dialog.getByLabel('每日用量上限（积分）')
  assert.equal(await limitInput.inputValue(), '1200', '编辑弹窗应回显已保存的上限')
  await limitInput.fill('3000')
  await dialog.getByRole('button', { name: '保存修改' }).dispatchEvent('click')
  await page.waitForFunction(
    (name) => Array.from(document.querySelectorAll('.nori-admin-workspace-card'))
      .some((card) => card.textContent?.includes(name) && /3,000/.test(card.textContent)),
    managerName,
    { timeout: 30_000 },
  )
  const patchRequest = accountWrites.find((entry) => entry.method === 'PATCH')
  assert.ok(patchRequest, '应发出更新账号请求')
  assert.equal(patchRequest.body?.dailyPointLimit, 3000, '更新请求应带上新的每日上限')
  steps.push('编辑账号把上限从 1200 改成 3000，列表实时刷新')

  // 4. 0 禁止生成，明确选择 unlimited 才是不限量。
  accountWrites.length = 0
  await newCard.getByRole('button', { name: '编辑账号' }).dispatchEvent('click')
  await dialog.waitFor({ state: 'visible' })
  await dialog.getByLabel('每日用量上限（积分）').fill('0')
  await dialog.getByRole('button', { name: '保存修改' }).dispatchEvent('click')
  await page.waitForFunction(
    (name) => Array.from(document.querySelectorAll('.nori-admin-workspace-card'))
      .some((card) => card.textContent?.includes(name) && card.textContent.includes('禁止生成 · 上限 0')),
    managerName,
    { timeout: 30_000 },
  )
  assert.equal(accountWrites.find((entry) => entry.method === 'PATCH')?.body?.dailyPointLimit, 0)
  const zeroState = await page.evaluate(async (name) => {
    const response = await fetch('/api/admin/accounts', { cache: 'no-store', headers: { 'x-forwarded-port': '8080' } })
    const data = await response.json()
    return data.workspaces.find((item) => item.manager.username === name)?.manager
  }, managerName)
  assert.equal(zeroState.dailyLimitPoints, 0)
  assert.equal(zeroState.usageToday.limitPoints, 0)
  assert.equal(zeroState.usageToday.exceeded, true)
  steps.push('上限设为 0，列表立即显示禁止生成')
  await newCard.getByRole('button', { name: '编辑账号' }).dispatchEvent('click')
  await dialog.waitFor({ state: 'visible' })
  assert.equal(await dialog.getByLabel('每日用量上限（积分）').inputValue(), '0')
  await dialog.getByLabel('每日用量模式').selectOption('unlimited')
  accountWrites.length = 0
  await dialog.getByRole('button', { name: '保存修改' }).dispatchEvent('click')
  await newCard.getByText('unlimited · 不限量', { exact: true }).waitFor()
  assert.equal(accountWrites.find((entry) => entry.method === 'PATCH')?.body?.dailyPointLimit, 'unlimited')
  steps.push('明确选择 unlimited，列表立即显示不限量')
  // Browser fetch preserves localhost's secure-cookie exception, while the
  // Node request context correctly refuses Secure cookies over the SSH HTTP
  // tunnel. Use the same authenticated path as the real interface.
  const persistedResponse = await page.evaluate(async () => {
    const response = await fetch('/api/admin/accounts', {
      cache: 'no-store', credentials: 'same-origin', headers: { 'x-forwarded-port': '8080' },
    })
    return { status: response.status, cacheControl: response.headers.get('cache-control'), payload: await response.json() }
  })
  assert.equal(persistedResponse.status, 200)
  assert.ok((persistedResponse.cacheControl || '').includes('no-store'))
  const persisted = persistedResponse.payload.workspaces.find((item) => item.manager.username === managerName)?.manager
  assert.ok(persisted, '测试账号应仍存在')
  assert.equal(persisted.dailyLimitPoints, null)
  assert.equal(persisted.usageToday.limitPoints, null)
  assert.equal(persisted.usageToday.exceeded, false)
  await page.reload({ waitUntil: 'domcontentloaded' })
  await newCard.getByText('unlimited · 不限量', { exact: true }).waitFor()
  steps.push('服务端确认上限为 null，刷新页面后仍显示不限量')

  // 5. 回收测试账号，避免污染本地数据
  await newCard.locator('button[title="删除管理账号"]').dispatchEvent('click')
  await page.waitForFunction(
    (name) => !Array.from(document.querySelectorAll('.nori-admin-workspace-card')).some((card) => card.textContent?.includes(name)),
    managerName,
    { timeout: 30_000 },
  )
  steps.push('删除临时管理账号')
  await page.screenshot({ path: path.join(artifacts, '03-after-cleanup.png'), fullPage: true })

  console.log(JSON.stringify({ ok: true, adminUrl, steps, artifacts }, null, 2))
} catch (error) {
  await page.screenshot({ path: path.join(artifacts, 'failure.png'), fullPage: true }).catch(() => {})
  throw error
} finally {
  // Delete only the uniquely named account created by this run, even if a
  // later assertion failed. Never touch existing managers or user projects.
  try {
    const response = await page.evaluate(async () => {
      const response = await fetch('/api/admin/accounts', { credentials: 'same-origin', headers: { 'x-forwarded-port': '8080' } })
      return { status: response.status, payload: await response.json() }
    })
    if (response.status === 200) {
      const own = response.payload.workspaces?.find((item) => item.manager?.username === managerName)?.manager
      if (own?.id) {
        const removed = await page.evaluate(async (id) => {
          const response = await fetch(`/api/admin/accounts/${encodeURIComponent(id)}`, {
            method: 'DELETE', credentials: 'same-origin', headers: { 'x-forwarded-port': '8080' },
          })
          return response.status
        }, own.id)
        assert.equal(removed, 200, '临时验证账号清理失败')
      }
    }
  } finally {
  await context.close()
  await browser.close()
  }
}
