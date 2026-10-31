import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { WorkTraceCard } from '../../src/components/frameos/views/ToolboxWorkTraceCard'
import { buildToolboxWorkTrace } from '../../src/components/frameos/views/toolbox-work-trace'
import '../../src/styles/frameos-replica.css'

const longPrompt = '苏晚卿在雨夜的长街上回头，镜头缓慢推近，霓虹灯反射在她的披风上。她抬手压住被风吹起的帽檐，街角的积水映出她与顾北辰交错的影子。镜头继续向前，远处传来一声闷雷，灯光在水面上碎成一片金色。她沿着湿滑的石板路走向巷口，风衣下摆被风掀起，雨滴在镜头前拉成细线，背景招牌的红色光晕一层层晕开。顾北辰从屋檐下走出，把伞递给她，两个人没有对话，只有呼吸声和雨声。镜头环绕半圈，停在两人并肩的背影上，最后缓慢拉远，露出整条被雨水洗亮的街道与远处模糊的车灯。'
const completed = buildToolboxWorkTrace({
  type: 'video',
  status: 'completed',
  modelId: 'nori::seedance2.0-fast',
  createdAt: '2026-10-25T10:24:00.000Z',
  params: {
    title: '苏晚卿夜行',
    prompt: longPrompt,
    inputMode: 'reference',
    aspectRatio: '16:9',
    resolution: '720p',
    duration: 5,
    fps: 24,
    generateAudio: true,
    assetCategory: 'character',
    referenceSummary: [
      { type: 'image', title: '苏晚卿', role: 'REF' },
      { type: 'image', title: '顾北辰', role: 'REF' },
      { type: 'audio', title: '苏晚卿音色', role: 'REF', durationSeconds: 7.2 },
    ],
  },
  task: { id: 'task_01J9Z6X8Y7W4K3M2N1P0Q9R8S7', status: 'completed', costPoints: 126.5 },
}, { modelName: 'Seedance 2.0 Fast' })

const failed = buildToolboxWorkTrace({
  type: 'video',
  status: 'failed',
  modelId: 'nori::seedance2.0-fast',
  createdAt: '2026-10-25T09:10:00.000Z',
  params: {
    title: '雨夜街角',
    prompt: '雨夜街角，人物回头。',
    inputMode: 'reference',
    aspectRatio: '9:16',
    resolution: '1080p',
    duration: 8,
    generateAudio: false,
    referenceSummary: [{ type: 'image', title: '苏晚卿', role: 'REF' }],
  },
  task: {
    id: 'task_01J9Z6X8Y7W4K3M2N1P0Q9R8S6',
    status: 'failed',
    errorCode: 'PROVIDER_REJECTED',
    errorMessage: '参考图片包含无法识别的角色，请更换素材后重试。',
  },
}, { modelName: 'Seedance 2.0 Fast' })

const processing = buildToolboxWorkTrace({
  type: 'video',
  status: 'processing',
  modelId: 'nori::norivideo2.5',
  createdAt: '2026-10-25T10:30:00.000Z',
  params: {
    title: '雾中车站',
    prompt: '清晨的雾中车站，镜头缓慢横移。',
    inputMode: 'text',
    aspectRatio: '1:1',
    resolution: '480p',
    duration: 4,
  },
  task: { id: 'task_01J9Z6X8Y7W4K3M2N1P0Q9R8S5', status: 'processing' },
}, { modelName: 'LanMiaoTV 2.5' })

function Fixture() {
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  return (
    <main className="fos-app" style={{ minHeight: '100vh', background: '#0b0d12', padding: 16 }}>
      <div data-testid="trace-stack" style={{ display: 'grid', gap: 16, width: '100%', maxWidth: 900, margin: '0 auto' }}>
        <WorkTraceCard trace={completed} copyState={copyState} onCopy={() => setCopyState('copied')} />
        <WorkTraceCard trace={failed} copyState="idle" onCopy={() => undefined} />
        <WorkTraceCard trace={processing} copyState="idle" onCopy={() => undefined} />
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
