import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, writeFile } from 'node:fs/promises'
import { createAuthPreview } from '../../scripts/auth-home-preview.mjs'

const { chromium } = createRequire(`${process.env.HOME}/.npm/_npx/e41f203b7505f1fb/package.json`)('playwright-core')
const { server, base } = await createAuthPreview()
const output = 'test-results/home'
await mkdir(output, { recursive: true })
const browser = await chromium.launch({ headless: true, executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', args: ['--enable-gpu-rasterization'] })
const errors = []
const externalRequests = []
const cases = []
async function open(viewport = { width: 1440, height: 900 }, query = '?home=1', reducedMotion = 'no-preference') {
  const page = await browser.newPage({ viewport, reducedMotion })
  page.on('pageerror', (error) => errors.push(error.message))
  page.on('request', (request) => { if (!request.url().startsWith(base)) externalRequests.push(request.url()) })
  await page.goto(`${base}/${query}`, { waitUntil: 'networkidle' })
  await page.locator('.lm-home').waitFor()
  return page
}
async function inFirstViewport(page, selector) {
  const value = await page.locator(selector).evaluate((element) => {
    const rect = element.getBoundingClientRect()
    return { top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right, width: innerWidth, height: innerHeight }
  })
  assert.ok(value.top >= -1 && value.left >= -1 && value.bottom <= value.height + 1 && value.right <= value.width + 1, `${selector} outside first viewport: ${JSON.stringify(value)}`)
}
try {
  for (const [width, height] of [[1920,1080], [1440,900], [1366,768], [1280,720], [1024,600], [900,600], [768,480], [540,700], [390,844], [375,667], [320,568]]) {
    const page = await open({ width, height })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${width}: horizontal overflow`)
    assert.equal(await page.locator('.fos-app').count(), 0)
    await inFirstViewport(page, '[data-testid="home-enter"]')
    await inFirstViewport(page, '[data-testid="home-signin"]')
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.screenshot({ path: `${output}/home-${width}x${height}.png`, fullPage: width === 1440 || width === 390 })
    await page.close()
    cases.push(`${width}x${height}:static-layout-ctas-no-overflow`)
  }
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const page = await open(viewport, '?home=1&lang=en')
    assert.equal(await page.locator('h1').getAttribute('aria-label'), 'Stories that leap off the screen.')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false)
    await inFirstViewport(page, '[data-testid="home-enter"]')
    await page.screenshot({ path: `${output}/home-en-${viewport.width}.png` })
    await page.close()
    cases.push(`${viewport.width}:english`)
  }
  const icp = await open()
  assert.equal(await icp.locator('[data-testid="home-icp"]').getAttribute('href'), 'https://beian.miit.gov.cn/')
  await icp.goto(`${base}/?home=1&icp=0`)
  assert.equal(await icp.locator('[data-testid="home-icp"]').count(), 0)
  await icp.close()
  cases.push('optional-icp')
  const noJs = await browser.newContext({ viewport: { width: 1440, height: 900 }, javaScriptEnabled: false })
  const noJsPage = await noJs.newPage()
  await noJsPage.goto(`${base}/no-js`)
  assert.equal(await noJsPage.locator('h1').getAttribute('aria-label'), '让故事，跃然屏上。')
  assert.equal(await noJsPage.locator('[data-lm-enter]').count(), 3)
  assert.equal(await noJsPage.locator('[data-lm-enter]').evaluateAll((links) => links.every((link) => link.getAttribute('href') === '/auth/signin')), true)
  await noJsPage.emulateMedia({ reducedMotion: 'reduce' })
  assert.equal(await noJsPage.locator('[data-lm-reveal], .lm-ch, .lm-tv, .lm-cat, .lm-eyebrow, .lm-hero-description, .lm-hero-actions').evaluateAll((elements) => elements.some((element) => getComputedStyle(element).opacity === '0')), false)
  await noJsPage.screenshot({ path: `${output}/home-no-js.png`, fullPage: true })
  await noJs.close()
  cases.push('server-rendered-no-js-content-links-visible')
  const motion = await open()
  const firstOsd = await motion.locator('.lm-osd-in').textContent()
  await motion.waitForTimeout(5000)
  assert.notEqual(await motion.locator('.lm-osd-in').textContent(), firstOsd, 'TV automatically changes channel')
  await motion.locator('.lm-channel-dots button').nth(3).click()
  assert.match(await motion.locator('.lm-osd-in').textContent(), /CH 04/)
  await motion.mouse.move(0, 0)
  await motion.locator('.lm-tv').hover()
  await motion.waitForTimeout(4500)
  assert.match(await motion.locator('.lm-osd-in').textContent(), /CH 04/, 'Hover pauses channel progress')
  for (const [wait, action] of [[100, null], [1000, null], [250, 'cat']]) {
    if (action) await motion.locator('.lm-tv-rig .lm-cat-button').click()
    await motion.waitForTimeout(wait)
    const safe = await motion.locator('.lm-tv-rig').evaluate((rig) => {
      const image = rig.querySelector('img')
      const television = rig.querySelector('.lm-tv')
      if (!image || !television) return { missing: true }
      const cat = image.getBoundingClientRect()
      const tv = television.getBoundingClientRect()
      return { safe: cat.bottom >= tv.top + 8, catBottom: cat.bottom, tvTop: tv.top }
    })
    assert.equal(safe.missing, undefined)
    assert.ok(safe.safe, 'Cat crop remains covered during entry, jump and pounce')
  }
  await motion.locator('.lm-tv-rig .lm-cat-bubble.is-visible').filter({ hasText: '喵！' }).waitFor()
  await motion.waitForTimeout(1300)
  assert.equal(await motion.locator('.lm-tv-rig .lm-cat-bubble.is-visible').count(), 0)
  for (let click = 1; click <= 4; click++) {
    await motion.locator('.lm-tv-rig .lm-cat-button').click()
    await motion.locator('.lm-tv-rig .lm-cat-bubble.is-visible').filter({ hasText: click === 4 ? '开拍！' : '喵！' }).waitFor()
    await motion.waitForFunction(() => !document.querySelector('.lm-tv-rig .lm-cat-jump')?.classList.contains('is-pounce'))
    await motion.waitForTimeout(510)
  }
  await motion.evaluate(() => scrollTo(0, document.querySelector('#flow').getBoundingClientRect().top + scrollY + 200))
  await motion.waitForTimeout(1000)
  assert.equal(await motion.locator('.lm-flow-card.is-in').count(), 4)
  assert.equal(await motion.locator('.lm-home').getAttribute('data-lm-ch'), '02')
  assert.equal(await motion.locator('#top').getAttribute('data-lm-live'), 'false')
  await motion.waitForTimeout(500)
  assert.equal(await motion.locator('#top').evaluate((section) => section.getAnimations({ subtree: true }).some((animation) => animation.playState === 'running')), false)
  await motion.screenshot({ path: `${output}/home-flow-motion.png` })
  await motion.close()
  cases.push('boot-channels-hover-pause-cat-safety-scroll-pause')
  const reduced = await open({ width: 1440, height: 900 }, '?home=1', 'reduce')
  await reduced.waitForTimeout(3600)
  assert.match(await reduced.locator('.lm-osd-in').textContent(), /CH 01/)
  assert.equal(await reduced.evaluate(() => document.getAnimations().filter((animation) => animation.playState === 'running').length), 0)
  await reduced.locator('.lm-channel-dots button').nth(1).click()
  assert.match(await reduced.locator('.lm-osd-in').textContent(), /CH 02/)
  assert.equal(await reduced.locator('.lm-hero-description').evaluate((element) => getComputedStyle(element).opacity), '1')
  await reduced.close()
  cases.push('reduced-motion-static-manual-channel')
  for (const viewport of [{ width: 768, height: 1024 }, { width: 390, height: 844 }]) {
    const page = await open(viewport)
    await page.waitForTimeout(1600)
    for (let sample = 0; sample < 8; sample++) {
      const covered = await page.locator('.lm-tv-rig').evaluate((rig) => {
        const cat = rig.querySelector('img').getBoundingClientRect()
        const tv = rig.querySelector('.lm-tv').getBoundingClientRect()
        return cat.bottom >= tv.top + 8
      })
      assert.ok(covered, `${viewport.width}: cat crop uncovered`)
      await page.waitForTimeout(160)
    }
    await page.locator('.lm-tv-rig .lm-cat-button').click()
    await page.waitForTimeout(250)
    assert.equal(await page.locator('.lm-tv-rig').evaluate((rig) => rig.querySelector('img').getBoundingClientRect().bottom >= rig.querySelector('.lm-tv').getBoundingClientRect().top + 8), true)
    await page.close()
    cases.push(`${viewport.width}:cat-entry-loop-pounce-safe`)
  }
  const keyboard = await open()
  await keyboard.locator('.lm-skip').focus()
  const expected = ['.lm-brand', '.lm-nav a[href="#flow"]', '.lm-nav a[href="#canvas"]', '.lm-nav a[href="#start"]', '[data-testid="home-signin"]', '[data-testid="home-enter"]', '.lm-text-link', '.lm-tv-rig .lm-cat-button']
  for (const selector of expected) {
    await keyboard.keyboard.press('Tab')
    assert.equal(await keyboard.locator(selector).evaluate((element) => element === document.activeElement), true, `Keyboard focus: ${selector}`)
    assert.notEqual(await keyboard.locator(selector).evaluate((element) => getComputedStyle(element).outlineStyle), 'none')
  }
  await keyboard.locator('.lm-nav a[href="#canvas"]').click()
  await keyboard.waitForTimeout(1500)
  assert.equal(await keyboard.locator('.lm-home').getAttribute('data-lm-ch'), '03')
  await keyboard.locator('#start').evaluate((element) => element.scrollIntoView())
  await keyboard.waitForTimeout(1300)
  await keyboard.screenshot({ path: `${output}/home-finale-motion.png` })
  await keyboard.close()
  cases.push('keyboard-order-visible-focus-anchor-navigation-finale')
  for (const selector of ['[data-testid="home-signin"]', '[data-testid="home-enter"]', '[data-testid="home-enter-final"]']) {
    const page = await open()
    await page.locator(selector).evaluate((element) => element.scrollIntoView({ block: 'center', behavior: 'instant' }))
    await page.waitForTimeout(1400)
    await page.locator(selector).hover({ force: true })
    assert.ok(await page.evaluate(() => window.__lmPrefetched?.includes('/auth/signin')))
    await page.locator(selector).click({ noWaitAfter: true })
    await page.waitForTimeout(100)
    assert.equal(await page.locator('.lm-home').getAttribute('data-lm-leaving'), '')
    await page.waitForTimeout(600)
    assert.deepEqual(await page.evaluate(() => window.__lmPushed), ['/auth/signin'])
    await page.close()
    cases.push(`${selector}:power-off-prefetch-single-navigation`)
  }
  const modifier = await open()
  const allowed = await modifier.locator('[data-testid="home-enter"]').evaluate((element) => {
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, metaKey: true })
    element.dispatchEvent(event)
    return !event.defaultPrevented
  })
  assert.equal(allowed, true)
  assert.equal(await modifier.locator('.lm-home').getAttribute('data-lm-leaving'), null)
  await modifier.close()
  cases.push('modifier-click-not-intercepted')
  const reducedEnter = await open({ width: 1440, height: 900 }, '?home=1', 'reduce')
  await reducedEnter.locator('[data-testid="home-enter"]').click({ noWaitAfter: true })
  await reducedEnter.waitForURL('**/auth/signin')
  cases.push('reduced-motion-immediate-native-navigation')
  const fallback = await open()
  await fallback.locator('[data-testid="home-enter"]').click()
  await fallback.waitForTimeout(4600)
  assert.equal(await fallback.locator('.lm-home').getAttribute('data-lm-leaving'), null)
  await fallback.close()
  cases.push('navigation-failure-restores-home')
  const immediate = await open()
  await immediate.waitForTimeout(2200)
  assert.equal(await immediate.locator('.lm-boot').evaluate((element) => getComputedStyle(element).visibility), 'hidden')
  assert.equal(await immediate.locator('.lm-ch:not(.lm-ch-leap)').evaluateAll((elements) => elements.every((element) => getComputedStyle(element).opacity === '1')), true)
  await immediate.close()
  cases.push('boot-finished-headline-readable')
  const paint = []
  for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
    const context = await browser.newContext({ viewport })
    await context.addInitScript(() => {
      window.__lcp = 0
      window.__cls = 0
      new PerformanceObserver((list) => { window.__lcp = list.getEntries().at(-1)?.startTime || 0 }).observe({ type: 'largest-contentful-paint', buffered: true })
      new PerformanceObserver((list) => { for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value }).observe({ type: 'layout-shift', buffered: true })
    })
    const page = await context.newPage()
    page.on('pageerror', (error) => errors.push(error.message))
    await page.goto(`${base}/?home=1`, { waitUntil: 'networkidle' })
    await page.waitForTimeout(2200)
    const metrics = await page.evaluate(() => ({ lcp: window.__lcp, cls: window.__cls }))
    assert.ok(metrics.lcp > 0 && metrics.lcp <= 2500, `${viewport.width}: LCP ${metrics.lcp}`)
    assert.ok(metrics.cls <= 0.02, `${viewport.width}: CLS ${metrics.cls}`)
    paint.push({ viewport: `${viewport.width}x${viewport.height}`, ...metrics })
    await context.close()
    cases.push(`${viewport.width}:lcp-cls`)
  }
  const perf = await open()
  await perf.evaluate(() => {
    window.__frameGaps = []
    window.__maxAnimations = 0
    let previous = performance.now()
    const tick = (now) => {
      window.__frameGaps.push(now - previous)
      previous = now
      const running = document.getAnimations().filter((animation) => animation.playState === 'running')
      window.__maxAnimations = Math.max(window.__maxAnimations, running.length)
      if (now < window.__perfStart + 5000) requestAnimationFrame(tick)
      else {
        const scroll = () => {
          scrollBy(0, 12)
          if (scrollY + innerHeight < document.documentElement.scrollHeight) requestAnimationFrame(scroll)
          else window.__perfDone = true
        }
        requestAnimationFrame(scroll)
      }
    }
    window.__perfStart = performance.now()
    requestAnimationFrame(tick)
  })
  await perf.waitForFunction(() => window.__perfDone, { timeout: 30000 })
  const metrics = await perf.evaluate(() => ({ gaps: window.__frameGaps, maxAnimations: window.__maxAnimations }))
  const longFrames = metrics.gaps.filter((gap) => gap > 34).length / metrics.gaps.length
  assert.ok(longFrames <= 0.05, `Slow frame ratio: ${longFrames}`)
  assert.ok(metrics.maxAnimations <= 40, `Running animation budget: ${metrics.maxAnimations}`)
  await perf.close()
  cases.push('performance-frame-sample')
  await writeFile(`${output}/result.json`, JSON.stringify({ cases, errors, performance: { slowFrameRatio: longFrames, maxAnimations: metrics.maxAnimations, paint } }, null, 2))
  assert.deepEqual(externalRequests, [])
  assert.deepEqual(errors, [])
  await writeFile(`${output}/static-result.json`, JSON.stringify({ cases, errors }, null, 2))
  console.log(JSON.stringify({ passed: cases.length, errors }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
