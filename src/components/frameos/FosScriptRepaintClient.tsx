'use client'

import { useState } from 'react'
import { useRouter } from '@/i18n/navigation'
import { FosShell } from './FosShell'
import { ScriptRepaintCreateForm } from './screenwriter/ScriptRepaintCreateForm'
import { ScreenwriterLoadingSkeleton } from './screenwriter/ScreenwriterLoadingSkeleton'
import { createScriptRepaintTask } from './screenwriter/screenwriterApi'
import type { ScriptRepaintCreateInput } from './screenwriter/types'

export function FosScriptRepaintClient() {
  const router = useRouter()
  const [isNavigating, setIsNavigating] = useState(false)

  const handleStart = async (input: ScriptRepaintCreateInput) => {
    const task = await createScriptRepaintTask(input)
    setIsNavigating(true)
    router.push(task.nextRoute)
  }

  return (
    <FosShell
      activeKey="screenwriter"
      hideSidebar
      header={<div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-6 py-4"><h1 className="text-[16px] font-bold text-white">剧本转绘 2.0</h1></div>}
    >
      {isNavigating ? (
        <ScreenwriterLoadingSkeleton title="正在加载剧本转绘页面" />
      ) : (
        <ScriptRepaintCreateForm
          onBack={() => {
            setIsNavigating(true)
            router.push({ pathname: '/screenwriter' })
          }}
          onStart={handleStart}
        />
      )}
    </FosShell>
  )
}
