import { describe, expect, it } from 'vitest'
import {
  CANVAS_IMAGE_ASPECT_RATIOS,
  CANVAS_IMAGE_QUALITIES,
  CANVAS_IMAGE_RESOLUTIONS,
  CANVAS_LEGACY_PANORAMA_ASPECT_RATIO,
  CANVAS_PANORAMA_ASPECT_RATIO,
  CANVAS_VIDEO_ASPECT_RATIOS,
  CANVAS_VIDEO_RESOLUTIONS,
  canvasVideoAspectRatioOptions,
  canvasPanoramaEditorAspectRatio,
  canvasVideoEditorMode,
  normalizeCanvasImageGenerationOptions,
  normalizeCanvasVideoGenerationOptions,
  resolveCanvasSuperresolveGenerationResolution,
  resolveSupportedResolution,
} from '@/lib/canvas/generator-options'

describe('canvas generator surface option contract', () => {
  it('keeps the FrameOS image option surface exact and applies stable defaults', () => {
    expect(CANVAS_IMAGE_ASPECT_RATIOS).toEqual(['16:9', '9:16', '21:9', '4:3', '3:4', '1:1'])
    expect(CANVAS_IMAGE_RESOLUTIONS).toEqual(['1K', '2K', '4K'])
    expect(CANVAS_IMAGE_QUALITIES).toEqual(['low', 'medium', 'high'])
    expect(normalizeCanvasImageGenerationOptions({})).toEqual({
      aspectRatio: '16:9',
      resolution: '2K',
      quality: 'high',
    })
    expect(normalizeCanvasImageGenerationOptions({
      aspectRatio: '21:9',
      resolution: '4k',
      quality: 'Medium',
    })).toEqual({
      aspectRatio: '21:9',
      resolution: '4K',
      quality: 'medium',
    })
  })

  it('keeps the FrameOS video surface exact and validates the complete payload', () => {
    expect(CANVAS_VIDEO_ASPECT_RATIOS).toEqual(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'])
    expect(CANVAS_VIDEO_RESOLUTIONS).toEqual(['480p', '720p', '1080p', '4k'])
    expect(normalizeCanvasVideoGenerationOptions({
      aspectRatio: '21:9',
      resolution: '4k',
      duration: 30,
      fps: 30,
      generateAudio: true,
    }, 'firstlastframe')).toEqual({
      aspectRatio: '21:9',
      resolution: '4k',
      duration: 30,
      fps: 30,
      generateAudio: true,
      inputMode: 'firstlastframe',
    })
    expect(canvasVideoAspectRatioOptions('nori::norivideo2.5', 'firstlastframe')).toEqual(['adaptive'])
    expect(canvasVideoAspectRatioOptions('nori::norivideo2.5', 'text')).toContain('adaptive')
    expect(canvasVideoAspectRatioOptions('nori::seedance2.0', 'text')).not.toContain('adaptive')
  })

  it('keeps superresolve targets separate from billed model resolution', () => {
    expect(normalizeCanvasVideoGenerationOptions({ superresolveTarget: '720P' }, 'text')).toMatchObject({
      resolution: '720p',
      superresolveTarget: '720p',
    })
    expect(resolveCanvasSuperresolveGenerationResolution('720p', ['480p', '720p'])).toBe('480p')
    expect(resolveCanvasSuperresolveGenerationResolution('1080p', ['480p', '720p'])).toBe('720p')
    expect(() => resolveCanvasSuperresolveGenerationResolution('720p', ['720p'])).toThrow('没有低于超分目标')
    expect(() => normalizeCanvasVideoGenerationOptions({ superresolveTarget: '2k' }, 'text')).toThrow('超分目标仅支持')
  })

  it('maps configured resolution defaults case-insensitively without inventing unsupported tiers', () => {
    expect(resolveSupportedResolution(
      '',
      '4K',
      ['480p', '720p', '1080p', '4k'],
    )).toBe('4k')
    expect(resolveSupportedResolution(
      '720P',
      '4K',
      ['480p', '720p'],
    )).toBe('720p')
    expect(resolveSupportedResolution(
      '1080p',
      '4K',
      ['480p', '720p'],
    )).toBe('480p')
    expect(resolveSupportedResolution(
      '',
      '2k',
      ['1K', '2K', '4K'],
    )).toBe('2K')
  })

  it('keeps image-to-video as a first-class editor mode aligned with the toolbox', () => {
    expect(canvasVideoEditorMode('image')).toBe('image')
    expect(normalizeCanvasVideoGenerationOptions({}, 'image')).toMatchObject({
      inputMode: 'image',
      resolution: '720p',
      duration: 5,
    })
  })

  it('rejects values outside the replicated surface before task submission', () => {
    expect(() => normalizeCanvasImageGenerationOptions({ quality: 'ultra' })).toThrow('图片质量仅支持')
    expect(() => normalizeCanvasVideoGenerationOptions({ resolution: '2K' }, 'text')).toThrow('视频分辨率仅支持')
    expect(() => normalizeCanvasVideoGenerationOptions({ duration: 3 }, 'text')).toThrow('4–30 秒')
    expect(() => normalizeCanvasVideoGenerationOptions({ duration: 31 }, 'text')).toThrow('4–30 秒')
    expect(() => normalizeCanvasVideoGenerationOptions({ generateAudio: 'yes' }, 'text')).toThrow('布尔值')
    expect(() => normalizeCanvasVideoGenerationOptions({ fps: 0 }, 'text')).toThrow('视频帧率')
    expect(() => normalizeCanvasVideoGenerationOptions({}, 'image-to-video')).toThrow('视频模式仅支持')
  })

  it('submits new panoramas at 21:9 while upgrading legacy 2:1 node data', () => {
    expect(CANVAS_PANORAMA_ASPECT_RATIO).toBe('21:9')
    expect(CANVAS_LEGACY_PANORAMA_ASPECT_RATIO).toBe('2:1')
    expect(CANVAS_IMAGE_ASPECT_RATIOS).not.toContain('2:1')
    expect(canvasPanoramaEditorAspectRatio('2:1')).toBe('21:9')
    expect(canvasPanoramaEditorAspectRatio('21:9')).toBe('21:9')
    expect(normalizeCanvasImageGenerationOptions({ aspectRatio: '2:1' }, { allowPanorama: true })).toMatchObject({
      aspectRatio: '21:9',
    })
    expect(() => normalizeCanvasImageGenerationOptions({ aspectRatio: '2:1' })).toThrow('图片比例仅支持')
  })
})
