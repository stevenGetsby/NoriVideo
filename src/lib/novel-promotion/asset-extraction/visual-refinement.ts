import type {
  AssetExtractionPackage,
  CharacterAsset,
  CharacterVariant,
  CharacterVisualProfile,
} from './types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function readString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function readVisualProfile(value: unknown, label: string): CharacterVisualProfile {
  const record = isRecord(value) ? value : {}
  const profile = {
    subject: readString(record.subject),
    face: readString(record.face),
    clothing: readString(record.clothing),
    accessories: readString(record.accessories),
  }
  if (!profile.subject || !profile.face || !profile.clothing || !profile.accessories) {
    throw new Error(`visual refinement profile incomplete: ${label}`)
  }
  return profile
}

function readProfileOverride(value: unknown, label: string): Partial<CharacterVisualProfile> {
  const record = isRecord(value) ? value : {}
  const profileOverride = {
    ...(readString(record.subject) ? { subject: readString(record.subject) } : {}),
    ...(readString(record.face) ? { face: readString(record.face) } : {}),
    ...(readString(record.clothing) ? { clothing: readString(record.clothing) } : {}),
    ...(readString(record.accessories) ? { accessories: readString(record.accessories) } : {}),
  }
  if (Object.keys(profileOverride).length === 0) {
    throw new Error(`visual refinement variant profileOverride empty: ${label}`)
  }
  return profileOverride
}

function serializeCharacterForRefine(character: CharacterAsset) {
  return {
    id: character.id,
    name: character.name,
    aliases: character.aliases,
    importance: character.importance,
    background: character.background,
    relatedEpisodes: character.relatedEpisodes,
    mainAppearance: {
      id: character.mainAppearance.id,
      name: character.mainAppearance.name,
      episodeRange: character.mainAppearance.episodeRange,
      facts: character.mainAppearance.facts,
      currentProfileDraft: character.mainAppearance.profile,
      reason: character.mainAppearance.reason,
      evidence: character.mainAppearance.evidence,
    },
    variants: character.variants.map((variant) => ({
      id: variant.id,
      name: variant.name,
      episodeRange: variant.episodeRange,
      facts: variant.facts,
      backgroundDelta: variant.backgroundDelta,
      currentProfileOverrideDraft: variant.profileOverride,
      reason: variant.reason,
      evidence: variant.evidence,
    })),
  }
}

export function buildCharacterVisualRefinementPrompt(input: {
  worldBackground: string
  character: CharacterAsset
}): string {
  return [
    '你是精品短剧美术设定师。请根据“角色事实/时期定位”生成最终可生图的角色视觉档案 JSON。',
    '',
    '核心任务：',
    '1. 只重写角色 mainAppearance.profile 和 variants.profileOverride；不要改角色 id、角色名、重要性、relatedEpisodes、episodeRange、evidence。',
    '2. 第一阶段的 currentProfileDraft 只是草案，可能被前一时期污染。你必须以 facts.identity、facts.socialStatus、facts.plotState 和 evidence 为准重建视觉档案。',
    '3. clothing 必须与时期身份匹配。落魄姨太/低位姨太 ≠ 流民装；她可以寒酸、半旧、素净、无贵重首饰，但仍应是陆府内宅姨太身份下的民国改良旗袍、袄裙、内宅便服等，而不是乡野粗布短衫长裤。',
    '4. 逃亡孤女、被卖孤女、雨夜逃亡等时期才可以使用粗布短衫、粗布长裤、湿透沾泥等流民/逃亡装束。',
    '5. 督军夫人、侧夫人、小姐、副官、丫鬟、西医、媒婆、下人等身份都要使用对应阶层服装，不要把其他时期服装继承过来。',
    '6. mainAppearance.profile 是稳定身份基准，不承载即时剧情状态；避免写一次性动作、构图、镜头、表情戏。受伤、湿透、饥饿、被打、护胎、深夜遇袭等都写进对应 variant.profileOverride。',
    '7. variants.profileOverride 是叠加在 mainAppearance 上的状态变化。同一主身份下必须保留主身份服装逻辑，只调整破损、凌乱、脸色、姿态、道具状态；只有逃亡/被卖/老年/身份跃迁等真正身份阶段才整体换服装。',
    '8. 必须返回输入中的每一个 variant id，不能省略、合并或新增 variant；如果某个变体变化较少，也要返回该 id 和最少一个 profileOverride 字段。',
    '9. 保留原文明确视觉线索；原文未写的发型、材质、版型可以按民国短剧、身份阶层、场景合理补全，但必须保守、可视觉化、可用于生图。',
    '',
    '字段要求：',
    '- subject：性别、年龄段、身高/体型、身份阶层、气质姿态。',
    '- face：脸型、发型发色、眉眼、瞳孔、鼻唇、肤色、可识别面部特征。',
    '- clothing：服装类别、颜色、材质、版型、纹样/无纹、整洁/破损状态、鞋履。必须体现时期身份。',
    '- accessories：首饰、信物、武器、随身物件，以及佩戴/持有位置；没有就写“无明确稳定配饰”。',
    '',
    '输出 JSON schema：',
    JSON.stringify({
      characters: [
        {
          id: 'character-su-wanqing',
          mainAppearance: {
            profile: {
              subject: '主体：女性，约18岁，约160厘米，汉族，陆府低位姨太，身型纤细单薄，站姿克制隐忍但脊背挺直。',
              face: '面部：鹅蛋偏瓜子脸，黑色长发梳低发髻，柳叶眉杏眼，深棕色瞳孔，鼻梁中等挺直，唇形偏薄，肤色白皙偏苍。',
              clothing: '服装：素净半旧的浅青灰色民国改良旗袍或内宅袄裙，细棉布材质，立领斜襟，盘扣整齐，素面少纹，版型合身但不华贵，袖口和衣摆轻微磨旧，黑色低跟布鞋。',
              accessories: '配饰：贴身藏刻“陆”字玄铁令牌，发间可有简素银簪，无华贵首饰。',
            },
          },
          variants: [
            {
              id: 'character-su-wanqing-variant-escape',
              profileOverride: {
                clothing: '相对主形象，服装换为靛蓝色粗布大襟短衫、黑色粗布长裤、黑布千层底布鞋，浑身湿透沾泥水。',
                face: '相对主形象，面色惨白，唇色发紫，额头冷汗混着雨水。',
              },
            },
          ],
        },
      ],
    }, null, 2),
    '',
    '待 refine 角色事实：',
    JSON.stringify({
      worldBackground: input.worldBackground,
      character: serializeCharacterForRefine(input.character),
    }, null, 2).slice(0, 80_000),
  ].join('\n')
}

export function applySingleCharacterVisualRefinement(
  pkg: AssetExtractionPackage,
  characterId: string,
  raw: unknown,
): AssetExtractionPackage {
  const record = isRecord(raw) ? raw : {}
  const characters = Array.isArray(record.characters) ? record.characters : []
  const byId = new Map<string, Record<string, unknown>>()
  for (const item of characters) {
    if (!isRecord(item)) continue
    const id = readString(item.id)
    if (id) byId.set(id, item)
  }

  return {
    ...pkg,
    characters: pkg.characters.map((character) => {
      if (character.id !== characterId) return character
      const refined = byId.get(character.id)
      if (!refined) {
        throw new Error(`visual refinement missing character: ${character.name}`)
      }
      const refinedMain = isRecord(refined.mainAppearance) ? refined.mainAppearance : {}
      const mainProfile = readVisualProfile(
        refinedMain.profile,
        `${character.name}/${character.mainAppearance.name}`,
      )
      const refinedVariantRecords = Array.isArray(refined.variants) ? refined.variants : []
      const variantById = new Map<string, Record<string, unknown>>()
      for (const item of refinedVariantRecords) {
        if (!isRecord(item)) continue
        const id = readString(item.id)
        if (id) variantById.set(id, item)
      }
      const variants = character.variants.map((variant): CharacterVariant => {
        const refinedVariant = variantById.get(variant.id)
        if (!refinedVariant) {
          throw new Error(`visual refinement missing variant: ${character.name}/${variant.name}`)
        }
        return {
          ...variant,
          profileOverride: readProfileOverride(
            refinedVariant.profileOverride,
            `${character.name}/${variant.name}`,
          ),
        }
      })
      return {
        ...character,
        mainAppearance: {
          ...character.mainAppearance,
          profile: mainProfile,
        },
        profile: mainProfile,
        variants,
      }
    }),
  }
}
