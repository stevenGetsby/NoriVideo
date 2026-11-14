// Real header, canvas chrome and story-tip styles; no login, database, storage
// or paid generation. All API calls are local empty JSON responses.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir, readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'

const root = process.cwd()
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')
const artifacts = path.join(root, 'test-results/lanmiaotv-ux-a')
await mkdir(artifacts, { recursive: true })

let appCss
if (process.env.NORI_BROWSER_GLOBAL_CSS_PATH) {
  appCss = await readFile(process.env.NORI_BROWSER_GLOBAL_CSS_PATH, 'utf8')
} else {
  const workspace = new URL('http://127.0.0.1:3000')
  const html = await (await fetch(new URL('/zh/auth/signin', workspace))).text()
  const styleUrls = [...html.matchAll(/<link\b[^>]*>/g)].filter(([tag]) => tag.includes('rel="stylesheet"'))
    .map(([tag]) => tag.match(/href="([^"]+)"/)?.[1]).filter((href) => href?.startsWith('/_next/static/'))
  assert.ok(styleUrls.length, 'Local app or NORI_BROWSER_GLOBAL_CSS_PATH is required')
  appCss = (await Promise.all(styleUrls.map(async (href) => {
    const response = await fetch(new URL(href, workspace))
    assert.ok(response.ok, `Global stylesheet unavailable: ${response.status}`)
    return response.text()
  }))).join('\n')
}
assert.ok(appCss.includes('--nori-interface-scale'), 'Actual application styling required')

const bundle = process.env.NORI_BROWSER_PREBUILT_DIR ? {
  outputFiles: await Promise.all(['js', 'css'].map(async (extension) => ({
    path: `/fixture/fixture.${extension}`,
    contents: await readFile(path.join(process.env.NORI_BROWSER_PREBUILT_DIR, `lanmiaotv-ux-a.${extension}`)),
  }))),
} : await (await import('esbuild')).build({
  entryPoints: ['tests/browser/lanmiaotv-ux-a.fixture.tsx'], bundle: true, write: false,
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
  const target = request.url === '/fixture.css' ? '.css' : '.js'
  const file = bundle.outputFiles.find((candidate) => candidate.path.endsWith(target))
  if (request.url === '/fixture.js' || request.url === '/fixture.css') {
    response.setHeader('Content-Type', target === '.css' ? 'text/css' : 'text/javascript')
    return response.end(file.contents)
  }
  response.setHeader('Content-Type', 'text/html')
  response.end('<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>')
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})
const errors = []
const results = []

async function open(query, viewport) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', (error) => errors.push(error.message))
  await page.route('**/api/**', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: '{}' }))
  await page.goto(`${base}/?${query}`)
  return page
}

const SHORT_NAME = '测试作品甲乙'
const LONG_NAME = '长作品名称边界测试'.repeat(8).slice(0, 40)

function headerMetrics() {
  const header = document.querySelector('.fos-stage-header')
  const h1 = header.querySelector('h1')
  const style = getComputedStyle(header)
  const containerWidth = header.clientWidth - Number.parseFloat(style.paddingLeft) - Number.parseFloat(style.paddingRight)
  const visible = (element) => {
    const own = getComputedStyle(element)
    const rect = element.getBoundingClientRect()
    return own.display !== 'none' && own.visibility !== 'hidden' && Number(own.opacity) > 0 && rect.width > 1 && rect.height > 1
  }
  const rectOf = (element) => {
    const rect = element.getBoundingClientRect()
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom, width: rect.width, height: rect.height }
  }
  const controls = [...header.querySelectorAll('a, button')].filter(visible).map((element) => ({
    label: (element.getAttribute('aria-label') || element.textContent || '').trim(),
    action: Boolean(element.closest('.fos-stage-actions')) || element.classList.contains('fos-back-btn'),
    rect: rectOf(element),
  }))
  const overlaps = []
  for (let i = 0; i < controls.length; i += 1) {
    for (let j = i + 1; j < controls.length; j += 1) {
      const a = controls[i].rect
      const b = controls[j].rect
      const x = Math.min(a.right, b.right) - Math.max(a.left, b.left)
      const y = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)
      if (x > 0.5 && y > 0.5) overlaps.push([controls[i].label, controls[j].label])
    }
  }
  const headerRect = rectOf(header)
  return {
    containerWidth,
    headerRect,
    controls,
    overlaps,
    h1: {
      ...rectOf(h1),
      scrollWidth: h1.scrollWidth,
      clientWidth: h1.clientWidth,
      whiteSpace: getComputedStyle(h1).whiteSpace,
      textOverflow: getComputedStyle(h1).textOverflow,
      title: h1.getAttribute('title'),
      text: h1.textContent,
    },
    labelsVisible: [...header.querySelectorAll('.fos-stage-icon-btn .fos-stage-action-label')].map((element) => getComputedStyle(element).display !== 'none'),
    moreVisible: visible(header.querySelector('.fos-stage-more')),
    legacyVisible: Boolean(header.querySelector('.fos-stage-action-more-legacy')) && visible(header.querySelector('.fos-stage-action-more-legacy')),
    assignmentsVisible: visible(header.querySelector('.fos-stage-action-assignments')),
    settingsVisible: visible(header.querySelector('.fos-stage-action-settings')),
    canvasVisible: visible(header.querySelector('.fos-stage-action-canvas')),
    parentVisible: visible(header.querySelector('.fos-stage-parent-project')),
    metaVisible: visible(header.querySelector('.fos-meta-tag')),
  }
}

for (const viewport of [
  { width: 1024, height: 700 },
  { width: 1100, height: 760 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
]) {
  for (const sidebar of ['expanded', 'collapsed']) {
    for (const [label, name] of [['short', SHORT_NAME], ['long', LONG_NAME]]) {
      const page = await open(`name=${encodeURIComponent(name)}&sidebar=${sidebar}`, viewport)
      await page.locator('.fos-stage-header h1').waitFor()
      const metrics = await page.evaluate(headerMetrics)
      const context = `${viewport.width}/${sidebar}/${label}`
      const tier = metrics.containerWidth >= 960 ? 'full' : metrics.containerWidth >= 720 ? 'compact' : 'minimal'

      assert.ok(metrics.headerRect.height <= 68, `${context}: header height ${metrics.headerRect.height}`)
      assert.equal(metrics.h1.whiteSpace, 'nowrap', `${context}: h1 must stay on one line`)
      assert.equal(metrics.h1.textOverflow, 'ellipsis', `${context}: h1 must ellipsize`)
      assert.equal(metrics.h1.title, name, `${context}: h1 title attribute must expose the full name`)
      assert.ok(metrics.h1.height <= 34, `${context}: h1 occupies more than one line (${metrics.h1.height})`)
      if (label === 'long') assert.ok(metrics.h1.scrollWidth > metrics.h1.clientWidth, `${context}: long title must actually truncate`)
      assert.deepEqual(metrics.overlaps, [], `${context}: header controls overlap`)
      for (const control of metrics.controls.filter((item) => item.action)) {
        assert.ok(control.rect.height >= 37.5 && control.rect.height <= 40.5, `${context}: control ${control.label} must use the 32px spec (${control.rect.height})`)
        assert.ok(control.rect.left >= metrics.headerRect.left - 1, `${context}: control ${control.label} escapes the header`)
        assert.ok(control.rect.right <= metrics.headerRect.right + 1, `${context}: control ${control.label} escapes the header`)
        assert.ok(control.rect.top >= metrics.headerRect.top - 1 && control.rect.bottom <= metrics.headerRect.bottom + 1, `${context}: control ${control.label} escapes the header`)
      }

      if (tier === 'full') {
        assert.ok(metrics.labelsVisible.every(Boolean), `${context}: full tier keeps action text`)
        assert.equal(metrics.moreVisible, false, `${context}: full tier hides the more trigger`)
        assert.equal(metrics.legacyVisible, true, `${context}: full tier keeps 作品操作`)
        assert.equal(metrics.metaVisible, metrics.containerWidth >= 1280, `${context}: meta tags follow the 1280 container threshold`)
      } else if (tier === 'compact') {
        assert.ok(metrics.labelsVisible.every((value) => value === false), `${context}: compact tier is icon-only`)
        for (const label of ['协作任务', '无限画布', '作品设置']) {
          const control = metrics.controls.find((item) => item.label === label)
          assert.ok(control, `${context}: missing ${label}`)
          assert.ok(Math.abs(control.rect.width - 38.4) <= 1.5, `${context}: ${label} must be a 32px square (${control.rect.width})`)
        }
        assert.equal(metrics.legacyVisible, true, `${context}: compact tier keeps the 作品操作 label`)
        assert.equal(metrics.moreVisible, false, `${context}: compact tier hides the more trigger`)
        assert.equal(metrics.parentVisible, metrics.containerWidth >= 900, `${context}: parent chip follows the 900 container threshold`)
        assert.equal(metrics.metaVisible, false, `${context}: compact tier hides meta tags`)
      } else {
        assert.ok(metrics.labelsVisible.every((value) => value === false), `${context}: minimal tier is icon-only`)
        assert.equal(metrics.assignmentsVisible, false, `${context}: minimal tier folds 协作任务 into 更多`)
        assert.equal(metrics.settingsVisible, false, `${context}: minimal tier folds 作品设置 into 更多`)
        assert.equal(metrics.legacyVisible, false, `${context}: minimal tier folds 作品操作 into 更多`)
        assert.equal(metrics.canvasVisible, true, `${context}: minimal tier keeps 无限画布`)
        assert.equal(metrics.moreVisible, true, `${context}: minimal tier exposes 更多`)
        assert.equal(metrics.parentVisible, false, `${context}: minimal tier hides the parent chip`)
        assert.equal(metrics.metaVisible, false, `${context}: minimal tier hides meta tags`)
      }
      results.push(`${context}:${tier}`)
      if (label === 'long' && (viewport.width === 1024 || sidebar === 'collapsed' && viewport.width === 1440)) {
        await page.screenshot({ path: path.join(artifacts, `header-${viewport.width}-${sidebar}-long.png`) })
      }
      await page.close()
    }
  }
}

// The compact trigger folds the three secondary actions behind one menu.
{
  const page = await open(`name=${encodeURIComponent(LONG_NAME)}&sidebar=expanded`, { width: 1024, height: 700 })
  await page.locator('.fos-stage-header h1').waitFor()
  const more = page.getByTestId('project-more-actions')
  await more.waitFor()
  assert.equal(await more.getAttribute('aria-label'), '更多')
  assert.equal(await more.getAttribute('title'), '更多')
  await more.click()
  const menu = page.getByRole('menu', { name: '更多操作' })
  await menu.waitFor()
  for (const name of ['协作任务', '作品设置', '编辑作品', '删除作品']) {
    assert.equal(await page.getByRole('menuitem', { name, exact: true }).count(), 1, `更多 menu must contain ${name}`)
  }
  await page.getByRole('menuitem', { name: '协作任务', exact: true }).click()
  await page.getByRole('dialog', { name: '协作任务' }).waitFor()
  await page.getByRole('button', { name: '关闭协作任务' }).click()
  await more.click()
  await page.getByRole('menuitem', { name: '作品设置', exact: true }).click()
  const settings = page.getByRole('dialog', { name: '编辑作品', exact: true })
  await settings.waitFor()
  await settings.getByRole('button', { name: '关闭', exact: true }).click()
  await settings.waitFor({ state: 'hidden' })
  await more.click()
  await page.getByRole('menuitem', { name: '编辑作品', exact: true }).click()
  await page.getByRole('dialog', { name: '编辑作品', exact: true }).waitFor()
  await page.getByRole('dialog', { name: '编辑作品', exact: true }).getByRole('button', { name: '关闭', exact: true }).click()
  await more.click()
  await page.getByRole('menuitem', { name: '删除作品', exact: true }).click()
  const deletion = page.getByRole('dialog', { name: '删除作品' })
  await deletion.waitFor()
  await deletion.getByRole('button', { name: '取消', exact: true }).click()
  await deletion.waitFor({ state: 'hidden' })
  results.push('more-menu-wiring')
  await page.close()
}

// Middle tier: the 作品操作 menu keeps its text trigger and edit/delete entries.
{
  const page = await open(`name=${encodeURIComponent(LONG_NAME)}&sidebar=expanded`, { width: 1280, height: 800 })
  const actions = page.locator('.fos-stage-actions')
  await actions.getByRole('button', { name: '作品操作', exact: true }).click()
  const menu = page.getByRole('menu', { name: '作品操作' })
  await menu.waitFor()
  assert.equal(await page.getByRole('menuitem', { name: '编辑作品', exact: true }).count(), 1)
  assert.equal(await page.getByRole('menuitem', { name: '删除作品', exact: true }).count(), 1)
  assert.equal(await page.getByRole('menuitem', { name: '协作任务', exact: true }).count(), 0)
  await page.keyboard.press('Escape')
  results.push('middle-tier-more-menu')
  await page.close()
}

// Story tips must stay clear of the chrome actions and still hide while dragging.
for (const viewport of [
  { width: 1024, height: 700 },
  { width: 1280, height: 800 },
  { width: 1440, height: 900 },
  { width: 1920, height: 1080 },
]) {
  const page = await open('view=story-tips', viewport)
  await page.locator('.nori-story-tips').waitFor()
  const geometry = await page.evaluate(() => {
    const tips = document.querySelector('.nori-story-tips').getBoundingClientRect()
    const actions = document.querySelector('.nori-canvas-chrome-actions').getBoundingClientRect()
    return {
      tips: { left: tips.left, top: tips.top, right: tips.right, bottom: tips.bottom },
      actions: { left: actions.left, top: actions.top, right: actions.right, bottom: actions.bottom },
      chromeHeight: Number.parseFloat(getComputedStyle(document.querySelector('.nori-canvas-workspace')).getPropertyValue('--nori-canvas-chrome-h')),
    }
  })
  const intersectX = Math.min(geometry.tips.right, geometry.actions.right) - Math.max(geometry.tips.left, geometry.actions.left)
  const intersectY = Math.min(geometry.tips.bottom, geometry.actions.bottom) - Math.max(geometry.tips.top, geometry.actions.top)
  assert.ok(intersectX <= 0 || intersectY <= 0, `${viewport.width}: story tips overlap the chrome actions ${JSON.stringify(geometry)}`)
  assert.ok(geometry.tips.top >= geometry.actions.bottom, `${viewport.width}: story tips must start below the chrome actions`)
  assert.ok(Math.abs(geometry.tips.right - geometry.actions.right) <= 2, `${viewport.width}: story tips must align with the chrome right edge`)
  assert.equal(geometry.chromeHeight, 102, `${viewport.width}: chrome height variable`)

  await page.evaluate(() => document.querySelector('.nori-canvas-workspace').classList.add('is-node-dragging'))
  await page.waitForTimeout(260)
  const hiddenWhileDragging = await page.locator('.nori-story-tips').evaluate((element) => {
    const style = getComputedStyle(element)
    return style.visibility === 'hidden' || Number(style.opacity) === 0
  })
  assert.ok(hiddenWhileDragging, `${viewport.width}: story tips must hide while dragging`)
  await page.evaluate(() => document.querySelector('.nori-canvas-workspace').classList.remove('is-node-dragging'))
  await page.waitForTimeout(260)
  const visibleAgain = await page.locator('.nori-story-tips').evaluate((element) => {
    const style = getComputedStyle(element)
    return style.visibility !== 'hidden' && Number(style.opacity) > 0
  })
  assert.ok(visibleAgain, `${viewport.width}: story tips must return after dragging`)
  results.push(`story-tips:${viewport.width}`)
  if (viewport.width === 1280) await page.screenshot({ path: path.join(artifacts, 'story-tips-1280.png') })
  await page.close()
}

await browser.close()
server.close()
assert.deepEqual(errors, [], `Page errors: ${errors.join(' | ')}`)
console.log(`lanmiaotv-ux-a: ${results.length} checks passed`)
