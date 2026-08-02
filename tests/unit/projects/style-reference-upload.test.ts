import { describe, expect, it } from 'vitest'
import { readIsoMediaDurationMs } from '@/lib/projects/style-reference-upload'
import {
  calculateStyleReferenceUploadProgress,
  readStyleReferenceFailureIndex,
} from '@/lib/projects/create-project-request'

function atom(type: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8)
  header.writeUInt32BE(payload.length + 8, 0)
  header.write(type, 4, 4, 'ascii')
  return Buffer.concat([header, payload])
}

function buildIsoVideo(durationSeconds: number): Buffer {
  const ftyp = atom('ftyp', Buffer.from('isom\x00\x00\x02\x00isommp41', 'binary'))
  const mvhdPayload = Buffer.alloc(20)
  mvhdPayload.writeUInt8(0, 0)
  mvhdPayload.writeUInt32BE(1000, 12)
  mvhdPayload.writeUInt32BE(durationSeconds * 1000, 16)
  return Buffer.concat([ftyp, atom('moov', atom('mvhd', mvhdPayload))])
}

function sizedFile(name: string, size: number): File {
  return new File([new Uint8Array(size)], name)
}

describe('project style reference media contract', () => {
  it('reads ISO BMFF duration from MP4/MOV mvhd metadata', () => {
    expect(readIsoMediaDurationMs(buildIsoVideo(59))).toBe(59_000)
    expect(readIsoMediaDurationMs(Buffer.from('not a video'))).toBeNull()
  })

  it('maps aggregate XHR bytes into stable per-item progress', () => {
    const references = [
      { id: 'one', file: sizedFile('one.jpg', 100) },
      { id: 'two', file: sizedFile('two.mp4', 100) },
    ]
    expect(calculateStyleReferenceUploadProgress(50, 200, references)).toEqual([
      { id: 'one', progress: 50, status: 'uploading', error: null },
      { id: 'two', progress: 0, status: 'idle', error: null },
    ])
    expect(calculateStyleReferenceUploadProgress(150, 200, references)).toEqual([
      { id: 'one', progress: 99, status: 'processing', error: null },
      { id: 'two', progress: 50, status: 'uploading', error: null },
    ])
  })

  it('reads a failed reference index from the unified API error shape', () => {
    expect(readStyleReferenceFailureIndex({
      error: { details: { styleReferenceIndex: 2 } },
    })).toBe(2)
    expect(readStyleReferenceFailureIndex({ error: { details: {} } })).toBeNull()
  })
})
