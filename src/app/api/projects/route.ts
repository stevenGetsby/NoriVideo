import { NextRequest, NextResponse } from 'next/server'
import { inflateSync } from 'node:zlib'
import mammoth from 'mammoth'
import { prisma } from '@/lib/prisma'
import { requireUserAuth, isErrorResponse } from '@/lib/api-auth'
import { apiHandler, ApiError } from '@/lib/api-errors'
import { toMoneyNumber } from '@/lib/billing/money'
import { isArtStyleValue, isCustomArtStyleValue } from '@/lib/constants'
import { resolveTaskLocale } from '@/lib/task/resolve-locale'
import { TASK_STATUS } from '@/lib/task/types'
import { buildProjectWorkflowSummary } from '@/lib/projects/workflow-summary'
import {
  containsInternalRecordMarker,
  isInternalUsageCostRecord,
} from '@/lib/workspace/internal-record-visibility'
import {
  formatProjectValidationIssue,
  normalizeProjectDraft,
  validateProjectDraft,
  type ProjectDraftInput,
} from '@/lib/projects/validation'
import {
  buildProjectDescription,
  normalizeProjectCreationConfig,
  type ProjectCreationConfig,
} from '@/lib/projects/creation-config'

function readProjectDraftBody(body: unknown): ProjectDraftInput {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { name: '' }
  }

  const payload = body as Record<string, unknown>
  return {
    name: typeof payload.name === 'string' ? payload.name : '',
    description: typeof payload.description === 'string' ? payload.description : null,
  }
}

const INITIAL_IMPORT_TEXT_MAX_LENGTH = 200_000
const INITIAL_IMPORT_EPISODE_NAME_MAX_LENGTH = 100
const CREATE_PROJECT_SCRIPT_MAX_BYTES = 10 * 1024 * 1024

interface ParsedCreateProjectBody {
  rawBody: Record<string, unknown>
  draft: ProjectDraftInput
  initialImportDraft: {
    pendingImportText: string | null
    pendingImportEpisodeName: string | null
  }
  config: ProjectCreationConfig
}

function normalizeOptionalText(value: unknown, maxLength: number, field: string): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  if (!trimmed) return null
  if (trimmed.length > maxLength) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'FIELD_TOO_LONG',
      field,
      limit: maxLength,
      message: `${field} is too long`,
    })
  }
  return trimmed
}

function readStringField(source: Record<string, unknown>, field: string): string | null {
  const value = source[field]
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed || null
}

function decodePdfLiteral(value: string): string {
  return value
    .replace(/\\([nrtbf()\\])/g, (_, ch: string) => {
      if (ch === 'n') return '\n'
      if (ch === 'r') return '\r'
      if (ch === 't') return '\t'
      if (ch === 'b') return '\b'
      if (ch === 'f') return '\f'
      return ch
    })
    .replace(/\\([0-7]{1,3})/g, (_, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))
}

function extractPdfTextFromSource(source: string): string {
  const chunks: string[] = []
  for (const match of source.matchAll(/\((?:\\.|[^\\)])*\)\s*Tj/g)) {
    chunks.push(decodePdfLiteral(match[0].replace(/\)\s*Tj$/, '').slice(1)))
  }
  for (const match of source.matchAll(/\[([\s\S]*?)\]\s*TJ/g)) {
    const segment = match[1]
    for (const part of segment.matchAll(/\((?:\\.|[^\\)])*\)/g)) {
      chunks.push(decodePdfLiteral(part[0].slice(1, -1)))
    }
  }
  return chunks.join('\n')
}

function extractPdfStreams(buffer: Buffer): string[] {
  const source = buffer.toString('latin1')
  const streams: string[] = [source]
  const streamPattern = /(<<[\s\S]{0,2000}?>>)\s*stream\r?\n([\s\S]*?)\r?\nendstream/g
  for (const match of source.matchAll(streamPattern)) {
    const dictionary = match[1]
    const raw = Buffer.from(match[2], 'latin1')
    if (!dictionary.includes('/FlateDecode')) {
      streams.push(raw.toString('latin1'))
      continue
    }
    try {
      streams.push(inflateSync(raw).toString('latin1'))
    } catch {
      // Ignore streams we cannot inflate; other streams may still contain text.
    }
  }
  return streams
}

function normalizeExtractedText(text: string): string {
  return text
    .replace(/\u0000/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function extractPdfText(buffer: Buffer): string {
  const text = normalizeExtractedText(extractPdfStreams(buffer).map(extractPdfTextFromSource).join('\n'))
  if (!text) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SCRIPT_FILE_UNREADABLE',
      field: 'scriptFile',
      message: '无法从该 PDF 提取文本；请上传文本型 PDF，或先转换为 txt/docx。',
    })
  }
  return text
}

async function extractScriptTextFromFile(file: File): Promise<string> {
  if (file.size > CREATE_PROJECT_SCRIPT_MAX_BYTES) {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SCRIPT_FILE_TOO_LARGE',
      field: 'scriptFile',
      limit: CREATE_PROJECT_SCRIPT_MAX_BYTES,
      message: 'Script file is too large',
    })
  }
  const name = file.name.toLowerCase()
  const buffer = Buffer.from(await file.arrayBuffer())
  let text = ''
  if (name.endsWith('.txt') || file.type.startsWith('text/')) {
    text = buffer.toString('utf8')
  } else if (name.endsWith('.docx') || file.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') {
    const result = await mammoth.extractRawText({ buffer })
    text = result.value
  } else if (name.endsWith('.pdf') || file.type === 'application/pdf') {
    text = extractPdfText(buffer)
  } else {
    throw new ApiError('INVALID_PARAMS', {
      code: 'SCRIPT_FILE_TYPE_UNSUPPORTED',
      field: 'scriptFile',
      message: 'Only txt, docx and text-based pdf files are supported',
    })
  }
  return normalizeOptionalText(text, INITIAL_IMPORT_TEXT_MAX_LENGTH, 'initialNovelText') || ''
}

function readInitialImportDraftBody(body: unknown) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { pendingImportText: null, pendingImportEpisodeName: null }
  }

  const payload = body as Record<string, unknown>
  return {
    pendingImportText: normalizeOptionalText(
      payload.initialNovelText ?? payload.pendingImportText,
      INITIAL_IMPORT_TEXT_MAX_LENGTH,
      'initialNovelText',
    ),
    pendingImportEpisodeName: normalizeOptionalText(
      payload.initialEpisodeName ?? payload.pendingImportEpisodeName,
      INITIAL_IMPORT_EPISODE_NAME_MAX_LENGTH,
      'initialEpisodeName',
    ),
  }
}

async function readCreateProjectBody(request: NextRequest): Promise<ParsedCreateProjectBody> {
  const contentType = request.headers.get('content-type') || ''
  if (contentType.includes('multipart/form-data')) {
    const form = await request.formData()
    const rawBody: Record<string, unknown> = {}
    for (const [key, value] of form.entries()) {
      if (typeof value === 'string') rawBody[key] = value
    }
    const scriptFile = form.get('scriptFile')
    if (scriptFile instanceof File && scriptFile.size > 0) {
      rawBody.initialNovelText = await extractScriptTextFromFile(scriptFile)
      rawBody.initialEpisodeName = readStringField(rawBody, 'initialEpisodeName') || scriptFile.name.replace(/\.[^.]+$/, '')
    }
    const explicitDescription = readStringField(rawBody, 'description')
    const config = normalizeProjectCreationConfig(rawBody)
    rawBody.description = buildProjectDescription(config, explicitDescription)
    return {
      rawBody,
      draft: readProjectDraftBody(rawBody),
      initialImportDraft: readInitialImportDraftBody(rawBody),
      config,
    }
  }

  const json = await request.json()
  const rawBody = json && typeof json === 'object' && !Array.isArray(json)
    ? json as Record<string, unknown>
    : {}
  const explicitDescription = readStringField(rawBody, 'description')
  const config = normalizeProjectCreationConfig(rawBody)
  if (
    rawBody.projectLevel !== undefined ||
    rawBody.projectStyle !== undefined ||
    rawBody.targetAudience !== undefined ||
    rawBody.videoResolution !== undefined ||
    rawBody.targetEpisodeDurationSeconds !== undefined
  ) {
    rawBody.description = buildProjectDescription(config, explicitDescription)
  }
  return {
    rawBody,
    draft: readProjectDraftBody(rawBody),
    initialImportDraft: readInitialImportDraftBody(rawBody),
    config,
  }
}

// GET - 获取用户的项目（支持分页和搜索）
export const GET = apiHandler(async (request: NextRequest) => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  // 获取查询参数
  const { searchParams } = new URL(request.url)
  const page = parseInt(searchParams.get('page') || '1', 10)
  const pageSize = parseInt(searchParams.get('pageSize') || '12', 10)
  const search = searchParams.get('search') || ''

  // 构建查询条件
  const where: Record<string, unknown> = { userId: session.user.id }

  // 如果有搜索关键词，搜索名称和描述
  // 注意：SQLite 不支持 mode: 'insensitive'，但 SQLite 的 LIKE 默认即大小写不敏感（ASCII 范围）
  if (search.trim()) {
    where.OR = [
      { name: { contains: search.trim() } },
      { description: { contains: search.trim() } }
    ]
  }

  // ⚡ 并行执行：获取总数 + 分页数据
  // 排序优先级：最近访问时间（有值的优先） > 更新时间
  const [total, allProjects] = await Promise.all([
    prisma.project.count({ where }),
    prisma.project.findMany({
      where,
      orderBy: { updatedAt: 'desc' },  // 先按更新时间排序获取所有匹配项目
      skip: (page - 1) * pageSize,
      take: pageSize
    })
  ])

  // 在应用层重新排序：
  // 1. 新创建但未访问过的项目（无 lastAccessedAt）按创建时间降序排在最前
  // 2. 访问过的项目按访问时间降序
  const projects = [...allProjects].sort((a, b) => {
    // 两个都没有访问时间，按创建时间降序（新创建的排前面）
    if (!a.lastAccessedAt && !b.lastAccessedAt) {
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    }
    // 只有 a 没有访问时间（新创建），a 排前面
    if (!a.lastAccessedAt && b.lastAccessedAt) return -1
    // 只有 b 没有访问时间（新创建），b 排前面
    if (a.lastAccessedAt && !b.lastAccessedAt) return 1
    // 两个都有访问时间，按访问时间降序
    return new Date(b.lastAccessedAt!).getTime() - new Date(a.lastAccessedAt!).getTime()
  })

  // 获取项目 ID 列表
  const projectIds = projects.map(p => p.id)

  // ⚡ 并行获取：费用 + 项目统计 + 后端工作流状态
  const [costsByProject, novelProjects, workflowStageRows, activeTasksByProject] = await Promise.all([
    // 一次性获取所有项目的费用（代替 N+1 查询）
    projectIds.length > 0 ? prisma.usageCost.findMany({
      where: {
        userId: session.user.id,
        projectId: { in: projectIds },
      },
      select: {
        projectId: true,
        cost: true,
        action: true,
        apiType: true,
        model: true,
        metadata: true,
      },
    }) : Promise.resolve([]),
    // 一次性获取所有项目的统计数据
    projectIds.length > 0 ? prisma.novelPromotionProject.findMany({
      where: { projectId: { in: projectIds } },
      select: {
        projectId: true,
        _count: {
          select: {
            episodes: true,
            characters: true,
            locations: true
          }
        },
        episodes: {
          orderBy: { episodeNumber: 'asc' },
          select: {
            episodeNumber: true,
            novelText: true,
            storyboards: {
              select: {
                _count: {
                  select: { panels: true }
                },
                panels: {
                  where: {
                    OR: [
                      { imageUrl: { not: null } },
                      { videoUrl: { not: null } },
                    ]
                  },
                  select: {
                    imageUrl: true,
                    videoUrl: true
                  }
                }
              }
            }
          }
        }
      }
    }) : Promise.resolve([]),
    projectIds.length > 0 ? prisma.workflowStageState.findMany({
      where: {
        userId: session.user.id,
        projectId: { in: projectIds },
      },
      select: {
        projectId: true,
        scopeId: true,
        stageKey: true,
        status: true,
        progress: true,
        reviewState: true,
        blocker: true,
        errorMessage: true,
        approvedAt: true,
        updatedAt: true,
      },
      orderBy: {
        updatedAt: 'desc',
      },
    }) : Promise.resolve([]),
    projectIds.length > 0 ? prisma.task.findMany({
      where: {
        userId: session.user.id,
        projectId: { in: projectIds },
        status: { in: [TASK_STATUS.QUEUED, TASK_STATUS.PROCESSING] },
      },
      select: {
        projectId: true,
        type: true,
        targetType: true,
        errorMessage: true,
      },
    }) : Promise.resolve([]),
  ])

  // 构建费用映射表
  const costMap = new Map<string, number>()
  for (const item of costsByProject) {
    if (isInternalUsageCostRecord(item)) continue
    costMap.set(item.projectId, (costMap.get(item.projectId) ?? 0) + toMoneyNumber(item.cost))
  }

  // 构建统计映射表 + 第一集预览
  const statsMap = new Map<string, { episodes: number; images: number; videos: number; panels: number; firstEpisodePreview: string | null }>(
    novelProjects.map(np => {
      let imageCount = 0
      let videoCount = 0
      let panelCount = 0
      for (const ep of np.episodes) {
        for (const sb of ep.storyboards) {
          panelCount += sb._count.panels
          for (const panel of sb.panels) {
            if (panel.imageUrl) imageCount++
            if (panel.videoUrl) videoCount++
          }
        }
      }
      // 取第一集的 novelText 前 100 字作为预览
      const firstEp = np.episodes[0]
      const preview = firstEp?.novelText ? firstEp.novelText.slice(0, 100) : null
      return [np.projectId, {
        episodes: np._count.episodes,
        images: imageCount,
        videos: videoCount,
        panels: panelCount,
        firstEpisodePreview: preview
      }]
    })
  )

  const workflowStageMap = new Map<string, typeof workflowStageRows>()
  for (const row of workflowStageRows) {
    const current = workflowStageMap.get(row.projectId) || []
    current.push(row)
    workflowStageMap.set(row.projectId, current)
  }

  const activeTaskCountMap = new Map<string, number>()
  for (const task of activeTasksByProject) {
    if (containsInternalRecordMarker(task.type, task.targetType, task.errorMessage)) continue
    activeTaskCountMap.set(task.projectId, (activeTaskCountMap.get(task.projectId) ?? 0) + 1)
  }

  // 合并项目、费用与统计
  const projectsWithStats = projects.map(project => ({
    ...project,
    totalCost: costMap.get(project.id) ?? 0,
    stats: statsMap.get(project.id) ?? { episodes: 0, images: 0, videos: 0, panels: 0, firstEpisodePreview: null },
    workflowSummary: buildProjectWorkflowSummary({
      stats: statsMap.get(project.id) ?? { episodes: 0, images: 0, videos: 0, panels: 0 },
      stages: workflowStageMap.get(project.id) ?? [],
      activeTaskCount: activeTaskCountMap.get(project.id) ?? 0,
    }),
  }))

  return NextResponse.json({
    projects: projectsWithStats,
    pagination: {
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize)
    }
  })
})

// POST - 创建新项目
export const POST = apiHandler(async (request: NextRequest) => {
  // 🔐 统一权限验证
  const authResult = await requireUserAuth()
  if (isErrorResponse(authResult)) return authResult
  const { session } = authResult

  const { rawBody, draft, initialImportDraft, config } = await readCreateProjectBody(request)
  const validationIssue = validateProjectDraft(draft)
  if (validationIssue) {
    const locale = resolveTaskLocale(request, rawBody) ?? 'zh'
    throw new ApiError('INVALID_PARAMS', {
      code: validationIssue.code,
      field: validationIssue.field,
      ...(typeof validationIssue.limit === 'number' ? { limit: validationIssue.limit } : {}),
      message: formatProjectValidationIssue(validationIssue, locale),
    })
  }

  const { name, description } = normalizeProjectDraft(draft)

  // 获取用户偏好配置
  const userPreference = await prisma.userPreference.findUnique({
    where: { userId: session.user.id }
  })

  // 创建基础项目
  const project = await prisma.project.create({
    data: {
      name: name.trim(),
      description: description?.trim() || null,
      userId: session.user.id
    }
  })

  // 创建 novel-promotion 数据表，使用用户偏好作为默认值
  // 注意：不再自动创建默认剧集，由用户在选择界面决定：
  // - 手动创作 → 创建第一个空白剧集
  // - 智能导入 → AI 分析后批量创建剧集
  // 创建时保存完整项目全局变量；后续分镜、视频、资产生成阶段从项目配置读取。
  await prisma.novelPromotionProject.create({
    data: {
      projectId: project.id,
      importStatus: 'pending',
      pendingImportText: initialImportDraft.pendingImportText,
      pendingImportEpisodeName: initialImportDraft.pendingImportEpisodeName,
      ...(userPreference && {
        analysisModel: userPreference.analysisModel,
        characterModel: userPreference.characterModel,
        locationModel: userPreference.locationModel,
        storyboardModel: userPreference.storyboardModel,
        editModel: userPreference.editModel,
        videoModel: userPreference.videoModel,
        audioModel: userPreference.audioModel,
        videoRatio: userPreference.videoRatio,
        videoResolution: userPreference.videoResolution,
        artStyle: (isArtStyleValue(userPreference.artStyle) || isCustomArtStyleValue(userPreference.artStyle)) ? userPreference.artStyle : 'american-comic',
        ttsRate: userPreference.ttsRate
      }),
      projectLevel: config.projectLevel,
      projectStyle: config.projectStyle,
      targetAudience: config.targetAudience,
      videoRatio: config.videoRatio,
      videoResolution: config.videoResolution,
      targetEpisodeDurationSeconds: config.targetEpisodeDurationSeconds,
      artStyle: config.artStyle,
      artStylePrompt: config.artStylePrompt,
    }
  })

  return NextResponse.json({ project }, { status: 201 })
})
