/**
 * 角色档案数据结构
 * 用于两阶段角色生成系统
 */

export type RoleLevel = 'S' | 'A' | 'B' | 'C' | 'D'

export type CostumeTier = 1 | 2 | 3 | 4 | 5

export type CoverageEpisode = string | number

export interface CharacterExpectedAppearance {
    /** 子形象编号，来自模型输出 */
    id?: string | number

    /** 子形象变化原因，例如初始形象、换装、年老回忆 */
    change_reason?: string

    /** 该形象覆盖的分集或剧情段 */
    coverage_episodes?: CoverageEpisode[]
}

export interface CharacterAssetVariant {
    /** FrameOS-style variant id or local variant index */
    variant_id?: string | number

    /** Human-readable variant label */
    label?: string

    /** Stable variant type, for example default costume, uniform, disguise, aged state */
    variant_type?: string

    /** Image prompt for this persistent visual variant */
    prompt?: string

    /** Scene labels where this variant is used */
    coverage_scenes?: string[]

    /** Episode labels where this variant is used */
    coverage_episodes?: CoverageEpisode[]
}

export interface CharacterProfileData {
    /** FrameOS-style role type, mapped from role_level when needed */
    role_type?: string

    /** 角色重要性层级 */
    role_level: RoleLevel

    /** FrameOS-style character description for asset cards */
    description?: string

    /** 角色原型 (如: 霸道总裁, 心机婊) */
    archetype: string

    /** 性格标签 */
    personality_tags: string[]

    /** 时代背景 */
    era_period: string

    /** 社会阶层 */
    social_class: string

    /** 职业 (可选) */
    occupation?: string

    /** 角色背景、身份关系或生产定位 */
    background?: string

    /** 角色身份锁定线索 */
    identity_lock?: string[]

    /** 角色关系线索 */
    relationships?: string[]

    /** 出现场次或剧情片段 */
    coverage_scenes?: string[]

    /** 出场集或覆盖剧情段 */
    coverage_episodes?: CoverageEpisode[]

    /** 角色主形象生成提示词 */
    prompt?: string

    /** 稳定音色特征 */
    voice_trait?: string

    /** 能代表角色语气的一句台词 */
    representative_line?: string

    /** 音色试镜提示词 */
    voice_audition_prompt?: string

    /** 配音语速倍率 */
    speech_rate?: number

    /** 已绑定音色 id，生成阶段通常为空 */
    voice_id?: string

    /** 已上传/匹配音频文件，生成阶段通常为空 */
    voice_raw_file?: string

    /** 音色试镜状态 */
    audition_status?: string

    /** 服装华丽度 (1-5) */
    costume_tier: CostumeTier

    /** 建议色彩 */
    suggested_colors: string[]

    /** 主要辨识标志 (S/A级角色必须) */
    primary_identifier?: string

    /** 视觉关键词 */
    visual_keywords: string[]

    /** 性别 */
    gender: string

    /** 年龄段描述 */
    age_range: string

    /** 持续性子形象规划 */
    expected_appearances?: CharacterExpectedAppearance[]

    /** FrameOS-style persistent visual variants */
    variants?: CharacterAssetVariant[]
}

/**
 * 从JSON字符串解析角色档案
 */
export function parseProfileData(profileDataJson: string | null): CharacterProfileData | null {
    if (!profileDataJson) return null
    try {
        return JSON.parse(profileDataJson) as CharacterProfileData
    } catch {
        return null
    }
}

/**
 * 将角色档案序列化为JSON字符串
 */
export function stringifyProfileData(profileData: CharacterProfileData): string {
    return JSON.stringify(profileData)
}

/**
 * 验证角色档案数据完整性
 */
export function validateProfileData(data: unknown): data is CharacterProfileData {
    if (!data || typeof data !== 'object') return false
    const candidate = data as Partial<CharacterProfileData>
    return !!(
        typeof candidate.role_level === 'string' &&
        ['S', 'A', 'B', 'C', 'D'].includes(candidate.role_level) &&
        typeof candidate.archetype === 'string' &&
        Array.isArray(candidate.personality_tags) &&
        typeof candidate.era_period === 'string' &&
        typeof candidate.social_class === 'string' &&
        typeof candidate.costume_tier === 'number' &&
        candidate.costume_tier >= 1 &&
        candidate.costume_tier <= 5 &&
        Array.isArray(candidate.suggested_colors) &&
        Array.isArray(candidate.visual_keywords) &&
        typeof candidate.gender === 'string' &&
        typeof candidate.age_range === 'string' &&
        (candidate.identity_lock === undefined || Array.isArray(candidate.identity_lock)) &&
        (candidate.relationships === undefined || Array.isArray(candidate.relationships)) &&
        (candidate.coverage_scenes === undefined || Array.isArray(candidate.coverage_scenes)) &&
        (candidate.coverage_episodes === undefined || Array.isArray(candidate.coverage_episodes)) &&
        (candidate.expected_appearances === undefined || Array.isArray(candidate.expected_appearances)) &&
        (candidate.variants === undefined || Array.isArray(candidate.variants))
    )
}
