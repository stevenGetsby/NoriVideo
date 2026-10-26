import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import {
  createToolboxDraftKey,
  defaultToolboxInputMode,
  readToolboxDraft,
  resolveToolboxGenerateAudio,
  TOOLBOX_DRAFT_INPUT_MODE_VERSION,
  writeToolboxDraft,
  type ToolboxDraft,
} from '@/components/frameos/views/toolbox-draft'

function memoryStorage() {
  const values = new Map<string, string>()
  return {
    getItem: (key: string) => values.get(key) || null,
    setItem: (key: string, value: string) => { values.set(key, value) },
  }
}

describe('toolbox draft persistence', () => {
  it('isolates drafts by account, project, and generation type', () => {
    expect(createToolboxDraftKey('user-1', 'project-1', 'video')).toBe('nori.toolbox.draft.v1:user-1:project-1:video')
    expect(createToolboxDraftKey('user-2', 'project-1', 'video')).not.toBe(createToolboxDraftKey('user-1', 'project-1', 'video'))
    expect(createToolboxDraftKey('', 'project-1', 'video')).toBe('')
  })

  it('uses the logged-in actor rather than the shared wallet owner for draft isolation', () => {
    const toolbox = readFileSync('src/components/frameos/views/FosToolbox.tsx', 'utf8')
    expect(toolbox).toContain('session?.user?.id || session?.user?.name')
    const browserAuth = readFileSync('src/lib/auth.ts', 'utf8')
    expect(browserAuth).toContain('session.user.id = token.id as string')
    expect(browserAuth).not.toContain('session.user.id = session.user.workspaceOwnerId')
    expect(createToolboxDraftKey('child-a', 'project-1', 'video')).not.toBe(createToolboxDraftKey('child-b', 'project-1', 'video'))
  })

  it('restores prompt, model options, sound selection, and ordered references', () => {
    const storage = memoryStorage()
    const key = createToolboxDraftKey('user-1', 'project-1', 'video')
    const draft: ToolboxDraft = {
      version: 1,
      title: '雨夜镜头',
      prompt: '@苏晚卿向前奔跑',
      modelKey: 'nori::seedance2.0',
      ratio: '9:16',
      resolution: '1080p',
      quality: 'high',
      inputMode: 'text',
      duration: 8,
      fps: 24,
      generateAudio: true,
      assetCategory: 'shot',
      references: [{ id: 'material-1', type: 'image', title: '苏晚卿', url: '/asset.png' } as ToolboxDraft['references'][number]],
    }

    writeToolboxDraft(storage, key, draft)
    expect(readToolboxDraft(storage, key)).toEqual(draft)
  })

  it('ignores corrupt storage instead of blocking the toolbox', () => {
    const storage = memoryStorage()
    storage.setItem('bad', '{')
    expect(readToolboxDraft(storage, 'bad')).toBeNull()
  })

  it('defaults video to all-in-one reference while keeping image drafts text-first', () => {
    expect(defaultToolboxInputMode('video')).toBe('reference')
    expect(defaultToolboxInputMode('image')).toBe('text')
    const storage = memoryStorage()
    storage.setItem('empty-video', JSON.stringify({ version: 1, prompt: '雨夜奔跑' }))
    expect(readToolboxDraft(storage, 'empty-video')?.inputMode).toBe('reference')
    expect(readToolboxDraft(storage, 'empty-video', 'text')?.inputMode).toBe('text')
  })

  it('migrates old text-labelled references without losing inputs and supports 30 seconds', () => {
    const storage = memoryStorage()
    storage.setItem('old', JSON.stringify({ version: 1, inputMode: 'text', duration: 30, references: [{ id: 'image-1', type: 'image' }] }))
    expect(readToolboxDraft(storage, 'old')).toMatchObject({ inputMode: 'reference', duration: 30 })
  })

  it('migrates drafts that captured the old default but keeps explicit new-mode text', () => {
    const storage = memoryStorage()
    storage.setItem('auto-old', JSON.stringify({ version: 1, inputModeVersion: 2, inputMode: 'text', references: [{ id: 'image-1', type: 'image' }] }))
    expect(readToolboxDraft(storage, 'auto-old')?.inputMode).toBe('reference')
    storage.setItem('explicit-new', JSON.stringify({
      version: 1,
      inputModeVersion: TOOLBOX_DRAFT_INPUT_MODE_VERSION,
      inputMode: 'text',
      references: [{ id: 'image-1', type: 'image' }],
    }))
    expect(readToolboxDraft(storage, 'explicit-new')?.inputMode).toBe('text')
  })

  it('stamps the current input-mode version when persisting a draft', () => {
    const storage = memoryStorage()
    const draft: ToolboxDraft = {
      version: 1,
      title: '',
      prompt: '',
      modelKey: '',
      ratio: '16:9',
      resolution: '',
      quality: 'high',
      inputMode: 'text',
      duration: 5,
      fps: null,
      generateAudio: true,
      assetCategory: 'other',
      references: [],
    }
    writeToolboxDraft(storage, 'key', draft)
    expect(JSON.parse(storage.getItem('key') || '{}')).toMatchObject({
      inputMode: 'text',
      inputModeVersion: TOOLBOX_DRAFT_INPUT_MODE_VERSION,
    })
  })

  it('defaults sound on for a new capable model but preserves an explicit draft choice', () => {
    const draft = {
      version: 1,
      title: '雨夜镜头',
      prompt: '人物奔跑',
      modelKey: 'nori::seedance2.0',
      ratio: '9:16',
      resolution: '720p',
      quality: 'high',
      inputMode: 'text',
      duration: 5,
      fps: null,
      generateAudio: false,
      assetCategory: 'shot',
      references: [],
    } satisfies ToolboxDraft

    expect(resolveToolboxGenerateAudio({
      type: 'video', modelKey: draft.modelKey, supportGenerateAudio: true, draft,
    })).toBe(false)
    expect(resolveToolboxGenerateAudio({
      type: 'video', modelKey: 'nori::seedance2.0-fast', supportGenerateAudio: true, draft,
    })).toBe(true)
    expect(resolveToolboxGenerateAudio({
      type: 'video', modelKey: draft.modelKey, supportGenerateAudio: false, draft,
    })).toBe(false)
    expect(resolveToolboxGenerateAudio({
      type: 'image', modelKey: draft.modelKey, supportGenerateAudio: true, draft,
    })).toBe(false)
  })
})
