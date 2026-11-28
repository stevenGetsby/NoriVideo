'use client'

import { lazy, memo, Suspense, useEffect, useState } from 'react'
import { AppIcon } from '@/components/ui/icons'
import type { CanvasAgentBridge } from './bridge-types'
import type { AgentFeedbackStore } from './feedback-store'
import './canvas-agent.css'

const Panel = lazy(() => import('./CanvasAgentPanel'))

export const CanvasAgentDock = memo(function CanvasAgentDock({ bridge, title, open, onOpenChange, feedback }: {
  bridge: CanvasAgentBridge
  title: string
  open: boolean
  onOpenChange(open: boolean): void
  feedback: AgentFeedbackStore
}) {
  const [activated, setActivated] = useState(open)
  useEffect(() => { if (open) setActivated(true) }, [open])
  return <>
    {!open && <button type="button" className="nori-canvas-agent-launcher" onClick={() => onOpenChange(true)} aria-label="打开喵导" title="喵导 · 画布助手（⌘J）">
      <AppIcon name="sparkles" />喵导 <kbd>⌘J</kbd>
    </button>}
    {(open || activated) && <Suspense fallback={open ? <aside className="nori-canvas-agent-panel" aria-label="喵导">正在加载喵导…</aside> : null}>
      <Panel bridge={bridge} title={title} open={open} feedback={feedback} onClose={() => onOpenChange(false)} />
    </Suspense>}
  </>
})
