import sharp from 'sharp'
import { describe, expect, it } from 'vitest'
import { cropCanvasImage, splitCanvasImage, upscaleCanvasImage } from '@/lib/canvas/image-operations'

async function sampleImage() {
  return await sharp({
    create: { width: 120, height: 80, channels: 3, background: { r: 45, g: 90, b: 180 } },
  }).jpeg().toBuffer()
}

describe('canvas image operations', () => {
  it('splits the complete image without losing boundary pixels', async () => {
    const tiles = await splitCanvasImage(await sampleImage(), 2, 3)
    expect(tiles).toHaveLength(6)
    expect(tiles.map((tile) => [tile.row, tile.col])).toEqual([
      [0, 0], [0, 1], [0, 2], [1, 0], [1, 1], [1, 2],
    ])
    expect(tiles.reduce((sum, tile) => sum + tile.width * tile.height, 0)).toBe(120 * 80)
  })

  it('crops a normalized focus rectangle', async () => {
    const crop = await cropCanvasImage(await sampleImage(), { x: 0.25, y: 0.25, width: 0.5, height: 0.5 })
    expect(crop.width).toBe(60)
    expect(crop.height).toBe(40)
    await expect(sharp(crop.body).metadata()).resolves.toMatchObject({ width: 60, height: 40 })
  })

  it('creates a two-times superresolved derivative', async () => {
    const result = await upscaleCanvasImage(await sampleImage(), 2)
    expect(result.width).toBe(240)
    expect(result.height).toBe(160)
    await expect(sharp(result.body).metadata()).resolves.toMatchObject({ width: 240, height: 160 })
  })

  it('rejects unsafe grid and crop parameters', async () => {
    await expect(splitCanvasImage(await sampleImage(), 6, 6)).rejects.toThrow('不能超过 25')
    await expect(cropCanvasImage(await sampleImage(), { x: 0.9, y: 0.9, width: 0.5, height: 0.5 })).rejects.toThrow('格式无效')
  })
})
