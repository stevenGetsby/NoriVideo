// Real three-layer interactive story UI (剧情画布 / 作品画布 / 制作画布) in
// headless Chromium. Story APIs are mocked locally: no generation, no paid
// calls and no production data changes.
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { createServer } from 'node:http'
import path from 'node:path'
import { mkdir } from 'node:fs/promises'

const root = process.cwd()
const artifacts = path.join(root, 'test-results/interactive-layers')
await mkdir(artifacts, { recursive: true })
const tools = createRequire(path.join(process.env.NORI_BROWSER_TOOLS_DIR || root, 'package.json'))
const { chromium } = tools('playwright-core')

const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/interactive-layers.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-intl': path.join(root, 'tests/browser/stubs/next-intl.ts'),
    'next/image': path.join(root, 'tests/browser/stubs/next-image.tsx'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).contents

const server = createServer((request, response) => {
  const pathname = new URL(request.url, 'http://127.0.0.1').pathname
  if (pathname === '/fixture.js') {
    response.setHeader('Content-Type', 'text/javascript')
    response.end(script)
  } else if (pathname === '/fixture.css') {
    response.setHeader('Content-Type', 'text/css')
    response.end(css)
  } else {
    response.setHeader('Content-Type', 'text/html')
    response.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>html,body,#root{height:100%;margin:0;background:#0d0f14;color:#f4f4f5;font-family:system-ui,sans-serif}</style>
<link rel="stylesheet" href="/fixture.css"><div id="root"></div><script src="/fixture.js"></script></html>`)
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}`

const poster = 'data:image/svg+xml,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="#3b5b7a"/><text x="24" y="96" fill="#fff" font-size="24">城头</text></svg>')
const chapters = [
  {
    projectId: 'p1', name: '第一章', canvasId: 'c1', nodeCount: 4, runningCount: 0, updatedAt: '2026-11-08T00:00:00.000Z',
    graph: {
      projectId: 'p1', title: '第一章',
      nodes: [
        { id: 'in1', kind: 'entry', title: '开场' },
        { id: 's1', kind: 'scene', title: '城头', lines: '敌军压境。', effects: [], media: { kind: 'image', url: poster, posterUrl: null } },
        { id: 's2', kind: 'scene', title: '冲阵', lines: '出城迎战。', effects: [], media: null },
        { id: 'e1', kind: 'exit', title: '离开' },
      ],
      flows: [
        { id: 'f1', from: 'in1', handle: 'output', to: 's1' },
        { id: 'f2', from: 's1', handle: 'output', to: 'e1' },
      ],
    },
  },
  {
    projectId: 'p2', name: '第二章', canvasId: 'c2', nodeCount: 4, runningCount: 0, updatedAt: '2026-11-08T00:00:00.000Z',
    graph: {
      projectId: 'p2', title: '第二章',
      nodes: [
        { id: 'in2', kind: 'entry', title: '凯旋' },
        { id: 's3', kind: 'scene', title: '凯旋', lines: '城门大开。', effects: [], media: null },
        { id: 's4', kind: 'scene', title: '流亡', lines: '孤城落日。', effects: [], media: null },
        { id: 'end', kind: 'ending', title: '终', endingType: 'normal', description: '' },
      ],
      flows: [
        { id: 'g1', from: 'in2', handle: 'output', to: 's3' },
        { id: 'g2', from: 's3', handle: 'output', to: 'end' },
      ],
    },
  },
]

let sequence = [
  { id: 'seg-s1', projectId: 'p1', sceneNodeId: 's1', title: '城头', branch: false, removed: false },
  { id: 'seg-s3', projectId: 'p2', sceneNodeId: 's3', title: '凯旋', branch: false, removed: false },
  { id: 'seg-lost', projectId: 'p2', sceneNodeId: 'gone', title: '已删除片段', branch: false, removed: false },
]

function overview() {
  return {
    story: {
      workId: 'work-1', name: '长安夜行', aspectRatio: '16:9', resolution: '1080p',
      canManage: true, canCreateChapters: true,
      config: {
        version: 1, variables: [],
        chapters: [
          { projectId: 'p1', order: 0, position: { x: 0, y: 0 }, status: 'drafting' },
          { projectId: 'p2', order: 1, position: { x: 340, y: 0 }, status: 'review' },
        ],
        links: [{ id: 'l1', fromProjectId: 'p1', exitNodeId: 'e1', toProjectId: 'p2', toEntryNodeId: 'in2' }],
        start: { projectId: 'p1', entryNodeId: 'in1' },
        sequence: { segments: sequence },
      },
    },
    chapters,
  }
}

const json = (route, payload, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(payload) })

const patches = []
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.NORI_CHROME_EXECUTABLE || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'],
})
const page = await browser.newPage({ viewport: { width: 1440, height: 960 } })
const errors = []
page.on('pageerror', (error) => errors.push(error.message))

await page.route('**/*', async (route) => {
  const url = new URL(route.request().url())
  if (!url.pathname.startsWith('/api/')) return route.continue()
  if (url.pathname === '/api/interactive/work-1') {
    if (route.request().method() === 'PATCH') {
      const body = route.request().postDataJSON()
      patches.push(body)
      if (body?.config?.sequence?.segments) sequence = body.config.sequence.segments
    }
    return json(route, overview())
  }
  if (url.pathname === '/api/user/balance') return json(route, { balancePoints: 1000, generationAllowed: true })
  if (url.pathname === '/api/collaboration/assignments/counts') return json(route, { data: { counts: { todo: 0, pendingReview: 0 } } })
  return json(route, {})
})

async function until(check, message, timeout = 6000) {
  const started = Date.now()
  while (Date.now() - started < timeout) {
    if (await check()) return
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  throw new Error(message)
}
const cutTitles = () => page.locator('[data-testid="linear-segment"] .nori-ix-seg-info strong').allTextContents()
const activeLayer = () => page.locator('[data-testid="story-layer-nav"] [aria-current="page"]').getAttribute('data-layer')

try {
  await page.goto(`${base}/interactive/work-1/works`)
  await page.waitForSelector('[data-testid="linear-cut"]')

  // Three-layer navigation exposes every layer and marks the current one.
  await page.waitForSelector('[data-testid="story-layer-nav"]')
  assert.deepEqual(
    await page.locator('[data-testid="story-layer-nav"] a').evaluateAll((links) => links.map((link) => [link.getAttribute('data-layer'), link.getAttribute('href')])),
    [
      ['story', '/interactive/work-1'],
      ['works', '/interactive/work-1/works'],
      ['production', '/interactive/work-1/production'],
    ],
  )
  assert.equal(await activeLayer(), 'works')

  // Old configs only store chapter order: migration derives the two linear
  // scenes while keeping branch scenes out of the cut.
  assert.deepEqual(await cutTitles(), ['城头', '凯旋'])
  assert.equal(await page.locator('[data-testid="branch-segment"]').count(), 2)
  assert.deepEqual(await page.locator('[data-testid="branch-segment"] strong').allTextContents(), ['冲阵', '流亡'])
  assert.equal(await page.locator('[data-testid="orphan-segment"]').count(), 1)

  // Orphan cleanup is a two-step confirmation and never a silent drop.
  const orphan = page.locator('[data-testid="orphan-segment"]')
  await orphan.getByRole('button', { name: '移除引用' }).click()
  assert.equal(patches.length, 0)
  await orphan.getByRole('button', { name: '确认移除' }).click()
  await until(() => patches.length === 1, 'orphan removal never reached the API')
  assert.equal(patches[0].config.sequence.segments.some((segment) => segment.id === 'seg-lost'), false)
  await page.waitForSelector('[data-testid="orphan-segment"]', { state: 'detached' })

  // Reordering only the linear cut, leaving branch slots in place.
  await page.locator('[data-testid="linear-segment"]').first().getByRole('button', { name: '下移 城头' }).click()
  await until(() => patches.length === 2, 'reorder never reached the API')
  const ordered = patches[1].config.sequence.segments.filter((segment) => ['s1', 's3'].includes(segment.sceneNodeId))
  assert.deepEqual(ordered.map((segment) => segment.sceneNodeId), ['s3', 's1'])
  await until(async () => (await cutTitles())[0] === '凯旋', 'the linear list did not follow the saved order')

  // Removal is recoverable and the removed tray restores the same slot.
  await page.locator('[data-testid="linear-segment"]').first().getByRole('button', { name: '移除', exact: true }).click()
  await until(() => patches.length === 3, 'removal never reached the API')
  assert.equal(patches[2].config.sequence.segments.find((segment) => segment.id === 'seg-s3').removed, true)
  await page.waitForSelector('[data-testid="removed-segment"]')
  await page.locator('[data-testid="removed-segment"]').getByRole('button', { name: '恢复到成片' }).click()
  await until(() => patches.length === 4, 'restore never reached the API')
  assert.equal(patches[3].config.sequence.segments.find((segment) => segment.id === 'seg-s3').removed, false)
  await page.waitForSelector('[data-testid="removed-segment"]', { state: 'detached' })
  assert.deepEqual(await cutTitles(), ['凯旋', '城头'])

  // Preview plays only the linear cut from existing media; branches stay out.
  await page.getByRole('button', { name: '预览成片' }).click()
  const preview = page.locator('[data-testid="sequence-preview"]')
  await preview.waitFor()
  assert.equal(await preview.locator('.nori-seq-list button').count(), 2)
  assert.deepEqual(await preview.locator('.nori-seq-list button strong').allTextContents(), ['凯旋', '城头'])
  const previewText = await preview.textContent()
  assert.ok(!previewText.includes('冲阵'), 'branch scene leaked into the linear preview')
  assert.ok(previewText.includes('不会混入线性成片'))
  assert.ok(previewText.includes('不拼接、不导出'))
  await preview.getByRole('button', { name: '跳过' }).click()
  await preview.getByRole('button', { name: '下一段' }).click()
  await preview.getByText('预览结束').waitFor()
  assert.ok((await preview.textContent()).includes('共 2 段线性片段'))
  await preview.getByRole('button', { name: '关闭预览' }).click()
  await preview.waitFor({ state: 'detached' })

  // Production layer drills into the existing canvas of each chapter.
  await Promise.all([
    page.waitForURL(/\/interactive\/work-1\/production$/),
    page.locator('[data-testid="story-layer-nav"] [data-layer="production"]').click(),
  ])
  await page.waitForSelector('[data-testid="production-chapter"]')
  assert.equal(await activeLayer(), 'production')
  assert.equal(await page.locator('[data-testid="production-chapter"]').count(), 2)
  assert.equal(await page.locator('[data-testid="production-chapter"][data-project-id="p1"] [data-testid="production-segment"]').count(), 2)
  assert.equal(await page.locator('[data-testid="production-chapter"][data-project-id="p2"] [data-testid="production-segment"]').count(), 2)
  assert.equal(await page.locator('[data-testid="production-chapter"][data-project-id="p1"] a[href="/canvas/p1/c1"]').count() >= 1, true)
  assert.equal(await page.locator('[data-testid="production-chapter"][data-project-id="p2"] a[href="/canvas/p2/c2"]').count() >= 1, true)
  assert.ok((await page.textContent('body')).includes('不另造生成引擎'))
  assert.equal(await page.locator('.nori-ix-prod-warning').count(), 0)

  // Story layer shows both chapter maps and the same derived segment counts.
  await Promise.all([
    page.waitForURL(/\/interactive\/work-1$/),
    page.locator('[data-testid="story-layer-nav"] [data-layer="story"]').click(),
  ])
  await page.waitForSelector('.nori-ix-chapter')
  assert.equal(await activeLayer(), 'story')
  assert.equal(await page.locator('.nori-ix-chapter').count(), 2)
  const storyText = await page.textContent('body')
  assert.ok(storyText.includes('作品片段'))
  assert.ok(storyText.includes('支线片段'))

  const gradientElements = await page.locator('body *').evaluateAll((elements) => elements.flatMap((element) => {
    const style = getComputedStyle(element)
    return ['backgroundImage', 'maskImage'].some((property) => style[property].includes('gradient('))
      ? [element.className || element.tagName]
      : []
  }))
  assert.deepEqual(gradientElements, [], 'The three-layer story UI must not render decorative gradients')
  await page.screenshot({ path: path.join(artifacts, 'story-layer-solid-ui.png'), fullPage: true })
  await page.locator('[data-testid="story-layer-nav"] [data-layer="works"]').click()
  await page.waitForSelector('[data-testid="linear-cut"]')
  await page.screenshot({ path: path.join(artifacts, 'works-layer-solid-ui.png'), fullPage: true })
  await page.locator('[data-testid="story-layer-nav"] [data-layer="production"]').click()
  await page.waitForSelector('[data-testid="production-chapter"]')
  await page.screenshot({ path: path.join(artifacts, 'production-layer-solid-ui.png'), fullPage: true })

  assert.deepEqual(errors, [])
  console.log('[interactive-layers] three-layer navigation, migration, reorder, preview, recovery, orphan prompt and drilldown passed')
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
