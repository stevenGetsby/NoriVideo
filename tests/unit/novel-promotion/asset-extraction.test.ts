import { describe, expect, it } from 'vitest'
import type { AiStepExecutionInput, AiStepExecutionResult } from '@/lib/ai-runtime'
import { executeAssetExtraction } from '@/lib/novel-promotion/asset-extraction'
import type {
  AssetExtractionPackage,
  CharacterVariant,
} from '@/lib/novel-promotion/asset-extraction/types'

function usage(): AiStepExecutionResult['usage'] {
  return {
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
  }
}

function completion(text: string): AiStepExecutionResult {
  return {
    text,
    reasoning: '',
    usage: usage(),
    completion: {
      id: 'completion-test',
      object: 'chat.completion',
      created: 0,
      model: 'test',
      choices: [],
    } as AiStepExecutionResult['completion'],
  }
}

function variant(index: number): CharacterVariant {
  return {
    id: `character-su-wanqing-variant-${index}`,
    name: `第${index}集视觉变化期`,
    episodeRange: { start: index, end: index },
    backgroundDelta: `第${index}集状态变化`,
    profileOverride: {
      subject: `第${index}集主体变化`,
      face: `第${index}集面部变化`,
      clothing: `第${index}集服装变化`,
      accessories: `第${index}集配饰变化`,
    },
    reason: `第${index}集需要单独状态`,
    evidence: [{ episodeNumber: index, quote: `第${index}集证据` }],
  }
}

function packageFor(input: {
  characterId: string
  variants: CharacterVariant[]
  environmentId: string
  propId: string
}): AssetExtractionPackage {
  return {
    version: 'asset-extraction-v1',
    worldBackground: '民国宅院复仇故事背景。',
    characters: [
      {
        id: input.characterId,
        name: '苏晚卿',
        aliases: ['我'],
        importance: 'lead',
        background: '苏晚卿是主角，被迫进入陆府后逐步反击。',
        profile: {
          subject: '女性，约18岁，约160厘米，乡野底层出身，身型纤细。',
          face: '小鹅蛋脸，黑色长发，柳叶眉杏眼，深棕色瞳孔。',
          clothing: '素色旧式斜襟上衣，棉麻材质，黑色布鞋。',
          accessories: '发髻藏银簪，贴身保存令牌。',
        },
        variants: input.variants,
        relatedEpisodes: input.variants.map((item) => item.episodeRange.start),
        evidence: [{ episodeNumber: 1, quote: '苏晚卿证据' }],
      },
    ],
    environments: [
      {
        id: input.environmentId,
        name: '陆府回廊',
        background: '陆府回廊是内宅冲突和偶遇场景。',
        profile: {
          subject: '陆府木质回廊。',
          layout: '长廊连接各院落。',
          atmosphere: '压抑、明亮但暗含敌意。',
          visualDetails: '朱褐色木柱、雕花栏杆、青石地面。',
        },
        relatedEpisodes: input.variants.map((item) => item.episodeRange.start),
        evidence: [{ episodeNumber: 1, quote: '陆府回廊证据' }],
      },
    ],
    props: [
      {
        id: input.propId,
        name: '银簪',
        background: '银簪是苏晚卿防身和情感信物。',
        profile: {
          subject: '女子发髻中隐藏的细长银簪。',
          material: '旧银材质。',
          shape: '细长簪身，簪尖锋利。',
          visualDetails: '雨夜中带冷光。',
        },
        owner: '苏晚卿',
        relatedEpisodes: input.variants.map((item) => item.episodeRange.start),
        evidence: [{ episodeNumber: 1, quote: '银簪证据' }],
      },
    ],
    warnings: [],
  }
}

describe('asset extraction merge normalization', () => {
  it('merges same-name assets and compacts lead variants across batches', async () => {
    const packages = [
      packageFor({
        characterId: 'character-su-wanqing-a',
        variants: [variant(1), variant(2), variant(3)],
        environmentId: 'environment-lu-corridor-a',
        propId: 'prop-silver-hairpin-a',
      }),
      packageFor({
        characterId: 'character-su-wanqing-b',
        variants: [variant(4), variant(5), variant(6)],
        environmentId: 'environment-lu-corridor-b',
        propId: 'prop-silver-hairpin-b',
      }),
    ]
    let callIndex = 0
    const executeTextStep = async (_input: AiStepExecutionInput) => {
      const pkg = packages[callIndex]
      callIndex += 1
      return completion(JSON.stringify(pkg))
    }

    const result = await executeAssetExtraction({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'test-model',
      episodes: Array.from({ length: 6 }, (_, index) => ({
        episodeNumber: index + 1,
        title: `第${index + 1}集`,
        sourceText: `第${index + 1}集文本`,
      })),
      executeTextStep,
    })

    expect(callIndex).toBe(2)
    expect(result.package.characters).toHaveLength(1)
    expect(result.package.environments.map((item) => item.name)).toEqual(['陆府回廊'])
    expect(result.package.props.map((item) => item.name)).toEqual(['银簪'])
    expect(result.package.characters[0].variants.length).toBeLessThanOrEqual(5)
    expect(result.package.characters[0].variants[0].episodeRange).toEqual({ start: 1, end: 2 })
    expect(result.package.characters[0].variants.at(-1)?.episodeRange).toEqual({ start: 5, end: 6 })
    expect(result.package.characters[0].relatedEpisodes).toEqual([1, 2, 3, 4, 5, 6])
  })
})
