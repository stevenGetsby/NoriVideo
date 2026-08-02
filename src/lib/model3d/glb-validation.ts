const GLB_HEADER_BYTES = 12
const GLB_CHUNK_HEADER_BYTES = 8
const GLB_JSON_CHUNK_TYPE = 0x4e4f534a
const GLB_BIN_CHUNK_TYPE = 0x004e4942

type JsonRecord = Record<string, unknown>

export class GlbValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GlbValidationError'
  }
}

function fail(message: string): never {
  throw new GlbValidationError(message)
}

function record(value: unknown): JsonRecord | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as JsonRecord
    : null
}

function nonNegativeInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : null
}

function isEmbeddedUri(value: string): boolean {
  return /^data:/i.test(value.trim())
}

function assertSelfContained(document: JsonRecord, binaryChunkLength: number | null) {
  const buffers = Array.isArray(document.buffers) ? document.buffers : []
  const bufferLengths: number[] = []

  for (let index = 0; index < buffers.length; index += 1) {
    const buffer = record(buffers[index])
    const byteLength = nonNegativeInteger(buffer?.byteLength)
    if (!buffer || byteLength === null) fail(`buffers[${index}] 缺少有效的 byteLength`)
    bufferLengths.push(byteLength)

    const uri = typeof buffer.uri === 'string' ? buffer.uri.trim() : ''
    if (uri && !isEmbeddedUri(uri)) {
      fail(`包含外部缓冲区依赖 buffers[${index}].uri；请导出为自包含 GLB`)
    }
  }

  if (binaryChunkLength !== null) {
    const primary = record(buffers[0])
    const primaryLength = nonNegativeInteger(primary?.byteLength)
    if (!primary || primaryLength === null || (typeof primary.uri === 'string' && primary.uri.trim())) {
      fail('BIN chunk 必须对应 buffers[0]，且 buffers[0] 不能包含 uri')
    }
    if (binaryChunkLength < primaryLength || binaryChunkLength - primaryLength > 3) {
      fail('BIN chunk 长度与 buffers[0].byteLength 不一致')
    }
  } else if (buffers.some((value) => {
    const buffer = record(value)
    return nonNegativeInteger(buffer?.byteLength) !== 0
      && !(typeof buffer?.uri === 'string' && isEmbeddedUri(buffer.uri))
  })) {
    fail('模型声明了二进制缓冲区，但 GLB 中缺少 BIN chunk')
  }

  const bufferViews = Array.isArray(document.bufferViews) ? document.bufferViews : []
  for (let index = 0; index < bufferViews.length; index += 1) {
    const view = record(bufferViews[index])
    const bufferIndex = nonNegativeInteger(view?.buffer)
    const byteOffset = view?.byteOffset === undefined ? 0 : nonNegativeInteger(view.byteOffset)
    const byteLength = nonNegativeInteger(view?.byteLength)
    if (!view || bufferIndex === null || byteOffset === null || byteLength === null || bufferIndex >= bufferLengths.length) {
      fail(`bufferViews[${index}] 的范围声明无效`)
    }
    if (byteOffset + byteLength > bufferLengths[bufferIndex]) {
      fail(`bufferViews[${index}] 超出 buffers[${bufferIndex}] 范围`)
    }
  }

  const images = Array.isArray(document.images) ? document.images : []
  for (let index = 0; index < images.length; index += 1) {
    const image = record(images[index])
    if (!image) fail(`images[${index}] 不是有效对象`)
    const uri = typeof image.uri === 'string' ? image.uri.trim() : ''
    if (uri && !isEmbeddedUri(uri)) {
      fail(`包含外部贴图依赖 images[${index}].uri；请将贴图打包进 GLB`)
    }
    if (image.bufferView !== undefined) {
      const viewIndex = nonNegativeInteger(image.bufferView)
      if (viewIndex === null || viewIndex >= bufferViews.length) {
        fail(`images[${index}].bufferView 无效`)
      }
    }
  }
}

/**
 * Strictly validates the GLB 2.0 container and its JSON/BIN boundaries.
 * Uploaded and generated models are stored as one object, so external buffer
 * and texture URIs are intentionally rejected.
 */
export function assertSelfContainedGlbV2(body: Buffer): void {
  if (body.length < GLB_HEADER_BYTES + GLB_CHUNK_HEADER_BYTES) fail('文件过短，缺少 GLB chunk')
  if (body.toString('ascii', 0, 4) !== 'glTF') fail('文件头 magic 不是 glTF')
  if (body.readUInt32LE(4) !== 2) fail('仅支持 GLB 2.0')
  if (body.readUInt32LE(8) !== body.length) fail('文件头声明长度与实际长度不一致')

  let offset = GLB_HEADER_BYTES
  let chunkIndex = 0
  let jsonDocument: JsonRecord | null = null
  let binaryChunkLength: number | null = null

  while (offset < body.length) {
    if (body.length - offset < GLB_CHUNK_HEADER_BYTES) fail(`chunk ${chunkIndex} 头部不完整`)
    const chunkLength = body.readUInt32LE(offset)
    const chunkType = body.readUInt32LE(offset + 4)
    if (chunkLength === 0 || chunkLength % 4 !== 0) fail(`chunk ${chunkIndex} 长度必须为非零且按 4 字节对齐`)
    const chunkStart = offset + GLB_CHUNK_HEADER_BYTES
    const chunkEnd = chunkStart + chunkLength
    if (!Number.isSafeInteger(chunkEnd) || chunkEnd > body.length) fail(`chunk ${chunkIndex} 超出文件边界`)

    if (chunkIndex === 0 && chunkType !== GLB_JSON_CHUNK_TYPE) fail('首个 chunk 必须是 JSON')
    if (chunkType === GLB_JSON_CHUNK_TYPE) {
      if (chunkIndex !== 0 || jsonDocument) fail('GLB 只能包含一个位于首位的 JSON chunk')
      const jsonText = body.subarray(chunkStart, chunkEnd).toString('utf8').replace(/\s+$/u, '')
      if (!jsonText) fail('JSON chunk 为空')
      try {
        jsonDocument = record(JSON.parse(jsonText))
      } catch {
        fail('JSON chunk 不是有效 JSON')
      }
      if (!jsonDocument) fail('JSON chunk 根节点必须是对象')
      const asset = record(jsonDocument.asset)
      if (asset?.version !== '2.0') fail('asset.version 必须是 2.0')
    } else if (chunkType === GLB_BIN_CHUNK_TYPE) {
      if (!jsonDocument) fail('BIN chunk 不能出现在 JSON chunk 之前')
      if (binaryChunkLength !== null) fail('GLB 只能包含一个 BIN chunk')
      binaryChunkLength = chunkLength
    }

    offset = chunkEnd
    chunkIndex += 1
  }

  if (!jsonDocument) fail('缺少 JSON chunk')
  assertSelfContained(jsonDocument, binaryChunkLength)
}
