// Deterministic synthetic canvases for the large-canvas performance work.
// Nothing here is copied from production: titles, prompts and media URLs are
// generated, so traces and reports never carry real prompts, users or paths.

export const NODE_SIZE = { width: 320, height: 180 }
const MIB = 1024 * 1024
const BASE_TIME = Date.parse('2026-11-01T00:00:00.000Z')

const HISTORY_LARGE = { entries: 640, promptBytes: 9175, refsPerEntry: 17 }
const HISTORY_SMALL = { entries: 126, promptBytes: 1200, refsPerEntry: 3 }

export const SCALE_SCENARIOS = {
  'small-40': { nodes: 40, edges: 60, videos: 10, layout: 'dense', zoom: 0.6 },
  'small-80': { nodes: 80, edges: 120, videos: 20, layout: 'dense', zoom: 0.6 },
  'laotou-a': { nodes: 179, edges: 1111, videos: 108, layout: 'dense', zoom: 0.6, hubInbound: 22, history: HISTORY_LARGE },
  'laotou-b': { nodes: 176, edges: 724, videos: 126, layout: 'dense', zoom: 0.2, hubInbound: 22, history: HISTORY_SMALL },
  'limit-1000': { nodes: 1000, edges: 4000, videos: 250, layout: 'dense', zoom: 0.3 },
  'limit-1000-long': { nodes: 1000, edges: 4000, videos: 250, layout: 'long-edges', zoom: 0.3 },
  'limit-1000-grouped': { nodes: 1000, edges: 4000, videos: 250, layout: 'grouped', groups: 40, zoom: 0.3 },
  'limit-1000-sparse': { nodes: 1000, edges: 4000, videos: 250, layout: 'sparse', zoom: 0.6 },
  'p5-5000': { nodes: 5000, edges: 20000, videos: 1250, layout: 'dense', zoom: 0.3 },
}

// Control pairs that hold one variable fixed so a regression points at one cause.
export const CONTROL_PAIRS = {
  sameNodesDifferentEdges: [
    { name: 'laotou-a-edges-198', base: 'laotou-a', overrides: { edges: 198, history: null } },
    { name: 'laotou-a-edges-1111', base: 'laotou-a', overrides: { history: null } },
  ],
  sameTopologyDifferentHistory: [
    { name: 'laotou-a-no-history', base: 'laotou-a', overrides: { history: null } },
    { name: 'laotou-a-history', base: 'laotou-a', overrides: {} },
  ],
}

export function resolveScenario(name, overrides = {}) {
  const base = SCALE_SCENARIOS[name]
  if (!base) throw new Error(`Unknown scale scenario: ${name}`)
  return { name, seed: 1, maxInbound: 22, hubInbound: 0, groups: 0, history: null, ...base, ...overrides }
}

function mulberry32(seed) {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function syntheticText(targetBytes, salt) {
  const unit = `合成测试提示词 ${salt}：夜景街道，霓虹反光，镜头缓慢推进，保持人物一致。`
  let text = ''
  while (Buffer.byteLength(text) < targetBytes) text += unit
  while (Buffer.byteLength(text) > targetBytes) text = text.slice(0, -1)
  return text
}

function layoutPosition(layout, index, columns, random) {
  const spacing = layout === 'sparse' ? { x: 1400, y: 1000 } : { x: 380, y: 260 }
  const jitter = () => Math.round((random() - 0.5) * 24)
  return {
    x: (index % columns) * spacing.x + jitter(),
    y: 260 + Math.floor(index / columns) * spacing.y + jitter(),
  }
}

// Water-fill the edge budget across target nodes: each target can only be fed
// by lower-index non-text nodes (keeps the graph acyclic) and by at most
// maxInbound edges, with one deliberate hub that reaches the maximum.
function allocateInbound({ targets, sourcePoolLowerCount, edges, maxInbound, hubInbound }) {
  const capacity = targets.map((target) => Math.min(maxInbound, sourcePoolLowerCount(target)))
  const total = capacity.reduce((sum, value) => sum + value, 0)
  if (total < edges) throw new Error(`Edge budget ${edges} exceeds the acyclic capacity ${total}`)
  const quota = targets.map(() => 0)
  let remaining = edges
  const hubSize = Math.min(hubInbound, maxInbound, edges)
  const hub = hubSize > 0
    ? capacity.findIndex((value, position) => position >= Math.floor(targets.length / 2) && value >= hubSize)
    : -1
  if (hubSize > 0 && hub < 0) throw new Error(`No target can host a ${hubSize}-edge hub`)
  if (hub >= 0) {
    quota[hub] = hubSize
    remaining -= hubSize
  }
  while (remaining > 0) {
    let progressed = false
    for (let position = 0; position < targets.length && remaining > 0; position += 1) {
      if (quota[position] >= capacity[position]) continue
      quota[position] += 1
      remaining -= 1
      progressed = true
    }
    if (!progressed) throw new Error('Edge allocation did not converge')
  }
  return quota
}

function historyFor(nodeIndex, count, history) {
  const entries = []
  for (let k = 0; k < count; k += 1) {
    entries.push({
      id: `hist-${nodeIndex}-${k}`,
      taskId: `task-${nodeIndex}-${k}`,
      url: `images/hist-${nodeIndex}-${k}.mp4`,
      prompt: syntheticText(history.promptBytes, `${nodeIndex}-${k}`),
      modelKey: 'kuaizi::doubao-seedance-2-5-260628',
      parameters: { duration: 5, resolution: '720p', aspectRatio: '16:9' },
      references: Array.from({ length: history.refsPerEntry }, (_, r) => ({
        id: `ref-${nodeIndex}-${k}-${r}`,
        title: `合成参考素材 ${r}`,
        type: 'image',
        previewUrl: `/img/${(nodeIndex + r) % 97}.jpg?ref=${r}`,
        url: `images/ref-${nodeIndex}-${k}-${r}.jpg`,
        materialId: `material-${(nodeIndex + r) % 211}`,
      })),
      source: 'generation',
      status: 'ready',
      quotedCostPoints: 20,
      actualCostPoints: 20,
      createdAt: new Date(BASE_TIME - (nodeIndex * 100 + k) * 60_000).toISOString(),
    })
  }
  return entries
}

export function buildScaleGraph(input) {
  const config = typeof input === 'string' ? resolveScenario(input) : { seed: 1, maxInbound: 22, hubInbound: 0, groups: 0, history: null, ...input }
  const { nodes: total, edges: edgeBudget, videos, layout, groups, maxInbound, hubInbound, history } = config
  const random = mulberry32(config.seed)
  const leafCount = total - groups
  if (leafCount < 1 || videos > leafCount) throw new Error('Scenario has more videos than leaf nodes')
  const columns = Math.max(4, Math.ceil(Math.sqrt(leafCount * 1.6)))

  const textIndexes = new Set()
  for (let i = 9; i < leafCount; i += 10) textIndexes.add(i)
  const nonText = []
  for (let i = 0; i < leafCount; i += 1) if (!textIndexes.has(i)) nonText.push(i)
  const videoIndexes = new Set()
  for (let k = 0; k < videos; k += 1) videoIndexes.add(nonText[Math.floor((k * nonText.length) / videos)])
  const targets = [...videoIndexes].sort((a, b) => a - b)

  // Sources are image/video nodes (not text), strictly lower index than the target.
  let pointer = 0
  const lowerCounts = new Map()
  for (const target of targets) {
    while (pointer < nonText.length && nonText[pointer] < target) pointer += 1
    lowerCounts.set(target, pointer)
  }
  const quota = edgeBudget > 0
    ? allocateInbound({ targets, sourcePoolLowerCount: (target) => lowerCounts.get(target), edges: edgeBudget, maxInbound, hubInbound })
    : targets.map(() => 0)

  const common = { canvasId: 'canvas-1', runId: null, mediaObjectId: null, parentNodeId: null }
  const historyPerVideo = history && videos > 0 ? Math.floor(history.entries / videos) : 0
  const historyExtra = history && videos > 0 ? history.entries - historyPerVideo * videos : 0
  const nodes = []
  let videoOrdinal = 0
  for (let i = 0; i < leafCount; i += 1) {
    const position = layoutPosition(layout, i, columns, random)
    const id = `node-${i}`
    if (textIndexes.has(i)) {
      nodes.push({ ...common, id, type: 'text', position, size: { ...NODE_SIZE, height: 180 }, status: 'IDLE', taskId: null, data: { title: `文本${i}`, mediaType: 'text', origin: 'manual', text: `合成分镜说明 ${i}：夜晚的街道，霓虹灯映在雨后的路面上。`.repeat(3) } })
    } else if (videoIndexes.has(i)) {
      const count = history ? historyPerVideo + (videoOrdinal < historyExtra ? 1 : 0) : 0
      const poster = `/img/${i}.jpg?n=${i}`
      nodes.push({ ...common, id, type: 'video', position, size: { ...NODE_SIZE }, status: 'SUCCEEDED', taskId: null, data: { title: `视频${i}`, mediaType: 'video', origin: 'generate', prompt: '合成提示词：雨夜街头的镜头推进', videoUrl: `images/pan-${i}.mp4`, contentUrl: `images/pan-${i}.mp4`, imageUrl: poster, generation: { modelKey: 'kuaizi::doubao-seedance-2-5-260628' }, history: history ? historyFor(i, count, history) : [] } })
      videoOrdinal += 1
    } else {
      const url = `/img/${i}.jpg?n=${i}`
      nodes.push({ ...common, id, type: 'image', position, size: { ...NODE_SIZE }, status: 'IDLE', taskId: null, data: { title: `素材${i}`, mediaType: 'image', origin: 'upload', contentUrl: url, imageUrl: url, materialId: `material-${i}` } })
    }
  }

  if (groups > 0) {
    const per = Math.ceil(leafCount / groups)
    for (let g = 0; g < groups; g += 1) {
      const members = nodes.slice(g * per, Math.min(leafCount, (g + 1) * per))
      if (!members.length) continue
      const minX = Math.min(...members.map((node) => node.position.x)) - 40
      const minY = Math.min(...members.map((node) => node.position.y)) - 60
      const maxX = Math.max(...members.map((node) => node.position.x + NODE_SIZE.width)) + 40
      const maxY = Math.max(...members.map((node) => node.position.y + NODE_SIZE.height)) + 40
      nodes.push({ ...common, id: `group-${g}`, type: 'group', position: { x: minX, y: minY }, size: { width: maxX - minX, height: maxY - minY }, status: 'IDLE', taskId: null, data: { title: `分组${g}`, memberIds: members.map((node) => node.id), groupColor: null } })
    }
  }

  const edges = []
  const seen = new Set()
  targets.forEach((target, position) => {
    const lower = lowerCounts.get(target)
    for (let k = 0; k < quota[position]; k += 1) {
      const sourceIndex = layout === 'long-edges' ? nonText[k] : nonText[lower - 1 - k]
      const sourceId = `node-${sourceIndex}`
      const targetId = `node-${target}`
      const id = `edge-${sourceId}-${targetId}`
      if (seen.has(id)) throw new Error(`Duplicate fixture edge ${id}`)
      seen.add(id)
      edges.push({ id, canvasId: 'canvas-1', sourceNodeId: sourceId, targetNodeId: targetId, sourceHandle: 'output', targetHandle: 'input', role: 'INPUT_DEFAULT' })
    }
  })

  const canvas = {
    id: 'canvas-1', projectId: 'project-1', title: `规模夹具 ${config.name || ''}`.trim(), revision: 0,
    viewport: { x: 30, y: 90, zoom: config.zoom ?? 0.6 }, themeColor: null, visibility: 'workspace', forkedFromId: null,
    createdAt: '2026-10-08T00:00:00.000Z', updatedAt: '2026-10-08T00:00:00.000Z',
  }
  return { canvas, nodes, edges }
}

export function graphStats(graph) {
  const inbound = new Map()
  const outbound = new Map()
  for (const edge of graph.edges) {
    inbound.set(edge.targetNodeId, (inbound.get(edge.targetNodeId) || 0) + 1)
    outbound.set(edge.sourceNodeId, (outbound.get(edge.sourceNodeId) || 0) + 1)
  }
  let historyEntries = 0
  let historyBytes = 0
  let promptBytes = 0
  let referenceBytes = 0
  for (const node of graph.nodes) {
    const history = node.data?.history
    if (!Array.isArray(history)) continue
    historyEntries += history.length
    historyBytes += Buffer.byteLength(JSON.stringify(history))
    for (const entry of history) {
      promptBytes += Buffer.byteLength(JSON.stringify(entry.prompt ?? ''))
      referenceBytes += Buffer.byteLength(JSON.stringify(entry.references ?? []))
    }
  }
  const ids = new Set(graph.nodes.map((node) => node.id))
  const dangling = graph.edges.filter((edge) => !ids.has(edge.sourceNodeId) || !ids.has(edge.targetNodeId)).length
  const edgeIds = new Set(graph.edges.map((edge) => edge.id))
  const pairs = new Set(graph.edges.map((edge) => `${edge.sourceNodeId}>${edge.targetNodeId}`))
  const xs = graph.nodes.map((node) => node.position.x)
  const ys = graph.nodes.map((node) => node.position.y)
  return {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    videos: graph.nodes.filter((node) => node.type === 'video').length,
    groups: graph.nodes.filter((node) => node.type === 'group').length,
    maxInbound: Math.max(0, ...inbound.values()),
    maxOutbound: Math.max(0, ...outbound.values()),
    dangling,
    duplicateEdgeIds: graph.edges.length - edgeIds.size,
    duplicatePairs: graph.edges.length - pairs.size,
    selfLoops: graph.edges.filter((edge) => edge.sourceNodeId === edge.targetNodeId).length,
    historyEntries,
    historyMiB: Math.round((historyBytes / MIB) * 100) / 100,
    promptMiB: Math.round((promptBytes / MIB) * 100) / 100,
    referenceMiB: Math.round((referenceBytes / MIB) * 100) / 100,
    documentMiB: Math.round((Buffer.byteLength(JSON.stringify(graph)) / MIB) * 100) / 100,
    bounds: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
  }
}
