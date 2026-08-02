export const ACCOUNT_ROLES = ['super_admin', 'admin', 'writer', 'asset', 'storyboard', 'reviewer'] as const
export const MANAGEMENT_ROLES = ['super_admin', 'admin'] as const
export const SUBACCOUNT_ROLES = ['writer', 'asset', 'storyboard', 'reviewer'] as const
export const ACCOUNT_STATUSES = ['active', 'disabled'] as const
export const ACCOUNT_PERMISSION_KEYS = [
  'read',
  'projectCreate',
  'scriptWrite',
  'assetWrite',
  'storyboardWrite',
  'toolboxUse',
  'canvasWrite',
  'admin',
] as const

export type AccountRole = typeof ACCOUNT_ROLES[number]
export type ManagementRole = typeof MANAGEMENT_ROLES[number]
export type SubaccountRole = typeof SUBACCOUNT_ROLES[number]
export type AccountStatus = typeof ACCOUNT_STATUSES[number]
export type AccountPermission = typeof ACCOUNT_PERMISSION_KEYS[number]

export const ACCOUNT_ROLE_DEFINITIONS: ReadonlyArray<{
  role: AccountRole
  label: string
  shortLabel: string
  description: string
}> = [
  { role: 'super_admin', label: '平台 Admin', shortLabel: '平台 Admin', description: '通过独立控制台创建和维护直属管理账号' },
  { role: 'admin', label: '管理账号', shortLabel: '管理', description: '拥有工作区全部读写、设置及账号管理权限' },
  { role: 'writer', label: '编剧模板', shortLabel: '编剧', description: '默认开启剧本、工具箱和无限画布；保存后仍可逐项调整' },
  { role: 'asset', label: '资产师模板', shortLabel: '资产师', description: '默认开启资产、工具箱和无限画布；保存后仍可逐项调整' },
  { role: 'storyboard', label: '分镜师模板', shortLabel: '分镜师', description: '默认开启分镜、工具箱和无限画布；保存后仍可逐项调整' },
  { role: 'reviewer', label: '审核员模板', shortLabel: '审核员', description: '默认仅查看；由平台 Admin 按项目授予任务审核权限' },
]

export const ACCOUNT_PERMISSION_DEFINITIONS: ReadonlyArray<{
  key: AccountPermission
  label: string
  description: string
}> = [
  { key: 'read', label: '读取团队内容', description: '查看所属管理账号下的全部项目和资产' },
  { key: 'projectCreate', label: '创建项目', description: '在管理账号已有作品中创建新项目并完成初始配置' },
  { key: 'scriptWrite', label: '剧本', description: '编辑剧本、解析剧本及使用视频转绘' },
  { key: 'assetWrite', label: '资产', description: '编辑角色、场景、道具、音色及生成资产' },
  { key: 'storyboardWrite', label: '分镜', description: '解析分镜、编辑镜头、生成和提交视频' },
  { key: 'toolboxUse', label: '工具箱', description: '使用工具箱内的图片、视频、音频与 3D 生成功能' },
  { key: 'canvasWrite', label: '无限画布', description: '编辑画布节点、工作流并执行画布生成任务' },
  { key: 'admin', label: '账号与系统管理', description: '管理账号、服务配置及工作区结构' },
]

export const ACCOUNT_FUNCTION_PERMISSION_DEFINITIONS = ACCOUNT_PERMISSION_DEFINITIONS.filter(
  (definition) => definition.key !== 'read' && definition.key !== 'admin',
)

const ROLE_PERMISSIONS: Record<AccountRole, AccountPermission[]> = {
  super_admin: ['read', 'projectCreate', 'scriptWrite', 'assetWrite', 'storyboardWrite', 'toolboxUse', 'canvasWrite', 'admin'],
  admin: ['read', 'projectCreate', 'scriptWrite', 'assetWrite', 'storyboardWrite', 'toolboxUse', 'canvasWrite', 'admin'],
  writer: ['read', 'scriptWrite', 'toolboxUse', 'canvasWrite'],
  asset: ['read', 'assetWrite', 'toolboxUse', 'canvasWrite'],
  storyboard: ['read', 'storyboardWrite', 'toolboxUse', 'canvasWrite'],
  reviewer: ['read'],
}

export const ALL_ACCOUNT_PERMISSIONS: AccountPermission[] = [...ROLE_PERMISSIONS.super_admin]
export const DEFAULT_MEMBER_PERMISSIONS: AccountPermission[] = [...ROLE_PERMISSIONS.writer]

export function isAccountRole(value: unknown): value is AccountRole {
  return typeof value === 'string' && ACCOUNT_ROLES.includes(value as AccountRole)
}

export function isManagementRole(value: unknown): value is ManagementRole {
  return typeof value === 'string' && MANAGEMENT_ROLES.includes(value as ManagementRole)
}

export function isSubaccountRole(value: unknown): value is SubaccountRole {
  return typeof value === 'string' && SUBACCOUNT_ROLES.includes(value as SubaccountRole)
}

export function isAccountStatus(value: unknown): value is AccountStatus {
  return typeof value === 'string' && ACCOUNT_STATUSES.includes(value as AccountStatus)
}

export function isAccountPermission(value: unknown): value is AccountPermission {
  return typeof value === 'string' && ACCOUNT_PERMISSION_KEYS.includes(value as AccountPermission)
}

export function normalizeAccountRole(value: unknown): AccountRole {
  if (value === 'super_admin' || value === 'platform_admin' || value === 'owner') return 'super_admin'
  if (value === 'admin') return 'admin'
  if (value === 'asset' || value === 'assetArtist') return 'asset'
  if (value === 'storyboard' || value === 'storyboardArtist') return 'storyboard'
  if (value === 'reviewer' || value === 'review') return 'reviewer'
  return 'writer'
}

export function isSuperAdminRole(value: unknown): value is 'super_admin' {
  return normalizeAccountRole(value) === 'super_admin'
}

export function defaultSubaccountRoleLabel(role: unknown): string {
  const normalizedRole = normalizeAccountRole(role)
  if (normalizedRole === 'asset') return '资产师'
  if (normalizedRole === 'storyboard') return '分镜师'
  if (normalizedRole === 'reviewer') return '审核员'
  return '编剧'
}

function normalizePermissionList(value: unknown): AccountPermission[] {
  if (!Array.isArray(value)) return []
  const requested = new Set<AccountPermission>()
  for (const permission of value) {
    if (permission === 'creativeGenerate') {
      requested.add('toolboxUse')
      requested.add('canvasWrite')
      continue
    }
    if (isAccountPermission(permission)) requested.add(permission)
  }
  return ACCOUNT_PERMISSION_KEYS.filter((permission) => requested.has(permission))
}

/**
 * Resolve the permissions that actually authorize a request.
 *
 * Management accounts always receive the full policy. For subaccounts a JSON
 * permission array is authoritative; a missing/null value is treated as a
 * legacy account and falls back to its original role template. Every active
 * subaccount keeps team-wide read access and can never be granted `admin` via
 * the editable JSON field.
 */
export function effectiveAccountPermissions(
  role: unknown,
  assignedPermissions?: unknown,
): AccountPermission[] {
  const normalizedRole = normalizeAccountRole(role)
  if (isManagementRole(normalizedRole)) return [...ROLE_PERMISSIONS[normalizedRole]]
  if (!Array.isArray(assignedPermissions)) return [...ROLE_PERMISSIONS[normalizedRole]]

  const assigned = new Set(normalizePermissionList(assignedPermissions))
  assigned.delete('admin')
  assigned.add('read')
  return ACCOUNT_PERMISSION_KEYS.filter((permission) => assigned.has(permission))
}

export function normalizeAccountPermissions(value: unknown): AccountPermission[] {
  return normalizePermissionList(value)
}

export function hasAccountPermissions(
  account: { role?: unknown; permissions?: unknown },
  required: readonly AccountPermission[],
): boolean {
  const granted = new Set(effectiveAccountPermissions(account.role, account.permissions))
  return required.every((permission) => granted.has(permission))
}

const READABLE_CONTENT_PREFIXES = [
  '/api/projects',
  '/api/novel-promotion',
  '/api/workflow',
  '/api/runs',
  '/api/tasks',
  '/api/assets',
  '/api/asset-hub',
  '/api/video-repaint',
  '/api/video-enhance',
  '/api/service-records',
  '/api/frameos',
  '/api/works',
  '/api/collaboration',
  '/api/creative/projects/collaboration',
]

const ADMIN_PREFIXES = [
  '/api/admin/accounts',
  '/api/user/api-config',
  '/api/user/storage-config',
  '/api/user/seedance-assets-config',
  '/api/user-preference',
  '/api/prompt-templates',
  '/api/super-agent',
]

const ASSET_PATH_PATTERNS = [
  /\/(?:assets?|asset-extraction|copy-from-global)(?:\/|$)/,
  /\/(?:character|characters|character-profile|character-voice)(?:-|\/|$)/,
  /\/(?:location|locations)(?:-|\/|$)/,
  /\/(?:appearance|appearances)(?:-|\/|$)/,
  /\/(?:voice-analyze|voice-design|voice-generate|voice-mapping|speaker-voice)(?:\/|$)/,
  /\/(?:upload-asset-image|modify-asset-image|update-asset-label)(?:\/|$)/,
  /\/(?:select-character-image|select-location-image|update-appearance|update-location)(?:\/|$)/,
  /\/[^/]*(?:character|location|appearance|asset|voice|prop)[^/]*(?:\/|$)/,
]

const STORYBOARD_PATH_PATTERNS = [
  /\/storyboard/,
  /\/script-to-storyboard-stream(?:\/|$)/,
  /\/panel(?:-|\/|$)/,
  /\/(?:clips|timeline|photography-plan|insert-panel)(?:\/|$)/,
  /\/editor(?:\/|$)/,
  /\/(?:generate-image|generate-video|lip-sync)(?:\/|$)/,
  /\/(?:regenerate|undo-regenerate|update-prompt)(?:-|\/|$)/,
  /\/[^/]*(?:shot-prompt|shot-variants)[^/]*(?:\/|$)/,
  /\/(?:voice-lines|export-|download-)(?:\/|$)/,
  /\/canvas(?:\/|$)/,
]

const SCRIPT_PATH_PATTERNS = [
  /\/episodes(?:\/|$)/,
  /\/(?:screenplay-conversion|story-to-script-stream)(?:\/|$)/,
  /\/(?:split|split-by-markers)(?:\/|$)/,
  /\/ai-story-expand(?:\/|$)/,
]

function matchesAny(path: string, patterns: RegExp[]) {
  return patterns.some((pattern) => pattern.test(path))
}

export function requiredPermissionsForApiPath(
  pathname: string,
  method = 'GET',
): AccountPermission[] {
  const path = pathname.toLowerCase()
  const normalizedMethod = method.toUpperCase()

  if (ADMIN_PREFIXES.some((prefix) => path.startsWith(prefix))) return ['admin']
  // Human assignment actions use object-level assignee/reviewer checks. Work and
  // project structure mutations remain management-account operations.
  if (
    path.startsWith('/api/collaboration/assignments')
    || path.startsWith('/api/creative/projects/collaboration/assignments')
  ) return ['read']
  if (normalizedMethod === 'GET' || normalizedMethod === 'HEAD' || normalizedMethod === 'OPTIONS') {
    return READABLE_CONTENT_PREFIXES.some((prefix) => path.startsWith(prefix)) ? ['read'] : []
  }

  if (path.startsWith('/api/works')) return ['admin']
  if (/\/api\/projects\/[^/]+\/(?:members|member-candidates)(?:\/|$)/.test(path)) return ['admin']

  if (path.startsWith('/api/asset-hub') || path.startsWith('/api/assets')) return ['assetWrite']
  if (path.startsWith('/api/frameos/materials')) return ['assetWrite']
  if (path.startsWith('/api/frameos/toolbox')) return ['toolboxUse']
  if (/\/api\/projects\/[^/]+\/assets(?:\/|$)/.test(path)) return ['assetWrite']
  if (path.startsWith('/api/video-enhance')) return ['storyboardWrite']
  if (path.startsWith('/api/user/ai-story-expand')) return ['scriptWrite']
  if (path.startsWith('/api/video-repaint')) return ['scriptWrite']

  if (path.startsWith('/api/novel-promotion')) {
    // Exact cross-named routes must be classified before the broad patterns:
    // asset image regeneration contains “regenerate”, while panel materials
    // are storyboard bindings even though the path does not end in /panel.
    if (/\/regenerate-single-image(?:\/|$)/.test(path)) return ['assetWrite']
    if (/\/panels\/[^/]+\/materials(?:\/|$)/.test(path)) return ['storyboardWrite']
    if (matchesAny(path, STORYBOARD_PATH_PATTERNS)) return ['storyboardWrite']
    if (matchesAny(path, ASSET_PATH_PATTERNS)) return ['assetWrite']
    if (matchesAny(path, SCRIPT_PATH_PATTERNS)) return ['scriptWrite']
    return ['admin']
  }

  if (path.startsWith('/api/projects')) {
    if (/^\/api\/projects\/?$/.test(path)) return normalizedMethod === 'POST' ? ['projectCreate'] : ['admin']
    if (/^\/api\/projects\/[^/]+\/?$/.test(path)) return ['admin']
    if (path.includes('/canvas')) return ['canvasWrite']
    return ['admin']
  }
  if (path.startsWith('/api/workflow') || path.startsWith('/api/runs')) return ['admin']

  if (path.startsWith('/api/auth/') || path.startsWith('/api/feedback')) return []
  return ['admin']
}
