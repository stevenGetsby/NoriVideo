import { describe, expect, it } from 'vitest'
import type { FrameosMaterialItem } from '@/components/frameos/materials/contracts'
import {
  resolveMaterialReferenceSchema,
  selectMaterialsForReferenceLimits,
} from '@/features/canvas/material-reference-drop'

function material(id: string, type: 'image' | 'video' | 'audio'): FrameosMaterialItem {
  return {
    id,
    projectId: 'project-1',
    projectName: 'Project',
    ownerName: null,
    title: id,
    type,
    source: 'upload',
    status: 'ready',
    isFavorited: false,
    resultUrl: `/api/files/${id}`,
    storageKey: `uploads/${id}`,
    url: `/api/files/${id}`,
    createdAt: '2026-10-07T00:00:00.000Z',
    updatedAt: '2026-10-07T00:00:00.000Z',
  }
}

describe('批量素材引用模型上限', () => {
  it('首尾帧固定只收两张图片', () => {
    const selected = selectMaterialsForReferenceLimits([
      material('first', 'image'),
      material('middle', 'video'),
      material('second', 'image'),
      material('third', 'image'),
    ], { type: 'video', inputMode: 'firstlastframe' })

    expect(selected.map((item) => item.id)).toEqual(['first', 'second'])
    expect(resolveMaterialReferenceSchema({ type: 'video', inputMode: 'firstlastframe' }).image.max).toBe(2)
  })

  it('模型未声明输入上限时使用画布默认上限', () => {
    const selected = selectMaterialsForReferenceLimits([
      material('image-1', 'image'),
      material('image-2', 'image'),
      material('video-1', 'video'),
      material('video-2', 'video'),
      material('audio-1', 'audio'),
    ], { type: 'video', inputMode: 'text' }, [])

    expect(selected.map((item) => item.id)).toEqual(['image-1', 'image-2', 'video-1', 'video-2', 'audio-1'])
  })

  it('图片生成节点只保留图片并应用模型上限', () => {
    const selected = selectMaterialsForReferenceLimits([
      material('image-1', 'image'),
      material('image-2', 'image'),
      material('video-1', 'video'),
    ], {
      type: 'image',
      inputSchema: {
        image: { min: 0, max: 1 },
        video: { min: 0, max: 0 },
        audio: { min: 0, max: 0 },
        requiredFields: ['prompt'],
      },
    }, [])

    expect(selected.map((item) => item.id)).toEqual(['image-1'])
  })
})
