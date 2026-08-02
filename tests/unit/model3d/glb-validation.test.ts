import { describe, expect, it } from 'vitest'
import { assertSelfContainedGlbV2 } from '@/lib/model3d/glb-validation'

const JSON_CHUNK_TYPE = 0x4e4f534a
const BIN_CHUNK_TYPE = 0x004e4942

function chunk(payload: Buffer, type: number, padding = 0x00) {
  const paddedLength = Math.ceil(payload.length / 4) * 4
  const output = Buffer.alloc(8 + paddedLength, padding)
  output.writeUInt32LE(paddedLength, 0)
  output.writeUInt32LE(type, 4)
  payload.copy(output, 8)
  return output
}

function glb(document: Record<string, unknown>, binary?: Buffer) {
  const chunks = [chunk(Buffer.from(JSON.stringify(document)), JSON_CHUNK_TYPE, 0x20)]
  if (binary) chunks.push(chunk(binary, BIN_CHUNK_TYPE))
  const length = 12 + chunks.reduce((sum, item) => sum + item.length, 0)
  const header = Buffer.alloc(12)
  header.write('glTF', 0, 'ascii')
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(length, 8)
  return Buffer.concat([header, ...chunks])
}

describe('GLB 2.0 validation', () => {
  it('accepts a structurally valid self-contained GLB with JSON and BIN chunks', () => {
    const body = glb({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 4 }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 4 }],
    }, Buffer.from([1, 2, 3, 4]))

    expect(() => assertSelfContainedGlbV2(body)).not.toThrow()
  })

  it('rejects header-only files, truncated chunks, and mismatched declared lengths', () => {
    const headerOnly = Buffer.alloc(12)
    headerOnly.write('glTF', 0, 'ascii')
    headerOnly.writeUInt32LE(2, 4)
    headerOnly.writeUInt32LE(12, 8)
    expect(() => assertSelfContainedGlbV2(headerOnly)).toThrow('缺少 GLB chunk')

    const truncated = glb({ asset: { version: '2.0' } })
    truncated.writeUInt32LE(1000, 12)
    expect(() => assertSelfContainedGlbV2(truncated)).toThrow('超出文件边界')

    const wrongLength = glb({ asset: { version: '2.0' } })
    wrongLength.writeUInt32LE(wrongLength.length - 4, 8)
    expect(() => assertSelfContainedGlbV2(wrongLength)).toThrow('声明长度与实际长度不一致')
  })

  it('requires a parseable first JSON chunk with glTF asset version 2.0', () => {
    expect(() => assertSelfContainedGlbV2(glb({ asset: { version: '1.0' } }))).toThrow('asset.version 必须是 2.0')

    const body = glb({ asset: { version: '2.0' } })
    body.fill(0x7b, 20, body.length)
    expect(() => assertSelfContainedGlbV2(body)).toThrow('JSON chunk 不是有效 JSON')
  })

  it('rejects external buffers, external textures, and out-of-range buffer views', () => {
    expect(() => assertSelfContainedGlbV2(glb({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 4, uri: 'mesh.bin' }],
    }))).toThrow('外部缓冲区依赖')

    expect(() => assertSelfContainedGlbV2(glb({
      asset: { version: '2.0' },
      images: [{ uri: 'texture.png' }],
    }))).toThrow('外部贴图依赖')

    expect(() => assertSelfContainedGlbV2(glb({
      asset: { version: '2.0' },
      buffers: [{ byteLength: 4 }],
      bufferViews: [{ buffer: 0, byteOffset: 2, byteLength: 4 }],
    }, Buffer.from([1, 2, 3, 4])))).toThrow('超出 buffers[0] 范围')
  })
})
