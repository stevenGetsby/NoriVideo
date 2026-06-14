import { prisma } from '@/lib/prisma'
import { randomUUID } from 'node:crypto'
import { safeParseJsonObject } from '@/lib/json-repair'
import { llmClient } from './llm-client'
import { recordAgentChatEditWorkflow } from './workflow-store'
import type { SkillId } from './types'
import type { Locale } from '@/i18n/routing'
import { TASK_TYPE } from '@/lib/task/types'
import { submitTask } from '@/lib/task/submitter'
import { withTaskUiPayload } from '@/lib/task/ui-payload'
import { getProjectModelConfig } from '@/lib/config-service'
import {
  buildPanelSeedanceReferenceAssets,
  writePanelSeedanceReferenceAssetsToActingNotes,
} from '@/lib/novel-promotion/seedance-reference-assets'
import {
  parseCharacterDescriptionValues,
  readFrameOSAppearanceMetadataFromDescriptions,
  stringifyCharacterDescriptionsWithFrameOSMetadata,
} from '@/lib/novel-promotion/character-appearance-frameos-metadata'
import {
  hasCharacterAppearanceOutput,
  hasLocationImageOutput,
  hasPanelVideoOutput,
} from '@/lib/task/has-output'
import { encodeImageUrls } from '@/lib/contracts/image-urls-contract'

type EditablePanel = {
  id: string
  storyboardId: string
  panelIndex: number
  panelNumber: number | null
  description: string | null
  location: string | null
  characters: string | null
  props: string | null
  imagePrompt: string | null
  videoPrompt: string | null
  srtSegment: string | null
  actingNotes: string | null
}

type EditableEpisodeContext = {
  episode: {
    id: string
    name: string
    novelText: string | null
  }
  panels: EditablePanel[]
  assets: {
    characters: Array<{
      id: string
      name: string
      aliases: string | null
      profileData: string | null
      appearanceId: string | null
      description: string | null
      hasImage: boolean
      imageIndex: number
    }>
    locations: Array<{
      id: string
      name: string
      kind: 'location' | 'prop'
      summary: string | null
      imageId: string | null
      description: string | null
      imageIndex: number
      hasImage: boolean
    }>
  }
}

export type AgentChatEditMode = 'live' | 'mock'

export type AgentChatEditPlan = {
  summary: string
  intent?: 'asset' | 'storyboard' | 'mixed'
  assets?: AgentChatEditAssetPlan[]
  panels?: AgentChatEditPanelPlan[]
}

type AgentChatEditAssetPlan = {
  action?: 'update' | 'create'
  kind: 'character' | 'location' | 'prop'
  id?: string
  name?: string
  appearanceId?: string
  imageId?: string
  updatedDescription?: string
  imageUrl?: string
  regenerate?: boolean
}

type AgentChatEditPanelPlan = {
  action?: 'update' | 'insert'
  id?: string
  insertAfterPanelId?: string
  insertBeforePanelId?: string
  description?: string
  imagePrompt?: string
  videoPrompt?: string
  srtSegment?: string
  characters?: string
  location?: string
  props?: string
  duration?: number
  shotType?: string
  cameraMove?: string
  regenerateVideo?: boolean
  reason?: 'edit' | 'bridge' | 'advertisement'
}

type AppliedPanelChange = {
  id: string
  changedFields: string[]
  taskId?: string
  action?: 'updated' | 'inserted'
}

type AppliedAssetChange = {
  kind: 'character' | 'location' | 'prop'
  id: string
  changedFields: string[]
  taskId?: string
  action?: 'updated' | 'created'
}

type AgentChatEditResult = {
  summary: string
  targetType: 'asset' | 'storyboard' | 'mixed' | 'none'
  episodeUpdated: boolean
  assetChanges: AppliedAssetChange[]
  panelChanges: AppliedPanelChange[]
  submittedTaskIds: string[]
  workflowRunId?: string
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function readPositiveNumber(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return value
}

function isSkillId(value: unknown): value is SkillId {
  return typeof value === 'string' && /^[a-z0-9][a-z0-9._-]{1,80}$/i.test(value)
}

function buildEditableContext(episode: {
  id: string
  name: string
  novelText: string | null
  novelPromotionProject: {
    characters: Array<{
      id: string
      name: string
      aliases: string | null
      profileData: string | null
      appearances: Array<{
        id: string
        description: string | null
        imageUrl: string | null
        imageUrls: string | null
        selectedIndex: number | null
        appearanceIndex: number
      }>
    }>
    locations: Array<{
      id: string
      name: string
      summary: string | null
      assetKind: string
      selectedImageId: string | null
      images: Array<{
        id: string
        description: string | null
        imageUrl: string | null
        imageIndex: number
        isSelected: boolean
      }>
    }>
  }
  storyboards: Array<{
    panels: EditablePanel[]
  }>
}): EditableEpisodeContext {
  const characters = episode.novelPromotionProject.characters.map((character) => {
    const selected = character.appearances.find((appearance) => appearance.imageUrl)
      || character.appearances[0]
      || null
    return {
      id: character.id,
      name: character.name,
      aliases: character.aliases,
      profileData: character.profileData,
      appearanceId: selected?.id || null,
      description: selected?.description || null,
      hasImage: Boolean(selected?.imageUrl || selected?.imageUrls),
      imageIndex: selected?.selectedIndex ?? 0,
    }
  })
  const locations = episode.novelPromotionProject.locations.map((location) => {
    const selected = location.images.find((image) => image.id === location.selectedImageId)
      || location.images.find((image) => image.isSelected)
      || location.images[0]
      || null
    const kind: 'location' | 'prop' = location.assetKind === 'prop' ? 'prop' : 'location'
    return {
      id: location.id,
      name: location.name,
      kind,
      summary: location.summary,
      imageId: selected?.id || null,
      description: selected?.description || null,
      imageIndex: selected?.imageIndex ?? 0,
      hasImage: Boolean(selected?.imageUrl),
    }
  })

  return {
    episode: {
      id: episode.id,
      name: episode.name,
      novelText: episode.novelText,
    },
    panels: episode.storyboards.flatMap((storyboard) => storyboard.panels),
    assets: {
      characters,
      locations,
    },
  }
}

function normalizePlan(raw: unknown, context: EditableEpisodeContext): AgentChatEditPlan {
  const record = raw && typeof raw === 'object' && !Array.isArray(raw)
    ? raw as Record<string, unknown>
    : {}
  const validPanelIds = new Set(context.panels.map((panel) => panel.id))
  const validCharacterIds = new Set(context.assets.characters.map((asset) => asset.id))
  const validAppearanceIds = new Set(context.assets.characters.map((asset) => asset.appearanceId).filter(Boolean))
  const validLocationIds = new Set(context.assets.locations.map((asset) => asset.id))
  const validLocationImageIds = new Set(context.assets.locations.map((asset) => asset.imageId).filter(Boolean))
  const assetNames = [...context.assets.characters, ...context.assets.locations]
  const panelsRaw = Array.isArray(record.panels) ? record.panels : []
  const panels = panelsRaw
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const panel = item as Record<string, unknown>
      const action: AgentChatEditPanelPlan['action'] = panel.action === 'insert' ? 'insert' : 'update'
      const id = readNonEmptyString(panel.id)
      const insertAfterPanelId = readNonEmptyString(panel.insertAfterPanelId)
      const insertBeforePanelId = readNonEmptyString(panel.insertBeforePanelId)
      const reason: AgentChatEditPanelPlan['reason'] =
        panel.reason === 'bridge' || panel.reason === 'advertisement' || panel.reason === 'edit'
          ? panel.reason
          : undefined
      if (action === 'update' && (!id || !validPanelIds.has(id))) return null
      if (
        action === 'insert'
        && (!insertAfterPanelId || !validPanelIds.has(insertAfterPanelId))
        && (!insertBeforePanelId || !validPanelIds.has(insertBeforePanelId))
      ) return null
      const next = {
        action,
        ...(id ? { id } : {}),
        ...(insertAfterPanelId && validPanelIds.has(insertAfterPanelId) ? { insertAfterPanelId } : {}),
        ...(insertBeforePanelId && validPanelIds.has(insertBeforePanelId) ? { insertBeforePanelId } : {}),
        ...(readNonEmptyString(panel.description) ? { description: readNonEmptyString(panel.description) } : {}),
        ...(readNonEmptyString(panel.imagePrompt) ? { imagePrompt: readNonEmptyString(panel.imagePrompt) } : {}),
        ...(readNonEmptyString(panel.videoPrompt) ? { videoPrompt: readNonEmptyString(panel.videoPrompt) } : {}),
        ...(readNonEmptyString(panel.srtSegment) ? { srtSegment: readNonEmptyString(panel.srtSegment) } : {}),
        ...(readNonEmptyString(panel.characters) ? { characters: readNonEmptyString(panel.characters) } : {}),
        ...(readNonEmptyString(panel.location) ? { location: readNonEmptyString(panel.location) } : {}),
        ...(readNonEmptyString(panel.props) ? { props: readNonEmptyString(panel.props) } : {}),
        ...(readNonEmptyString(panel.shotType) ? { shotType: readNonEmptyString(panel.shotType) } : {}),
        ...(readNonEmptyString(panel.cameraMove) ? { cameraMove: readNonEmptyString(panel.cameraMove) } : {}),
        ...(readPositiveNumber(panel.duration) ? { duration: readPositiveNumber(panel.duration) } : {}),
        ...(typeof panel.regenerateVideo === 'boolean' ? { regenerateVideo: panel.regenerateVideo } : {}),
        ...(reason ? { reason } : {}),
      }
      return Object.keys(next).length > (action === 'insert' ? 2 : 1) ? next : null
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  const assetsRaw = Array.isArray(record.assets) ? record.assets : []
  const assets: AgentChatEditAssetPlan[] = assetsRaw
    .map((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return null
      const asset = item as Record<string, unknown>
      const action: AgentChatEditAssetPlan['action'] = asset.action === 'create' ? 'create' : 'update'
      const rawKind = readNonEmptyString(asset.kind)
      const kind: AgentChatEditAssetPlan['kind'] | null = rawKind === 'character' || rawKind === 'location' || rawKind === 'prop' ? rawKind : null
      if (!kind) return null
      const name = readNonEmptyString(asset.name)
      const id = readNonEmptyString(asset.id)
      const appearanceId = readNonEmptyString(asset.appearanceId)
      const imageId = readNonEmptyString(asset.imageId)
      const matchedByName = name
        ? assetNames.find((candidate) => normalizeName(candidate.name) === normalizeName(name))
        : null
      const resolvedId = id || matchedByName?.id || undefined
      const updatedDescription = readNonEmptyString(asset.updatedDescription)
      const imageUrl = readNonEmptyString(asset.imageUrl)
      if (action === 'create') {
        if (!name || !updatedDescription) return null
        return {
          action,
          kind,
          name,
          updatedDescription,
          ...(imageUrl ? { imageUrl } : {}),
          regenerate: asset.regenerate === true,
        }
      }
      if (kind === 'character') {
        const resolvedAppearanceId = appearanceId
          || context.assets.characters.find((candidate) => candidate.id === resolvedId)?.appearanceId
          || undefined
        if ((!resolvedId || !validCharacterIds.has(resolvedId)) && (!resolvedAppearanceId || !validAppearanceIds.has(resolvedAppearanceId))) return null
        return {
          kind,
          ...(resolvedId ? { id: resolvedId } : {}),
          ...(name ? { name } : {}),
          ...(resolvedAppearanceId ? { appearanceId: resolvedAppearanceId } : {}),
          ...(updatedDescription ? { updatedDescription } : {}),
          ...(imageUrl ? { imageUrl } : {}),
          regenerate: asset.regenerate !== false,
        }
      }
      const resolvedImageId = imageId
        || context.assets.locations.find((candidate) => candidate.id === resolvedId)?.imageId
        || undefined
      if ((!resolvedId || !validLocationIds.has(resolvedId)) && (!resolvedImageId || !validLocationImageIds.has(resolvedImageId))) return null
      return {
        kind,
        ...(resolvedId ? { id: resolvedId } : {}),
        ...(name ? { name } : {}),
        ...(resolvedImageId ? { imageId: resolvedImageId } : {}),
        ...(updatedDescription ? { updatedDescription } : {}),
        ...(imageUrl ? { imageUrl } : {}),
        regenerate: asset.regenerate !== false,
      }
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item))

  const intent = record.intent === 'asset' || record.intent === 'storyboard' || record.intent === 'mixed'
    ? record.intent
    : assets.length > 0 && panels.length > 0
      ? 'mixed'
      : assets.length > 0
        ? 'asset'
        : panels.length > 0
          ? 'storyboard'
          : undefined

  return {
    summary: readNonEmptyString(record.summary) || '已根据你的要求更新可编辑内容。',
    ...(intent ? { intent } : {}),
    ...(assets.length > 0 ? { assets } : {}),
    ...(panels.length > 0 ? { panels } : {}),
  }
}

function normalizeName(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\s"'“”‘’`·。、，,;；:：()（）[\]【】\-_/|]/g, '')
}

function clipText(value: string | null | undefined, maxLength: number): string | null {
  if (!value) return null
  const text = value.trim()
  if (!text) return null
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text
}

function buildCompactEditContext(context: EditableEpisodeContext) {
  return {
    episode: {
      id: context.episode.id,
      name: context.episode.name,
      novelText: clipText(context.episode.novelText, 600),
    },
    assets: {
      characters: context.assets.characters.map((character) => ({
        id: character.id,
        name: character.name,
        aliases: character.aliases,
        appearanceId: character.appearanceId,
        description: clipText(character.description || character.profileData, 800),
        hasImage: character.hasImage,
        imageIndex: character.imageIndex,
      })),
      locations: context.assets.locations.map((asset) => ({
        id: asset.id,
        name: asset.name,
        kind: asset.kind,
        imageId: asset.imageId,
        description: clipText(asset.description || asset.summary, 600),
        hasImage: asset.hasImage,
        imageIndex: asset.imageIndex,
      })),
    },
    panels: context.panels.map((panel) => ({
      id: panel.id,
      panelIndex: panel.panelIndex,
      panelNumber: panel.panelNumber,
      location: panel.location,
      characters: panel.characters,
      props: panel.props,
      description: clipText(panel.description, 260),
      videoPrompt: clipText(panel.videoPrompt, 360),
      srtSegment: clipText(panel.srtSegment, 180),
    })),
  }
}

function createMockEditPlan(
  instruction: string,
  context: EditableEpisodeContext,
  referenceImageUrls: string[] = [],
): AgentChatEditPlan {
  const firstPanel = context.panels[0]
  const secondPanel = context.panels[1]
  if (/广告|商品|植入/.test(instruction) && firstPanel) {
    const productName = 'Agent 测试商品'
    return {
      intent: 'mixed',
      summary: '已创建商品道具资产，并把商品自然植入首个分镜。',
      assets: [{
        action: 'create',
        kind: 'prop',
        name: productName,
        updatedDescription: `${productName}，真实商业产品道具，包装清晰但不出现乱码文字，适合自然出现在当前剧情环境中。`,
        ...(referenceImageUrls[0] ? { imageUrl: referenceImageUrls[0] } : {}),
        regenerate: false,
      }],
      panels: [{
        action: 'update',
        id: firstPanel.id,
        props: JSON.stringify([productName]),
        videoPrompt: `${firstPanel.videoPrompt || firstPanel.description || ''}\n道具=${productName}\n广告植入要求：${productName}作为自然道具短暂进入画面，不破坏原剧情因果，不要硬切成商品广告。`.trim(),
        regenerateVideo: false,
        reason: 'advertisement',
      }],
    }
  }
  if (/衔接|过渡|补.*分镜|插入/.test(instruction) && firstPanel && secondPanel) {
    return {
      intent: 'storyboard',
      summary: '已在两个相邻分镜之间插入衔接分镜。',
      panels: [{
        action: 'insert',
        insertAfterPanelId: firstPanel.id,
        description: 'Agent 测试衔接分镜：承接上一镜头的视线方向，并为下一镜头保留动作入口。',
        videoPrompt: [
          '场景：沿用上一分镜的主要场景，保持角色、光线、空间方向一致。',
          `承接上一个分镜：${firstPanel.description || firstPanel.videoPrompt || '上一动作'}`,
          `衔接到下一个分镜：${secondPanel.description || secondPanel.videoPrompt || '下一动作'}`,
          '镜头语言：固定中景建立空间连续性，再轻微推近到角色视线或手部动作，结尾留出进入下一镜头的动作方向。',
          '负面要求：不要新增无关角色，不要改变故事核心因果，不要生成中文字幕。',
        ].join('\n'),
        characters: firstPanel.characters || secondPanel.characters || '[]',
        location: firstPanel.location || secondPanel.location || undefined,
        props: firstPanel.props || secondPanel.props || undefined,
        duration: 4,
        reason: 'bridge',
        regenerateVideo: false,
      }],
    }
  }
  return {
    intent: 'storyboard',
    summary: '已记录修改要求，并更新首个分镜视频提示词。',
    ...(firstPanel ? {
      panels: [{
        id: firstPanel.id,
        videoPrompt: `${firstPanel.videoPrompt || firstPanel.description || ''}\n\n修改要求：${instruction.trim()}`.trim(),
        regenerateVideo: false,
      }],
    } : {}),
  }
}

async function createLiveEditPlan(params: {
  userId: string
  instruction: string
  context: EditableEpisodeContext
  referenceImageUrls?: string[]
}): Promise<AgentChatEditPlan> {
  const systemPrompt = `你是 NoriVideo 的 Agent 修改编排器。用户会要求修改一个已经生成、可编辑的视频项目。

你只能返回 JSON，不要输出解释文字。已有对象只能使用 context 中已有的 panel id / asset id。新增对象不要编造 id，由后端创建。

返回格式：
{
  "summary": "一句话说明改了什么",
  "intent": "asset | storyboard | mixed",
  "assets": [
    {
      "action": "update | create",
      "kind": "character | location | prop",
      "id": "更新已有资产时填写；角色用 character id，场景/道具用 location id",
      "name": "新增资产或按名字匹配已有资产时填写",
      "appearanceId": "可选：角色形象 id",
      "imageId": "可选：场景/道具图片 id",
      "updatedDescription": "新的资产生成描述，必须是完整可执行描述",
      "imageUrl": "可选：用户提供的商品图/参考图 URL",
      "regenerate": true
    }
  ],
  "panels": [
    {
      "action": "update | insert",
      "id": "更新已有 panel 时填写",
      "insertAfterPanelId": "新增衔接/广告分镜时，插在此 panel 后",
      "insertBeforePanelId": "可选：插在此 panel 前；优先用 insertAfterPanelId",
      "description": "可选：新的分镜描述",
      "imagePrompt": "可选：新的图片提示词",
      "videoPrompt": "可选：新的完整 video_prompt",
      "srtSegment": "可选：新的字幕/口播片段",
      "characters": "可选：JSON 字符串数组，例 [\\"Ava\\",\\"Dr. Grayson\\"]",
      "location": "可选：场景名",
      "props": "可选：JSON 字符串数组，例 [\\"产品名\\"]",
      "duration": 4,
      "shotType": "可选：景别",
      "cameraMove": "可选：运镜",
      "reason": "edit | bridge | advertisement",
      "regenerateVideo": false
    }
  ]
}

规则：
1. 先判断用户到底要改资产还是改分镜：
   - 修改角色外貌、服装、年龄、发型、人设、场景空间、道具外观、资产一致性 => intent=asset，写 assets。
   - 修改某个镜头、分镜、节奏、台词、镜头语言、video_prompt、视频效果 => intent=storyboard，写 panels。
   - 同时涉及资产和分镜 => intent=mixed，同时写 assets 和 panels。
   - 用户说新增角色/场景/道具/商品 => assets[].action=create。
   - 用户要求两个分镜衔接不顺、补镜头、过渡镜头 => panels[].action=insert，reason=bridge，读取相邻分镜上下文，插入一个服务剧情连续和镜头连续的新 panel。
   - 用户要求广告植入/商品植入/把商品图放进合适分镜 => 通常先创建 prop 资产，再更新或插入一个 reason=advertisement 的 panel；videoPrompt 和 props 必须明确商品作为道具/植入物出现。
2. 修改资产时，不要只写一句补丁，updatedDescription 必须是融合修改要求后的完整资产描述，可以直接用于重新生成资产图。
   - 如果 intent=asset，只输出 assets，不要输出 panels；资产图重生成后系统会自动刷新分镜 reference，不需要修改 video_prompt。
   - 修改角色外观时，updatedDescription 必须保留原角色身份、脸部、年龄、发型/服装中未被用户要求修改的部分，只融合用户指定变化。
3. 新增资产时，updatedDescription 必须是完整资产描述。商品图/参考图在 referenceImageUrls 中时，可把第一张写入 imageUrl。
4. 修改分镜时，videoPrompt 必须保留原分镜核心剧情、角色资产、场景资产和负面要求，只融合用户修改要求；不要输出内部小标题。
5. 插入衔接分镜时，videoPrompt 要明确承接上一分镜的动作/视线/空间方向，并把下一分镜的入口动作、站位或视线留下来。
6. 广告植入必须自然，不要破坏原剧情因果；可以选择最适合的已有分镜更新，也可以插入一个新广告植入分镜。
7. 除非用户明确要求立即重生视频，否则 regenerateVideo 必须为 false。
8. 不要修改没有被用户点名或明显关联的资产/分镜。
9. JSON 必须能被 JSON.parse 解析。`

  const userPrompt = JSON.stringify({
    instruction: params.instruction,
    referenceImageUrls: params.referenceImageUrls || [],
    context: buildCompactEditContext(params.context),
  })

  const response = await llmClient.callLLM(params.userId, systemPrompt, userPrompt, {
    action: 'super-agent.chat-edit',
    timeoutMs: 30_000,
    reasoning: false,
    reasoningEffort: 'low',
  })
  return normalizePlan(safeParseJsonObject(response), params.context)
}

async function loadEditableEpisode(projectId: string, episodeId: string) {
  const episode = await prisma.novelPromotionEpisode.findUnique({
    where: { id: episodeId },
    include: {
      novelPromotionProject: {
        include: {
          characters: {
            include: {
              appearances: { orderBy: { appearanceIndex: 'asc' } },
            },
          },
          locations: {
            include: {
              images: { orderBy: { imageIndex: 'asc' } },
            },
          },
        },
      },
      storyboards: {
        include: {
          panels: {
            orderBy: { panelIndex: 'asc' },
            select: {
              id: true,
              storyboardId: true,
              panelIndex: true,
              panelNumber: true,
              description: true,
              location: true,
              characters: true,
              props: true,
              imagePrompt: true,
              videoPrompt: true,
              srtSegment: true,
              actingNotes: true,
            },
          },
        },
      },
    },
  })

  if (!episode || episode.novelPromotionProject.projectId !== projectId) {
    throw new Error('Episode not found for project')
  }

  return episode
}

function parseDescriptions(value: string | null | undefined): string[] {
  return parseCharacterDescriptionValues(value).map((item) => String(item || ''))
}

function writeIndexedDescription(input: {
  descriptions: string | null | undefined
  fallback: string | null | undefined
  index: number
  nextDescription: string
}) {
  const descriptions = parseDescriptions(input.descriptions)
  const index = Math.max(0, input.index)
  while (descriptions.length <= index) descriptions.push(input.fallback || '')
  descriptions[index] = input.nextDescription
  return stringifyCharacterDescriptionsWithFrameOSMetadata(
    descriptions,
    readFrameOSAppearanceMetadataFromDescriptions(input.descriptions),
  )
}

async function refreshPanelReferenceAssets(panelId: string) {
  const panel = await prisma.novelPromotionPanel.findUnique({
    where: { id: panelId },
    include: {
      storyboard: {
        include: {
          episode: {
            include: {
              novelPromotionProject: {
                include: {
                  characters: {
                    include: {
                      appearances: { orderBy: { appearanceIndex: 'asc' } },
                    },
                  },
                  locations: {
                    include: {
                      selectedImage: true,
                      images: { orderBy: { imageIndex: 'asc' } },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  })
  if (!panel) return null
  const projectAssets = panel.storyboard.episode.novelPromotionProject
  const references = buildPanelSeedanceReferenceAssets({
    panel: {
      characters: panel.characters,
      location: panel.location,
      props: panel.props,
      videoPrompt: panel.videoPrompt,
    },
    characterAssets: projectAssets.characters,
    locationAssets: projectAssets.locations,
  })
  return writePanelSeedanceReferenceAssetsToActingNotes(panel.actingNotes, references)
}

function taskIdFromSubmitResult(result: unknown): string | undefined {
  if (!result || typeof result !== 'object') return undefined
  const record = result as Record<string, unknown>
  if (typeof record.taskId === 'string') return record.taskId
  const task = record.task
  if (task && typeof task === 'object' && typeof (task as Record<string, unknown>).id === 'string') {
    return (task as Record<string, unknown>).id as string
  }
  return undefined
}

function pickPanelPromptUpdate(panel: AgentChatEditPanelPlan) {
  const data: Record<string, string | number> = {}
  for (const field of ['description', 'imagePrompt', 'videoPrompt', 'srtSegment', 'characters', 'location', 'props', 'shotType', 'cameraMove'] as const) {
    const value = panel[field]
    if (typeof value === 'string' && value.trim()) {
      data[field] = value.trim()
    }
  }
  if (typeof panel.duration === 'number' && Number.isFinite(panel.duration) && panel.duration > 0) {
    data.duration = panel.duration
  }
  return data
}

async function createAgentAsset(params: {
  projectInternalId: string
  asset: AgentChatEditAssetPlan
}) {
  const description = params.asset.updatedDescription?.trim()
  const name = params.asset.name?.trim()
  if (!name || !description) return null

  if (params.asset.kind === 'character') {
    const character = await prisma.novelPromotionCharacter.create({
      data: {
        novelPromotionProjectId: params.projectInternalId,
        name,
        aliases: null,
        introduction: description,
        profileData: JSON.stringify({
          source: 'agent-chat-edit',
          visual_keywords: [description],
        }),
        profileConfirmed: false,
      },
    })
    const appearance = await prisma.characterAppearance.create({
      data: {
        characterId: character.id,
        appearanceIndex: 0,
        changeReason: 'Agent 新增资产',
        description,
        descriptions: JSON.stringify([description]),
        imageUrl: params.asset.imageUrl || null,
        imageUrls: encodeImageUrls(params.asset.imageUrl ? [params.asset.imageUrl] : []),
        previousImageUrls: encodeImageUrls([]),
      },
    })
    return {
      kind: params.asset.kind,
      id: character.id,
      targetId: appearance.id,
      targetType: 'CharacterAppearance',
      imageIndex: 0,
      changedFields: ['created', 'description', ...(params.asset.imageUrl ? ['imageUrl'] : [])],
    }
  }

  const location = await prisma.novelPromotionLocation.create({
    data: {
      novelPromotionProjectId: params.projectInternalId,
      name,
      summary: description,
      assetKind: params.asset.kind === 'prop' ? 'prop' : 'location',
    },
  })
  const image = await prisma.locationImage.create({
    data: {
      locationId: location.id,
      imageIndex: 0,
      description,
      imageUrl: params.asset.imageUrl || null,
      isSelected: Boolean(params.asset.imageUrl),
    },
  })
  if (params.asset.imageUrl) {
    await prisma.novelPromotionLocation.update({
      where: { id: location.id },
      data: { selectedImageId: image.id },
    })
  }
  return {
    kind: params.asset.kind,
    id: location.id,
    targetId: image.id,
    targetType: 'LocationImage',
    imageIndex: 0,
    changedFields: ['created', 'description', ...(params.asset.imageUrl ? ['imageUrl'] : [])],
  }
}

async function insertAgentPanel(panel: AgentChatEditPanelPlan) {
  const anchorId = panel.insertAfterPanelId || panel.insertBeforePanelId
  if (!anchorId) return null
  const anchor = await prisma.novelPromotionPanel.findUnique({
    where: { id: anchorId },
    select: {
      id: true,
      storyboardId: true,
      panelIndex: true,
      shotType: true,
      cameraMove: true,
      description: true,
      location: true,
      characters: true,
      props: true,
      srtSegment: true,
      duration: true,
      imagePrompt: true,
      videoPrompt: true,
    },
  })
  if (!anchor) return null
  const insertIndex = panel.insertBeforePanelId ? anchor.panelIndex : anchor.panelIndex + 1
  const newPanelId = randomUUID()
  const data = pickPanelPromptUpdate(panel)

  const created = await prisma.$transaction(async (tx) => {
    const affectedPanels = await tx.novelPromotionPanel.findMany({
      where: { storyboardId: anchor.storyboardId, panelIndex: { gte: insertIndex } },
      orderBy: { panelIndex: 'desc' },
      select: { id: true, panelIndex: true },
    })
    for (const item of affectedPanels) {
      await tx.novelPromotionPanel.update({
        where: { id: item.id },
        data: {
          panelIndex: item.panelIndex + 1,
          panelNumber: item.panelIndex + 2,
        },
      })
    }
    const next = await tx.novelPromotionPanel.create({
      data: {
        id: newPanelId,
        storyboardId: anchor.storyboardId,
        panelIndex: insertIndex,
        panelNumber: insertIndex + 1,
        shotType: typeof data.shotType === 'string' ? data.shotType : (anchor.shotType || '中景'),
        cameraMove: typeof data.cameraMove === 'string' ? data.cameraMove : (anchor.cameraMove || '固定'),
        description: typeof data.description === 'string' ? data.description : (panel.description || 'Agent 新增衔接分镜'),
        imagePrompt: typeof data.imagePrompt === 'string' ? data.imagePrompt : null,
        videoPrompt: typeof data.videoPrompt === 'string' ? data.videoPrompt : null,
        srtSegment: typeof data.srtSegment === 'string' ? data.srtSegment : null,
        location: typeof data.location === 'string' ? data.location : anchor.location,
        characters: typeof data.characters === 'string' ? data.characters : anchor.characters,
        props: typeof data.props === 'string' ? data.props : anchor.props,
        duration: typeof data.duration === 'number' ? data.duration : (anchor.duration || 4),
      },
    })
    const panelCount = await tx.novelPromotionPanel.count({
      where: { storyboardId: anchor.storyboardId },
    })
    await tx.novelPromotionStoryboard.update({
      where: { id: anchor.storyboardId },
      data: { panelCount },
    })
    return next
  })

  const actingNotes = await refreshPanelReferenceAssets(created.id)
  if (actingNotes !== null) {
    await prisma.novelPromotionPanel.update({
      where: { id: created.id },
      data: { actingNotes },
    })
  }
  return {
    panel: created,
    changedFields: [
      'created',
      ...Object.keys(data),
      ...(actingNotes !== null ? ['seedanceReferenceAssets'] : []),
    ],
  }
}

export async function applyAgentChatEdit(params: {
  userId: string
  projectId: string
  episodeId: string
  instruction: string
  locale?: Locale
  mode?: AgentChatEditMode
  selectedSkill?: SkillId | null
  referenceImageUrls?: string[]
  allowVideoGeneration?: boolean
}): Promise<AgentChatEditResult> {
  const instruction = params.instruction.trim()
  if (!instruction) {
    throw new Error('instruction is required')
  }

  const episode = await loadEditableEpisode(params.projectId, params.episodeId)
  const context = buildEditableContext(episode)
  let plan: AgentChatEditPlan
  if (params.mode === 'mock') {
    plan = createMockEditPlan(instruction, context, params.referenceImageUrls || [])
  } else {
    plan = await createLiveEditPlan({
      userId: params.userId,
      instruction,
      context,
      referenceImageUrls: params.referenceImageUrls,
    })
  }
  const normalizedPlan = normalizePlan(plan, context)
  if (normalizedPlan.intent === 'asset' && (normalizedPlan.assets || []).length > 0) {
    normalizedPlan.panels = []
    normalizedPlan.intent = 'asset'
    if (/分镜|video_prompt|视频提示词|同步/i.test(normalizedPlan.summary)) {
      normalizedPlan.summary = '已更新资产，并提交资产图重生成。'
    }
  }
  const projectModels = await getProjectModelConfig(params.projectId, params.userId)
  const locale = params.locale || 'zh'
  const submittedTaskIds: string[] = []
  const assetChanges: AppliedAssetChange[] = []
  const panelChanges: AppliedPanelChange[] = []

  for (const asset of normalizedPlan.assets || []) {
    const changedFields: string[] = []
    let targetId = asset.id || ''
    let taskId: string | undefined

    if (asset.action === 'create') {
      const created = await createAgentAsset({
        projectInternalId: episode.novelPromotionProject.id,
        asset,
      })
      if (!created) continue
      targetId = created.id
      changedFields.push(...created.changedFields)
      if (asset.regenerate === true && !asset.imageUrl) {
        if (created.kind === 'character' && projectModels.characterModel) {
          const result = await submitTask({
            userId: params.userId,
            locale,
            projectId: params.projectId,
            episodeId: params.episodeId,
            type: TASK_TYPE.IMAGE_CHARACTER,
            targetType: 'CharacterAppearance',
            targetId: created.targetId,
            payload: withTaskUiPayload({
              id: created.id,
              appearanceId: created.targetId,
              imageIndex: created.imageIndex,
              count: 1,
              modelId: projectModels.characterModel,
            }, {
              intent: 'regenerate',
              hasOutputAtStart: false,
            }),
            dedupeKey: `image_character:${created.targetId}:single:${created.imageIndex}`,
          })
          taskId = taskIdFromSubmitResult(result)
        } else if ((created.kind === 'location' || created.kind === 'prop') && projectModels.locationModel) {
          const result = await submitTask({
            userId: params.userId,
            locale,
            projectId: params.projectId,
            episodeId: params.episodeId,
            type: TASK_TYPE.IMAGE_LOCATION,
            targetType: 'LocationImage',
            targetId: created.targetId,
            payload: withTaskUiPayload({
              type: created.kind,
              id: created.id,
              locationId: created.id,
              imageIndex: created.imageIndex,
              count: 1,
              modelId: projectModels.locationModel,
            }, {
              intent: 'regenerate',
              hasOutputAtStart: false,
            }),
            dedupeKey: `image_location:${created.targetId}:single:${created.imageIndex}`,
          })
          taskId = taskIdFromSubmitResult(result)
        }
      }
      if (taskId) submittedTaskIds.push(taskId)
      assetChanges.push({
        kind: asset.kind,
        id: targetId,
        changedFields,
        action: 'created',
        ...(taskId ? { taskId } : {}),
      })
      continue
    }

    if (asset.kind === 'character') {
      const appearance = asset.appearanceId
        ? await prisma.characterAppearance.findUnique({ where: { id: asset.appearanceId }, include: { character: true } })
        : asset.id
          ? await prisma.characterAppearance.findFirst({
            where: { characterId: asset.id },
            orderBy: { appearanceIndex: 'asc' },
            include: { character: true },
          })
          : null
      if (!appearance) continue
      targetId = appearance.characterId
      const imageIndex = appearance.selectedIndex ?? 0
      if (asset.updatedDescription) {
        await prisma.characterAppearance.update({
          where: { id: appearance.id },
          data: {
            previousDescription: appearance.description || null,
            previousDescriptions: appearance.descriptions || null,
            description: asset.updatedDescription,
            descriptions: writeIndexedDescription({
              descriptions: appearance.descriptions,
              fallback: appearance.description,
              index: imageIndex,
              nextDescription: asset.updatedDescription,
            }),
          },
        })
        changedFields.push('description')
      }
      if (asset.imageUrl) {
        await prisma.characterAppearance.update({
          where: { id: appearance.id },
          data: {
            previousImageUrl: appearance.imageUrl || null,
            previousImageUrls: appearance.imageUrls || null,
            imageUrl: asset.imageUrl,
            imageUrls: encodeImageUrls([asset.imageUrl]),
            selectedIndex: 0,
          },
        })
        changedFields.push('imageUrl')
      }
      if (asset.regenerate !== false && appearance.imageUrl && projectModels.editModel) {
        const result = await submitTask({
          userId: params.userId,
          locale,
          projectId: params.projectId,
          episodeId: params.episodeId,
          type: TASK_TYPE.MODIFY_ASSET_IMAGE,
          targetType: 'CharacterAppearance',
          targetId: appearance.id,
          payload: withTaskUiPayload({
            type: 'character',
            appearanceId: appearance.id,
            id: appearance.characterId,
            imageIndex,
            modifyPrompt: instruction,
            modelId: projectModels.editModel,
          }, {
            intent: 'regenerate',
            hasOutputAtStart: await hasCharacterAppearanceOutput({
              appearanceId: appearance.id,
              characterId: appearance.characterId,
            }),
          }),
          dedupeKey: `modify_asset_image:character:${appearance.id}:${imageIndex}`,
        })
        taskId = taskIdFromSubmitResult(result)
      } else if (asset.regenerate !== false && projectModels.characterModel) {
        const result = await submitTask({
          userId: params.userId,
          locale,
          projectId: params.projectId,
          episodeId: params.episodeId,
          type: TASK_TYPE.IMAGE_CHARACTER,
          targetType: 'CharacterAppearance',
          targetId: appearance.id,
          payload: withTaskUiPayload({
            id: appearance.characterId,
            appearanceId: appearance.id,
            imageIndex,
            count: 1,
            modelId: projectModels.characterModel,
          }, {
            intent: 'regenerate',
            hasOutputAtStart: await hasCharacterAppearanceOutput({
              appearanceId: appearance.id,
              characterId: appearance.characterId,
            }),
          }),
          dedupeKey: `image_character:${appearance.id}:single:${imageIndex}`,
        })
        taskId = taskIdFromSubmitResult(result)
      }
    } else {
      const location = asset.id
        ? await prisma.novelPromotionLocation.findUnique({
          where: { id: asset.id },
          include: { images: { orderBy: { imageIndex: 'asc' } } },
        })
        : asset.imageId
          ? await prisma.novelPromotionLocation.findFirst({
            where: { images: { some: { id: asset.imageId } } },
            include: { images: { orderBy: { imageIndex: 'asc' } } },
          })
          : null
      if (!location) continue
      const locationImage = asset.imageId
        ? location.images.find((image) => image.id === asset.imageId)
        : location.images.find((image) => image.isSelected)
          || location.images[0]
      if (!locationImage) continue
      targetId = location.id
      const kind = location.assetKind === 'prop' || asset.kind === 'prop' ? 'prop' : 'location'
      if (asset.updatedDescription) {
        await prisma.$transaction([
          prisma.novelPromotionLocation.update({
            where: { id: location.id },
            data: { summary: asset.updatedDescription },
          }),
          prisma.locationImage.update({
            where: { id: locationImage.id },
            data: {
              previousDescription: locationImage.description || null,
              description: asset.updatedDescription,
            },
          }),
        ])
        changedFields.push('description')
      }
      if (asset.imageUrl) {
        await prisma.$transaction([
          prisma.locationImage.update({
            where: { id: locationImage.id },
            data: {
              previousImageUrl: locationImage.imageUrl || null,
              imageUrl: asset.imageUrl,
              isSelected: true,
            },
          }),
          prisma.novelPromotionLocation.update({
            where: { id: location.id },
            data: { selectedImageId: locationImage.id },
          }),
        ])
        changedFields.push('imageUrl')
      }
      if (asset.regenerate !== false && locationImage.imageUrl && projectModels.editModel) {
        const result = await submitTask({
          userId: params.userId,
          locale,
          projectId: params.projectId,
          episodeId: params.episodeId,
          type: TASK_TYPE.MODIFY_ASSET_IMAGE,
          targetType: 'LocationImage',
          targetId: locationImage.id,
          payload: withTaskUiPayload({
            type: kind,
            locationId: location.id,
            locationImageId: locationImage.id,
            imageIndex: locationImage.imageIndex,
            modifyPrompt: instruction,
            modelId: projectModels.editModel,
          }, {
            intent: 'regenerate',
            hasOutputAtStart: await hasLocationImageOutput({
              locationId: location.id,
              imageIndex: locationImage.imageIndex,
            }),
          }),
          dedupeKey: `modify_asset_image:${kind}:${locationImage.id}`,
        })
        taskId = taskIdFromSubmitResult(result)
      } else if (asset.regenerate !== false && projectModels.locationModel) {
        const result = await submitTask({
          userId: params.userId,
          locale,
          projectId: params.projectId,
          episodeId: params.episodeId,
          type: TASK_TYPE.IMAGE_LOCATION,
          targetType: 'LocationImage',
          targetId: locationImage.id,
          payload: withTaskUiPayload({
            type: kind,
            id: location.id,
            locationId: location.id,
            imageIndex: locationImage.imageIndex,
            count: 1,
            modelId: projectModels.locationModel,
          }, {
            intent: 'regenerate',
            hasOutputAtStart: await hasLocationImageOutput({
              locationId: location.id,
              imageIndex: locationImage.imageIndex,
            }),
          }),
          dedupeKey: `image_location:${locationImage.id}:single:${locationImage.imageIndex}`,
        })
        taskId = taskIdFromSubmitResult(result)
      }
    }

    if (taskId) submittedTaskIds.push(taskId)
    if (changedFields.length > 0 || taskId) {
      assetChanges.push({
        kind: asset.kind,
        id: targetId,
        changedFields,
        action: 'updated',
        ...(taskId ? { taskId } : {}),
      })
    }
  }

  for (const panel of normalizedPlan.panels || []) {
    if (panel.action === 'insert') {
      const inserted = await insertAgentPanel(panel)
      if (!inserted) continue
      panelChanges.push({
        id: inserted.panel.id,
        changedFields: inserted.changedFields,
        action: 'inserted',
      })
      continue
    }
    if (!panel.id) continue
    const data = pickPanelPromptUpdate(panel)
    if (Object.keys(data).length === 0 && panel.regenerateVideo === false) continue
    const before = await prisma.novelPromotionPanel.findUnique({
      where: { id: panel.id },
      select: {
        id: true,
        storyboardId: true,
        panelIndex: true,
        videoPrompt: true,
      },
    })
    if (!before) continue
    if (Object.keys(data).length > 0) {
      await prisma.novelPromotionPanel.update({
        where: { id: panel.id },
        data,
      })
    }
    const actingNotes = data.videoPrompt ? await refreshPanelReferenceAssets(panel.id) : null
    if (actingNotes !== null) {
      await prisma.novelPromotionPanel.update({
        where: { id: panel.id },
        data: { actingNotes },
      })
    }

    const changedFields = [
      ...Object.keys(data),
      ...(actingNotes !== null ? ['seedanceReferenceAssets'] : []),
    ]
    let taskId: string | undefined
    if (params.allowVideoGeneration === true && panel.regenerateVideo === true) {
      if (!projectModels.videoModel) {
        throw new Error('视频模型未配置，无法重新生成分镜视频')
      }
      const result = await submitTask({
        userId: params.userId,
        locale,
        projectId: params.projectId,
        episodeId: params.episodeId,
        type: TASK_TYPE.VIDEO_PANEL,
        targetType: 'NovelPromotionPanel',
        targetId: panel.id,
        payload: withTaskUiPayload({
          storyboardId: before.storyboardId,
          panelIndex: before.panelIndex,
          videoModel: projectModels.videoModel,
        }, {
          intent: 'regenerate',
          hasOutputAtStart: await hasPanelVideoOutput(panel.id),
        }),
        dedupeKey: `video_panel:${panel.id}`,
      })
      taskId = taskIdFromSubmitResult(result)
      if (taskId) submittedTaskIds.push(taskId)
    }
    if (changedFields.length > 0 || taskId) {
      panelChanges.push({
        id: panel.id,
        changedFields,
        action: 'updated',
        ...(taskId ? { taskId } : {}),
      })
    }
  }

  let workflowRunId: string | undefined
  try {
    const run = await recordAgentChatEditWorkflow({
      userId: params.userId,
      projectId: params.projectId,
      episodeId: params.episodeId,
      selectedSkill: isSkillId(params.selectedSkill) ? params.selectedSkill : null,
      instruction,
      appliedChanges: {
        summary: normalizedPlan.summary,
        targetType: normalizedPlan.intent || 'none',
        episodeUpdated: false,
        assetChanges,
        panelChanges,
        submittedTaskIds,
      },
    })
    workflowRunId = run.id
  } catch {
    workflowRunId = undefined
  }

  return {
    summary: normalizedPlan.summary,
    targetType: assetChanges.length > 0 && panelChanges.length > 0
      ? 'mixed'
      : assetChanges.length > 0
        ? 'asset'
        : panelChanges.length > 0
          ? 'storyboard'
          : 'none',
    episodeUpdated: false,
    assetChanges,
    panelChanges,
    submittedTaskIds,
    ...(workflowRunId ? { workflowRunId } : {}),
  }
}
