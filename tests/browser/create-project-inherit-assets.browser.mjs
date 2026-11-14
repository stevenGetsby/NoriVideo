// 独立浏览器验证：创建作品弹窗（画布模式）的“继承资产”流程。
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdir } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { build } from 'esbuild'

const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || process.cwd(), 'package.json'))
const { chromium } = tools('playwright-core')
const root = process.cwd()
const artifacts = path.join(root, 'test-results/create-project-inherit-assets')
await mkdir(artifacts, { recursive: true })

const bundle = await build({
  entryPoints: ['tests/browser/create-project-dialog.fixture.tsx'],
  bundle: true,
  write: false,
  outdir: '/fixture.js',
  jsx: 'automatic',
  platform: 'browser',
  alias: { '@': path.join(root, 'src') },
  define: { 'process.env.NODE_ENV': '"development"' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js'))?.contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css'))?.contents
assert.ok(script && css, 'fixture bundle must contain JavaScript and CSS')

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
const base = `http://127.0.0.1:${server.address().port}`
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
})

// ---- 测试数据 -------------------------------------------------------------

const stamp = (day, hour = 8) => `2026-11-${String(day).padStart(2, '0')}T${String(hour).padStart(2, '0')}:00:00.000Z`
const swatch = (color) => `data:image/svg+xml;utf8,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96"><rect width="96" height="96" fill="${color}"/></svg>`)}`

function material(projectId, id, title, type, source, extra = {}) {
  const url = type === 'image' ? swatch('#3b82f6') : null
  return {
    id, projectId, projectName: projectId, ownerName: '验证账号', title, type, source,
    status: 'ready', isFavorited: false, resultUrl: url, storageKey: null, url, metadata: {},
    createdAt: stamp(10), updatedAt: stamp(10), ...extra,
  }
}

const inheritedFrom = { inheritedFrom: { projectId: 'p-ep1', projectName: '第一集', materialId: 'm-src-1' } }
const EP2 = [
  material('p-ep2', 'g1', '主角-林夏', 'image', 'creative', { metadata: { assetCategory: 'character' } }),
  material('p-ep2', 'g2', '雨夜街景', 'image', 'production'),
  material('p-ep2', 'g3', '开场镜头', 'video', 'toolbox'),
  material('p-ep2', 'u1', '品牌 Logo', 'image', 'upload'),
  material('p-ep2', 'u2', '配乐-主题曲', 'audio', 'upload'),
  material('p-ep2', 'i1', '场景-旧公寓', 'image', 'creative', { metadata: inheritedFrom }),
  material('p-ep2', 'x1', '生成中的素材', 'image', 'creative', { status: 'processing' }),
  material('p-ep2', 'x2', '已删除素材', 'image', 'upload', { deletedAt: stamp(11) }),
  material('p-ep2', 'x3', '个人素材', 'image', 'upload', { personal: true }),
  material('p-ep2', 'x4', '个人素材B', 'image', 'upload', { personalOwnerId: 'user-9' }),
]
const EP1_PAGE_1 = [material('p-ep1', 'e1', '第一集-角色A', 'image', 'creative'), material('p-ep1', 'e2', '第一集-场景B', 'image', 'upload')]
const EP1_PAGE_2 = [material('p-ep1', 'e3', '第一集-配音C', 'audio', 'creative')]
const pad = (index) => String(index + 1).padStart(3, '0')
const CITY = Array.from({ length: 230 }, (_, index) => material('p-city', `city-${pad(index)}`, `城-${pad(index)}`, 'image', 'creative'))
const ERROR_RECOVERED = [material('p-error', 'er1', '恢复后素材一', 'image', 'creative'), material('p-error', 'er2', '恢复后素材二', 'image', 'upload')]
const SLOW = [material('p-slow', 'sl1', '慢速素材', 'image', 'creative')]
const NOT_INHERITABLE_ONLY = [
  material('p-empty', 'em1', '处理中', 'image', 'creative', { status: 'processing' }),
  material('p-empty', 'em2', '已删除', 'image', 'upload', { deletedAt: stamp(11) }),
  material('p-empty', 'em3', '个人', 'image', 'upload', { personal: true }),
]

const project = (id, name, updatedAt) => ({ id, name, createdAt: stamp(1), updatedAt })
const work = (id, name, projects) => ({ id, name, createdAt: stamp(1), updatedAt: stamp(12), projectCount: projects.length, projects })
const WORKS = [
  work('work-current', '第一季', [project('p-ep1', '第一集', stamp(5)), project('p-ep2', '第二集', stamp(10))]),
  work('work-other', '另一个项目', [
    project('p-city', '城市篇', stamp(12)),
    project('p-extra-a', '番外', stamp(8, 1)),
    project('p-extra-b', '番外', stamp(9, 2)),
    project('p-error', '读取失败', stamp(7)),
    project('p-slow', '慢速作品', stamp(6)),
    project('p-empty', '空作品', stamp(4)),
  ]),
]

// ---- 页面与接口模拟 -------------------------------------------------------

const materialRequests = []
const forbidden = []
const pageErrors = []
const consoleErrors = []
const errorAttempts = { count: 0 }
let releaseSlow = () => undefined
const slowGate = new Promise((resolve) => { releaseSlow = resolve })

const json = (route, body, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

async function openPage(config, viewport = { width: 1402, height: 970 }) {
  const page = await browser.newPage({ viewport })
  page.on('pageerror', (error) => pageErrors.push(String(error)))
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().includes('Failed to load resource')) consoleErrors.push(message.text())
  })
  page.on('request', (request) => {
    const url = request.url()
    if (url.startsWith(base) || url.startsWith('data:') || url.startsWith('blob:')) {
      const { pathname } = new URL(url)
      if (pathname.startsWith('/api/projects')) forbidden.push(`${request.method()} ${pathname}`)
      return
    }
    forbidden.push(url)
  })
  if (config) await page.addInitScript((value) => { window.__CREATE_DIALOG_FIXTURE__ = value }, config)
  await page.route('**/api/**', (route) => json(route, { scripts: [], candidates: [] }))
  await page.route('**/api/frameos/materials**', async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname !== '/api/frameos/materials') { await route.fallback(); return }
    const query = Object.fromEntries(url.searchParams)
    materialRequests.push(query)
    try {
      switch (query.projectId) {
        case 'p-ep2': return await json(route, { materials: EP2, pagination: { nextCursor: null } })
        case 'p-ep1': return await json(route, query.cursor === 'c1'
          ? { materials: EP1_PAGE_2, pagination: { nextCursor: null } }
          : { materials: EP1_PAGE_1, pagination: { nextCursor: 'c1' } })
        case 'p-city': return await json(route, { materials: CITY, pagination: { nextCursor: null } })
        case 'p-extra-a': return await json(route, { materials: [material('p-extra-a', 'ea1', '番外A素材', 'image', 'upload')], pagination: { nextCursor: null } })
        case 'p-extra-b': return await json(route, { materials: [material('p-extra-b', 'eb1', '番外B素材', 'image', 'upload')], pagination: { nextCursor: null } })
        case 'p-error':
          errorAttempts.count += 1
          return errorAttempts.count === 1
            ? await json(route, { success: false, error: { code: 'MATERIALS_DOWN', message: '素材服务暂时不可用' } }, 500)
            : await json(route, { materials: ERROR_RECOVERED, pagination: { nextCursor: null } })
        case 'p-slow':
          await slowGate
          return await json(route, { materials: SLOW, pagination: { nextCursor: null } })
        case 'p-empty': return await json(route, { materials: NOT_INHERITABLE_ONLY, pagination: { nextCursor: null } })
        default: return await json(route, { materials: [], pagination: { nextCursor: null } })
      }
    } catch {
      // 切换作品会中止上一个读取，此时无需再回应。
    }
  })
  await page.goto(base, { waitUntil: 'domcontentloaded' })
  const dialog = page.getByRole('dialog', { name: '创建作品' })
  await dialog.waitFor({ state: 'visible', timeout: 15_000 })
  return { page, dialog }
}

const flat = (value) => value.replace(/\s+/g, ' ').trim()

function toolkit(page, dialog) {
  const section = dialog.getByTestId('inherit-assets-section')
  const modeGroup = section.getByRole('radiogroup', { name: '继承资产', exact: true })
  return {
    section,
    mode: (label) => modeGroup.getByRole('radio', { name: label, exact: true }),
    tiles: dialog.getByTestId('inherit-tile'),
    checked: dialog.locator('[data-testid="inherit-tile"][aria-checked="true"]'),
    blocked: dialog.locator('[data-testid="inherit-tile"][aria-disabled="true"]'),
    count: dialog.getByTestId('inherit-count'),
    picker: dialog.getByTestId('inherit-picker'),
    dialogError: dialog.locator('.create-project-error'),
    origin: (label) => dialog.getByRole('radiogroup', { name: '按来源筛选资产', exact: true }).getByRole('radio').filter({ hasText: label }),
    selectAll: dialog.getByRole('button', { name: '全选当前列表中的资产', exact: true }),
    clearAll: dialog.getByRole('button', { name: '清空当前列表中已选的资产', exact: true }),
    search: dialog.getByRole('searchbox', { name: '搜索要继承的资产', exact: true }),
    sourceSelect: dialog.getByRole('combobox', { name: '选择要继承资产的作品', exact: true }),
    submit: () => dialog.getByRole('button', { name: '创建并进入画布', exact: true }).click(),
    calls: async () => Number(await page.getByLabel('创建结果').getAttribute('data-calls')),
    created: async () => JSON.parse(await page.getByLabel('创建结果').innerText()),
    countText: async () => flat(await dialog.getByTestId('inherit-count').innerText()),
    titles: async () => dialog.getByTestId('inherit-tile').evaluateAll((nodes) => nodes.map((node) => node.querySelector('.create-project-inherit-name')?.textContent ?? '')),
  }
}

async function layoutMetrics(dialog) {
  return dialog.evaluate((element) => {
    const body = element.querySelector('.create-project-body')
    const foot = element.querySelector('.fos-dialog-foot')
    const grid = element.querySelector('.create-project-inherit-grid')
    const section = element.querySelector('.create-project-inherit')
    const bodyRect = body?.getBoundingClientRect()
    const sectionRect = section?.getBoundingClientRect()
    const footRect = foot?.getBoundingClientRect()
    return {
      bodyOverflowsX: body ? body.scrollWidth > body.clientWidth + 1 : null,
      sectionInsideBody: sectionRect && bodyRect ? sectionRect.left >= bodyRect.left - 1 && sectionRect.right <= bodyRect.right + 1 : null,
      sectionOverflowers: section && bodyRect
        ? [...section.querySelectorAll('*')].filter((node) => {
          const rect = node.getBoundingClientRect()
          return rect.right > bodyRect.right + 1 || rect.left < bodyRect.left - 1
        }).length
        : null,
      footVisible: !!footRect && footRect.bottom <= window.innerHeight + 1 && footRect.right <= window.innerWidth + 1,
      dialogFits: element.getBoundingClientRect().width <= window.innerWidth && element.getBoundingClientRect().height <= window.innerHeight,
      grid: grid ? {
        clientHeight: grid.clientHeight,
        scrollHeight: grid.scrollHeight,
        overflowY: getComputedStyle(grid).overflowY,
        columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
        // The standalone bundle has no tailwind preflight, so a content-box grid may exceed max-height by its padding.
        maxHeight: parseFloat(getComputedStyle(grid).maxHeight),
        heightLimit: parseFloat(getComputedStyle(grid).maxHeight)
          + (getComputedStyle(grid).boxSizing === 'content-box' ? parseFloat(getComputedStyle(grid).paddingTop) + parseFloat(getComputedStyle(grid).paddingBottom) : 0),
      } : null,
    }
  })
}

const steps = []
async function step(name, run) {
  const started = Date.now()
  await run()
  steps.push(`${name} (${Date.now() - started}ms)`)
}

try {
  // A. 没有可继承的作品时，不出现任何继承入口，提交内容也不带继承字段。
  await step('A 无可继承作品：入口隐藏', async () => {
    const { page, dialog } = await openPage(null)
    const t = toolkit(page, dialog)
    assert.equal(await t.section.count(), 0)
    await dialog.getByPlaceholder('请输入作品名称').fill('无继承入口')
    await t.submit()
    const created = await t.created()
    assert.equal(created.creationMode, 'canvas')
    assert.ok(!('inheritSourceProjectId' in created) && !('inheritMaterialIds' in created))
    await page.close()
  })

  // B. 当前项目还没有作品时：“上一个作品”不可用，“指定作品”仍可用。
  await step('B 当前项目没有上一个作品', async () => {
    const works = [work('work-empty', '空项目', []), WORKS[1]]
    const { page, dialog } = await openPage({ currentWorkId: 'work-empty', works })
    const t = toolkit(page, dialog)
    await t.section.waitFor()
    assert.equal(await t.mode('上一个作品').isDisabled(), true)
    assert.equal(await t.mode('上一个作品').getAttribute('title'), '当前项目还没有可继承的作品')
    await t.mode('指定作品').click()
    assert.equal(await t.mode('指定作品').getAttribute('aria-checked'), 'true')
    await page.close()
  })

  const { page, dialog } = await openPage({ currentWorkId: 'work-current', works: WORKS })
  const t = toolkit(page, dialog)
  const name = dialog.getByPlaceholder('请输入作品名称')

  await step('C 默认不继承', async () => {
    await t.section.waitFor()
    assert.equal(await t.mode('不继承').getAttribute('aria-checked'), 'true')
    assert.equal(await t.mode('上一个作品').getAttribute('aria-checked'), 'false')
    assert.equal(await t.mode('指定作品').getAttribute('aria-checked'), 'false')
    assert.equal(await t.mode('上一个作品').isEnabled(), true)
    assert.equal(await t.picker.count(), 0)
    assert.equal(await dialog.locator('.create-project-inherit-note').count(), 0)
    assert.equal(materialRequests.length, 0, '不继承时不得读取任何作品资产')
    await page.screenshot({ path: path.join(artifacts, '01-default.png') })
    await name.fill('不继承验证')
    await t.submit()
    assert.equal(await t.calls(), 1)
    const created = await t.created()
    assert.ok(!('inheritSourceProjectId' in created) && !('inheritMaterialIds' in created))
  })

  await step('D 上一个作品：读取、过滤和来源标记', async () => {
    await t.mode('上一个作品').click()
    const previous = dialog.getByTestId('inherit-previous')
    await previous.waitFor()
    assert.match(flat(await previous.innerText()), /^上一个作品 第一季 \/ 第二集/)
    await t.picker.waitFor()
    assert.deepEqual(materialRequests.at(-1), { projectId: 'p-ep2', scope: 'project', limit: '500', sync: '1' })
    assert.equal(await t.tiles.count(), 6, '处理中、已删除和个人素材不得出现')
    assert.deepEqual((await t.titles()).sort(), ['主角-林夏', '雨夜街景', '开场镜头', '品牌 Logo', '配乐-主题曲', '场景-旧公寓'].sort())
    assert.equal(await t.countText(), '已选 6 / 6 项')
    assert.equal(await t.checked.count(), 6)
    assert.equal(await t.selectAll.isDisabled(), true)
    for (const [label, expected] of [['全部', 6], ['生成', 3], ['上传', 2], ['继承', 1]]) {
      assert.match(flat(await t.origin(label).innerText()), new RegExp(`^${label} ?${expected}$`))
    }
    const origins = await t.tiles.evaluateAll((nodes) => nodes.map((node) => [node.querySelector('.create-project-inherit-name')?.textContent, node.getAttribute('data-origin')]))
    assert.deepEqual(Object.fromEntries(origins), {
      '主角-林夏': 'generated', '雨夜街景': 'generated', '开场镜头': 'generated',
      '品牌 Logo': 'uploaded', '配乐-主题曲': 'uploaded', '场景-旧公寓': 'inherited',
    })
    const inheritedTile = dialog.getByRole('checkbox', { name: /场景-旧公寓/ })
    assert.match(await inheritedTile.getAttribute('aria-label'), /继承自「第一集」/)
    assert.equal(flat(await inheritedTile.locator('.create-project-inherit-origin').innerText()), '继承')

    const palette = await dialog.evaluate((element) => Object.fromEntries(['generated', 'uploaded', 'inherited'].map((kind) => {
      const style = getComputedStyle(element.querySelector(`.create-project-inherit-origin.is-${kind}`))
      return [kind, [style.backgroundColor, style.color, style.backgroundImage]]
    })))
    assert.deepEqual(palette, {
      generated: ['rgb(42, 47, 99)', 'rgb(163, 172, 255)', 'none'],
      uploaded: ['rgb(43, 43, 52)', 'rgb(212, 212, 220)', 'none'],
      inherited: ['rgb(18, 58, 54)', 'rgb(94, 234, 212)', 'none'],
    })
    const metrics = await layoutMetrics(dialog)
    assert.equal(metrics.bodyOverflowsX, false)
    assert.equal(metrics.sectionInsideBody, true)
    assert.equal(metrics.sectionOverflowers, 0)
    assert.equal(metrics.footVisible, true)
    assert.equal(metrics.dialogFits, true)
    await page.screenshot({ path: path.join(artifacts, '02-previous-all-selected.png') })
  })

  await step('E 来源筛选、清空当前列表、搜索与键盘', async () => {
    await t.origin('继承').click()
    assert.deepEqual(await t.titles(), ['场景-旧公寓'])
    await t.origin('生成').click()
    assert.equal(await t.tiles.count(), 3)
    await t.origin('上传').click()
    assert.equal(await t.tiles.count(), 2)
    await t.clearAll.click()
    assert.equal(await t.countText(), '已选 4 / 6 项')
    assert.equal(await t.checked.count(), 0, '清空只作用于当前筛选出的两项')
    assert.equal(await t.clearAll.isDisabled(), true)
    assert.equal(await t.selectAll.isEnabled(), true)
    await t.origin('全部').click()
    assert.equal(await t.tiles.count(), 6)
    assert.equal(await t.checked.count(), 4, '隐藏的已选项保持选中')

    await t.search.fill('街景')
    assert.deepEqual(await t.titles(), ['雨夜街景'])
    await t.search.press('Enter')
    assert.equal(await t.calls(), 1, '搜索框回车不得提交弹窗')
    assert.equal(await t.dialogError.count(), 0)
    await t.search.fill('zzzz')
    assert.equal(await t.tiles.count(), 0)
    assert.equal(flat(await dialog.locator('.create-project-inherit-empty').innerText()), '没有符合条件的资产')
    assert.equal(await t.selectAll.isDisabled(), true)
    assert.equal(await t.clearAll.isDisabled(), true)
    await t.search.fill('Logo')
    assert.deepEqual(await t.titles(), ['品牌 Logo'])
    await t.search.fill('')
    assert.equal(await t.tiles.count(), 6)

    const logo = dialog.getByRole('checkbox', { name: /品牌 Logo/ })
    assert.equal(await logo.getAttribute('aria-checked'), 'false')
    await logo.focus()
    await page.keyboard.press('Space')
    assert.equal(await logo.getAttribute('aria-checked'), 'true')
    assert.equal(await t.countText(), '已选 5 / 6 项')
    await logo.click()
    assert.equal(await logo.getAttribute('aria-checked'), 'false')
    assert.equal(await t.countText(), '已选 4 / 6 项')
  })

  await step('F 提交上一个作品的已选资产', async () => {
    await t.submit()
    assert.equal(await t.calls(), 2)
    const created = await t.created()
    assert.equal(created.creationMode, 'canvas')
    assert.equal(created.inheritSourceProjectId, 'p-ep2')
    assert.deepEqual([...created.inheritMaterialIds].sort(), ['g1', 'g2', 'g3', 'i1'])
    assert.equal(new Set(created.inheritMaterialIds).size, created.inheritMaterialIds.length)
  })

  await step('G 指定作品：未选择时拦截并提示', async () => {
    await t.mode('指定作品').click()
    assert.equal(await t.sourceSelect.count(), 1)
    assert.equal(flat(await dialog.locator('.create-project-inherit-empty').innerText()), '选择作品后，可勾选要继承的资产。')
    assert.equal(await t.picker.count(), 0)
    await t.submit()
    assert.equal(flat(await t.dialogError.innerText()), '请选择要继承资产的作品。')
    assert.equal(await t.calls(), 2, '拦截后不得调用创建')
  })

  await step('H 指定作品：搜索、同名区分与分页读取', async () => {
    await t.sourceSelect.click()
    const search = dialog.getByRole('textbox', { name: '选择要继承资产的作品' })
    await search.fill('番外')
    const labels = await dialog.getByRole('option').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''))
    assert.equal(labels.length, 2)
    assert.notEqual(labels[0], labels[1], '同名作品必须能区分')
    for (const label of labels) assert.match(label, /^另一个项目 \/ 番外 · /)
    await search.fill('不存在的作品')
    assert.equal(flat(await dialog.locator('.fa-select-empty').innerText()), '没有匹配“不存在的作品”的选项')
    await search.fill('')
    const all = await dialog.getByRole('option').evaluateAll((nodes) => nodes.map((node) => node.textContent?.trim() ?? ''))
    assert.equal(all[0], '第一季 / 第二集', '目标项目自己的作品排在最前')
    assert.equal(all[1], '第一季 / 第一集')
    assert.equal(all[2], '另一个项目 / 城市篇')

    const before = materialRequests.length
    await dialog.getByRole('option', { name: '第一季 / 第一集', exact: true }).click()
    await dialog.getByRole('checkbox', { name: /第一集-配音C/ }).waitFor()
    assert.equal(await t.tiles.count(), 3, '两页资产必须合并')
    assert.equal(await t.countText(), '已选 3 / 3 项')
    assert.equal(await t.dialogError.count(), 0, '选好作品后，旧的“请选择作品”提示应消失')
    const requests = materialRequests.slice(before)
    assert.equal(requests.length, 2)
    assert.deepEqual(requests[0], { projectId: 'p-ep1', scope: 'project', limit: '500', sync: '1' })
    assert.deepEqual(requests[1], { projectId: 'p-ep1', scope: 'project', limit: '500', cursor: 'c1' })
  })

  await step('I 超过 200 项：默认只选前 200，上限拦截', async () => {
    await t.sourceSelect.click()
    await dialog.getByRole('textbox', { name: '选择要继承资产的作品' }).fill('城市')
    assert.equal(await dialog.getByRole('option').count(), 1)
    await dialog.getByRole('option', { name: '另一个项目 / 城市篇', exact: true }).click()
    await dialog.getByRole('checkbox', { name: /城-230/ }).waitFor()
    assert.equal(await t.tiles.count(), 230)
    assert.equal(await t.countText(), '已选 200 / 230 项 · 一次最多继承 200 项')
    assert.equal(await t.checked.count(), 200)
    assert.equal(await t.blocked.count(), 30)
    assert.equal(await t.selectAll.isDisabled(), true)
    const last = dialog.getByRole('checkbox', { name: /城-230/ })
    assert.equal(await last.getAttribute('aria-checked'), 'false')
    assert.equal(await last.getAttribute('title'), '一次最多继承 200 项资产')
    await last.click({ force: true })
    assert.equal(await t.checked.count(), 200, '达到上限后不能再多选')

    await dialog.getByRole('checkbox', { name: /城-010/ }).click()
    assert.equal(await t.countText(), '已选 199 / 230 项 · 一次最多继承 200 项')
    assert.equal(await t.blocked.count(), 0)
    await last.click()
    assert.equal(await t.checked.count(), 200)
    assert.equal(await t.blocked.count(), 30)
    await dialog.getByRole('checkbox', { name: /城-230/ }).click()
    assert.equal(await t.checked.count(), 199)

    const metrics = await layoutMetrics(dialog)
    assert.ok(metrics.grid, '230 项需要渲染资产网格')
    assert.equal(metrics.grid.overflowY, 'auto')
    assert.equal(metrics.grid.maxHeight, 320, '资产网格最大高度应为 320px')
    assert.ok(metrics.grid.clientHeight <= metrics.grid.heightLimit, `资产网格高度超出上限，实际 ${metrics.grid.clientHeight}`)
    assert.ok(metrics.grid.scrollHeight > metrics.grid.clientHeight, '网格应在内部滚动')
    assert.equal(metrics.bodyOverflowsX, false)
    assert.equal(metrics.footVisible, true)
    const gradients = await t.section.evaluate((rootElement) => [rootElement, ...rootElement.querySelectorAll('*')]
      .filter((element) => {
        const style = getComputedStyle(element)
        return style.backgroundImage !== 'none' || /gradient/i.test(style.borderImageSource)
      })
      .map((element) => element.className))
    assert.deepEqual(gradients, [], '继承区域不得使用渐变背景')
    await page.screenshot({ path: path.join(artifacts, '03-city-cap.png') })

    await t.clearAll.click()
    assert.equal(await t.countText(), '已选 0 / 230 项 · 一次最多继承 200 项')
    await t.submit()
    assert.equal(flat(await t.dialogError.innerText()), '请至少选择一项要继承的资产，或选择“不继承”。')
    assert.equal(await t.calls(), 2)
    await t.selectAll.click()
    assert.equal(await t.checked.count(), 200)
    assert.equal(await t.dialogError.count(), 0, '重新选择后，“请至少选择”提示应消失')
    await t.submit()
    assert.equal(await t.calls(), 3)
    const created = await t.created()
    assert.equal(created.inheritSourceProjectId, 'p-city')
    assert.equal(created.inheritMaterialIds.length, 200)
    assert.equal(new Set(created.inheritMaterialIds).size, 200)
    assert.deepEqual(created.inheritMaterialIds.slice(0, 2), ['city-001', 'city-002'])
  })

  await step('J 窄屏不溢出', async () => {
    await page.setViewportSize({ width: 390, height: 780 })
    await page.waitForTimeout(100)
    const metrics = await layoutMetrics(dialog)
    assert.equal(metrics.sectionInsideBody, true)
    assert.equal(metrics.sectionOverflowers, 0, '继承区域内不得有元素超出弹窗内容区')
    assert.equal(metrics.footVisible, true)
    assert.equal(metrics.dialogFits, true)
    assert.ok(metrics.grid && metrics.grid.columns >= 2, `窄屏资产网格至少两列，实际 ${metrics.grid?.columns}`)
    await page.screenshot({ path: path.join(artifacts, '04-narrow.png') })
    await page.setViewportSize({ width: 1402, height: 970 })
  })

  await step('K 读取失败：提示、拦截、重试恢复', async () => {
    await t.sourceSelect.click()
    await dialog.getByRole('textbox', { name: '选择要继承资产的作品' }).fill('读取失败')
    await dialog.getByRole('option', { name: '另一个项目 / 读取失败', exact: true }).click()
    const alert = dialog.locator('.create-project-inherit-empty.is-error')
    await alert.waitFor()
    assert.match(flat(await alert.innerText()), /^读取作品资产失败：.+重试$/)
    assert.equal(await t.picker.count(), 0)
    await t.submit()
    assert.equal(flat(await t.dialogError.innerText()), '无法读取要继承的资产，请重试，或选择“不继承”。')
    assert.equal(await t.calls(), 3)
    await page.screenshot({ path: path.join(artifacts, '05-error.png') })
    await alert.getByRole('button', { name: '重试', exact: true }).click()
    await dialog.getByRole('checkbox', { name: /恢复后素材一/ }).waitFor()
    assert.equal(await t.tiles.count(), 2)
    assert.equal(await t.countText(), '已选 2 / 2 项')
    assert.equal(await alert.count(), 0)
    assert.equal(errorAttempts.count, 2)
    assert.equal(await t.dialogError.count(), 0, '重试成功后，旧的读取失败提示应消失')
  })

  await step('L 读取中：状态提示并拦截提交', async () => {
    await t.sourceSelect.click()
    await dialog.getByRole('textbox', { name: '选择要继承资产的作品' }).fill('慢速')
    await dialog.getByRole('option', { name: '另一个项目 / 慢速作品', exact: true }).click()
    const status = dialog.locator('.create-project-inherit-empty[role="status"]')
    await status.waitFor()
    assert.match(flat(await status.innerText()), /正在读取作品资产…/)
    await t.submit()
    assert.equal(flat(await t.dialogError.innerText()), '正在读取要继承的资产，请稍候。')
    assert.equal(await t.calls(), 3)
    await page.screenshot({ path: path.join(artifacts, '06-loading.png') })
    releaseSlow()
    await dialog.getByRole('checkbox', { name: /慢速素材/ }).waitFor()
    assert.equal(await t.countText(), '已选 1 / 1 项')
    assert.equal(await t.dialogError.count(), 0, '读取完成后，旧的“请稍候”提示应消失')
  })

  await step('M 没有可继承资产的作品', async () => {
    await t.sourceSelect.click()
    await dialog.getByRole('textbox', { name: '选择要继承资产的作品' }).fill('空作品')
    await dialog.getByRole('option', { name: '另一个项目 / 空作品', exact: true }).click()
    const empty = dialog.locator('.create-project-inherit-empty:not([role="status"])')
    await empty.waitFor()
    assert.equal(flat(await empty.innerText()), '该作品还没有可继承的资产，仅已完成的共享素材可以继承。')
    await t.submit()
    assert.equal(flat(await t.dialogError.innerText()), '请至少选择一项要继承的资产，或选择“不继承”。')
    assert.equal(await t.calls(), 3)
  })

  await step('N 切换来源不带入旧选择；回到不继承后不再提交继承字段', async () => {
    await t.mode('上一个作品').click()
    await t.picker.waitFor()
    assert.equal(await t.countText(), '已选 6 / 6 项', '已选择过其他作品，回到上一个作品应恢复默认全选')
    await t.mode('不继承').click()
    assert.equal(await t.picker.count(), 0)
    await t.submit()
    assert.equal(await t.calls(), 4)
    const created = await t.created()
    assert.ok(!('inheritSourceProjectId' in created) && !('inheritMaterialIds' in created))
  })

  await step('O 工作流模式隐藏继承入口且不提交继承字段', async () => {
    await t.mode('上一个作品').click()
    await t.picker.waitFor()
    await dialog.getByRole('radio', { name: '工作流', exact: true }).click()
    await dialog.locator('.create-project-workflow-settings').waitFor()
    assert.equal(await t.section.count(), 0)
    await dialog.getByRole('tab', { name: '空白作品', exact: true }).click()
    await dialog.locator('button[type="submit"]').click()
    assert.equal(await t.calls(), 5)
    const created = await t.created()
    assert.equal(created.creationMode, 'workflow')
    assert.ok(!('inheritSourceProjectId' in created) && !('inheritMaterialIds' in created))
    await dialog.getByRole('radio', { name: '画布', exact: true }).click()
    await t.section.waitFor()
    assert.equal(await t.mode('上一个作品').getAttribute('aria-checked'), 'true')
    assert.equal(await t.countText(), '已选 6 / 6 项')
  })

  await page.close()
  assert.deepEqual(pageErrors, [], '页面不得抛出脚本错误')
  assert.deepEqual(consoleErrors, [], '控制台不得出现错误或 React 警告')
  assert.deepEqual(forbidden, [], '验证期间不得访问外部地址或创建作品接口')

  console.log(JSON.stringify({ ok: true, steps, materialRequests: materialRequests.length, artifacts }, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
