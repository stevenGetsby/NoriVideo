'use client'

import { FosShell } from './FosShell'
import { FosToolbox } from './views/FosToolbox'

export function FosToolboxClient() {
  return (
    <FosShell activeKey="toolbox" hideSidebar>
      <FosToolbox />
    </FosShell>
  )
}
