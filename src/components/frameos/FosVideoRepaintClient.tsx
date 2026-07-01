'use client'

import { FosShell } from './FosShell'
import { FosVideoRepaintTask } from './views/FosVideoRepaintTask'

export function FosVideoRepaintClient() {
  return (
    <FosShell activeKey="screenwriter" hideSidebar
      header={<div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-6 py-4"><h1 className="text-[16px] font-bold text-white">视频转绘 2.0</h1></div>}>
      <FosVideoRepaintTask />
    </FosShell>
  )
}
