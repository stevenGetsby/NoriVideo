import { beforeEach, describe, expect, it, vi } from 'vitest'

const prismaMock = vi.hoisted(() => ({
  frameosScript: {
    findMany: vi.fn(async (): Promise<unknown[]> => []),
  },
}))

vi.mock('@/lib/prisma', () => ({ prisma: prismaMock }))

import {
  buildVideoRepaintSections,
  joinDocumentBodies,
  listFrameosScriptsForAccount,
  normalizeFrameosScriptStatus,
  toPrismaSections,
  toWriterScript,
} from '@/lib/frameos/screenwriter-script-service'

function stored(overrides?: Record<string, unknown>) {
  return {
    id: 'vr_abc',
    title: '转绘任务',
    content: '正文',
    status: 'draft',
    sections: null as unknown,
    createdAt: new Date('2026-11-01T00:00:00.000Z'),
    updatedAt: new Date('2026-11-02T00:00:00.000Z'),
    ...overrides,
  }
}

describe('video repaint documents', () => {
  it('builds the target script, outline and optional storyboard as documents with deterministic ids', () => {
    const sections = buildVideoRepaintSections({
      scriptId: 'vr_abc',
      targetScript: '## S1 [老家堂屋 · 日间 · 内]\n### SH001 [00:00.0-00:02.8]',
      outline: '  1. 目标市场版故事核与类型承诺\n内容  ',
      storyboard: '## S1 [堂屋客厅 · 日间 · 内]',
      sourceScript: '第1集\n场景：源场景',
      adaptationBrief: '改为北美语境',
      adaptationContract: { story_invariants: ['复仇主线'] },
      model: 'text-model-x',
      sourceFileName: 'sample.mp4',
    })

    expect(sections).toEqual({
      version: 2,
      kind: 'video-repaint',
      layout: 'documents',
      episodes: [
        { id: 'vr_abc-doc-script', title: '目标剧本', body: '## S1 [老家堂屋 · 日间 · 内]\n### SH001 [00:00.0-00:02.8]' },
        { id: 'vr_abc-doc-outline', title: '目标设定总纲', body: '1. 目标市场版故事核与类型承诺\n内容' },
        { id: 'vr_abc-doc-storyboard', title: '分镜', body: '## S1 [堂屋客厅 · 日间 · 内]' },
      ],
      sourceScript: '第1集\n场景：源场景',
      adaptationBrief: '改为北美语境',
      adaptationContract: { story_invariants: ['复仇主线'] },
      model: 'text-model-x',
      sourceFileName: 'sample.mp4',
    })
  })

  it('keeps all documents when a stage produced nothing', () => {
    const sections = buildVideoRepaintSections({ scriptId: 'vr_abc', outline: '总纲正文' })

    expect(sections.episodes).toEqual([
      { id: 'vr_abc-doc-script', title: '目标剧本', body: '' },
      { id: 'vr_abc-doc-outline', title: '目标设定总纲', body: '总纲正文' },
      { id: 'vr_abc-doc-storyboard', title: '分镜', body: '' },
    ])
    expect(sections).toMatchObject({ sourceScript: '', adaptationBrief: '', model: '', sourceFileName: '' })
  })

  it('joins the non-empty document bodies with one blank line', () => {
    expect(joinDocumentBodies([
      { id: 'a', title: '总纲', body: '总纲正文' },
      { id: 'b', title: '分镜', body: '' },
      { id: 'c', title: '补充', body: '补充正文' },
    ])).toBe('总纲正文\n\n补充正文')
    expect(joinDocumentBodies([{ id: 'a', title: '总纲', body: '' }])).toBe('')
  })

  it('serialises sections as plain JSON, dropping undefined fields', () => {
    const sections = buildVideoRepaintSections({ scriptId: 'vr_abc', outline: '总纲' })

    expect(toPrismaSections(sections)).toEqual({
      version: 2,
      kind: 'video-repaint',
      layout: 'documents',
      episodes: [
        { id: 'vr_abc-doc-script', title: '目标剧本', body: '' },
        { id: 'vr_abc-doc-outline', title: '目标设定总纲', body: '总纲' },
        { id: 'vr_abc-doc-storyboard', title: '分镜', body: '' },
      ],
      sourceScript: '',
      adaptationBrief: '',
      model: '',
      sourceFileName: '',
    })
  })
})

describe('toWriterScript', () => {
  it('hands the documents layout to the writer with the target script first', () => {
    const sections = buildVideoRepaintSections({
      scriptId: 'vr_abc',
      outline: '总纲',
      storyboard: '分镜',
      sourceFileName: 'sample.mp4',
    })

    expect(toWriterScript(stored({ sections }))).toEqual({
      id: 'vr_abc',
      title: '转绘任务',
      type: '视频转绘',
      status: 'draft',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-02T00:00:00.000Z',
      episodes: [
        { id: 'vr_abc-doc-script', title: '目标剧本', body: '' },
        { id: 'vr_abc-doc-outline', title: '目标设定总纲', body: '总纲' },
        { id: 'vr_abc-doc-storyboard', title: '分镜', body: '分镜' },
      ],
      layout: 'documents',
      lineage: 'sample.mp4',
    })
  })

  it('still reads a version 1 draft saved before the two-document layout', () => {
    const script = toWriterScript(stored({
      sections: {
        version: 1,
        kind: 'video-repaint',
        episodes: [{ id: 'ep-1', title: '第 1 集', body: '第1集\n场景：目标场景' }],
        sourceScript: '第1集\n场景：源场景',
        sourceStoryboard: '',
        adaptationBrief: '',
        resultMode: 'llm',
        model: '',
        sourceFileName: '',
      },
    }))

    expect(script.episodes).toEqual([{ id: 'ep-1', title: '第 1 集', body: '第1集\n场景：目标场景' }])
    expect(script).not.toHaveProperty('layout')
    expect(script).not.toHaveProperty('lineage')
  })

  it('falls back to one episode built from the content column when there are no sections', () => {
    const script = toWriterScript(stored({ sections: null, content: '旧版正文' }))

    expect(script.episodes).toEqual([{ id: 'vr_abc-ep-1', title: '第 1 集', body: '旧版正文' }])
    expect(script).not.toHaveProperty('layout')
  })

  it('ignores an unknown layout value and repairs malformed episode entries', () => {
    const script = toWriterScript(stored({
      sections: {
        layout: 'carousel',
        episodes: ['garbage', { id: '', title: '', body: 12 }, { id: 'ep-9', title: '第九集', body: '内容' }],
      },
    }))

    expect(script).not.toHaveProperty('layout')
    expect(script.episodes).toEqual([
      { id: 'vr_abc-ep-2', title: '第 2 集', body: '' },
      { id: 'ep-9', title: '第九集', body: '内容' },
    ])
  })

  it('normalises an unknown status to draft', () => {
    expect(toWriterScript(stored({ status: 'weird' })).status).toBe('draft')
    expect(normalizeFrameosScriptStatus('available')).toBe('available')
    expect(normalizeFrameosScriptStatus('archived')).toBe('archived')
    expect(normalizeFrameosScriptStatus(undefined)).toBe('draft')
  })
})

describe('listFrameosScriptsForAccount', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('lists the acting account scripts newest first, in the writer shape', async () => {
    prismaMock.frameosScript.findMany.mockResolvedValueOnce([
      stored({ sections: buildVideoRepaintSections({ scriptId: 'vr_abc', outline: '总纲' }) }),
    ])

    const scripts = await listFrameosScriptsForAccount('actor-1')

    expect(prismaMock.frameosScript.findMany).toHaveBeenCalledWith({
      where: { userId: 'actor-1' },
      orderBy: { updatedAt: 'desc' },
    })
    expect(scripts).toHaveLength(1)
    expect(scripts[0]).toMatchObject({ id: 'vr_abc', layout: 'documents', type: '视频转绘' })
  })
})
