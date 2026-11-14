'use client'

import { AppIcon } from '@/components/ui/icons'
import type { RepaintRunState } from './videoRepaintState'

interface FosVideoRepaintRailProps {
  state: RepaintRunState
  sourceReady?: boolean
  onBack: () => void
}

const NODES = [
  { title: '上传设置', subtitle: '一个视频生成剧本与总纲' },
  { title: '视频反译', subtitle: '提取原剧本与剪辑点' },
  { title: '文档生成', subtitle: '目标剧本 + 总纲，分镜可选' },
  { title: '对照审核', subtitle: '编辑并确认生成文档' },
  { title: '保存完成', subtitle: '写入当前账号草稿' },
] as const

export function FosVideoRepaintRail({ state, sourceReady = false, onBack }: FosVideoRepaintRailProps) {
  const currentOrder = state === 'setup'
    ? 0
    : state === 'processing'
      ? (sourceReady ? 2 : 1)
      : state === 'done'
        ? 4
        : 3

  return (
    <aside className="rv2-rail">
      <div className="rv2-rail-header">
        <button type="button" className="rv2-back-btn" onClick={onBack}><AppIcon name="chevronLeft" className="rv2-back-icon" />返回编剧工作台</button>
      </div>
      <div className="rvh-title">真实处理流程</div>
      <div className="rv2-rail-nodes">
        {NODES.map((node, order) => {
          const done = order < currentOrder || state === 'done'
          const active = order === currentOrder && state !== 'done'
          return (
            <div key={node.title} className={`rv2-node${active ? ' rv2-node--active' : ''}${done ? ' rv2-node--done' : ''}`}>
              <span className="rv2-dot">{done ? <AppIcon name="check" className="rv2-check-icon" /> : order + 1}</span>
              <span className="rv2-node-text"><span className="rv2-lbl">{node.title}</span><span className="rv2-sub">{node.subtitle}</span></span>
            </div>
          )
        })}
      </div>
    </aside>
  )
}
