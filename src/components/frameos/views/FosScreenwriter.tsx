'use client'

import { useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter } from '@/i18n/navigation'
import { ScreenwriterLoadingSkeleton } from '@/components/frameos/screenwriter/ScreenwriterLoadingSkeleton'
import { ScreenwriterWorkbench } from '@/components/frameos/screenwriter/ScreenwriterWorkbench'
import { getScreenwriterTaskNextRoute } from '@/components/frameos/screenwriter/screenwriterRoutes'
import { useScreenwriterTasks } from '@/components/frameos/screenwriter/useScreenwriterTasks'
import type { ScreenwriterModeKey, ScreenwriterScriptSummary } from '@/components/frameos/screenwriter/types'

export type ToolKey = 'video-repaint-2' | 'video2script' | 'video2board' | 'script2board' | 'board2board'

const VideoToTextDialog = dynamic(() => import('@/components/frameos/screenwriter/ScreenwriterDialogs').then((mod) => mod.VideoToTextDialog))
const RepaintDialog = dynamic(() => import('@/components/frameos/screenwriter/ScreenwriterDialogs').then((mod) => mod.RepaintDialog))

export function FosScreenwriter({ initialDialog }: { initialDialog?: ToolKey | null }) {
  void initialDialog
  const router = useRouter()
  const [dialog, setDialog] = useState<ToolKey | null>(null)
  const [isNavigating, setIsNavigating] = useState(false)
  const { tasks } = useScreenwriterTasks()

  const onCard = (key: ScreenwriterModeKey) => {
    if (key === 'script-repaint-2') {
      setIsNavigating(true)
      router.push({ pathname: '/screenwriter/script-repaint' })
      return
    }
  }

  const onScript = (script: ScreenwriterScriptSummary) => {
    setIsNavigating(true)
    router.push(getScreenwriterTaskNextRoute(script))
  }

  return (
    <>
      {isNavigating ? (
        <ScreenwriterLoadingSkeleton title="正在加载编剧工作台" />
      ) : (
        <ScreenwriterWorkbench scripts={tasks} onModeSelect={onCard} onScriptSelect={onScript} />
      )}

      {dialog === 'video2script' ? <VideoToTextDialog mode="script" onClose={() => setDialog(null)} /> : null}
      {dialog === 'video2board' ? <VideoToTextDialog mode="board" onClose={() => setDialog(null)} /> : null}
      {dialog === 'script2board' ? <RepaintDialog mode="script" onClose={() => setDialog(null)} /> : null}
      {dialog === 'board2board' ? <RepaintDialog mode="board" onClose={() => setDialog(null)} /> : null}
    </>
  )
}
