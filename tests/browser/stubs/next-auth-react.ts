type StubSession = {
  data: { user: { id: string; name: string; role: string; permissions: string[] } }
  status: string
}

export function useSession(): StubSession {
  return {
    data: { user: { id: 'user-1', name: '测试资产师', role: 'admin', permissions: ['assetWrite'] } },
    status: 'authenticated',
  }
}

export function SessionProvider({ children }: { children: unknown }) {
  return children
}
