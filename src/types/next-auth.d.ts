import type { DefaultSession } from 'next-auth'
import type { DefaultJWT } from 'next-auth/jwt'

type NoriAccountRole = 'super_admin' | 'admin' | 'writer' | 'asset' | 'storyboard' | 'reviewer'
type NoriAccountPermission = 'read' | 'projectCreate' | 'scriptWrite' | 'assetWrite' | 'storyboardWrite' | 'toolboxUse' | 'canvasWrite' | 'admin'

declare module 'next-auth' {
  interface Session {
    user: DefaultSession['user'] & {
      id: string
      role: NoriAccountRole
      roleLabel?: string | null
      status: 'active' | 'disabled' | 'revoked'
      permissions: NoriAccountPermission[]
      sessionVersion: number
      workspaceOwnerId?: string | null
      parentAccountId?: string | null
      coinCredits: number
      pointCredits: number
    }
  }

  interface User {
    role?: NoriAccountRole
    roleLabel?: string | null
    status?: 'active' | 'disabled'
    permissions?: NoriAccountPermission[]
    sessionVersion?: number
    workspaceOwnerId?: string | null
    parentAccountId?: string | null
    coinCredits?: number
    pointCredits?: number
  }
}

declare module 'next-auth/jwt' {
  interface JWT extends DefaultJWT {
    id: string
    role?: NoriAccountRole
    roleLabel?: string | null
    accountStatus?: 'active' | 'disabled' | 'revoked'
    permissions?: NoriAccountPermission[]
    sessionVersion?: number
    workspaceOwnerId?: string | null
    parentAccountId?: string | null
    coinCredits?: number
    pointCredits?: number
  }
}
