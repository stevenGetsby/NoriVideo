import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { createAuthPreview } from '../../scripts/auth-home-preview.mjs'

const { chromium } = createRequire('/private/tmp/nori-browser-tools-local/package.json')('playwright-core')
const { server, base } = await createAuthPreview()
const output = 'test-results/auth-redesign'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome' })
const cases = []
const browserErrors = []
let latest
async function open(viewport = { width: 1440, height: 900 }, query = '') {
  const page = await browser.newPage({ viewport })
  latest = page
  page.on('pageerror', (error) => browserErrors.push(error.name))
  await page.goto(`${base}/${query}`, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: query.includes('signup') ? '账号由管理员分配' : query.includes('lang=en') ? 'Welcome Back' : '欢迎回来', exact: true }).waitFor()
    await page.locator('.nori-auth-creative-scene[data-scene-state="ready"] canvas').waitFor()
    await page.waitForTimeout(150)
    await page.waitForFunction(() => {
      const image = document.querySelector('.nori-auth-brand .nori-brand-mark')
      return image && image.complete && image.naturalWidth > 0
    })
  return page
}
async function bounds(locator) {
  await locator.scrollIntoViewIfNeeded()
  const box = await locator.boundingBox()
  const viewport = locator.page().viewportSize()
  assert.ok(box && box.x >= -1 && box.y >= -1 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
    'Interactive control must be reachable inside the viewport')
}
async function fill(page, username = 'test-creator', password = 'test-only-password') {
  await page.locator('#username').fill(username)
  await page.locator('#password').fill(password)
}
try {
  for (const [width, height] of [[1920,1080], [1440,900], [1366,768], [1280,720], [1024,600], [900,600], [768,480], [540,700], [390,844], [375,667], [320,568]]) {
    const page = await open({ width, height })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    assert.equal(await page.locator('main.fos-app').count(), 0, 'Public login must not inherit workspace zoom/fixed overflow')
    for (const locator of [page.locator('#username'), page.locator('#password'), page.getByRole('button', { name: '显示密码', exact: true }), page.getByRole('button', { name: '进入创作工作台', exact: true }), page.getByRole('link', { name: '平台 Admin 独立管理入口', exact: true })]) await bounds(locator)
    assert.equal(await page.locator('#username').getAttribute('autocomplete'), 'username')
    assert.equal(await page.locator('#password').getAttribute('autocomplete'), 'current-password')
    await page.evaluate(() => scrollTo(0, 0))
    await page.screenshot({ path: `${output}/login-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: '使用指南', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: '开始你的下一部作品。', exact: true })
    await bounds(dialog)
    await bounds(dialog.getByRole('button', { name: '关闭使用指南', exact: true }))
    await page.keyboard.press('Tab')
    assert.ok(await dialog.evaluate((element) => element.contains(document.activeElement)), 'Native modal contains keyboard focus')
    await dialog.getByRole('button', { name: '了解了，开始创作', exact: true }).click()
    await dialog.waitFor({ state: 'hidden' })
    await page.close()
    cases.push(`${width}x${height}:layout-controls-guide-focus-no-clipping`)
  }
  const password = await open()
  const colors = await password.evaluate(() => {
    const probe = document.createElement('div')
    probe.className = 'fos-viewport-theme'
    probe.style.cssText = 'position:absolute;left:-10000px;top:0;width:1px;height:1px;overflow:hidden'
    probe.innerHTML = '<div data-base style="background:var(--fos-bg-1)"></div><div class="fos-card"></div><input class="fos-input"><button class="fos-btn fos-btn-primary">probe</button>'
    document.body.append(probe)
    const color = (element) => getComputedStyle(element).backgroundColor
    const result = {
      page: color(document.querySelector('.nori-auth')), workspacePage: color(probe.querySelector('[data-base]')),
      panel: color(document.querySelector('.nori-auth-card')), workspacePanel: color(probe.querySelector('.fos-card')),
      input: color(document.querySelector('#username')), workspaceInput: color(probe.querySelector('.fos-input')),
      action: color(document.querySelector('.nori-auth-submit')), workspaceAction: color(probe.querySelector('.fos-btn-primary')),
      ambient: getComputedStyle(document.querySelector('.nori-auth-ambient')).backgroundImage,
    }
    probe.remove()
    return result
  })
  assert.equal(colors.page, colors.workspacePage)
  assert.notEqual(colors.panel, colors.workspacePanel, 'Glass login card intentionally differs from opaque workspace cards')
  assert.equal(colors.input, 'rgb(19, 19, 25)')
  assert.equal(colors.action, colors.workspaceAction)
  assert.notEqual(colors.ambient, 'none')
  assert.match(colors.panel, /rgba\(20, 20, 27, 0\.82\)/)
  cases.push('workspace-neutral-tokens-with-colorful-light-field-glass-card')
  await password.getByRole('link', { name: '进入工作台', exact: true }).click()
  assert.equal(await password.locator('#username').evaluate((element) => document.activeElement === element), true)
  await fill(password)
  await password.getByRole('button', { name: '显示密码', exact: true }).click()
  assert.equal(await password.locator('#password').getAttribute('type'), 'text')
  assert.equal(await password.locator('#password').inputValue(), 'test-only-password')
  await password.getByRole('button', { name: '隐藏密码', exact: true }).click()
  assert.equal(await password.locator('#password').getAttribute('type'), 'password')
  await password.locator('#password').focus()
  await password.locator('#password').dispatchEvent('keydown', { key: 'A', code: 'KeyA', modifierCapsLock: true })
  await password.getByRole('status').filter({ hasText: '大写锁定已开启' }).waitFor()
  await password.locator('#username').focus()
  await password.locator('#nori-caps-lock-hint').waitFor({ state: 'hidden' })
  assert.equal(await password.locator('#nori-caps-lock-hint').count(), 0)
  await password.getByRole('button', { name: '使用指南', exact: true }).click()
  await password.keyboard.press('Escape')
  await password.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await password.getByRole('dialog').count(), 0)
  await password.getByRole('button', { name: '遇到登录问题？', exact: true }).click()
  await password.getByRole('dialog').getByRole('button', { name: '关闭使用指南', exact: true }).click()
  await password.getByRole('dialog').waitFor({ state: 'hidden' })
  assert.equal(await password.locator('#username').inputValue(), 'test-creator')
  assert.equal(await password.locator('#password').inputValue(), 'test-only-password')
  await password.close()
  cases.push('show-hide-password-capslock-guide-escape-preserves-input')

  const invalid = await open({ width: 390, height: 700 })
  let submitted = 0
  await invalid.route('**/__fixture/auth/signin', (route) => { submitted++; return route.fulfill({ json: { ok: false, status: 401, error: 'CredentialsSignin' } }) })
  await invalid.getByRole('button', { name: '进入创作工作台', exact: true }).click()
  assert.equal(submitted, 0)
  await fill(invalid, '   ')
  await invalid.locator('#password').press('Enter')
  await invalid.getByRole('alert').filter({ hasText: '不能只填写空格' }).waitFor()
  assert.equal(submitted, 0)
  assert.equal(await invalid.locator('#username').evaluate((element) => element === document.activeElement), true)
  await invalid.close()
  cases.push('native-required-and-whitespace-account-validation-no-auth-request')

  for (const [status, error, expected] of [
    [401, 'CredentialsSignin', '账号或密码不正确'],
    [429, 'RateLimited', '请求过于频繁'],
    [500, 'CredentialsSignin', '登录服务暂时异常'],
    [401, 'AdminSurfaceRequired', '平台 Admin 必须从下方'],
  ]) {
    const page = await open(status === 500 ? { width: 320, height: 568 } : undefined)
    await page.route('**/__fixture/auth/signin', (route) => route.fulfill({ json: { ok: false, status, error } }))
    await fill(page)
    await page.getByRole('button', { name: '进入创作工作台', exact: true }).click()
    await page.getByRole('alert').filter({ hasText: expected }).waitFor()
    await bounds(page.getByRole('button', { name: '进入创作工作台', exact: true }))
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    assert.equal(await page.locator('#username').inputValue(), 'test-creator')
    assert.equal(await page.locator('#password').inputValue(), 'test-only-password')
    assert.equal(await page.getByRole('button', { name: '进入创作工作台', exact: true }).isEnabled(), true)
    await page.close()
    cases.push(`auth-error-${status}-${error}-recoverable`)
  }
  const network = await open()
  await network.route('**/__fixture/auth/signin', (route) => route.abort('failed'))
  await fill(network)
  await network.getByRole('button', { name: '进入创作工作台', exact: true }).click()
  await network.getByRole('alert').filter({ hasText: '登录过程中出现错误' }).waitFor()
  assert.equal(await network.locator('#username').isEnabled(), true)
  await network.close()
  cases.push('auth-network-failure-restores-input-and-submit')

  const pending = await open()
  let calls = 0
  let release
  await pending.route('**/__fixture/auth/signin', async (route) => {
    calls++
    const body = route.request().postDataJSON()
    assert.equal(body.username, 'test-creator')
    assert.equal(body.password, ' test-only-password ')
    await new Promise((resolve) => { release = resolve })
    await route.fulfill({ json: { ok: false, status: 401, error: 'CredentialsSignin' } })
  })
  await fill(pending, '  test-creator  ', ' test-only-password ')
  await pending.locator('form').evaluate((form) => { form.requestSubmit(); form.requestSubmit() })
  await pending.getByRole('button', { name: '登录中...', exact: true }).waitFor()
  assert.equal(await pending.locator('#username').isDisabled(), true)
  assert.equal(await pending.locator('#password').isDisabled(), true)
  for (let i = 0; i < 50 && !release; i++) await pending.waitForTimeout(20)
  assert.equal(calls, 1)
  release()
  await pending.getByRole('alert').waitFor()
  await pending.close()
  cases.push('synchronous-double-submit-guard-loading-trim-account-not-password')

  for (const role of ['admin', 'storyboard', 'super_admin']) {
    const page = await open()
    await page.route('**/__fixture/auth/signin', (route) => route.fulfill({ json: { ok: true, status: 200 } }))
    await page.route('**/__fixture/auth/session', (route) => route.fulfill({ json: { user: { role } } }))
    await fill(page)
    await page.locator('#password').press('Enter')
    await page.waitForURL(`${base}/zh/${role === 'super_admin' ? 'admin/accounts' : 'works'}`)
    await page.close()
    cases.push(`success-role-${role}-existing-redirect-preserved`)
  }
  const signup = await open({ width: 390, height: 700 }, '?signup=1')
  assert.equal(await signup.locator('form').count(), 0)
  await bounds(signup.getByRole('link', { name: '返回登录', exact: true }))
  await signup.close()
  cases.push('managed-registration-remains-closed-small-screen')
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 700 }]) {
    const page = await open(viewport, '?lang=en')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await bounds(page.getByRole('button', { name: 'Enter your workspace', exact: true }))
    await page.close()
    cases.push(`english-${viewport.width}-no-overflow`)
  }
  const motion = await open()
  await motion.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await motion.locator('.nori-auth-scene-renderer').evaluate((element) => getComputedStyle(element).transitionDuration), '0s')
  const firstFrame = await motion.locator('.nori-auth-scene-renderer canvas').evaluate((canvas) => canvas.toDataURL())
  await motion.waitForTimeout(250)
  assert.equal(await motion.locator('.nori-auth-scene-renderer canvas').evaluate((canvas) => canvas.toDataURL()), firstFrame, 'Reduced motion stops rendering new WebGL frames')
  await motion.close()
  cases.push('reduced-motion-stops-css-and-webgl-animation')
  const noWebgl = await browser.newPage({ viewport: { width: 390, height: 700 } })
  noWebgl.on('pageerror', (error) => browserErrors.push(error.name))
  await noWebgl.addInitScript(() => {
    const getContext = HTMLCanvasElement.prototype.getContext
    HTMLCanvasElement.prototype.getContext = function (type, ...args) {
      return type.startsWith('webgl') || type === 'experimental-webgl' ? null : getContext.call(this, type, ...args)
    }
  })
  await noWebgl.goto(base, { waitUntil: 'networkidle' })
  await noWebgl.locator('.nori-auth-creative-scene[data-scene-state="fallback"]').waitFor()
  assert.equal(await noWebgl.locator('.nori-auth-scene-renderer canvas').count(), 0)
  await fill(noWebgl)
  await bounds(noWebgl.getByRole('button', { name: '进入创作工作台', exact: true }))
  await noWebgl.close()
  cases.push('webgl-unavailable-static-fallback-login-usable')
  assert.deepEqual(browserErrors, [])
  const result = { ok: true, cases, browserErrors, productionRequests: 0, realCredentialsUsed: false, output }
  await writeFile(`${output}/results.json`, JSON.stringify(result, null, 2) + '\n')
  console.log(JSON.stringify(result, null, 2))
} catch (error) {
  if (latest && !latest.isClosed()) await latest.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {})
  throw error
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
