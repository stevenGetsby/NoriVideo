'use client'

import { useRouter } from '@/i18n/navigation'
import { FosShell } from './FosShell'
import { VideoRepaintCreateForm } from './screenwriter/VideoRepaintCreateForm'
import { createVideoRepaintTask } from './screenwriter/screenwriterMockStore'
import type { VideoRepaintCreateInput } from './screenwriter/types'

export function FosVideoRepaintClient() {
  const router = useRouter()

  const handleStart = (input: VideoRepaintCreateInput) => {
    const task = createVideoRepaintTask(input)
    router.push(task.nextRoute)
  }

  return (
    <FosShell activeKey="screenwriter" hideSidebar
      header={<div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-6 py-4"><h1 className="text-[16px] font-bold text-white">视频转绘 2.0</h1></div>}>
      <VideoRepaintCreateForm
        onBack={() => router.push({ pathname: '/screenwriter' })}
        onStart={handleStart}
      />
    </FosShell>
  )
}
