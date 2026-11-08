import { useSyncExternalStore } from 'react'

type StubUser = {
  id: string
  name: string
  role: string
  permissions: string[]
  workspaceOwnerId?: string
  actorId?: string
  projectLeader?: boolean
  pointCredits?: number
}
type StubSession = {
  data: { user: StubUser }
  status: string
}

const childMode = typeof location !== 'undefined' && new URLSearchParams(location.search).get('session') === 'child'
const adminMode = typeof location !== 'undefined' && new URLSearchParams(location.search).get('view')?.startsWith('admin')
const readOnlyMode = typeof location !== 'undefined' && new URLSearchParams(location.search).has('readonly')
const graphReadOnlyMode = readOnlyMode && !new URLSearchParams(location.search).has('view')
const graphRole = graphReadOnlyMode ? 'unauthenticated' : childMode ? 'storyboard' : 'admin'
let session: StubSession = {
  data: { user: adminMode
    ? { id: 'admin-1', name: 'Platform Admin', role: 'super_admin', permissions: [] }
    : childMode
    ? { id: 'child-1', name: '测试子账号', role: graphRole, permissions: graphReadOnlyMode ? [] : ['canvasWrite', 'toolboxUse'], workspaceOwnerId: 'user-1', pointCredits: 0 }
    : { id: 'user-1', name: '测试资产师', role: graphRole, permissions: ['assetWrite'] } },
  status: 'authenticated',
}
const listeners = new Set<() => void>()

export function setFixtureSession(user: StubUser) {
  session = { ...session, data: { user } }
  listeners.forEach((notify) => notify())
}

export function refreshFixtureSession() {
  session = { ...session, data: { ...session.data, user: { ...session.data.user } } }
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
