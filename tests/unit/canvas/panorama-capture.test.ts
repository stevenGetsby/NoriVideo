import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  panoramaCaptureResultMessage,
  settlePanoramaCaptureUploads,
} from '@/features/canvas/panorama-capture'

describe('panorama capture partial uploads', () => {
  it('attempts every upload and retains successful values with their original view indexes', async () => {
    const upload = vi.fn(async (index: number) => {
      if (index === 1 || index === 3) throw new Error(`视角 ${index + 1} 网络失败`)
      return { id: `material-${index}`, url: `/view-${index}.jpg` }
    })

    const result = await settlePanoramaCaptureUploads(4, upload)

    expect(upload).toHaveBeenCalledTimes(4)
    expect(result.successes).toEqual([
      { index: 0, value: { id: 'material-0', url: '/view-0.jpg' } },
      { index: 2, value: { id: 'material-2', url: '/view-2.jpg' } },
    ])
    expect(result.failures).toEqual([
      { index: 1, message: '视角 2 网络失败' },
      { index: 3, message: '视角 4 网络失败' },
    ])
  })

  it('reports actual partial totals instead of a full-success message', () => {
    expect(panoramaCaptureResultMessage({
      created: 2,
      failed: 2,
      errors: ['视角 2 网络失败', '视角 4 网络失败'],
    })).toBe('成功 2 张，失败 2 张：视角 2 网络失败；视角 4 网络失败')
    expect(panoramaCaptureResultMessage({ created: 4, failed: 0, errors: [] }))
      .toBe('已发送 4 张全景视角截图到画布')
  })

  it('wires successful materials to nodes using the uncompressed source index', () => {
    const graph = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/CanvasGraph.tsx'), 'utf8')
    const dialog = fs.readFileSync(path.join(process.cwd(), 'src/features/canvas/components/CanvasPanoramaDialog.tsx'), 'utf8')

    expect(graph).toContain('settlePanoramaCaptureUploads(files.length')
    expect(graph).toContain('uploaded.successes.map(({ value: material, index }, createdIndex)')
    expect(graph).toContain('panoramaCaptureIndex: index')
    expect(graph).toContain('failed: uploaded.failures.length')
    expect(graph).toContain('setToast(panoramaCaptureResultMessage(result))')
    expect(dialog).toContain('if (result.failed > 0) setError(panoramaCaptureResultMessage(result))')
  })
})
