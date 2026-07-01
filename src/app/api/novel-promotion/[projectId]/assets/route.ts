import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { requireProjectAuthLight, isErrorResponse } from '@/lib/api-auth'
import { apiHandler } from '@/lib/api-errors'
import { attachMediaFieldsToProject } from '@/lib/media/attach'
import {
    parseCharacterDescriptionValues,
    readFrameOSAppearanceMetadataFromDescriptions,
} from '@/lib/novel-promotion/character-appearance-frameos-metadata'
import { readFrameOSAssetMetadataFromAvailableSlots } from '@/lib/location-available-slots'

function readAssetKind(value: Record<string, unknown>): string {
    return typeof value.assetKind === 'string' ? value.assetKind : 'location'
}

function readText(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null
}

function joinPromptSections(sections: Array<string | null | undefined>): string {
    return sections.map((section) => readText(section)).filter(Boolean).join('\n')
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function parseProfileData(value: unknown): Record<string, unknown> {
    if (isRecord(value)) return value
    if (typeof value !== 'string') return {}
    try {
        const parsed = JSON.parse(value) as unknown
        return isRecord(parsed) ? parsed : {}
    } catch {
        return {}
    }
}

function formatCoverageEpisodes(value: unknown): string | null {
    if (!Array.isArray(value) || value.length === 0) return null
    const labels = value
        .map((item) => typeof item === 'number' || typeof item === 'string' ? `E${String(item).replace(/^E/i, '')}` : '')
        .filter(Boolean)
    return labels.length > 0 ? labels.join('、') : null
}

function readStringArray(value: unknown): string[] {
    return Array.isArray(value) ? value.map((item) => readText(item)).filter((item): item is string => !!item) : []
}

function promptLooksFinal(value: string | null): boolean {
    return Boolean(value && (value.includes('【整体美学】') || value.includes('基于参考图生成角色变体设定图')))
}

function formatAestheticBlock(artStylePrompt: string | null): string {
    return joinPromptSections([
        '真人实拍摄影质感，自然皮肤毛孔与织物纹理，影棚级光影，35mm胶片质地。',
        artStylePrompt,
    ])
}

function formatCharacterArchiveFromProfileData(profileData: Record<string, unknown>, fallback: string | null): string {
    const keywords = readStringArray(profileData.visual_keywords)
    if (keywords.length > 0) {
        const [subject, face, clothing, accessories] = keywords
        return joinPromptSections([
            subject ? `主体：${subject}` : null,
            face ? `面部：${face}` : null,
            clothing ? `服装：${clothing}` : null,
            accessories ? `配饰：${accessories}` : null,
        ]).replace(/\n/g, '。')
    }
    return fallback || ''
}

function buildFinalCharacterMainPrompt(input: {
    characterName: string
    appearanceName: string | null
    archive: string
    artStylePrompt: string | null
}): string {
    return joinPromptSections([
        '【整体美学】',
        '',
        formatAestheticBlock(input.artStylePrompt),
        '',
        '【画面规格】',
        '',
        `角色设定图，"${input.characterName}"。16:9 横版，纯白背景，平视视角。仅一个角色，画面中不得出现其他人物。`,
        '',
        '版面：左40%，右60%两区。',
        '',
        '左区（占画面宽度40%，全高，纯白背景）：',
        '3/4侧角面部大特写，头顶贴近画面上沿留5%留白，画面下沿到锁骨位置，面部横向居中，无表情闭嘴，脸部无阴影。',
        '右区（占画面宽度60%，纯白背景）：',
        '三张等尺全身像横向排列，依次为正面、侧面、背面。立正姿势，双手自然下垂，头顶贴近画面上沿留5%留白，全身完整入画，从头顶到鞋底无任何裁切。',
        '',
        '身材比例（身高 / 体型 / 头身比）严格按【角色档案】描述呈现。',
        '',
        '所有视图保持同一人物，服装、发型、配饰、身材比例、肤色完全一致。',
        '',
        '【角色档案】',
        '',
        input.appearanceName ? `时期：${input.appearanceName}。` : null,
        input.archive,
        '',
        '（不出现任何字幕、文字、Logo、水印、UI；不出现其他人物；不要复制角色或分身同脸；不裁切头顶或脚部）',
    ])
}

function buildFinalCharacterVariantPrompt(input: {
    characterName: string
    variantName: string
    archive: string
    change: string
    episodes: string | null
}): string {
    return joinPromptSections([
        '基于参考图生成角色变体设定图，必须保持同一人物身份连续性：脸型、五官结构、身高体型、肤色、年龄感与主形象一致。',
        `角色：${input.characterName}。变体：${input.variantName}。`,
        '只改变变体要求中明确变化的服装、发型状态、面色、配饰状态，其余外观特征保持不变。',
        '16:9 横版，纯白背景，平视视角。角色设定图，左40%为3/4侧角面部大特写，右60%为正面、侧面、背面三张等尺全身像横向排列。',
        '仅一个角色，不出现其他人物；不出现任何字幕、文字、Logo、水印、UI；不裁切头顶或脚部。',
        input.episodes ? `覆盖分集：${input.episodes}` : null,
        '【主形象参考】',
        input.archive,
        '【变体变化】',
        input.change,
    ])
}

function extractLegacyVisualChangeText(prompt: string): string | null {
    const visualMarker = '视觉档案：'
    const visualIndex = prompt.indexOf(visualMarker)
    if (visualIndex < 0) return null
    const visualText = prompt.slice(visualIndex + visualMarker.length)
    const lines = visualText
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
    const changeLines: string[] = []
    for (const line of lines) {
        if (/^(世界背景|统一画风|近代|民国|院线|真人实拍)/.test(line)) break
        if (/^(主体|面部|服装|配饰)[：:]/.test(line)) {
            changeLines.push(line)
        }
    }
    return changeLines.length > 0 ? changeLines.join('\n') : null
}

function extractVariantChangeText(prompt: string): string {
    const marker = '【变体变化】'
    const index = prompt.indexOf(marker)
    if (index >= 0) {
        const body = prompt.slice(index + marker.length).trim()
        return extractLegacyVisualChangeText(body) || body
    }

    const legacyVisualChangeText = extractLegacyVisualChangeText(prompt)
    if (legacyVisualChangeText) return legacyVisualChangeText

    const editMarker = '只编辑以下视觉变化：'
    const editIndex = prompt.indexOf(editMarker)
    if (editIndex >= 0) return prompt.slice(editIndex + editMarker.length).trim()

    const deltaMarker = '剧情变化：'
    const deltaIndex = prompt.indexOf(deltaMarker)
    if (deltaIndex >= 0) {
        return prompt
            .slice(deltaIndex + deltaMarker.length)
            .split(/\n(?:保留主形象|世界背景|统一画风)：/)[0]
            .trim()
    }

    return prompt
}

function readAppearancePrompt(appearance: Record<string, unknown>): string | null {
    const descriptions = parseCharacterDescriptionValues(appearance.descriptions)
    const selectedIndex = typeof appearance.selectedIndex === 'number' ? appearance.selectedIndex : 0
    const metadata = readFrameOSAppearanceMetadataFromDescriptions(appearance.descriptions)
    return readText(descriptions[selectedIndex])
        || readText(descriptions[0])
        || readText(appearance.description)
        || readText(metadata?.prompt)
}

function decorateCharacterAsset(character: Record<string, unknown>, artStylePrompt: string | null): Record<string, unknown> {
    const profileData = parseProfileData(character.profileData)
    const appearances = Array.isArray(character.appearances)
        ? character.appearances.filter(isRecord)
        : []
    const primaryAppearance = appearances[0] || null
    const rawPrompt = primaryAppearance
        ? readAppearancePrompt(primaryAppearance)
        : readText(profileData.prompt)
    const characterName = readText(character.name) || '未命名角色'
    const archive = formatCharacterArchiveFromProfileData(
        profileData,
        readText(profileData.prompt) || readText(character.introduction),
    )
    const prompt = promptLooksFinal(rawPrompt)
        ? rawPrompt
        : buildFinalCharacterMainPrompt({
            characterName,
            appearanceName: readText(primaryAppearance?.changeReason),
            archive,
            artStylePrompt,
        })
    const variants = appearances.map((appearance) => {
        const metadata = readFrameOSAppearanceMetadataFromDescriptions(appearance.descriptions)
        const rawDescription = readAppearancePrompt(appearance) || ''
        const label = readText(appearance.changeReason)
            || readText(metadata?.label)
            || readText(metadata?.change_reason)
            || '初始形象'
        const episodes = formatCoverageEpisodes(metadata?.coverage_episodes)
        const rawChangeText = appearance === primaryAppearance ? null : extractVariantChangeText(rawDescription)
        const fullPrompt = appearance === primaryAppearance || promptLooksFinal(rawDescription)
            ? rawDescription
            : buildFinalCharacterVariantPrompt({
                characterName,
                variantName: label,
                archive,
                change: rawChangeText || rawDescription,
                episodes,
            })
        const changeText = appearance === primaryAppearance ? null : extractVariantChangeText(fullPrompt)
        return {
            id: String(appearance.id || appearance.appearanceIndex || ''),
            appearanceId: String(appearance.id || ''),
            label,
            description: changeText || fullPrompt,
            changeText,
            imageUrl: readText(appearance.imageUrl),
            prompt: fullPrompt,
            fullPrompt,
            promptKind: appearance === primaryAppearance ? 'text_to_image' : 'image_to_image_edit',
            episodes,
        }
    }).filter((variant) => variant.description)

    return {
        ...character,
        mainAppearanceId: primaryAppearance ? String(primaryAppearance.id || '') : null,
        description: readText(profileData.description)
            || readText(profileData.background)
            || readText(character.introduction),
        prompt,
        imagePrompt: prompt,
        imageUrl: readText(primaryAppearance?.imageUrl),
        variants,
    }
}

function readLocationPrompt(location: Record<string, unknown>): string | null {
    const images = Array.isArray(location.images) ? location.images.filter(isRecord) : []
    const selected = images.find((image) => image.isSelected === true)
        || images.find((image) => readText(image.description))
        || images[0]
        || null
    if (!selected) return null
    const metadata = readFrameOSAssetMetadataFromAvailableSlots(readText(selected.availableSlots))
    return readText(selected.description) || readText(metadata?.prompt)
}

function decorateLocationBackedAsset(location: Record<string, unknown>): Record<string, unknown> {
    const images = Array.isArray(location.images) ? location.images.filter(isRecord) : []
    const prompt = readLocationPrompt(location)
    const variants = images.map((image) => {
        const metadata = readFrameOSAssetMetadataFromAvailableSlots(readText(image.availableSlots))
        const description = readText(image.description) || readText(metadata?.prompt) || ''
        return {
            id: String(image.id || image.imageIndex || ''),
            label: readText(metadata?.name) || `方案 ${Number(image.imageIndex ?? 0) + 1}`,
            description,
            episodes: formatCoverageEpisodes(metadata?.coverage_episodes),
            imageUrl: readText(image.imageUrl),
        }
    }).filter((variant) => variant.description)

    return {
        ...location,
        description: readText(location.summary),
        prompt,
        imagePrompt: prompt,
        imageUrl: readText(images[0]?.imageUrl),
        variants,
    }
}

/**
 * GET - 获取项目资产（角色 + 场景）
 * 🔥 V6.5: 为 useProjectAssets hook 提供统一的资产数据接口
 */
export const GET = apiHandler(async (
    request: NextRequest,
    context: { params: Promise<{ projectId: string }> }
) => {
    const { projectId } = await context.params

    // 🔐 统一权限验证
    const authResult = await requireProjectAuthLight(projectId)
    if (isErrorResponse(authResult)) return authResult

    // 获取项目的角色和场景数据
    const novelData = await prisma.novelPromotionProject.findUnique({
        where: { projectId },
        include: {
            characters: {
                include: {
                    appearances: {
                        orderBy: { appearanceIndex: 'asc' }
                    }
                },
                orderBy: { createdAt: 'asc' }
            },
            locations: {
                include: {
                    images: {
                        orderBy: { imageIndex: 'asc' }
                    }
                },
                orderBy: { createdAt: 'asc' }
            }
        }
    })

    if (!novelData) {
        return NextResponse.json({ characters: [], locations: [], props: [] })
    }

    // 为资产添加稳定媒体 URL（并保留兼容字段）
    const withSignedUrls = await attachMediaFieldsToProject(novelData)
    const artStylePrompt = readText(withSignedUrls.artStylePrompt)
    const characters = (withSignedUrls.characters || []).map((character) => decorateCharacterAsset(character, artStylePrompt))
    const locations = (withSignedUrls.locations || [])
        .filter((item) => readAssetKind(item) !== 'prop')
        .map(decorateLocationBackedAsset)
    const props = (withSignedUrls.locations || [])
        .filter((item) => readAssetKind(item) === 'prop')
        .map(decorateLocationBackedAsset)

    return NextResponse.json({
        characters,
        locations,
        props,
    })
})
