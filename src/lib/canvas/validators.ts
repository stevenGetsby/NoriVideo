function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const trimmed = v.trim()
  return trimmed.length > 0 ? trimmed : null
}

function asNumber(v: unknown): number | null {
  if (typeof v !== 'number' || !Number.isFinite(v)) return null
  return v
}

export function parseCreateCanvasInput(body: unknown): { title: string; themeColor: string | null } | null {
  if (!body || typeof body !== 'object') return null
  const title = asString((body as Record<string, unknown>).title)
  if (!title || title.length > 120) return null
  const themeRaw = (body as Record<string, unknown>).themeColor
  const themeColor = themeRaw == null ? null : asString(themeRaw)
  if (themeColor !== null && themeColor.length > 32) return null
  return { title, themeColor }
}

export function parseUpdateCanvasInput(body: unknown): {
  title?: string
  themeColor?: string | null
  viewport?: { x: number; y: number; zoom: number }
} | null {
  if (!body || typeof body !== 'object') return null
  const src = body as Record<string, unknown>
  const result: { title?: string; themeColor?: string | null; viewport?: { x: number; y: number; zoom: number } } = {}

  if ('title' in src) {
    const title = asString(src.title)
    if (!title || title.length > 120) return null
    result.title = title
  }

  if ('themeColor' in src) {
    if (src.themeColor === null) {
      result.themeColor = null
    } else {
      const c = asString(src.themeColor)
      if (c === null || c.length > 32) return null
      result.themeColor = c
    }
  }

  if ('viewport' in src) {
    const vp = src.viewport
    if (!vp || typeof vp !== 'object') return null
    const v = vp as Record<string, unknown>
    const x = asNumber(v.x)
    const y = asNumber(v.y)
    const zoom = asNumber(v.zoom)
    if (x === null || y === null || zoom === null) return null
    result.viewport = { x, y, zoom }
  }

  return result
}

export function parseCreateNodeInput(body: unknown): {
  type: string
  position: { x: number; y: number }
  size?: { width: number; height: number } | null
  data?: unknown
  parentNodeId?: string | null
} | null {
  if (!body || typeof body !== 'object') return null
  const src = body as Record<string, unknown>

  const type = asString(src.type)
  if (!type) return null

  const pos = src.position
  if (!pos || typeof pos !== 'object') return null
  const px = asNumber((pos as Record<string, unknown>).x)
  const py = asNumber((pos as Record<string, unknown>).y)
  if (px === null || py === null) return null

  let size: { width: number; height: number } | null | undefined
  if ('size' in src) {
    if (src.size === null) {
      size = null
    } else if (src.size && typeof src.size === 'object') {
      const w = asNumber((src.size as Record<string, unknown>).width)
      const h = asNumber((src.size as Record<string, unknown>).height)
      if (w === null || h === null) return null
      size = { width: w, height: h }
    } else {
      return null
    }
  }

  let parentNodeId: string | null | undefined
  if ('parentNodeId' in src) {
    if (src.parentNodeId === null) parentNodeId = null
    else {
      const p = asString(src.parentNodeId)
      if (!p) return null
      parentNodeId = p
    }
  }

  return {
    type,
    position: { x: px, y: py },
    size,
    data: 'data' in src ? src.data : undefined,
    parentNodeId,
  }
}

export function parseBulkPatchNodesInput(body: unknown): Array<{
  id: string
  position?: { x: number; y: number }
  size?: { width: number; height: number }
  data?: unknown
}> | null {
  if (!body || typeof body !== 'object') return null
  const updates = (body as Record<string, unknown>).updates
  if (!Array.isArray(updates)) return null

  const out: Array<{ id: string; position?: { x: number; y: number }; size?: { width: number; height: number }; data?: unknown }> = []
  for (const raw of updates) {
    if (!raw || typeof raw !== 'object') return null
    const r = raw as Record<string, unknown>
    const id = asString(r.id)
    if (!id) return null
    const entry: { id: string; position?: { x: number; y: number }; size?: { width: number; height: number }; data?: unknown } = { id }

    if ('position' in r) {
      const p = r.position
      if (!p || typeof p !== 'object') return null
      const x = asNumber((p as Record<string, unknown>).x)
      const y = asNumber((p as Record<string, unknown>).y)
      if (x === null || y === null) return null
      entry.position = { x, y }
    }

    if ('size' in r && r.size != null) {
      const w = asNumber((r.size as Record<string, unknown>).width)
      const h = asNumber((r.size as Record<string, unknown>).height)
      if (w === null || h === null) return null
      entry.size = { width: w, height: h }
    }

    if ('data' in r) {
      entry.data = r.data
    }

    out.push(entry)
  }

  return out
}

export function parseCreateEdgeInput(body: unknown): {
  sourceNodeId: string
  targetNodeId: string
  sourceHandle: string | null
  targetHandle: string | null
  role: string
} | null {
  if (!body || typeof body !== 'object') return null
  const src = body as Record<string, unknown>

  const sourceNodeId = asString(src.sourceNodeId)
  const targetNodeId = asString(src.targetNodeId)
  if (!sourceNodeId || !targetNodeId) return null
  if (sourceNodeId === targetNodeId) return null

  const sourceHandle = src.sourceHandle == null ? null : asString(src.sourceHandle)
  const targetHandle = src.targetHandle == null ? null : asString(src.targetHandle)

  const roleRaw = src.role
  const role = roleRaw == null ? 'INPUT_DEFAULT' : asString(roleRaw) ?? 'INPUT_DEFAULT'

  return { sourceNodeId, targetNodeId, sourceHandle, targetHandle, role }
}
