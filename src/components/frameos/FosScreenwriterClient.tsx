'use client'

import { useSearchParams } from 'next/navigation'
import { FosShell } from './FosShell'
import { FosScreenwriter } from './views/FosScreenwriter'
import type { ToolKey } from './views/FosScreenwriter'

const DIALOG_TOOLS: ToolKey[] = ['video2script', 'video2board', 'script2board', 'board2board']

export function FosScreenwriterClient() {
  const params = useSearchParams()
  const raw = params?.get('tool')
  const initialDialog = DIALOG_TOOLS.includes(raw as ToolKey) ? (raw as ToolKey) : null

  return (
    <FosShell activeKey="screenwriter" header={<ScreenwriterHeader />}>
      <FosScreenwriter initialDialog={initialDialog} />
    </FosShell>
  )
}

function ScreenwriterHeader() {
  return (
    <div className="flex items-center gap-3 px-6 py-4">
      <h1 className="text-[18px] font-bold text-white">编剧工作台</h1>
    </div>
  )
}
