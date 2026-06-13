'use client'

import React from 'react'
import VideoPanelCardHeader from './VideoPanelCardHeader'
import VideoPanelCardBody from './VideoPanelCardBody'
import VideoPanelCardFooter from './VideoPanelCardFooter'
import { useVideoPanelActions, type VideoPanelCardShellProps } from './hooks/useVideoPanelActions'

export type { VideoPanelCardShellProps }

function VideoPanelCardLayout(props: VideoPanelCardShellProps) {
  const runtime = useVideoPanelActions(props)

  return (
    <div className="glass-surface-elevated overflow-hidden border border-[var(--glass-border-light)] bg-[var(--glass-bg-surface)]">
      <div className="grid gap-0 lg:grid-cols-[minmax(220px,320px)_minmax(0,1fr)]">
      <VideoPanelCardHeader runtime={runtime} />
      <VideoPanelCardBody runtime={runtime} />
      </div>
      <VideoPanelCardFooter runtime={runtime} />
    </div>
  )
}

export default React.memo(VideoPanelCardLayout)
