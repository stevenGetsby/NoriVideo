import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

function source(relativePath: string) {
  return fs.readFileSync(path.join(__dirname, '../../..', relativePath), 'utf8')
}

describe('retired video repaint surface', () => {
  it('keeps scripts editable while blocking the retired generation entry', () => {
    const client = source('src/components/frameos/FosVideoRepaintClient.tsx')
    const understand = source('src/app/api/video-repaint/understand/route.ts')
    const adapt = source('src/app/api/video-repaint/adapt/route.ts')
    expect(client).toContain('视频转绘已停用')
    expect(client).toContain('/writer-workbench')
    expect(understand).toContain('status: 410')
    expect(adapt).toContain('status: 410')
    expect(fs.existsSync(path.join(__dirname, '../../../src/components/frameos/views/videoRepaintState.ts'))).toBe(false)
  })
})
