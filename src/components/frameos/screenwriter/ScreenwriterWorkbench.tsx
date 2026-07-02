'use client'

import { useState } from 'react'
import { ScreenwriterEmptyCanvas } from './ScreenwriterEmptyCanvas'
import { ScreenwriterModeCards } from './ScreenwriterModeCards'
import { ScreenwriterScriptSidebar } from './ScreenwriterScriptSidebar'
import { emptyScreenwriterModeCards, screenwriterModeCards } from './screenwriterDemoData'
import type { ScreenwriterModeKey, ScreenwriterScriptSummary } from './types'

export function ScreenwriterWorkbench({
  scripts,
  onModeSelect,
}: {
  scripts: ScreenwriterScriptSummary[]
  onModeSelect: (key: ScreenwriterModeKey) => void
}) {
  const [selectedScriptId, setSelectedScriptId] = useState<string | null>(null)

  if (scripts.length === 0) {
    return (
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-10">
        <ScreenwriterModeCards cards={emptyScreenwriterModeCards} variant="empty" onSelect={onModeSelect} />
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="border-b border-[var(--fos-border-soft)] px-4 py-4 lg:px-6">
        <ScreenwriterModeCards cards={screenwriterModeCards} onSelect={onModeSelect} />
      </div>
      <div className="flex min-h-0 flex-1">
        <ScreenwriterScriptSidebar
          scripts={scripts}
          selectedScriptId={selectedScriptId}
          onSelectScript={setSelectedScriptId}
        />
        <ScreenwriterEmptyCanvas />
      </div>
    </div>
  )
}
