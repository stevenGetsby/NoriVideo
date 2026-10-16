import type { AccountPermission } from '@/lib/account/permissions'

export type CollaborationMode = 'solo' | 'team'

export interface WorkProjectConfig {
  projectLevel?: string | null
  projectLevelName?: string | null
  budgetLevel?: string | null
  budgetLevelName?: string | null
  projectStyle?: string | null
  targetAudience?: string | null
  videoRatio?: string | null
  videoResolution?: string | null
  episodeDurationMode?: string | null
  episodeDurationValue?: number | null
  artStyle?: string | null
  importStatus?: string | null
  workflowMode?: string | null
  contentType?: string | null
  materialType?: string | null
  targetEpisodeCount?: number | null
  episodeCount?: number | null
}

export interface WorkProject {
  id: string
  name: string
  description?: string | null
  createdAt: string
  updatedAt: string
  workId?: string | null
  createdById?: string | null
  collaborationMode?: CollaborationMode | null
  canManage?: boolean
  canMove?: boolean
  canManageMembers?: boolean
  budgetLevel?: string | null
  budgetLevelName?: string | null
  genre?: string | null
  genreName?: string | null
  aspectRatio?: string | null
  artStyle?: string | null
  novelPromotionData?: WorkProjectConfig | null
}

/** Business names; legacy DTO names remain for existing workflow clients. */
export type ProductionWorkSummary = Omit<WorkProject, 'workId'> & {
  kind: 'work'
  projectId: string | null
}

export interface RecycleBinProject {
  id: string
  name: string
  workId?: string | null
  workName?: string | null
  deletedAt?: string | null
  deletedByName?: string | null
  restoreDeadline?: string | null
  remainingDays?: number
  expired?: boolean | null
}

export interface WorkMember {
  id?: string
  userId: string
  name: string
  role?: string | null
  accountRole?: string | null
  roleLabel?: string | null
  status?: string | null
  isCreator?: boolean
  canRemove?: boolean
}

export interface WorkSummary {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  createdById?: string | null
  canManage?: boolean
  canCreateProjects?: boolean
  canDelete?: boolean
  canMoveProjects?: boolean
  projectCount: number
  memberCount?: number
  members?: WorkMember[]
  projects: WorkProject[]
  virtual?: boolean
}

export type ProductionProjectSummary = Omit<WorkSummary, 'projectCount' | 'projects' | 'canCreateProjects' | 'canMoveProjects'> & {
  kind: 'project'
  workCount: number
  canCreateWorks?: boolean
  canMoveWorks?: boolean
  works: ProductionWorkSummary[]
}

export interface WorkPagination {
  page: number
  pageSize: number
  total: number
  totalPages: number
}

export interface WorksResponse {
  projectHierarchy?: { version: 2; projects: ProductionProjectSummary[] }
  works?: WorkSummary[]
  unassignedProjects?: WorkProject[]
  pagination?: Partial<WorkPagination>
}

export interface MemberCandidate {
  id: string
  name: string
  role?: string | null
  roleLabel?: string | null
  permissions?: AccountPermission[]
  status?: string | null
  coinCredits?: number
  pointCredits?: number
}

export const UNASSIGNED_WORK_ID = '__unassigned__'

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalText(value: unknown): string | null {
  const normalized = text(value).trim()
  return normalized || null
}

function bool(value: unknown, fallback = false): boolean {
  return typeof value === 'boolean' ? value : fallback
}

function integer(value: unknown, fallback = 0): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

export function normalizeWorkProject(value: unknown): WorkProject | null {
  const source = record(value)
  const id = text(source.id || source.uuid).trim()
  if (!id) return null
  const config = record(source.novelPromotionData || source.novel_promotion_data || source.config)
  const configCount = record(config._count || config.count)
  const mode = optionalText(source.collaborationMode || source.collaboration_mode)
  return {
    id,
    name: text(source.name).trim() || '未命名作品',
    description: optionalText(source.description),
    createdAt: text(source.createdAt || source.created_at),
    updatedAt: text(source.updatedAt || source.updated_at),
    workId: optionalText(source.kind === 'work' ? source.projectId : source.workId || source.work_id),
    createdById: optionalText(source.createdById || source.created_by_id),
    collaborationMode: mode === 'team' ? 'team' : 'solo',
    canManage: bool(source.canManage ?? source.can_manage),
    canMove: bool(source.canMove ?? source.can_move),
    canManageMembers: bool(source.canManageMembers ?? source.can_manage_members),
    budgetLevel: optionalText(
      source.budgetLevel
      || source.budget_level
      || config.budgetLevel
      || config.budget_level
      || config.projectLevel
      || config.project_level,
    ),
    budgetLevelName: optionalText(
      source.budgetLevelName
      || source.budget_level_name
      || config.budgetLevelName
      || config.budget_level_name
      || config.projectLevelName
      || config.project_level_name,
    ),
    genre: optionalText(source.genre),
    genreName: optionalText(source.genreName || source.genre_name),
    aspectRatio: optionalText(source.aspectRatio || source.aspect_ratio || config.videoRatio || config.video_ratio),
    artStyle: optionalText(source.artStyle || source.art_style || config.projectStyle || config.project_style || config.artStyle || config.art_style),
    novelPromotionData: Object.keys(config).length ? {
      projectLevel: optionalText(config.projectLevel || config.project_level),
      projectLevelName: optionalText(config.projectLevelName || config.project_level_name),
      budgetLevel: optionalText(config.budgetLevel || config.budget_level || config.projectLevel || config.project_level),
      budgetLevelName: optionalText(config.budgetLevelName || config.budget_level_name || config.projectLevelName || config.project_level_name),
      projectStyle: optionalText(config.projectStyle || config.project_style),
      targetAudience: optionalText(config.targetAudience || config.target_audience),
      videoRatio: optionalText(config.videoRatio || config.video_ratio || source.videoRatio || source.aspect_ratio),
      videoResolution: optionalText(config.videoResolution || config.video_resolution || source.videoResolution || source.resolution),
      episodeDurationMode: optionalText(config.episodeDurationMode || config.episode_duration_mode),
      episodeDurationValue: typeof (config.episodeDurationValue ?? config.episode_duration_value) === 'number'
        ? Number(config.episodeDurationValue ?? config.episode_duration_value)
        : null,
      artStyle: optionalText(config.artStyle || config.art_style || source.artStyle || source.art_style),
      importStatus: optionalText(config.importStatus || config.import_status || source.importStatus || source.generation_status),
      workflowMode: optionalText(config.workflowMode || config.workflow_mode || source.workflowMode || source.workflow_mode),
      contentType: optionalText(config.contentType || config.content_type || source.contentType || source.content_type),
      materialType: optionalText(config.materialType || config.material_type || source.materialType || source.material_type),
      targetEpisodeCount: typeof (config.targetEpisodeCount ?? config.target_episode_count) === 'number'
        ? Number(config.targetEpisodeCount ?? config.target_episode_count)
        : null,
      episodeCount: integer(
        config.episodeCount
        ?? config.episode_count
        ?? configCount.episodes,
        0,
      ),
    } : null,
  }
}

export function normalizeWorkMember(value: unknown): WorkMember | null {
  const source = record(value)
  const user = record(source.user)
  const userId = text(source.userId || source.user_id || source.uid || user.id).trim()
  if (!userId) return null
  return {
    id: optionalText(source.id) || undefined,
    userId,
    name: text(source.name || source.userName || source.user_name || user.name).trim() || userId,
    role: optionalText(source.role),
    accountRole: optionalText(source.accountRole || source.account_role || user.role),
    roleLabel: optionalText(source.roleLabel || source.role_label || user.roleLabel || user.role_label),
    status: optionalText(source.status || user.status),
    isCreator: bool(source.isCreator ?? source.is_creator) || source.role === 'creator',
    canRemove: bool(source.canRemove ?? source.can_remove, source.role !== 'creator'),
  }
}

export function normalizeWork(value: unknown): WorkSummary | null {
  const source = record(value)
  const id = text(source.id || source.uuid).trim()
  if (!id) return null
  const rawProjects = source.kind === 'project' ? source.works : source.projects
  const projects = Array.isArray(rawProjects)
    ? rawProjects.flatMap((project) => normalizeWorkProject(project) || [])
    : []
  const members = Array.isArray(source.members)
    ? source.members.flatMap((member) => normalizeWorkMember(member) || [])
    : []
  return {
    id,
    name: text(source.name).trim() || '未命名项目',
    createdAt: text(source.createdAt || source.created_at),
    updatedAt: text(source.updatedAt || source.updated_at),
    createdById: optionalText(source.createdById || source.created_by_id),
    canManage: bool(source.canManage ?? source.can_manage),
    canCreateProjects: bool(source.canCreateWorks ?? source.canCreateProjects ?? source.can_create_projects),
    canDelete: bool(source.canDelete ?? source.can_delete, projects.length === 0),
    canMoveProjects: bool(source.canMoveWorks ?? source.canMoveProjects ?? source.can_move_projects),
    projectCount: integer(source.workCount ?? source.projectCount ?? source.project_count, projects.length),
    memberCount: integer(source.memberCount ?? source.member_count, members.length),
    members,
    projects,
  }
}

export function normalizeWorksResponse(value: unknown): {
  works: WorkSummary[]
  pagination: WorkPagination
} {
  const source = record(value)
  const payload = record(source.data)
  const hierarchy = record(source.projectHierarchy || payload.projectHierarchy)
  const rawWorks = hierarchy.version === 2 && Array.isArray(hierarchy.projects)
    ? hierarchy.projects
    : Array.isArray(source.works) ? source.works : Array.isArray(payload.works) ? payload.works : []
  const works = rawWorks.flatMap((work) => normalizeWork(work) || [])
  const rawUnassigned = hierarchy.version === 2 ? [] : Array.isArray(source.unassignedProjects)
    ? source.unassignedProjects
    : Array.isArray(source.unassigned_projects)
      ? source.unassigned_projects
      : []
  const unassigned = rawUnassigned.flatMap((project) => normalizeWorkProject(project) || [])
  if (unassigned.length) {
    works.push({
      id: UNASSIGNED_WORK_ID,
      name: '未归属项目',
      createdAt: '',
      updatedAt: '',
      projectCount: unassigned.length,
      projects: unassigned,
      virtual: true,
      canDelete: false,
      canManage: false,
      canMoveProjects: true,
    })
  }
  const paginationSource = record(source.pagination || payload.pagination)
  const pageSize = integer(paginationSource.pageSize ?? paginationSource.page_size, 50) || 50
  const total = integer(paginationSource.total, works.filter((work) => !work.virtual).length)
  return {
    works,
    pagination: {
      page: integer(paginationSource.page, 1) || 1,
      pageSize,
      total,
      totalPages: integer(paginationSource.totalPages ?? paginationSource.total_pages, Math.max(1, Math.ceil(total / pageSize))) || 1,
    },
  }
}

export function normalizeCandidate(value: unknown): MemberCandidate | null {
  const source = record(value)
  const id = text(source.id || source.userId || source.user_id || source.uid).trim()
  if (!id) return null
  return {
    id,
    name: text(source.name || source.userName || source.user_name).trim() || id,
    role: optionalText(source.role),
    roleLabel: optionalText(source.roleLabel || source.role_label),
    permissions: Array.isArray(source.permissions)
      ? source.permissions.filter((permission): permission is AccountPermission => typeof permission === 'string')
      : [],
    status: optionalText(source.status),
    coinCredits: integer(source.coinCredits ?? source.coin_credits),
    pointCredits: integer(source.pointCredits ?? source.point_credits),
  }
}
