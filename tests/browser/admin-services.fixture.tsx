import React from 'react'
import { createRoot } from 'react-dom/client'
import { PlatformAdminServicesClient } from '../../src/components/admin/PlatformAdminServicesClient'
import { SessionProvider } from 'next-auth/react'
import type { Session } from 'next-auth'

const session: Session = {
  user: {
    id: 'admin-test', name: '测试管理员', role: 'super_admin', status: 'active',
    passwordChangeRequired: false, permissions: [], sessionVersion: 1,
    coinCredits: 0, pointCredits: 0,
  },
  expires: '2099-01-01',
}
createRoot(document.getElementById('root')!).render(
  <SessionProvider session={session}>
    <PlatformAdminServicesClient />
  </SessionProvider>,
)
