import { useSyncExternalStore } from 'react'

type StubUser = {
  id: string
  name: string
  role: string
  permissions: string[]
  workspaceOwnerId?: string
  pointCredits?: number
}
type StubSession = {
  data: { user: StubUser }
  status: string
}

const childMode = typeof location !== 'undefined' && new URLSearchParams(location.search).get('session') === 'child'
const adminMode = typeof location !== 'undefined' && new URLSearchParams(location.search).get('view')?.startsWith('admin')
let session: StubSession = {
  data: { user: adminMode
    ? { id: 'admin-1', name: 'Platform Admin', role: 'super_admin', permissions: [] }
    : childMode
    ? { id: 'child-1', name: '测试子账号', role: 'storyboard', permissions: ['canvasWrite', 'toolboxUse'], workspaceOwnerId: 'user-1', pointCredits: 0 }
    : { id: 'user-1', name: '测试资产师', role: 'admin', permissions: ['assetWrite'] } },
  status: 'authenticated',
}
const listeners = new Set<() => void>()

export function setFixtureSession(user: StubUser) {
  session = { ...session, data: { user } }
  listeners.forEach((notify) => notify())
}

export function useSession(): StubSession {
  return useSyncExternalStore(
    (notify) => { listeners.add(notify); return () => { listeners.delete(notify) } },
    () => session,
    () => session,
  )
}

export function SessionProvider({ children }: { children: unknown }) {
  return children
}

export async function signOut() {}
export async function signIn() { return { ok: true, status: 200, error: null } }
export async function getSession() { return session.data }
