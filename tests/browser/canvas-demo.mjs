// Local interactive demo for the canvas generator + @ mention menu.
// Everything runs against in-memory mocks: no server, no paid calls.
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const root = process.cwd()
const operations = await import(pathToFileURL(path.join(root, 'src/lib/canvas/operations.ts')).href)
const { validateCanvasOperationsSaveInput } = operations.default || operations
const documentContract = await import(pathToFileURL(path.join(root, 'src/lib/canvas/document.ts')).href)
const { validateCanvasDocumentSaveInput } = documentContract.default || documentContract
const appCss = await readFile(path.join(root, 'src/app/globals.css'), 'utf8')
const bundle = await (await import('esbuild')).build({
  entryPoints: ['tests/browser/canvas-ui-regression.fixture.tsx'], bundle: true, write: false,
  outdir: '/fixture', jsx: 'automatic', platform: 'browser',
  alias: {
    '@': path.join(root, 'src'),
    '@/i18n/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
    'next-auth/react': path.join(root, 'tests/browser/stubs/next-auth-react.ts'),
    'next/navigation': path.join(root, 'tests/browser/stubs/navigation.tsx'),
  },
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
})
const script = bundle.outputFiles.find((file) => file.path.endsWith('.js')).contents
const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).contents

const model = {
  modelKey: 'kuaizi::doubao-seedance-2-5-260628', name: 'doubao-seedance-2-5-260628', provider: 'kuaizi', configured: true, available: true,
  supportGenerateAudio: true, firstLastFrame: true,
  options: { duration: [4, 5, 6, 8, 10], resolution: ['480p', '720p', '1080p'], aspectRatio: ['16:9', '9:16', '1:1', '4:3', '21:9'] },
  inputSchema: { image: { min: 0, max: 30 }, video: { min: 0, max: 10 }, audio: { min: 0, max: 10 }, requiredFields: ['prompt'] },
}
const swatch = (color, label) => 'data:image/svg+xml,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="180"><rect width="320" height="180" fill="${color}"/><text x="160" y="98" text-anchor="middle" font-family="sans-serif" font-size="26" fill="rgba(255,255,255,.85)">${label}</text></svg>`,
)
const reference = swatch('#36517d', '参考')
const canvas = { id: 'canvas-1', projectId: 'project-1', title: '演示画布', revision: 0, viewport: { x: 0, y: 0, zoom: 1 }, themeColor: null, visibility: 'workspace', forkedFromId: null, createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z' }
const common = { canvasId: 'canvas-1', runId: null, mediaObjectId: null, parentNodeId: null }
const libraryMaterials = [
  { id: 'library-character', title: '林夏', type: 'image', isFavorited: true, url: swatch('#7d3651', '林夏'), metadata: { assetCategory: 'character' } },
  { id: 'library-character-2', title: '马俊', type: 'image', isFavorited: true, url: swatch('#51487d', '马俊'), metadata: { assetCategory: 'character' } },
  { id: 'library-location', title: '雨夜街巷', type: 'image', isFavorited: false, url: swatch('#2f5d50', '雨夜街巷'), metadata: { assetCategory: 'location' } },
  { id: 'library-location-2', title: '山顶日出', type: 'image', isFavorited: false, url: swatch('#8a5a2b', '山顶日出'), metadata: { assetCategory: 'location' } },
  { id: 'library-prop', title: '桂芳足力健', type: 'image', isFavorited: true, url: swatch('#8a2b2b', '足力健'), metadata: { assetCategory: 'prop' } },
  { id: 'library-prop-2', title: '油纸伞', type: 'image', isFavorited: false, url: swatch('#5d6b2f', '油纸伞'), metadata: { assetCategory: 'prop' } },
  { id: 'library-shot', title: '开场分镜', type: 'image', isFavorited: false, url: swatch('#31566e', '开场分镜'), metadata: { assetCategory: 'shot' } },
  { id: 'library-audio', title: '环境雨声', type: 'audio', isFavorited: false, url: null, metadata: { assetCategory: 'other' } },
  { id: 'library-audio-2', title: '紧张配乐', type: 'audio', isFavorited: false, url: null, metadata: { assetCategory: 'other' } },
  { id: 'library-text', title: '世界观设定', type: 'text', isFavorited: false, url: null, metadata: { assetCategory: 'other' } },
  { id: 'library-video', title: '预告片素材', type: 'video', isFavorited: false, url: null, metadata: { assetCategory: 'shot' } },
].map((material) => ({
  projectId: 'project-1', projectName: '演示项目', ownerName: null, source: 'upload', status: 'ready',
  resultUrl: material.url, storageKey: null, createdAt: '2026-10-08', updatedAt: '2026-10-08', ...material,
}))

let graph = {
  canvas,
  edges: [
    { id: 'edge-wired', canvasId: 'canvas-1', sourceNodeId: 'ref-1', targetNodeId: 'gen-1', sourceHandle: 'output', targetHandle: 'input', role: 'INPUT_DEFAULT' },
    { id: 'edge-secondary', canvasId: 'canvas-1', sourceNodeId: 'ref-2', targetNodeId: 'ref-1', sourceHandle: 'output', targetHandle: 'input', role: 'INPUT_DEFAULT' },
  ],
  nodes: [
    { ...common, id: 'gen-1', type: 'video', position: { x: 560, y: 170 }, size: { width: 320, height: 180 }, status: 'IDLE', taskId: null, data: { title: '视频生成节点', mediaType: 'video', prompt: '', origin: 'empty', generation: { modelKey: model.modelKey }, history: [] } },
    { ...common, id: 'ref-1', type: 'image', position: { x: 60, y: 60 }, size: { width: 320, height: 180 }, status: 'IDLE', taskId: null, data: { title: '参考素材1', mediaType: 'image', origin: 'upload', contentUrl: reference, imageUrl: reference, materialId: 'material-1' } },
    { ...common, id: 'ref-2', type: 'image', position: { x: 60, y: 330 }, size: { width: 320, height: 180 }, status: 'IDLE', taskId: null, data: { title: '参考素材2', mediaType: 'image', origin: 'upload', contentUrl: swatch('#6e5136', '参考2'), imageUrl: swatch('#6e5136', '参考2'), materialId: 'material-2' } },
  ],
}

function handleApi(url, method, body) {
  if (url.pathname.endsWith('/generation-config')) return { textModels: [], imageModels: [], videoModels: [model], audioModels: [], model3dModels: [], defaults: { videoModel: model.modelKey, aspectRatio: '16:9', resolution: '720p' } }
  if (url.pathname === '/api/interactive') return { story: null }
  if (url.pathname.endsWith('/generate') && method === 'POST') return { status: 400, payload: { message: '演示模式：生成已停用，不会产生真实任务' } }
  if (url.pathname === '/api/projects/project-1') return { work: { id: 'project-1', name: '演示作品', workId: 'work-1', workName: '演示项目' } }
  if (url.pathname === '/api/frameos/materials') return { materials: libraryMaterials, projects: [], pagination: { nextCursor: null } }
  if (url.pathname.endsWith('/generation-quote')) return { points: 20, costCny: 0.2 }
  if (url.pathname.endsWith('/balance')) return { balancePoints: 100000, generationAllowed: true, dailyLimitPoints: null, dailyUsedPoints: 0, dailyLimitExceeded: false }
  if (url.pathname.endsWith('/toolbox/assets')) return { assets: [] }
  if (url.pathname.endsWith('/operations')) return { engines: [], latestTask: null, latestTaskLinks: null }
  const canvasMatch = /^\/api\/projects\/[^/]+\/canvas\/canvas-1(\/ops|\/document)?$/.exec(url.pathname)
  if (canvasMatch) {
    const route = canvasMatch[1] || ''
    if (method !== 'GET') {
      if (!body) return { status: 400, payload: { message: '演示模式：未知写入负载' } }
      if (route === '/document') {
        if (method !== 'PUT' || !body.nodes) return { status: 400, payload: { message: '演示模式：未知写入负载' } }
        const validated = validateCanvasDocumentSaveInput(body)
        if (!validated.success) return { status: 400, payload: { message: '画布文档格式无效' } }
        graph = { ...graph, nodes: body.nodes }
        if (body.edges) graph = { ...graph, edges: body.edges }
        graph = { ...graph, canvas: { ...graph.canvas, revision: graph.canvas.revision + 1 } }
        return graph
      }
      if (route === '/ops' && method !== 'POST') return { status: 400, payload: { message: '演示模式：未知写入负载' } }
      if (!body.ops && !body.nodes) return { status: 400, payload: { message: '演示模式：未知写入负载' } }
      if (body.ops) {
        const validated = validateCanvasOperationsSaveInput(body)
        if (!validated.success) return { status: 400, payload: { message: validated.error.message } }
      }
      if (body.nodes) {
        const validated = validateCanvasDocumentSaveInput(body)
        if (!validated.success) return { status: 400, payload: { message: '画布文档格式无效' } }
        graph = { ...graph, nodes: body.nodes }
      }
      if (body.edges) graph = { ...graph, edges: body.edges }
      for (const op of body.ops || []) {
        if (op.type === 'node.upsert') {
          const exists = graph.nodes.some((node) => node.id === op.node.id)
          graph.nodes = exists ? graph.nodes.map((node) => node.id === op.node.id ? { ...node, ...op.node } : node) : [...graph.nodes, op.node]
        }
        if (op.type === 'edge.add' && !graph.edges.some((edge) => edge.id === op.edge.id)) graph.edges = [...graph.edges, op.edge]
        if (op.type === 'edge.delete') graph.edges = graph.edges.filter((edge) => edge.id !== op.id)
        if (op.type === 'node.delete') graph.nodes = graph.nodes.filter((node) => node.id !== op.id)
      }
      graph = { ...graph, canvas: { ...graph.canvas, revision: graph.canvas.revision + 1 } }
    }
    return graph
  }
  return { voices: [], materials: [], projects: [] }
}

const server = createServer((request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1')
  if (url.pathname.startsWith('/api/')) {
    const chunks = []
    let received = 0
    request.on('data', (chunk) => {
      received += chunk.length
      if (received > 8 * 1024 * 1024) {
        response.writeHead(413, { 'Content-Type': 'application/json' })
        response.end(JSON.stringify({ message: '请求体过大' }))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      let body = null
      try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || 'null') } catch {}
      const result = handleApi(url, request.method, body)
      const wrapped = result && typeof result === 'object' && 'payload' in result && 'status' in result
      const status = wrapped ? result.status : 200
      const payload = wrapped ? result.payload : result
      response.writeHead(status, { 'Content-Type': 'application/json' })
      response.end(JSON.stringify(payload))
    })
    return
  }
  if (url.pathname === '/fixture.js') { response.setHeader('Content-Type', 'text/javascript'); response.end(script); return }
  if (url.pathname === '/fixture.css') { response.setHeader('Content-Type', 'text/css'); response.end(css); return }
  if (url.pathname === '/global.css') { response.setHeader('Content-Type', 'text/css'); response.end(appCss); return }
  response.setHeader('Content-Type', 'text/html')
  response.end(`<!doctype html><html lang="zh"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>画布演示 · @ 引用与点状背景</title><link rel="stylesheet" href="/global.css"><link rel="stylesheet" href="/fixture.css"><style>
  .demo-tip { position: fixed; right: 16px; top: 16px; z-index: 4000; max-width: 300px; border: 1px solid rgba(255,255,255,.12); border-radius: 12px; padding: 12px 14px; background: rgba(24,24,30,.92); color: #c9cad4; font: 12px/1.8 system-ui, sans-serif; backdrop-filter: blur(12px); }
  .demo-tip b { color: #fff; display: block; margin-bottom: 4px; font-size: 13px; }
  .demo-tip kbd { border: 1px solid rgba(255,255,255,.2); border-radius: 4px; padding: 0 4px; font-size: 11px; }
  .demo-tip button { margin-top: 8px; border: 0; border-radius: 6px; padding: 3px 10px; background: rgba(255,255,255,.12); color: #fff; cursor: pointer; font-size: 11px; }
  </style><div id="root"></div><div class="demo-tip" id="demo-tip"><b>本地演示（数据仅存内存）</b>
  在提示词框输入 <kbd>@</kbd> 打开素材菜单：<br>
  · 悬停「图片 / 角色 / 收藏…」弹出侧挂子菜单<br>
  · <kbd>↑</kbd><kbd>↓</kbd> 移动，<kbd>→</kbd> 进入分类，<kbd>←</kbd> 返回<br>
  · 顶部搜索框可直接输入过滤，<kbd>Enter</kbd> 引用<br>
  · 中键拖拽 / 滚轮缩放画布，面板跟随节点<br>
  · 生成按钮已停用，不会调用真实模型<br>
  <button onclick="document.getElementById('demo-tip').remove()">收起</button></div><script src="/fixture.js"></script></html>`)
})
const port = Number(process.env.NORI_DEMO_PORT || 4173)
await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve) })
console.log(`Canvas demo ready: http://127.0.0.1:${port}`)
