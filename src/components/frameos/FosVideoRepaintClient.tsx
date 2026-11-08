'use client'

import { useRouter } from '@/i18n/navigation'
import { FosShell } from './FosShell'
import { FosVideoRepaintTask } from './views/FosVideoRepaintTask'

export function FosVideoRepaintClient({ scriptId = 'new' }: { scriptId?: string }) {
  const router = useRouter()
  return (
    <FosShell activeKey="screenwriter" hideSidebar>
      <FosVideoRepaintTask
        scriptId={scriptId}
        onExit={() => router.push({ pathname: '/writer-workbench' })}
      />
    </FosShell>
  )
}
