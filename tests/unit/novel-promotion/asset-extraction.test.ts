import { describe, expect, it } from 'vitest'
import type { AiStepExecutionInput, AiStepExecutionResult } from '@/lib/ai-runtime'
import { executeAssetExtraction } from '@/lib/novel-promotion/asset-extraction'
import { buildAssetExtractionPrompt } from '@/lib/novel-promotion/asset-extraction/prompt'
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
    facts: {
      identity: `第${index}集身份`,
      socialStatus: `第${index}集处境`,
      plotState: `第${index}集状态变化`,
      explicitVisualCues: [`第${index}集证据`],
    },
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
  propName?: string
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
        mainAppearance: {
          id: `${input.characterId}-main-appearance`,
          name: '陆府姨太时期',
          episodeRange: {
            start: input.variants[0]?.episodeRange.start || 1,
            end: input.variants.at(-1)?.episodeRange.end || 1,
          },
          facts: {
            identity: '陆府低位姨太',
            socialStatus: '已进入陆府内宅但地位低。',
            plotState: '初入陆府后逐步反击。',
            explicitVisualCues: ['贴身保存令牌'],
          },
          profile: {
            subject: '女性，约18岁，约160厘米，乡野底层出身，身型纤细。',
            face: '小鹅蛋脸，黑色长发，柳叶眉杏眼，深棕色瞳孔。',
            clothing: '素色旧式斜襟上衣，棉麻材质，黑色布鞋。',
            accessories: '发髻藏银簪，贴身保存令牌。',
          },
          reason: '本批次最稳定的陆府姨太身份主形象。',
          evidence: [{ episodeNumber: 1, quote: '苏晚卿证据' }],
        },
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
        name: input.propName || '银簪',
        background: `${input.propName || '银簪'}是苏晚卿防身和情感信物。`,
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
  it('asks the LLM for structured main-appearance assets and semantic period variants', () => {
    const prompt = buildAssetExtractionPrompt({
      episodes: [
        {
          episodeNumber: 1,
          title: '第一集',
          sourceText: '苏晚卿在雨夜逃亡，衣衫湿透，手中攥着陈阿婆留下的银簪。',
        },
      ],
    })

    expect(prompt).toContain('当前步骤只负责从输入剧集中抽取结构化资产 JSON')
    expect(prompt).toContain('角色定位、时期划分、身份阶层、剧情状态、明确视觉线索')
    expect(prompt).toContain('主形象/身份基准')
    expect(prompt).toContain('显式 mainAppearance（主形象/身份基准）')
    expect(prompt).toContain('mainAppearance.facts')
    expect(prompt).toContain('profile 是兼容字段，必须复制 mainAppearance.profile，但它只是初稿')
    expect(prompt).toContain('name 必须以“状态”或“时期”结尾')
    expect(prompt).toContain('identity 必须写角色在该时期的身份')
    expect(prompt).toContain('socialStatus 必须写阶层和待遇')
    expect(prompt).toContain('剧本文本中的“人物：”行是角色覆盖集数的重要依据')
    expect(prompt).toContain('小角色也要抽成 supporting')
    expect(prompt).toContain('普通配角 supporting 必须输出空 variants 数组')
    expect(prompt).toContain('身份阶段变化 > 同身份重大状态 > 单集剧情事件')
    expect(prompt).toContain('逃亡孤女时期')
    expect(prompt).toContain('陆府姨太时期')
    expect(prompt).toContain('陆府断食受辱状态')
    expect(prompt).toContain('物品没有 variants')
    expect(prompt).toContain('物品不输出 variants')
    expect(prompt).toContain('不要使用“第1-3集视觉阶段”')
    expect(prompt).toContain('相对 mainAppearance')
    expect(prompt).toContain('不要输出完整的角色设定图构图模板')
  })

  it('uses cast-marker rules to complete character coverage and removes variants from one-off supporting characters', async () => {
    const executeTextStep = async () => completion(JSON.stringify({
      version: 'asset-extraction-v1',
      worldBackground: '民国陆府故事背景。',
      characters: [
        {
          id: 'character-lu-chengyu',
          name: '陆承煜',
          aliases: ['陆副官', '副官'],
          importance: 'core_supporting',
          background: '陆承煜是军政权力人物，与苏晚卿主线密切相关。',
          profile: {
            subject: '男性，约30岁，身型高大挺拔，军政权力人物。',
            face: '硬朗长方脸，黑色短发，浓眉深目，鼻梁高直。',
            clothing: '深色民国军官制服，立领铜扣，黑色高筒皮靴。',
            accessories: '随身有刻陆字令牌，常有侍卫随行。',
          },
          variants: [],
          relatedEpisodes: [],
          evidence: [],
        },
        {
          id: 'character-chuntao',
          name: '春桃',
          aliases: ['丫鬟春桃'],
          importance: 'supporting',
          background: '春桃是带苏晚卿入院的丫鬟。',
          profile: {
            subject: '年轻丫鬟，身型普通，姿态拘谨。',
            face: '圆脸，黑发盘起，眉眼普通。',
            clothing: '灰色丫鬟布衣，黑色布鞋。',
            accessories: '无明确稳定配饰。',
          },
          variants: [variant(4)],
          relatedEpisodes: [4],
          evidence: [{ episodeNumber: 4, quote: '人物：我（苏晚卿）、丫鬟（春桃）' }],
        },
      ],
      environments: [],
      props: [],
      warnings: [],
    }))

    const result = await executeAssetExtraction({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'test-model',
      episodes: [
        {
          episodeNumber: 2,
          title: '第2集',
          sourceText: '人物：我（苏晚卿）、追兵、陆承煜、侍卫若干\n陆承煜出手救下苏晚卿。',
        },
        {
          episodeNumber: 3,
          title: '第3集',
          sourceText: '人物：我（苏晚卿）、王媒婆\n王媒婆说受陆副官所托。',
        },
        {
          episodeNumber: 4,
          title: '第4集',
          sourceText: '人物：我（苏晚卿）、丫鬟（春桃）、沈曼柔\n春桃领她进小院。',
        },
      ],
      executeTextStep,
      enableVisualRefinement: false,
    })

    expect(result.package.characters.map((item) => item.name)).toEqual(['陆承煜', '春桃'])
    expect(result.package.characters[0].relatedEpisodes).toEqual([2, 3])
    expect(result.package.characters[0].evidence.map((item) => item.episodeNumber)).toEqual([2, 3])
    expect(result.package.characters[0].mainAppearance.name).toBe('陆府副官时期')
    expect(result.package.characters[0].mainAppearance.episodeRange).toEqual({ start: 2, end: 3 })
    expect(result.package.characters[1].relatedEpisodes).toEqual([4])
    expect(result.package.characters[1].mainAppearance.episodeRange).toEqual({ start: 4, end: 4 })
    expect(result.package.characters[1].variants).toEqual([])
  })

  it('extracts assets in 3-episode batches, then merges same-name assets and compacts lead variants', async () => {
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
        propName: '断裂银簪',
      }),
    ]
    let callIndex = 0
    let activeCalls = 0
    let maxActiveCalls = 0
    const promptEpisodeCounts: number[] = []
    const stepIndexes: number[] = []
    const executeTextStep = async (input: AiStepExecutionInput) => {
      activeCalls += 1
      maxActiveCalls = Math.max(maxActiveCalls, activeCalls)
      const prompt = input.messages[0]?.content || ''
      promptEpisodeCounts.push((prompt.match(/^第\d+集：/gm) || []).length)
      stepIndexes.push(input.meta.stepIndex)
      await new Promise((resolve) => setTimeout(resolve, 10))
      const pkg = packages[input.meta.stepIndex - 1]
      callIndex += 1
      activeCalls -= 1
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
      batchConcurrency: 2,
      enableVisualRefinement: false,
    })

    expect(callIndex).toBe(2)
    expect(maxActiveCalls).toBe(2)
    expect(promptEpisodeCounts).toEqual([3, 3])
    expect(stepIndexes).toEqual([1, 2])
    expect(result.package.characters).toHaveLength(1)
    expect(result.package.environments.map((item) => item.name)).toEqual(['陆府回廊'])
    expect(result.package.props.map((item) => item.name)).toEqual(['银簪'])
    expect(result.package.characters[0].variants.length).toBeLessThanOrEqual(4)
    expect(result.package.characters[0].variants[0].episodeRange).toEqual({ start: 1, end: 2 })
    expect(result.package.characters[0].variants.at(-1)?.episodeRange).toEqual({ start: 5, end: 6 })
    expect(result.package.characters[0].relatedEpisodes).toEqual([1, 2, 3, 4, 5, 6])
    expect(result.package.characters[0].mainAppearance.name).toBe('陆府姨太时期')
    expect(result.package.characters[0].mainAppearance.episodeRange).toEqual({ start: 1, end: 6 })
    expect(result.package.characters[0].profile).toEqual(result.package.characters[0].mainAppearance.profile)
  })

  it('deduplicates prop state names without introducing prop variants', async () => {
    const executeTextStep = async () => completion(JSON.stringify({
      version: 'asset-extraction-v1',
      worldBackground: '民国陆府故事。',
      characters: [],
      environments: [],
      props: [
        {
          id: 'prop-lu-token',
          name: '陆字玄铁令牌',
          background: '陆承煜给苏晚卿的身份信物。',
          profile: {
            subject: '刻陆字的玄铁令牌。',
            material: '玄铁。',
            shape: '方形令牌。',
            visualDetails: '正面刻陆字。',
          },
          owner: '苏晚卿',
          relatedEpisodes: [2],
          evidence: [{ episodeNumber: 2, quote: '他把令牌塞给我。' }],
        },
        {
          id: 'prop-deformed-token',
          name: '变形令牌',
          background: '令牌被踩变形。',
          profile: {
            subject: '被踩变形的令牌。',
            material: '玄铁。',
            shape: '边缘凹陷。',
            visualDetails: '正面陆字被挤压。',
          },
          owner: '苏晚卿',
          relatedEpisodes: [4],
          evidence: [{ episodeNumber: 4, quote: '令牌被踩得变形。' }],
        },
        {
          id: 'prop-oil-lamp',
          name: '小院油灯',
          background: '偏院夜间照明。',
          profile: {
            subject: '小院油灯。',
            material: '陶土与灯油。',
            shape: '小灯盏。',
            visualDetails: '可被打翻。',
          },
          relatedEpisodes: [10],
          evidence: [{ episodeNumber: 10, quote: '我打翻油灯。' }],
        },
        {
          id: 'prop-lamp',
          name: '油灯',
          background: '夜袭时被打翻。',
          profile: {
            subject: '油灯。',
            material: '陶土。',
            shape: '灯盏。',
            visualDetails: '火光摇晃。',
          },
          relatedEpisodes: [10],
          evidence: [{ episodeNumber: 10, quote: '油灯倒地。' }],
        },
      ],
      warnings: [],
    }))

    const result = await executeAssetExtraction({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'test-model',
      episodes: [{ episodeNumber: 10, title: '第10集', sourceText: '我打翻油灯，令牌被踩得变形。' }],
      executeTextStep,
      enableVisualRefinement: false,
    })

    expect(result.package.props.map((item) => item.name)).toEqual(['陆字玄铁令牌', '油灯'])
    expect(result.package.props[0]).not.toHaveProperty('variants')
    expect(result.package.props[0].relatedEpisodes).toEqual([2, 4])
    expect(result.package.props[1].relatedEpisodes).toEqual([10])
  })

  it('refines visual profiles from period facts so a low-status concubine does not keep refugee clothing', async () => {
    const refinedCharacterNames: string[] = []
    const executeTextStep = async (input: AiStepExecutionInput) => {
      if (input.meta.stepId === 'asset_visual_refinement') {
        refinedCharacterNames.push(input.meta.stepTitle)
        const prompt = input.messages[0]?.content || ''
        if (prompt.includes('"id": "character-chuntao"')) {
          return completion(JSON.stringify({
            characters: [
              {
                id: 'character-chuntao',
                mainAppearance: {
                  profile: {
                    subject: '主体：女性，约16岁，陆府低等丫鬟，身型瘦小，姿态拘谨。',
                    face: '面部：圆脸，黑发盘成低髻，眉眼普通，肤色偏黄。',
                    clothing: '服装：灰蓝色粗棉丫鬟短袄与长裤，布料朴素，衣摆整洁，黑色布鞋。',
                    accessories: '配饰：腰间挂小布巾，无明确稳定首饰。',
                  },
                },
                variants: [],
              },
            ],
          }))
        }
        return completion(JSON.stringify({
          characters: [
            {
              id: 'character-su-wanqing',
              mainAppearance: {
                profile: {
                  subject: '主体：女性，约18岁，约160厘米，汉族，陆府低位姨太，身型纤细单薄，站姿克制隐忍但脊背挺直。',
                  face: '面部：鹅蛋脸偏瘦，黑色长发梳低发髻，柳叶眉杏眼，深棕色瞳孔，肤色白皙偏苍。',
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
                {
                  id: 'character-su-wanqing-variant-hunger',
                  profileOverride: {
                    clothing: '相对主形象，仍穿陆府低位姨太内宅衣着，衣料略起皱，腰身因饥饿显得空荡。',
                    face: '相对主形象，脸色更苍白，额头渗汗。',
                  },
                },
                {
                  id: 'character-su-wanqing-variant-lufu-same-range',
                  name: '陆府姨太受辱时期',
                  episodeRange: { start: 4, end: 6 },
                  facts: {
                    identity: '陆府低位姨太',
                    socialStatus: '已进入陆府内宅体系，但地位低。',
                    plotState: '初入陆府受辱。',
                    explicitVisualCues: ['被扇耳光红痕'],
                  },
                  backgroundDelta: '初入陆府后受辱。',
                  profileOverride: {
                    clothing: '相对主形象，衣襟略乱。',
                  },
                  reason: '与主形象同范围，应由主形象承载。',
                  evidence: [{ episodeNumber: 4, quote: '她被带入陆府小院。' }],
                },
              ],
            },
          ],
        }))
      }
      return completion(JSON.stringify({
        version: 'asset-extraction-v1',
        worldBackground: '民国陆府内宅故事。',
        characters: [
          {
            id: 'character-su-wanqing',
            name: '苏晚卿',
            aliases: ['我', '苏姨太'],
            importance: 'lead',
            background: '苏晚卿被迫进入陆府成为低位姨太。',
            mainAppearance: {
              id: 'character-su-wanqing-main-lufu',
              name: '陆府小院姨太时期',
              episodeRange: { start: 4, end: 6 },
              facts: {
                identity: '陆府低位姨太',
                socialStatus: '已进入陆府内宅体系，但地位低，被沈曼柔压制，生活寒酸受限。',
                plotState: '初入陆府，受辱、断食，但开始冷静设局反击。',
                explicitVisualCues: ['被扇耳光红痕', '贴身藏令牌'],
              },
              profile: {
                subject: '女性，约18岁，乡野底层孤女出身，身型纤细。',
                face: '鹅蛋脸，黑色长发，面色苍白。',
                clothing: '服装：靛蓝色粗布大襟短衫、黑色粗布长裤、黑布千层底布鞋。',
                accessories: '贴身藏令牌。',
              },
              reason: '陆府低位姨太主形象。',
              evidence: [{ episodeNumber: 4, quote: '她被带入陆府小院。' }],
            },
            profile: {
              subject: '女性，约18岁，乡野底层孤女出身，身型纤细。',
              face: '鹅蛋脸，黑色长发，面色苍白。',
              clothing: '服装：靛蓝色粗布大襟短衫、黑色粗布长裤、黑布千层底布鞋。',
              accessories: '贴身藏令牌。',
            },
            variants: [
              {
                id: 'character-su-wanqing-variant-escape',
                name: '柴房被卖时期',
                episodeRange: { start: 1, end: 3 },
                facts: {
                  identity: '被陆副官纳为姨太的民女',
                  socialStatus: '被生母卖给恶霸，药效未退，处于失控危险。',
                  plotState: '雨夜逃亡。',
                  explicitVisualCues: ['浑身湿透沾泥水'],
                },
                backgroundDelta: '被卖后雨夜逃亡。',
                profileOverride: {
                  clothing: '相对主形象，粗布衣裤湿透沾泥。',
                },
                reason: '逃亡状态需要独立时期。',
                evidence: [{ episodeNumber: 1, quote: '她浑身湿透逃进雨夜。' }],
              },
              {
                id: 'character-su-wanqing-variant-hunger',
                name: '偏院断食受困时期',
                episodeRange: { start: 4, end: 5 },
                facts: {
                  identity: '陆府低位姨太',
                  socialStatus: '已进入陆府内宅体系但被断食打压。',
                  plotState: '初入陆府后受辱断食。',
                  explicitVisualCues: ['脸色惨白', '额头渗汗'],
                },
                backgroundDelta: '陆府偏院断食状态。',
                profileOverride: {
                  clothing: '相对主形象，衣料略起皱。',
                },
                reason: '同身份下的饥饿状态。',
                evidence: [{ episodeNumber: 4, quote: '她被带入陆府小院。' }],
              },
            ],
            relatedEpisodes: [1, 2, 3, 4, 5, 6],
            evidence: [{ episodeNumber: 4, quote: '她被带入陆府小院。' }],
          },
          {
            id: 'character-chuntao',
            name: '春桃',
            aliases: ['丫鬟'],
            importance: 'supporting',
            background: '春桃是陆府丫鬟，负责带苏晚卿入院。',
            mainAppearance: {
              id: 'character-chuntao-main',
              name: '陆府丫鬟时期',
              episodeRange: { start: 4, end: 4 },
              facts: {
                identity: '陆府丫鬟',
                socialStatus: '陆府下人。',
                plotState: '带苏晚卿入院。',
                explicitVisualCues: ['丫鬟身份'],
              },
              profile: {
                subject: '年轻丫鬟，身型普通。',
                face: '圆脸，黑发盘起。',
                clothing: '灰色丫鬟布衣。',
                accessories: '无明确稳定配饰。',
              },
              reason: '陆府丫鬟主形象。',
              evidence: [{ episodeNumber: 4, quote: '丫鬟春桃领她进小院。' }],
            },
            profile: {
              subject: '年轻丫鬟，身型普通。',
              face: '圆脸，黑发盘起。',
              clothing: '灰色丫鬟布衣。',
              accessories: '无明确稳定配饰。',
            },
            variants: [],
            relatedEpisodes: [4],
            evidence: [{ episodeNumber: 4, quote: '丫鬟春桃领她进小院。' }],
          },
        ],
        environments: [],
        props: [],
        warnings: [],
      }))
    }

    const result = await executeAssetExtraction({
      userId: 'user-1',
      projectId: 'project-1',
      model: 'test-model',
      episodes: [
        { episodeNumber: 1, title: '第1集', sourceText: '人物：我（苏晚卿）\n她浑身湿透逃进雨夜。' },
        { episodeNumber: 4, title: '第4集', sourceText: '人物：我（苏晚卿）\n她被带入陆府小院。' },
      ],
      executeTextStep,
    })

    const clothing = result.package.characters[0].mainAppearance.profile.clothing
    expect(clothing).toContain('民国改良旗袍')
    expect(clothing).toContain('内宅袄裙')
    expect(clothing).not.toContain('粗布大襟短衫')
    expect(result.package.characters[0].variants[0].profileOverride.clothing).toContain('粗布大襟短衫')
    expect(result.package.characters[0].mainAppearance.episodeRange).toEqual({ start: 4, end: 6 })
    expect(result.package.characters[0].variants).toHaveLength(2)
    expect(result.package.characters[0].variants.map((item) => item.name)).toEqual([
      '柴房被卖时期',
      '偏院断食受困状态',
    ])
    expect(result.package.characters[1].mainAppearance.profile.clothing).toContain('丫鬟短袄')
    expect(refinedCharacterNames).toEqual(['资产视觉设定：苏晚卿', '资产视觉设定：春桃'])
  })
})
