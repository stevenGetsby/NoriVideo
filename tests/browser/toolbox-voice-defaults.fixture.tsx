import React from 'react'
import { createRoot } from 'react-dom/client'
import { FosToolbox } from '../../src/components/frameos/views/FosToolbox'
import { setFixtureSession } from './stubs/next-auth-react'
import '../../src/styles/frameos-replica.css'
import '../../src/features/canvas/canvas.css'

setFixtureSession({
  id: 'user-1',
  name: '测试资产师',
  role: 'admin',
  permissions: ['assetWrite', 'canvasWrite', 'toolboxUse'],
})

const material = (id: string, title: string, metadata: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({
  id,
  projectId: 'project-1',
  projectName: '小屏验证作品',
  ownerName: '管理员',
  title,
  type: 'image',
  source: 'upload',
  status: 'ready',
  isFavorited: false,
  resultUrl: `/${id}.jpg`,
  storageKey: `/${id}.jpg`,
  url: `/${id}.jpg`,
  metadata,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  ...extra,
})

const draft = {
  version: 1,
  title: '雨夜角色测试',
  prompt: '苏晚卿回头，顾北辰撑伞走来。',
  modelKey: 'nori::norivideo2.5',
  ratio: '16:9',
  resolution: '720p',
  quality: 'high',
  // 旧版自动保存草稿没有 inputModeVersion；重开时应迁移到新的全能参考默认值。
  inputMode: 'text',
  duration: 5,
  fps: null,
  generateAudio: true,
  assetCategory: 'shot',
  references: [
    material('char-1', '苏晚卿', { assetCategory: 'character', voiceMaterialId: 'audio-1' }, {
      voice: { materialId: 'audio-1', title: '苏晚卿音色', url: '/voice.mp3' },
    }),
    material('char-2', '顾北辰', { assetCategory: 'character' }),
    {
      id: 'audio-1',
      projectId: 'project-1',
      projectName: '小屏验证作品',
      ownerName: '管理员',
      title: '苏晚卿音色',
      type: 'audio',
      source: 'upload',
      status: 'ready',
      isFavorited: false,
      resultUrl: '/voice.mp3',
      storageKey: '/voice.mp3',
      url: '/voice.mp3',
      metadata: null,
      createdAt: '2026-10-01T00:00:00.000Z',
      updatedAt: '2026-10-01T00:00:00.000Z',
    },
  ],
}

window.localStorage.setItem('nori.toolbox.draft.v1:user-1:project-1:video', JSON.stringify(draft))

function Fixture() {
  return (
    <main className="fos-app">
      <FosToolbox initialTab="video" />
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
