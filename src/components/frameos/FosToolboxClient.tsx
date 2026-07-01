'use client'

import { useSearchParams } from 'next/navigation'
import { FosShell } from './FosShell'
import { FosToolbox } from './views/FosToolbox'
import type { ToolTab } from './views/FosToolbox'

const VALID_TABS: ToolTab[] = ['seedance', 'image', 'video', 'music', 'material']

export function FosToolboxClient() {
  const params = useSearchParams()
  const raw = params?.get('tab')
  const initialTab = VALID_TABS.includes(raw as ToolTab) ? (raw as ToolTab) : undefined

  return (
    <FosShell activeKey="toolbox">
      <FosToolbox initialTab={initialTab} />
    </FosShell>
  )
}
