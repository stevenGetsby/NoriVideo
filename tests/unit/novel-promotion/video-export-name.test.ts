import { describe, expect, it } from 'vitest'
import { buildNovelVideoExportFileName, validateVideoExportTemplate } from '@/lib/novel-promotion/video-export-name'

describe('novel video export names', () => {
  it('uses project, episode, generation name, and creator in a stable safe order', () => {
    expect(buildNovelVideoExportFileName({
      projectName: '机甲三国',
      episodeName: '第008集',
      sequence: 1,
      generationName: '001镜头组',
      creatorName: '马俊',
    })).toBe('机甲三国_001镜头组_视频001_马俊.mp4')
  })

  it('sanitizes path characters and supplies deterministic fallbacks', () => {
    expect(buildNovelVideoExportFileName({
      projectName: '项目/一',
      episodeName: '',
      sequence: 0,
      generationName: '',
      creatorName: null,
    })).toBe('项目_一_001镜头组_视频001_未命名账号.mp4')
  })
  it('matches the requested simple and detailed export conventions', () => {
    expect(buildNovelVideoExportFileName({ projectName: '机甲三国', generationName: '测试', sequence: 1, creatorName: '马俊' })).toBe('机甲三国_测试_视频001_马俊.mp4')
    expect(buildNovelVideoExportFileName({
      projectName: '机甲三国', episodeName: '第008集', generationName: '001镜头组', generationIndex: 2, sequence: 1, creatorName: '马俊',
      template: '{project}_{episode}_{generation}_{attempt}次生成_{creator}',
    })).toBe('机甲三国_第008集_001镜头组_002次生成_马俊.mp4')
  })
  it('never loses creator suffix or exceeds byte limits with long Unicode input', () => {
    const file = buildNovelVideoExportFileName({ projectName: '机甲'.repeat(100), generationName: '🦊'.repeat(80), creatorName: '马俊'.repeat(50), sequence: 200 })
    expect(file).toMatch(/_马俊.*\.mp4$/)
    expect(new TextEncoder().encode(file).length).toBeLessThanOrEqual(255)
  })
  it('rejects path traversal and unrecognised template fields', () => {
    expect(validateVideoExportTemplate('../{project}/{creator}')).toBe(false)
    expect(validateVideoExportTemplate('{project}_{unknown}')).toBe(false)
    expect(validateVideoExportTemplate('{project}_{episode}_{attempt}_{creator}')).toBe(true)
  })
})
