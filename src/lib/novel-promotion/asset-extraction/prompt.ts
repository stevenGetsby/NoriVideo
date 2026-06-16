import type { AssetExtractionEpisodeInput } from './types'

function serializeEpisodes(episodes: AssetExtractionEpisodeInput[]): string {
  return episodes
    .map((episode) => [
      `第${episode.episodeNumber}集：${episode.title || `第${episode.episodeNumber}集`}`,
      episode.sourceText,
    ].join('\n'))
    .join('\n\n')
}

export function buildAssetExtractionPrompt(input: {
  episodes: AssetExtractionEpisodeInput[]
}): string {
  return [
    '你是精品短剧资产设定抽取助手。你的输出会直接进入 GPT Image 2 生图流程，用于生成角色定稿图、环境定稿图、道具定稿图。请只根据输入剧集文本抽取可复用资产，输出严格 JSON，不要输出 Markdown，不要解释。',
    '',
    '重要规则：',
    '1. 不要改分集，不要新增集数，不要重写剧情。',
    '2. 只抽取后续生图、视频、配音、分镜会复用的核心资产。',
    '3. 角色必须区分主角、核心配角、配角。',
    '4. 角色必须有“角色背景”和“角色档案”。角色背景用于理解剧情；角色档案必须是可直接拼接进 GPT Image 2 的精品生图提示词素材。',
    '5. 角色档案必须拆成 subject、face、clothing、accessories。每个字段必须是稳定、具体、客观、可视觉化的中文短段落，避免空泛形容。',
    '6. 如果原文没有明确写出脸型、身高、发型、服装材质等细节，可以基于时代、身份、阶层、场景做保守合理补全；补全必须服务一致性，不要夸张，不要玄幻化。',
    '7. 角色变体必须绑定 episodeRange。变体只描述相对默认角色档案的阶段差异，例如受伤、淋雨、饥饿、入府、更换服装、令牌变形、玉镯出现等。',
    '8. 环境和道具必须带剧情作用 background 和 GPT Image 2 可用的视觉档案 profile。',
    '9. 每个资产必须带 evidence，quote 必须摘自输入文本。',
    '10. 不确定时减少抽取；但主角、核心配角、核心道具、核心环境不能抽得单薄。',
    '',
    '角色档案质量标准：',
    '- subject 必须包含：性别、年龄段、身高/体型、身份阶层、气质姿态。示例：女性，约18岁，约160厘米，汉族，乡野底层出身，身型纤细单薄，站姿隐忍但脊背挺直。',
    '- face 必须包含：脸型、发型发色、眉眼、瞳孔、鼻唇、肤色、面部比例或可识别特征。不能只写“漂亮、清秀、冷峻”。',
    '- clothing 必须包含：服装类别、颜色、材质、版型、纹样/无纹、整洁/破损/湿透状态、鞋履。默认档案写稳定常态，变体写阶段状态。',
    '- accessories 必须包含：首饰、信物、武器、随身物件，以及佩戴/持有位置。没有就写“无明确稳定配饰”，不要留空。',
    '- background 可以写人物经历、动机、关系、别名；profile 不要写抽象剧情评价，要写可画出来的视觉信息。',
    '',
    'GPT Image 2 提示词要求：',
    '- profile 字段要像“定稿图提示词素材”，可以直接与项目画风、镜头要求拼接。',
    '- 使用具体名词和视觉短语，不要写“很有故事感、气质复杂、命运感强”这种不可直接生图的词。',
    '- 不要加入镜头语言、构图、景别、光效，除非它是资产本身的稳定视觉属性。镜头语言留给后续分镜。',
    '- 不要把剧情动作写进默认 clothing/face；动作状态放到 variants.profileOverride。',
    '',
    '变体规则：',
    '- 主角通常需要 2-5 个变体，按“视觉状态显著变化”划分，不按每一集机械拆分。',
    '- 变体必须覆盖 episodeRange，且 reason 说明为什么后续生图需要这个变体。',
    '- profileOverride 只写变化字段。没有变化的字段可以省略或留空字符串。',
    '- 示例变体：雨夜逃亡期、获救持信物期、入府受辱期、反击锋芒期、婚后身份升级期。',
    '',
    '不要输出这些低质量档案：',
    '- “年轻女子，长得漂亮，气质倔强。”',
    '- “穿古装，表情复杂。”',
    '- “一个很有压迫感的男人。”',
    '- “豪门宅院，氛围高级。”',
    '',
    '输出 JSON schema：',
    JSON.stringify({
      version: 'asset-extraction-v1',
      worldBackground: '全局故事背景。只描述故事时代、地点范围、权力结构、整体氛围等，不写分集摘要。',
      characters: [
        {
          id: 'character-su-wanqing',
          name: '苏晚卿',
          aliases: ['我', '苏姨太'],
          importance: 'lead',
          background: '角色背景：出身、经历、动机、主线关系、原文别名等，用一段高密度中文自然语言。',
          profile: {
            subject: '主体：女性，约18岁，约160厘米，汉族，乡野底层出身，身型纤细单薄，肩背略瘦，站姿隐忍但脊背挺直。',
            face: '面部：瓜子脸或小鹅蛋脸，黑长直发低挽或低马尾，乌黑发色，柳叶眉，杏眼，深棕色瞳孔，高鼻薄唇，肤色白皙但带风霜与疲惫痕迹，眼距适中，下颌圆润。',
            clothing: '服装：月白色或素青色旧式斜襟上衣，棉麻材质，盘扣，素面无纹，衣料洗旧但整洁，下配深色长裙或布裤，黑色低跟布鞋。',
            accessories: '配饰：发髻藏陈阿婆留下的银簪，后期贴身藏刻“陆”字玄铁令牌，腕间佩戴羊脂玉镯。',
          },
          variants: [
            {
              id: 'character-su-wanqing-variant-escape',
              name: '雨夜逃亡期',
              episodeRange: { start: 1, end: 3 },
              backgroundDelta: '该阶段角色处境变化。',
              profileOverride: {
                subject: '药效未退，身体发软，踉跄奔逃，姿态狼狈但求生意志强。',
                face: '脸色惨白，嘴唇发紫，额头冷汗混着雨水，眼神惊恐、屈辱但倔强。',
                clothing: '素色旧衣被瓢泼大雨浸透，衣摆沾泥，袖口和裙摆凌乱，手臂可见淤青。',
                accessories: '手中死死攥着银簪，掌心划伤渗血。',
              },
              reason: '为什么这个阶段需要变体。',
              evidence: [{ episodeNumber: 1, quote: '原文证据' }],
            },
          ],
          relatedEpisodes: [1, 2, 3],
          evidence: [{ episodeNumber: 1, quote: '原文证据' }],
        },
      ],
      environments: [
        {
          id: 'environment-land-temple',
          name: '城郊土地庙',
          background: '环境在剧情中的作用。',
          profile: {
            subject: '场景主体：城郊破旧土地庙，乡野小庙，墙面斑驳，庙门陈旧。',
            layout: '空间结构：单进小庙，木门、窗棂、供台、墙角可藏身，门外连接泥泞雨夜道路。',
            atmosphere: '氛围：夜雨、阴冷、荒僻、压抑，适合作为逃亡避难和围堵对峙场景。',
            visualDetails: '视觉细节：破木门、斑驳冷墙、泥水脚印、窗棂透入火把光、旧供台积灰。',
          },
          relatedEpisodes: [1, 2],
          evidence: [{ episodeNumber: 1, quote: '原文证据' }],
        },
      ],
      props: [
        {
          id: 'prop-silver-hairpin',
          name: '银簪',
          background: '道具的剧情作用。',
          profile: {
            subject: '物件主体：女子发髻中隐藏的细长银簪，可作为贴身信物和临时武器。',
            material: '材质：银质，冷白金属光泽，略旧。',
            shape: '形状：细长簪身，尾端简素，簪尖锋利，可单手紧攥。',
            visualDetails: '视觉细节：雨夜中带冷光，簪尖可沾血或雨水，适合手部特写和发髻特写。',
          },
          owner: '苏晚卿',
          relatedEpisodes: [1],
          evidence: [{ episodeNumber: 1, quote: '原文证据' }],
        },
      ],
      warnings: [],
    }, null, 2),
    '',
    '输入剧集文本：',
    serializeEpisodes(input.episodes).slice(0, 80_000),
  ].join('\n')
}
