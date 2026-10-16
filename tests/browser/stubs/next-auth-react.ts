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
let session: StubSession = {
  data: { user: childMode
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
