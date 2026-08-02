'use client'

import { FosShell } from './FosShell'
import { FosVideoRepaintTask } from './views/FosVideoRepaintTask'

export function FosVideoRepaintClient({ scriptId = 'new' }: { scriptId?: string }) {
  return (
    <FosShell activeKey="screenwriter" hideSidebar>
      <FosVideoRepaintTask scriptId={scriptId} />
    </FosShell>
  )
}
