import { PrismaAdapter } from "@next-auth/prisma-adapter"
import CredentialsProvider from "next-auth/providers/credentials"
import bcrypt from "bcryptjs"
import { logAuthAction } from './logging/semantic'
import { prisma } from './prisma'
import { effectiveAccountPermissions, isManagementRole, normalizeAccountRole } from './account/permissions'
import { normalizeAccountCredit, normalizeAccountPointCredit } from './account/credits'
import { getGenerationWalletPoints } from './account/generation-wallet'
import {
  authCookieNamespace,
  isRoleAllowedOnSurface,
  resolveAppSurface,
  surfaceLoginError,
} from './app-surface'

const authSurface = resolveAppSurface()
const secureCookies = (process.env.NEXTAUTH_URL || '').startsWith('https://')
const cookieNamespace = authCookieNamespace(authSurface)
const securePrefix = secureCookies ? '__Secure-' : ''
const hostPrefix = secureCookies ? '__Host-' : ''

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const authOptions: any = {
  adapter: PrismaAdapter(prisma),
  // 🔥 允许从任意 Host 访问（解决局域网访问问题）
  trustHost: true,
  // 🔥 根据 URL 协议决定是否使用 Secure Cookie
  // 局域网 HTTP 访问时需要关闭，否则 Cookie 无法设置
  useSecureCookies: secureCookies,
  // The workspace and platform Admin run on different ports of the same host.
  // Cookie names must differ because browser cookies are not scoped by port.
  cookies: {
    sessionToken: {
      name: `${securePrefix}${cookieNamespace}.session-token`,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: secureCookies },
    },
    callbackUrl: {
      name: `${securePrefix}${cookieNamespace}.callback-url`,
      options: { sameSite: 'lax', path: '/', secure: secureCookies },
    },
    csrfToken: {
      name: `${hostPrefix}${cookieNamespace}.csrf-token`,
      options: { httpOnly: true, sameSite: 'lax', path: '/', secure: secureCookies },
    },
  },
  providers: [
    CredentialsProvider({
      name: "credentials",
      credentials: {
        username: { label: "Username", type: "text" },
        password: { label: "Password", type: "password" }
      },
      async authorize(credentials) {
        const username = credentials?.username?.trim() || ''
        if (!username || !credentials?.password) {
          logAuthAction('LOGIN', credentials?.username || 'unknown', { error: 'Missing credentials' })
          return null
        }

        const user = await prisma.user.findUnique({
          where: {
            name: username
          },
          include: {
            balance: {
              select: { balance: true },
            },
            parentAccount: {
              select: { id: true, role: true, status: true },
            },
          },
        })

        if (!user || !user.password) {
          logAuthAction('LOGIN', username, { error: 'User not found' })
          return null
        }

        if (user.status === 'disabled') {
          logAuthAction('LOGIN', username, { error: 'Account disabled', userId: user.id })
          return null
        }

        const role = normalizeAccountRole(user.role)
        if (!isManagementRole(role) && user.parentAccount?.status === 'disabled') {
          logAuthAction('LOGIN', username, { error: 'Manager account disabled', userId: user.id })
          return null
        }

        // 验证密码
        const isPasswordValid = await bcrypt.compare(credentials.password, user.password)

        if (!isPasswordValid) {
          logAuthAction('LOGIN', username, { error: 'Invalid password' })
          return null
        }

        if (!isRoleAllowedOnSurface(role, authSurface)) {
          logAuthAction('LOGIN', username, {
            error: 'Account role is not allowed on this application surface',
            userId: user.id,
            role,
            surface: authSurface,
          })
          // The password is valid. Preserve that distinction so the two login
          // pages can guide the account to the correct application surface.
          throw new Error(surfaceLoginError(role))
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLoginAt: new Date() },
        })

        logAuthAction('LOGIN', user.name, { userId: user.id, success: true })

        return {
          id: user.id,
          name: user.name,
          role,
          roleLabel: user.roleLabel,
          status: 'active',
          permissions: effectiveAccountPermissions(user.role, user.permissions),
          sessionVersion: user.sessionVersion,
          workspaceOwnerId: user.workspaceOwnerId,
          parentAccountId: user.parentAccountId,
          coinCredits: user.coinCredits,
          pointCredits: await getGenerationWalletPoints(user),
        }
      }
    })
  ],
  session: {
    strategy: "jwt"
  },
  pages: {
    signIn: "/auth/signin",
  },
  callbacks: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async jwt({ token, user }: any) {
      if (user) {
        token.id = user.id
        token.sessionVersion = user.sessionVersion
      }

      const userId = typeof token.id === 'string' ? token.id : ''
      if (!userId) return token

      const account = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          name: true,
          role: true,
          roleLabel: true,
          status: true,
          permissions: true,
          sessionVersion: true,
          workspaceOwnerId: true,
          parentAccountId: true,
          parentAccount: {
            select: { status: true },
          },
          coinCredits: true,
          balance: {
            select: { balance: true },
          },
        },
      })

      if (!account) {
        token.accountStatus = 'revoked'
        token.permissions = []
        return token
      }

      const tokenVersion = typeof token.sessionVersion === 'number' ? token.sessionVersion : account.sessionVersion
      const versionMatches = tokenVersion === account.sessionVersion
      const role = normalizeAccountRole(account.role)
      const managerDisabled = !isManagementRole(role) && account.parentAccount?.status === 'disabled'
      token.name = account.name
      token.role = role
      token.roleLabel = account.roleLabel
      token.accountStatus = versionMatches
        ? (account.status === 'disabled' || managerDisabled ? 'disabled' : 'active')
        : 'revoked'
      token.permissions = effectiveAccountPermissions(account.role, account.permissions)
      token.sessionVersion = tokenVersion
      token.workspaceOwnerId = account.workspaceOwnerId
      token.parentAccountId = account.parentAccountId
      token.coinCredits = normalizeAccountCredit(account.coinCredits)
      token.pointCredits = await getGenerationWalletPoints({ ...account, id: userId })
      return token
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async session({ session, token }: any) {
      if (token && session.user) {
        session.user.id = token.id as string
        session.user.name = typeof token.name === 'string' ? token.name : session.user.name
        session.user.role = normalizeAccountRole(token.role)
        session.user.roleLabel = typeof token.roleLabel === 'string' ? token.roleLabel : null
        session.user.status = token.accountStatus || 'active'
        session.user.permissions = Array.isArray(token.permissions) ? token.permissions : []
        session.user.sessionVersion = typeof token.sessionVersion === 'number' ? token.sessionVersion : 0
        session.user.workspaceOwnerId = typeof token.workspaceOwnerId === 'string' ? token.workspaceOwnerId : null
        session.user.parentAccountId = typeof token.parentAccountId === 'string' ? token.parentAccountId : null
        session.user.coinCredits = normalizeAccountCredit(token.coinCredits)
        session.user.pointCredits = normalizeAccountPointCredit(token.pointCredits)
      }
      return session
    }
  }
}
