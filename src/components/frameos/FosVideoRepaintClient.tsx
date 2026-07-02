'use client'

import { useRouter } from '@/i18n/navigation'
import { FosShell } from './FosShell'
import { VideoRepaintCreateForm } from './screenwriter/VideoRepaintCreateForm'

export function FosVideoRepaintClient() {
  const router = useRouter()

  return (
    <FosShell activeKey="screenwriter" hideSidebar
      header={<div className="flex items-center gap-3 border-b border-[var(--fos-border-soft)] px-6 py-4"><h1 className="text-[16px] font-bold text-white">视频转绘 2.0</h1></div>}>
      <VideoRepaintCreateForm
        onBack={() => router.push({ pathname: '/screenwriter' })}
        onStart={() => router.push('/screenwriter/video-repaint/demo-oversea-redraw-task')}
      />
    </FosShell>
  )
}
