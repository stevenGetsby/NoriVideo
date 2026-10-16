/**
 * 🔐 API 权限验证工具
 * 集中管理 Session 验证、作品权限检查等通用逻辑
 */

import { getServerSession } from 'next-auth/next'
import { NextResponse } from 'next/server'
import { headers as readHeaders } from 'next/headers'
import { authOptions } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { withPrismaRetry } from '@/lib/prisma-retry'
import { extractModelKey } from '@/lib/config-service'
import { getErrorSpec, type UnifiedErrorCode } from '@/lib/errors/codes'
import { getLogContext, setLogContext } from '@/lib/logging/context'
import { getOrCreateTestModeSession, isTestModeEnabled } from '@/lib/test-mode'
import { getAccountPermissionContext, setAccountActorContext } from '@/lib/account/request-context'
import { normalizeAccountCredit } from '@/lib/account/credits'
import { getGenerationWalletPoints } from '@/lib/account/generation-wallet'
import { projectReadWhere } from '@/lib/collaboration/access'
import {
    effectiveAccountPermissions,
    hasAccountPermissions,
    isAccountPermission,
    isManagementRole,
    normalizeAccountRole,
    type AccountPermission,
    type AccountRole,
    type AccountStatus,
} from '@/lib/account/permissions'

// ============================================================
// 类型定义
// ============================================================

export interface AuthSession {
    user: {
        id: string
        name?: string | null
        email?: string | null
        role?: AccountRole
        roleLabel?: string | null
        status?: AccountStatus | 'revoked'
        permissions?: AccountPermission[]
        sessionVersion?: number
        actorId?: string
        workspaceOwnerId?: string | null
        parentAccountId?: string | null
        coinCredits?: number
        pointCredits?: number
    }
}

function bindAuthLogContext(session: AuthSession, projectId?: string) {
    const context = getLogContext()
    if (!context.requestId) return
    setLogContext({
        userId: session.user.actorId || session.user.id,
        ...(projectId ? { projectId } : {}),
    })
}

async function validateSessionUser(
    session: AuthSession,
    requiredPermissions: readonly AccountPermission[] = [],
): Promise<NextResponse | null> {
    const user = await withPrismaRetry(() =>
        prisma.user.findUnique({
            where: { id: session.user.actorId || session.user.id },
            select: {
                id: true,
                name: true,
                email: true,
                role: true,
                roleLabel: true,
                status: true,
                permissions: true,
                sessionVersion: true,
                workspaceOwnerId: true,
                parentAccountId: true,
                parentAccount: {
                    select: {
                        id: true,
                        role: true,
                        status: true,
                    },
                },
                coinCredits: true,
                balance: {
                    select: { balance: true },
                },
            },
        })
    )
    if (!user) return unauthorized('登录已失效，请重新登录。')

    const role = normalizeAccountRole(user.role)
    const status: AccountStatus = user.status === 'active' ? 'active' : 'disabled'
    const permissions = effectiveAccountPermissions(role, user.permissions)
    const sessionVersion = typeof session.user.sessionVersion === 'number'
        ? session.user.sessionVersion
        : user.sessionVersion

    if (session.user.status === 'revoked' || sessionVersion !== user.sessionVersion) {
        return unauthorized('密码已重置或登录已失效，请重新登录。')
    }
    if (user.status !== 'active') {
        return forbidden('账号已停用，请联系管理员。')
    }
    if (!isManagementRole(role) && user.parentAccount?.status === 'disabled') {
        return forbidden('所属管理账号已停用，请联系平台管理员。')
    }
    const contextualPermissions = getAccountPermissionContext().filter(isAccountPermission)
    const allRequiredPermissions = Array.from(new Set([...contextualPermissions, ...requiredPermissions]))
    if (!hasAccountPermissions({ role, permissions }, allRequiredPermissions)) {
        return forbidden('当前账号没有执行此操作的权限。')
    }

    session.user.name = user.name
    session.user.email = user.email
    session.user.role = role
    session.user.roleLabel = user.roleLabel
    session.user.status = status
    session.user.permissions = permissions
    session.user.sessionVersion = user.sessionVersion
    session.user.actorId = user.id
    session.user.workspaceOwnerId = isManagementRole(role) ? user.id : (user.workspaceOwnerId || user.id)
    session.user.parentAccountId = user.parentAccountId
    session.user.coinCredits = normalizeAccountCredit(user.coinCredits)
    session.user.pointCredits = await getGenerationWalletPoints(user)
    session.user.id = session.user.workspaceOwnerId
    setAccountActorContext(user.id, session.user.workspaceOwnerId)
    return null
}

async function getInternalTaskSession(): Promise<AuthSession | null> {
    const expectedToken = process.env.INTERNAL_TASK_TOKEN || ''

    const incomingHeaders = await readHeaders()
    const token = incomingHeaders.get('x-internal-task-token') || ''
    const userId = incomingHeaders.get('x-internal-user-id') || ''
    if (!userId) return null
    if (expectedToken) {
        if (token !== expectedToken) return null
    } else if (process.env.NODE_ENV === 'production') {
        return null
    }

    return {
        user: {
            id: userId,
            name: 'internal-worker',
            email: null,
        }
    }
}

/**
 * 可选的关联数据加载配置
 */
export type ProjectAuthIncludes = {
    characters?: boolean
    locations?: boolean
    episodes?: boolean
}

interface AuthCharacterLike {
    name: string
    introduction?: string | null
    [key: string]: unknown
}

interface AuthLocationLike {
    name: string
    [key: string]: unknown
}

interface AuthEpisodeLike {
    id: string
    [key: string]: unknown
}

/**
 * 基础 novelData 类型
 */
export interface NovelDataBase {
    id: string
    [key: string]: unknown
}

/**
 * 根据 include 选项推断的 novelData 类型
 */
export type NovelDataWithIncludes<T extends ProjectAuthIncludes> = NovelDataBase
    & (T['characters'] extends true ? { characters: AuthCharacterLike[] } : Record<string, never>)
    & (T['locations'] extends true ? { locations: AuthLocationLike[] } : Record<string, never>)
    & (T['episodes'] extends true ? { episodes: AuthEpisodeLike[] } : Record<string, never>)

/**
 * 完整的认证上下文（带泛型）
 */
export interface ProjectAuthContextWithIncludes<T extends ProjectAuthIncludes = ProjectAuthIncludes> {
    session: AuthSession
    project: {
        id: string
        userId: string
        name: string
        [key: string]: unknown
    }
    novelData: NovelDataWithIncludes<T>
}

/**
 * 向后兼容的类型别名
 */
export type ProjectAuthContext = ProjectAuthContextWithIncludes<ProjectAuthIncludes>

// ============================================================
// 错误响应工具
// ============================================================

function buildErrorResponse(code: UnifiedErrorCode, message?: string, details: Record<string, unknown> = {}) {
    const spec = getErrorSpec(code)
    const finalMessage = message?.trim() || spec.defaultMessage
    return NextResponse.json(
        {
            success: false,
            error: {
                code,
                message: finalMessage,
                retryable: spec.retryable,
                category: spec.category,
                userMessageKey: spec.userMessageKey,
                details,
            },
            code,
            message: finalMessage,
            ...details,
        },
        { status: spec.httpStatus },
    )
}

export function unauthorized(message = 'Unauthorized') {
    return buildErrorResponse('UNAUTHORIZED', message)
}

export function forbidden(message = 'Forbidden') {
    return buildErrorResponse('FORBIDDEN', message)
}

export function notFound(resource = 'Resource') {
    return buildErrorResponse('NOT_FOUND', `${resource} not found`)
}

export function badRequest(message: string) {
    return buildErrorResponse('INVALID_PARAMS', message)
}

export function serverError(message = 'Internal server error') {
    return buildErrorResponse('INTERNAL_ERROR', message)
}

// ============================================================
// 权限验证函数
// ============================================================

/**
 * 验证用户 Session
 * @returns session 或 null
 */
export async function getAuthSession(): Promise<AuthSession | null> {
    const internalSession = await getInternalTaskSession()
    if (internalSession) return internalSession
    if (isTestModeEnabled()) return await getOrCreateTestModeSession()
    const session = await getServerSession(authOptions)
    return session as AuthSession | null
}

/**
 * 要求用户登录
 * @throws 返回 401 响应
 */
export async function requireAuth(requiredPermissions: readonly AccountPermission[] = []): Promise<AuthSession> {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        throw { response: unauthorized() }
    }
    const invalidUserResponse = await validateSessionUser(session, requiredPermissions)
    if (invalidUserResponse) {
        throw { response: invalidUserResponse }
    }
    bindAuthLogContext(session)
    return session
}

/**
 * 验证作品访问权限
 * 包含：Session 验证 + 作品存在检查 + 所有权验证 + NovelPromotionData 检查
 * 
 * @param projectId 作品 ID
 * @param options 可选配置，支持按需加载关联数据
 * @returns 验证上下文（session, project, novelData）
 * @throws 返回对应的错误响应
 * 
 * @example
 * ```typescript
 * // 基础用法（不加载关联数据）
 * const authResult = await requireProjectAuth(projectId)
 * 
 * // 加载 characters 和 locations
 * const authResult = await requireProjectAuth(projectId, {
 *   include: { characters: true, locations: true }
 * })
 * // authResult.novelData.characters 和 locations 自动可用
 * ```
 */
export async function requireProjectAuth<T extends ProjectAuthIncludes = ProjectAuthIncludes>(
    projectId: string,
    options?: { include?: T; permissions?: readonly AccountPermission[] }
): Promise<ProjectAuthContextWithIncludes<T> | NextResponse> {
    // 1. 验证 Session
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return unauthorized()
    }
    const invalidUserResponse = await validateSessionUser(session, options?.permissions)
    if (invalidUserResponse) return invalidUserResponse
    bindAuthLogContext(session, projectId)

    // 2. 构建动态 include 对象
    const novelPromotionIncludes: Record<string, boolean> = {}
    if (options?.include?.characters) {
        novelPromotionIncludes.characters = true
    }
    if (options?.include?.locations) {
        novelPromotionIncludes.locations = true
    }
    if (options?.include?.episodes) {
        novelPromotionIncludes.episodes = true
    }

    // 3. 获取作品（包含 novelPromotionData 及其可选关联）
    const hasIncludes = Object.keys(novelPromotionIncludes).length > 0
    const project = await withPrismaRetry(() =>
        prisma.project.findFirst({
            where: projectReadWhere(session, projectId),
            include: {
                novelPromotionData: hasIncludes
                    ? { include: novelPromotionIncludes }
                    : true
            }
        })
    )

    // 4. 作品存在检查
    if (!project) {
        return notFound('Project')
    }

    // 5. NovelPromotionData 检查
    if (!project.novelPromotionData) {
        return notFound('Novel promotion data')
    }

    // 统一返回 modelKey（provider::modelId），禁止降级为纯 modelId
    const rawNovelData = project.novelPromotionData as {
        analysisModel?: string | null
        characterModel?: string | null
        locationModel?: string | null
        storyboardModel?: string | null
        editModel?: string | null
        videoModel?: string | null
        audioModel?: string | null
        [key: string]: unknown
    }
    const processedNovelData = {
        ...rawNovelData,
        analysisModel: extractModelKey(rawNovelData.analysisModel),
        characterModel: extractModelKey(rawNovelData.characterModel),
        locationModel: extractModelKey(rawNovelData.locationModel),
        storyboardModel: extractModelKey(rawNovelData.storyboardModel),
        editModel: extractModelKey(rawNovelData.editModel),
        videoModel: extractModelKey(rawNovelData.videoModel),
        audioModel: extractModelKey(rawNovelData.audioModel),
    }

    return {
        session,
        project,
        novelData: processedNovelData as unknown as NovelDataWithIncludes<T>
    }
}

/**
 * 仅验证 Session，不检查作品权限
 * 适用于用户级 API（如资产库）
 * 
 * @example
 * ```typescript
 * const authResult = await requireUserAuth()
 * if (authResult instanceof NextResponse) return authResult
 * 
 * const { session } = authResult
 * ```
 */
export async function requireUserAuth(): Promise<{ session: AuthSession } | NextResponse> {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return unauthorized()
    }
    const invalidUserResponse = await validateSessionUser(session)
    if (invalidUserResponse) return invalidUserResponse
    bindAuthLogContext(session)
    return { session }
}

/**
 * 验证作品权限（不要求 NovelPromotionData）
 * 适用于某些不需要 novelPromotionData 的 API
 */
export async function requireProjectAuthLight(
    projectId: string,
    requiredPermissions: readonly AccountPermission[] = [],
): Promise<{ session: AuthSession; project: { id: string; userId: string; name: string; [key: string]: unknown } } | NextResponse> {
    const session = await getAuthSession()
    if (!session?.user?.id) {
        return unauthorized()
    }
    const invalidUserResponse = await validateSessionUser(session, requiredPermissions)
    if (invalidUserResponse) return invalidUserResponse
    bindAuthLogContext(session, projectId)

    const project = await withPrismaRetry(() =>
        prisma.project.findFirst({
            where: projectReadWhere(session, projectId)
        })
    )

    if (!project) {
        return notFound('Project')
    }

    return { session, project }
}

export async function requireUserPermission(
    requiredPermissions: readonly AccountPermission[],
): Promise<{ session: AuthSession } | NextResponse> {
    const session = await getAuthSession()
    if (!session?.user?.id) return unauthorized()
    const invalidUserResponse = await validateSessionUser(session, requiredPermissions)
    if (invalidUserResponse) return invalidUserResponse
    bindAuthLogContext(session)
    return { session }
}

export async function requireAdminAuth(): Promise<{ session: AuthSession } | NextResponse> {
    const authResult = await requireUserPermission([])
    if (authResult instanceof NextResponse) return authResult
    if (!isManagementRole(authResult.session.user.role)) {
        return forbidden('仅管理账号可以执行此操作。')
    }
    return authResult
}

export async function requireSuperAdminAuth(): Promise<{ session: AuthSession } | NextResponse> {
    const authResult = await requireAdminAuth()
    if (authResult instanceof NextResponse) return authResult
    if (normalizeAccountRole(authResult.session.user.role) !== 'super_admin') {
        return forbidden('仅平台 Admin 可以管理全局服务配置。')
    }
    return authResult
}

export const requireOwnerAuth = requireAdminAuth

// ============================================================
// 类型守卫
// ============================================================

/**
 * 检查是否是错误响应
 */
export function isErrorResponse(result: unknown): result is NextResponse {
    return result instanceof NextResponse
}
