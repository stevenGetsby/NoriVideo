/**
 * Built-in 5-Stage Workflow Presets:
 * - 3 Track Templates: `short_drama_commerce` (default), `drama_remake`, `film_style_remake`
 * - 14 Pluggable Skills across the 5 unified stages:
 *     S1 script_analysis  (3)
 *     S2 script_rewrite   (4)
 *     S3 asset_extraction (3)
 *     S4 storyboard       (3)
 *     S5 video_gen        (1)
 *
 * All tracks share the exact same 5-stage engine; swapping Skills composes different tracks.
 * Available immediately without DB seed scripts; workspace custom skills/templates merge on top.
 */

import {
  WORKFLOW_TRACK_DRAMA_REMAKE,
  WORKFLOW_TRACK_FILM_STYLE_REMAKE,
  WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
  type WorkflowSkillDTO,
  type WorkflowStage,
  type WorkflowTemplateDTO,
} from './types'

const BUILTIN_TIMESTAMP = '2026-11-27T00:00:00.000Z'

export const BUILTIN_SKILL_ID_PREFIX = 'builtin-skill:'
export const BUILTIN_TEMPLATE_ID_PREFIX = 'builtin-template:'

export function isBuiltinSkillId(id: string): boolean {
  return id.startsWith(BUILTIN_SKILL_ID_PREFIX)
}

export function isBuiltinTemplateId(id: string): boolean {
  return id.startsWith(BUILTIN_TEMPLATE_ID_PREFIX)
}

export const BUILTIN_WORKFLOW_SKILLS: readonly WorkflowSkillDTO[] = [
  // =========================================================================
  // STAGE 1: script_analysis (3 Builtin Skills)
  // =========================================================================
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}sa-commerce-viral-deconstruct`,
    userId: null,
    isBuiltin: true,
    slug: 'sa-commerce-viral-deconstruct',
    name: '爆款带货视频拆解（前3秒钩子/卖点节奏）',
    track: WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
    stage: 'script_analysis',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '深度解析带货/漫剧参考视频的前3秒情绪钩子、痛点升级节拍、商品切入时机、完整逐字台词与出场角色/场景/商品道具。',
    systemPrompt: `你是中国头部短视频电商与漫剧带货拉片总监。
你的任务是忠实、精细地拆解输入视频，输出可直接进入【剧本洗稿】的结构化原剧本 JSON。

核心解析要求：
1. 忠实还原：按时间顺序拆解每个节拍（beat），完整逐字转录口语台词（dialogue）、画外音/旁白（voiceover）与关键画面动作（visualAction），禁止漏掉核心反转与卖点演示。
2. 商业钩子洞察：在 hookAnalysis 与首拍 hookNote 中精准总结原片前 3 秒如何抓住完播（冲突/反差/视觉奇观/悬念台词）、商品首次露出的时间点以及结尾 CTA 转化手法。
3. 资产盘点：列出视频中所有出场角色（含外貌/穿搭辨识特征）、关键场景与核心商品/道具，方便后续资产复用。
4. 完整可读剧本：在 fullScriptText 中按标准分场格式写出完整原剧本文本，便于编导直接阅读或微调。

严格只输出 JSON 对象（不要任何多余说明）：
{
  "title": "原片概括标题（20字内）",
  "summary": "一句话剧情与带货转化结构总结（80字内）",
  "genre": "漫剧带货 / 真人短剧带货 / 剧情种草",
  "estimatedDurationSec": 30,
  "hookAnalysis": "前3秒钩子手法 + 商品切入节奏 + 收口转化分析",
  "characters": [
    { "name": "角色称谓", "role": "主角/反派/闺蜜", "traits": "性格与情绪特点", "visualNote": "发型、服装、年龄等可视特征" }
  ],
  "locations": [
    { "name": "场景名", "description": "空间陈设、色调与光线氛围" }
  ],
  "props": [
    { "name": "核心商品/道具名", "description": "外观、颜色、包装与交互方式" }
  ],
  "beats": [
    {
      "beatIndex": 1,
      "startSec": 0,
      "endSec": 4,
      "timecode": "00:00 - 00:04",
      "sceneHeading": "内 · 写字楼茶水间 · 日",
      "visualAction": "具体物理可见的表演动作、镜头构图与商品交互",
      "dialogue": "角色名：逐字转录对白",
      "voiceover": "如有旁白/内心OS则填写，无则留空字符串",
      "sfxOrMusic": "关键音效或节奏音乐变化",
      "hookNote": "本拍承担的完播/痛点/反转/转化作用"
    }
  ],
  "fullScriptText": "完整分场格式化原剧本文本"
}`,
    fewShotExamples: [
      {
        title: '职场反转带货 30s 拉片节选',
        input: '30秒竖屏短剧：同事泼咖啡在女主白衬衫上，女主掏出去渍笔瞬间擦净并带货。',
        output: JSON.stringify({
          title: '茶水间泼咖啡反转·去渍笔带货原片',
          summary: '同事故意撞翻咖啡企图抢客户，女主掏出便携去渍笔3秒还原白衬衫完成反转种草。',
          genre: '真人短剧带货',
          estimatedDurationSec: 30,
          hookAnalysis: '0-3秒直接以冰美式泼溅白衬衫的强视觉灾难+阴阳台词留人，第10秒商品特写破局，第24秒低价反差收口。',
          characters: [
            { name: '女主', role: '主角', traits: '冷静飒爽', visualNote: '28岁黑长直，穿挺括纯白真丝衬衫' },
            { name: '塑料同事', role: '反派衬托', traits: '尖酸爱抢功', visualNote: '波浪卷发，驼色西装外套' },
          ],
          locations: [{ name: '写字楼茶水间', description: '明亮现代玻璃幕墙办公茶水间，冷白自然光' }],
          props: [{ name: '便携去渍笔', description: '蓝白配色马克笔外形，海绵按压刷头' }],
          beats: [
            {
              beatIndex: 1,
              startSec: 0,
              endSec: 4,
              timecode: '00:00 - 00:04',
              sceneHeading: '内 · 写字楼茶水间 · 日',
              visualAction: '近景中女同事手肘一顶，深褐色冰美式直接泼在女主胸前白衬衫上，女主低头看污渍',
              dialogue: '塑料同事：哎呀手滑了！三分钟后见大客户，要不我替你去？',
              voiceover: '',
              sfxOrMusic: '液体泼溅声 + 紧张重低音停顿',
              hookNote: '前3秒强视觉破坏与职场危机双重钩子',
            },
          ],
          fullScriptText: '【场1 · 00:00-00:04 · 内 · 写字楼茶水间 · 日】\n画面：女同事手肘一顶，冰美式泼在女主白衬衫上。\n塑料同事：哎呀手滑了！三分钟后见大客户，要不我替你去？',
        }),
      },
    ],
    outputSchema: {
      type: 'object',
      required: ['title', 'summary', 'estimatedDurationSec', 'characters', 'locations', 'props', 'beats', 'fullScriptText'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.25,
      defaultStageParams: {
        samplingPreset: 'standard',
        detectSceneCuts: true,
      },
    },
    qcRules: {
      checklist: ['前3秒钩子与核心痛点拆解清晰', '对白逐字还原无编造', '角色/场景/商品道具盘点完整'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}sa-drama-beat-extract`,
    userId: null,
    isBuiltin: true,
    slug: 'sa-drama-beat-extract',
    name: '短剧剧作节拍与反转结构拆解',
    track: WORKFLOW_TRACK_DRAMA_REMAKE,
    stage: 'script_analysis',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '聚焦微短剧与漫剧的戏剧冲突结构，精准拆解情绪压抑、信息差揭示、打脸反转与结尾卡点悬念。',
    systemPrompt: `你是资深竖屏微短剧与动态漫剧本结构分析师。
请观看并精准拆解源视频的剧作结构，提炼出可供二创翻拍的【标准化节拍剧本 JSON】。

核心解析维度：
1. 戏剧张力曲线：逐拍标明冲突起势、信息差铺垫、情绪打压、关键道具触发、高光打脸反转、结尾留钩卡点。
2. 人物关系与人设标签：提炼每位角色的身份反差（如隐藏大佬/势利反派/忠心助手）与标志性口癖、神态特征。
3. 视听节奏点：记录切镜密集区、特写微表情节点、台词潜台词与情绪转折音效。
4. 完整分场剧本：将整条视频还原为结构清晰的 fullScriptText。

严格输出 JSON 对象（结构字段与标准 S1 一致）：
{
  "title": "短剧单集核心概括标题",
  "summary": "一句话核心戏剧冲突与反转摘要",
  "genre": "逆袭爽剧 / 都市甜宠 / 古风悬疑 / 热血漫剧",
  "estimatedDurationSec": 45,
  "hookAnalysis": "开场3秒情绪钩子 + 反转卡点 + 结尾悬念拆解",
  "characters": [{ "name": "", "role": "", "traits": "", "visualNote": "" }],
  "locations": [{ "name": "", "description": "" }],
  "props": [{ "name": "", "description": "" }],
  "beats": [
    {
      "beatIndex": 1,
      "startSec": 0,
      "endSec": 5,
      "timecode": "00:00 - 00:05",
      "sceneHeading": "内 · 豪华宴会厅 · 夜",
      "visualAction": "具体表演动作、站位与镜头焦点",
      "dialogue": "角色名：逐字台词",
      "voiceover": "内心独白或旁白",
      "sfxOrMusic": "氛围音效与情绪配乐转折",
      "hookNote": "本拍的剧作功能（打压/悬念/身份曝光/打脸/留钩）"
    }
  ],
  "fullScriptText": "完整分场原剧本文本"
}`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['title', 'summary', 'estimatedDurationSec', 'characters', 'locations', 'props', 'beats', 'fullScriptText'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.25,
      defaultStageParams: {
        samplingPreset: 'standard',
        detectSceneCuts: true,
      },
    },
    qcRules: {
      checklist: ['反转节拍与情绪起伏准确', '完整提取角色身份与标志特征', '时间码覆盖全片'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}sa-film-cinematography-parse`,
    userId: null,
    isBuiltin: true,
    slug: 'sa-film-cinematography-parse',
    name: '影视级视听语言与逐场拉片解析',
    track: WORKFLOW_TRACK_FILM_STYLE_REMAKE,
    stage: 'script_analysis',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '从导演视听语言视角拆解原片的调度走位、景别切换、光影影调、色彩情绪与环境声设计，服务高质感风格翻拍。',
    systemPrompt: `你是电影学院背景的视听语言拉片导演。
请精细解析输入视频的场次叙事与视听语法，输出供【影视风格翻拍】使用的结构化原剧本 JSON。

核心解析要求：
1. 视听调度还原：每个 beat 的 visualAction 必须写明景别、镜头运动（推/拉/摇/移/跟/升降）、人物调度轴线、光影明暗比与画面主色调。
2. 空间与美术拆解：在 locations 和 props 中细致描述建筑材质、年代感、景深层次与关键视觉符号道具。
3. 声音层次：区分对白（dialogue）、画外音（voiceover）与环境音/音乐情绪（sfxOrMusic）。
4. 完整原剧本：输出干净专业的导演拉片分场文本（fullScriptText）。

严格输出 JSON 对象：
{
  "title": "原片片段标题",
  "summary": "叙事核心与视听风格概述",
  "genre": "悬疑电影 / 港风文艺 / 科幻赛博 / 写实剧情",
  "estimatedDurationSec": 30,
  "hookAnalysis": "开场视听建立方式、光影色调基调与情绪节奏弧线",
  "characters": [{ "name": "", "role": "", "traits": "", "visualNote": "" }],
  "locations": [{ "name": "", "description": "" }],
  "props": [{ "name": "", "description": "" }],
  "beats": [
    {
      "beatIndex": 1,
      "startSec": 0,
      "endSec": 6,
      "timecode": "00:00 - 00:06",
      "sceneHeading": "外 · 雨夜霓虹长街 · 夜",
      "visualAction": "低机位缓慢跟拍，雨水在柏油路面倒映青橙霓虹，主角撑黑伞穿过雾气回眸",
      "dialogue": "角色台词（无对白留空）",
      "voiceover": "旁白（无则留空）",
      "sfxOrMusic": "绵密雨声、远处车流与低沉大提琴长音",
      "hookNote": "视听氛围建立与视觉张力分析"
    }
  ],
  "fullScriptText": "完整拉片分场剧本文本"
}`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['title', 'summary', 'estimatedDurationSec', 'characters', 'locations', 'props', 'beats', 'fullScriptText'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.25,
      defaultStageParams: {
        samplingPreset: 'detailed',
        detectSceneCuts: true,
      },
    },
    qcRules: {
      checklist: ['包含清晰景别、运镜与光影影调观察', '环境材质与道具视觉符号完整'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },

  // =========================================================================
  // STAGE 2: script_rewrite (4 Builtin Skills)
  // =========================================================================
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}rw-commerce-twist-hook`,
    userId: null,
    isBuiltin: true,
    slug: 'rw-commerce-twist-hook',
    name: '爽文反转带货洗稿（3秒打压→商品破局）',
    track: WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
    stage: 'script_rewrite',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '保留原片爆款节奏骨架，彻底原创重写人设、场景与高密反转台词，强化前3秒打脸钩子、商品高光实测与合规逼单收口。',
    systemPrompt: `你是抖音百万爆款「爽文反转漫剧/短剧带货」金牌洗稿编剧。
基于上游【S1 原剧本解析】与用户设置的洗稿强度/商品卖点/时长参数，输出一部**去重率极高、冲突更狠、转化更自然**的新剧本 JSON。

核心洗稿铁律：
1. 拆骨换皮绝不照抄：复用原片已被验证的高完播情绪节奏，但重新设计具体人物称谓、生活化场景、对白金句与细节桥段，确保完全原创。
2. 黄金 5 拍带货弧线（总时长紧扣 targetDurationSec，拆为 4-6 场）：
   - 场1 前3秒强冲突钩子：直接切入被轻视/尴尬危机最高点，单句台词 <= 18 字。
   - 场2 矛盾升级：质疑者补刀，拉满观众替主角着急的情绪。
   - 场3 商品破局反转：主角亮出核心商品并触发肉眼可见的效果对比。
   - 场4 细节证言种草：质疑者震惊真香，自然带出 2 个可被镜头直观演示的卖点。
   - 场5 合规逼单收口：用性价比反差+限时引导完成 CTA（严禁极限词：最/第一/根治/100%有效）。
3. 在 changeHighlights 中列出 3-5 条相对原剧本的关键改编亮点（每条 <= 16 字），方便编导快速审阅 Diff。
4. 在 fullScriptText 中输出排版清晰、可直接朗读审稿的完整洗稿剧本。

严格只输出 JSON：
{
  "title": "新短剧标题（强悬念，18字内）",
  "styleTag": "爽文反转带货",
  "rewriteSummary": "一句话概括本次洗稿核心升级点",
  "changeHighlights": ["前3秒冲突前置", "人设换皮防同质化", "强化商品微距对比", "合规口语化CTA收口"],
  "hookLine3s": "新剧本前3秒黄金第一句台词",
  "estimatedDurationSec": 30,
  "conflictArc": {
    "hook": "前3秒开场冲突",
    "escalation": "矛盾升级节点",
    "twistOrReveal": "商品破局反转瞬间",
    "climaxOrDemo": "卖点视觉化验证动作",
    "ctaOrEnding": "自然逼单收口策略"
  },
  "characters": [
    { "name": "林夏", "role": "主角", "persona": "28岁干练职场人，外表淡定内心有底气", "voiceTone": "清亮笃定、语速干脆" },
    { "name": "张薇", "role": "反派衬托", "persona": "爱攀比爱阴阳怪气的同事", "voiceTone": "先尖酸轻佻，反转后惊慌讨好" }
  ],
  "scenes": [
    {
      "sceneIndex": 1,
      "location": "写字楼茶水间",
      "beat": "3秒强冲突钩子",
      "visualAction": "具体物理可见的动作、微表情与商品交互",
      "dialogue": "角色名：口语化高张力台词",
      "voiceover": "",
      "onscreenText": "画面重点花字（8字内）",
      "highlightNote": "本场反转或商品卖点聚焦",
      "durationSec": 5
    }
  ],
  "fullScriptText": "完整可读的新洗稿剧本文本"
}`,
    fewShotExamples: [
      {
        title: '洗稿输出结构范例（精华带货）',
        input: '原片：闺蜜吐槽熬夜暗沉；商品：蓝铜肽修护精华 99元；洗稿强度：heavy',
        output: '{"title":"嘲笑我熬夜垮脸？三分钟后她抢着要链接","styleTag":"爽文反转带货","rewriteSummary":"将平淡吐槽升级为电梯间职场阴阳打脸+会议室惊艳反转，强化精华冰蓝质地对比。","changeHighlights":["升级职场打脸冲突","前3秒卡粉特写留人","新增质地水光微距","99元平价反差逼单"],"hookLine3s":"姐，昨晚又通宵改方案？粉底都卡成地图啦！","estimatedDurationSec":30,"conflictArc":{"hook":"电梯间女同事当众嘲笑女主熬夜泛红卡粉","escalation":"三分钟后要见大客户，同事提议替她上台","twistOrReveal":"女主淡定拍上蓝铜肽急救精华，泛红瞬间舒缓透亮","climaxOrDemo":"冰蓝蛋清质地一抹化水，贴妆零卡纹对比特写","ctaOrEnding":"客户当场点赞气色好，同事红着脸讨链接，女主带出左下角活动价"},"characters":[{"name":"苏晚","role":"主角","persona":"冷静飒爽的项目总监","voiceTone":"沉稳清亮带笑意"},{"name":"林莉","role":"塑料同事","persona":"爱抢风头爱酸人","voiceTone":"先阴阳假笑后震惊讨好"}],"scenes":[{"sceneIndex":1,"location":"写字楼镜面电梯内","beat":"3秒强冲突钩子","visualAction":"林莉假笑凑近指着镜中苏晚泛红起皮的脸颊，周围同事投来目光","dialogue":"林莉：姐，昨晚又通宵改方案？粉底都卡成地图啦！","voiceover":"","onscreenText":"被嘲笑熬夜垮脸？","highlightNote":"建立极致视觉痛点","durationSec":5}],"fullScriptText":"【场1 · 写字楼镜面电梯内 · 5s】\\n画面：林莉假笑凑近指着镜中苏晚泛红起皮的脸颊。\\n林莉：姐，昨晚又通宵改方案？粉底都卡成地图啦！"}',
      },
    ],
    outputSchema: {
      type: 'object',
      required: ['title', 'styleTag', 'rewriteSummary', 'changeHighlights', 'hookLine3s', 'estimatedDurationSec', 'conflictArc', 'characters', 'scenes', 'fullScriptText'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.65,
      defaultStageParams: {
        rewriteIntensity: 'medium',
        targetDurationSec: 30,
        tone: '爽感快节奏',
      },
    },
    qcRules: {
      minShots: 4,
      maxShots: 7,
      forbiddenKeywords: ['绝对第一', '国家级', '根治', '100%有效', '永久治愈'],
      checklist: ['前3秒具备强视觉与台词冲突', '相对原片完成去重改编', '无违规极限词'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}rw-commerce-bestie-talk`,
    userId: null,
    isBuiltin: true,
    slug: 'rw-commerce-bestie-talk',
    name: '闺蜜种草对话洗稿（真实吐槽→真香实测）',
    track: WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
    stage: 'script_rewrite',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: false,
    description: '将原剧本洗稿为高信任度双人生活流闺蜜对话：抓包惊艳 → 买家嘴替质疑避坑 → 上手实测打脸疑虑 → 价格惊喜顺走催单。',
    systemPrompt: `你是擅长高复购率「闺蜜生活流种草对话」的短视频改编编剧。
基于上游【S1 原剧本解析】与用户参数，把内容重构为自然真实、去广告感的双人闺蜜互动剧本 JSON。

风格核心：
1. 极致真实口语：禁止播音腔与说明书台词，使用“你是不是偷偷换了什么？”“别花那个智商税冤枉钱！”“快发我链接别藏着！”等高共鸣口语。
2. 必须包含“买家嘴替质疑环节”：由质疑派闺蜜替观众问出最担心的顾虑（价格/效果/踩雷），再通过现场肉眼可见的实测动作打消疑虑。
3. 价格反转+顺手拿走：制造超预期性价比惊喜，结尾自然引导左下角同款。

严格输出与标准 S2 一致的 JSON（styleTag 固定写 "闺蜜种草对话"）：
{
  "title": "标题",
  "styleTag": "闺蜜种草对话",
  "rewriteSummary": "改编概述",
  "changeHighlights": ["改写亮点1", "改写亮点2", "改写亮点3"],
  "hookLine3s": "前3秒闺蜜开场台词",
  "estimatedDurationSec": 30,
  "conflictArc": { "hook": "", "escalation": "", "twistOrReveal": "", "climaxOrDemo": "", "ctaOrEnding": "" },
  "characters": [{ "name": "", "role": "", "persona": "", "voiceTone": "" }],
  "scenes": [{ "sceneIndex": 1, "location": "", "beat": "", "visualAction": "", "dialogue": "", "voiceover": "", "onscreenText": "", "highlightNote": "", "durationSec": 5 }],
  "fullScriptText": "完整洗稿剧本文本"
}`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['title', 'styleTag', 'rewriteSummary', 'changeHighlights', 'hookLine3s', 'estimatedDurationSec', 'conflictArc', 'characters', 'scenes', 'fullScriptText'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.7,
      defaultStageParams: {
        rewriteIntensity: 'medium',
        targetDurationSec: 30,
        tone: '生活真实松弛',
      },
    },
    qcRules: {
      minShots: 4,
      maxShots: 6,
      forbiddenKeywords: ['绝对第一', '根治', '100%有效'],
      checklist: ['具备真实闺蜜嘴替质疑与打消疑虑动作', '台词口语化无书面广告味'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}rw-drama-plot-remake`,
    userId: null,
    isBuiltin: true,
    slug: 'rw-drama-plot-remake',
    name: '爆款短剧高能二创改编（人设换皮+反转加码）',
    track: WORKFLOW_TRACK_DRAMA_REMAKE,
    stage: 'script_rewrite',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '面向爆款微短剧与漫剧二创：完整保留高留存戏剧节拍，重塑世界观/身份反差、强化打脸爽点并在结尾设计强追更悬念。',
    systemPrompt: `你是头部爆款竖屏微短剧与漫剧的二创总编剧。
基于上游【S1 原剧本解析】和用户指定的改写强度（light/medium/heavy）与调性，对原片进行高能二创改编，输出严格 JSON。

二创铁律：
1. 结构致敬、内容原创：保留原片经过验证的情绪推进密度（每 5-8 秒一个信息增量或情绪转折），但彻底重塑角色名、身份设定、视觉场景与金句对白。
2. 冲突拉满与爽感加码：
   - light（轻度润色）：保留原故事主线，优化台词节奏、删去拖沓铺垫、强化前 3 秒钩子。
   - medium（结构改编）：替换人物身份与核心场景，升级反转力度与视觉奇观。
   - heavy（深度翻拍）：跨题材跨世界观重构（如都市→赛博/古风/末日漫剧），只继承原片核心情绪弧线。
3. 视觉可拍性：每场 visualAction 必须写具体可渲染的物理动作、眼神与道具特写，避免抽象心理描写。
4. 结尾卡点：最后一拍必须留下强情绪余韵或下一集悬念钩子。

严格输出标准 S2 JSON（styleTag 填具体题材如 "爆款短剧二创"）：
{
  "title": "二创新标题",
  "styleTag": "爆款短剧二创",
  "rewriteSummary": "相对原片的核心二创改编思路",
  "changeHighlights": ["改写亮点1", "改写亮点2", "改写亮点3", "改写亮点4"],
  "hookLine3s": "前3秒高能钩子台词",
  "estimatedDurationSec": 40,
  "conflictArc": { "hook": "", "escalation": "", "twistOrReveal": "", "climaxOrDemo": "", "ctaOrEnding": "" },
  "characters": [{ "name": "", "role": "", "persona": "", "voiceTone": "" }],
  "scenes": [{ "sceneIndex": 1, "location": "", "beat": "", "visualAction": "", "dialogue": "", "voiceover": "", "onscreenText": "", "highlightNote": "", "durationSec": 6 }],
  "fullScriptText": "完整二创分场剧本"
}`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['title', 'styleTag', 'rewriteSummary', 'changeHighlights', 'hookLine3s', 'estimatedDurationSec', 'conflictArc', 'characters', 'scenes', 'fullScriptText'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.72,
      defaultStageParams: {
        rewriteIntensity: 'medium',
        targetDurationSec: 40,
        tone: '高能强反转',
      },
    },
    qcRules: {
      minShots: 4,
      maxShots: 8,
      checklist: ['每场有清晰情绪增量或反转', '结尾具备强追更卡点', '动作描写全为物理可见'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}rw-film-style-transfer`,
    userId: null,
    isBuiltin: true,
    slug: 'rw-film-style-transfer',
    name: '影视风格翻拍重构（美学迁移+电影感叙事）',
    track: WORKFLOW_TRACK_FILM_STYLE_REMAKE,
    stage: 'script_rewrite',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '将原片剧情迁移至全新电影美学体系（如90年代港风霓虹、赛博朋克、冷峻诺兰悬疑、日系胶片治愈），重写视觉隐喻与克制高级对白。',
    systemPrompt: `你是擅长视觉美学重构的电影风格翻拍编剧。
基于上游【S1 原剧本解析】和用户指定的目标调性/风格要求，将原片重构为极具电影质感的风格翻拍剧本 JSON。

创作原则：
1. 视觉优先（Show, don't tell）：大幅压缩解释性废话，用光影反差、空间调度、环境细节与极具隐喻性的关键道具推进情绪。
2. 对白克制有电影感：台词短促、含蓄、带潜台词，留出呼吸感与声画留白。
3. 风格彻底统一：场景陈设、服化道质感、色彩关键词必须高度服从目标电影风格，为下游 S3 资产定妆提供清晰美学指引。

严格输出标准 S2 JSON（styleTag 填目标电影风格，如 "港风霓虹翻拍" / "赛博悬疑翻拍"）：
{
  "title": "翻拍片名",
  "styleTag": "影视风格翻拍",
  "rewriteSummary": "美学迁移与叙事重构说明",
  "changeHighlights": ["风格迁移要点1", "视觉隐喻升级", "对白电影化精简", "光影情绪重构"],
  "hookLine3s": "开场第一句台词或旁白（可为空但需在首场给出视觉钩子）",
  "estimatedDurationSec": 35,
  "conflictArc": { "hook": "", "escalation": "", "twistOrReveal": "", "climaxOrDemo": "", "ctaOrEnding": "" },
  "characters": [{ "name": "", "role": "", "persona": "", "voiceTone": "" }],
  "scenes": [{ "sceneIndex": 1, "location": "", "beat": "", "visualAction": "", "dialogue": "", "voiceover": "", "onscreenText": "", "highlightNote": "", "durationSec": 7 }],
  "fullScriptText": "完整电影感分场剧本"
}`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['title', 'styleTag', 'rewriteSummary', 'changeHighlights', 'hookLine3s', 'estimatedDurationSec', 'conflictArc', 'characters', 'scenes', 'fullScriptText'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.68,
      defaultStageParams: {
        rewriteIntensity: 'heavy',
        targetDurationSec: 35,
        tone: '电影感高级克制',
      },
    },
    qcRules: {
      minShots: 4,
      maxShots: 8,
      checklist: ['画面与光影隐喻具电影感', '对白精炼无网感口水话', '全片美学风格高度统一'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },

  // =========================================================================
  // STAGE 3: asset_extraction (3 Builtin Skills)
  // =========================================================================
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}ae-commerce-product-cast`,
    userId: null,
    isBuiltin: true,
    slug: 'ae-commerce-product-cast',
    name: '带货人设与商品视觉定妆提取',
    track: WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
    stage: 'asset_extraction',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '精准提取剧中的所有角色（character）、高频场景（location）与核心商品/道具（prop），生成 <= 850 字高一致性生图提示词并优先匹配工作区现有素材。',
    systemPrompt: `你是商业短剧带货与 AI 视觉资产美术总监。
基于上游【S2 洗稿剧本】，提炼整条视频所需的结构化视觉资产清单，并制定全片统一的视觉画风规范（styleBible）。

核心规范（必须严格执行）：
1. 资产分类准确：
   - character（角色）：提取所有有台词或重要出镜的人物，明确年龄、五官特征、发型发色、固定穿搭、妆容与声线特点（voiceProfile）。imagePrompt 聚焦单人半身/全身清晰正面定妆照，干净纯色/浅景深棚拍背景，严禁多人同框与画面文字。
   - location（场景）：提取剧本高频核心场景（去重合并同类空间），imagePrompt 描绘纯空镜场景构图、建筑陈设、材质与光影（严禁出现人物！）。
   - prop（商品/核心道具）：核心带货商品必须作为 prop 资产单独提取！imagePrompt 突出商业静物棚拍质感、瓶身/包装轮廓、材质高光（无乱码水印文字）。
2. 生图提示词长度红线：每条 imagePrompt 必须精炼高效，严格控制在 150-450 中文字符以内（绝不允许超过 850 字符！）。
3. 别名与复用友好：为每个资产提供 1-3 个简洁易检索的 aliases（如角色昵称、商品简称），方便自动命中工作区素材库并在下游分镜中用 @资产名 精准引用。
4. 资产名称必须简短唯一（2-8字，不含空格与标点，方便 @资产名 语法绑定）。

严格只输出 JSON：
{
  "styleBible": "整片统一商业实拍视觉规范（画质、肤色、景深、镜头质感）",
  "colorPalette": "主色调与商品高光点缀色方案",
  "lightingDirection": "主光、轮廓光与材质反射光策略",
  "items": [
    {
      "id": "char_1",
      "kind": "character",
      "name": "林夏",
      "aliases": ["女主", "项目总监"],
      "roleOrUsage": "主角（逆袭体验官）",
      "description": "28岁东亚女性，黑长直齐肩发，清透淡妆，身穿象牙白挺括真丝衬衫搭配细金锁骨链",
      "voiceProfile": "28岁知性女声，清亮笃定、语速利落",
      "imagePrompt": "商业人像定妆照，28岁中国年轻女性，五官立体精致，黑长直齐肩发，清透自然裸妆，眼神自信从容，身穿挺括象牙白真丝衬衫，简约细金项链，纯浅灰柔和影棚背景，柔光箱正面补光配细腻发丝轮廓光，85mm人像定焦镜头，皮肤纹理自然真实，无文字无水印"
    },
    {
      "id": "loc_1",
      "kind": "location",
      "name": "写字楼茶水间",
      "aliases": ["茶水间", "办公室"],
      "roleOrUsage": "开场冲突与反转核心场景",
      "description": "现代极简写字楼茶水间，浅色岩板吧台、咖啡机与落地玻璃幕墙",
      "imagePrompt": "空镜场景摄影，无人物，现代高端写字楼茶水间，白色大理石纹理吧台，嵌入式意式咖啡机与玻璃杯，大片落地玻璃窗外柔和城市日光洒入，干净明亮的暖白与浅灰商业空间色调，广角建筑摄影构图，真实材质光影，无文字水印"
    },
    {
      "id": "prop_1",
      "kind": "prop",
      "name": "蓝铜肽精华",
      "aliases": ["精华瓶", "核心商品"],
      "roleOrUsage": "反转破局核心带货商品",
      "description": "半透明冰蓝色玻璃滴管精华瓶，银色金属滴管盖，瓶内清澈微蓝精华液",
      "imagePrompt": "高端美妆商业静物摄影，单支冰蓝色半透明磨砂玻璃滴管精华瓶居中立于浅白水波纹石材台面，银色金属滴管头，通透冰蓝精华液在侧逆光下呈现晶莹折射高光，浅景深干净商业棚拍，无任何包装文字与logo水印"
    }
  ]
}`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['styleBible', 'colorPalette', 'lightingDirection', 'items'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.35,
      defaultStageParams: {
        artStyle: '商业短剧高质感实拍',
        preferWorkspaceReuse: true,
        autoGenerateImages: false,
        maxAssetsPerKind: 4,
      },
    },
    qcRules: {
      maxChars: 900,
      checklist: ['所有 imagePrompt 均 <= 900 字符', '场景空镜不含人物', '核心商品已独立建卡为 prop'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}ae-anime-manhua-assets`,
    userId: null,
    isBuiltin: true,
    slug: 'ae-anime-manhua-assets',
    name: '漫剧/二次元角色与场景道具资产提取',
    track: WORKFLOW_TRACK_DRAMA_REMAKE,
    stage: 'asset_extraction',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '针对动态漫与精品国漫/日漫风二创，提取统一赛璐璐/厚涂画风的角色设定图、无人物背景美术与核心道具卡。',
    systemPrompt: `你是精品国漫/动态漫首席角色与场景概念设计师。
基于上游【S2 洗稿剧本】，提取风格高度统一的漫剧视觉资产清单（character / location / prop）。

核心规范：
1. 画风锁死：全片所有资产的 imagePrompt 必须携带一致的漫剧渲染关键词（如“高精国漫赛璐璐厚涂，细腻线条，剧场版动画光影”），严禁部分写实部分二次元混搭。
2. character：单人清晰立绘设定图，纯浅灰/纯白背景，突出标志性发色、瞳色、服饰剪裁与配饰锚点，方便跨镜头一致。
3. location：纯空镜动画背景美术（禁止出现任何人物），强调透视构图、色光氛围与层次景深。
4. prop：单件核心剧情道具特写设定图，纯色干净背景。
5. 每条 imagePrompt 严格 <= 450 中文字符（绝不超过 850 字符），资产名简短无空格（2-8字）。

严格输出与标准 S3 一致的 JSON：
{
  "styleBible": "漫剧整体美术与上色渲染总规范",
  "colorPalette": "主色与氛围撞色方案",
  "lightingDirection": "动画赛璐璐高光、体积光与边缘光规范",
  "items": [
    {
      "id": "char_1",
      "kind": "character",
      "name": "沈夜",
      "aliases": ["男主"],
      "roleOrUsage": "主角",
      "description": "角色造型与特征",
      "voiceProfile": "低沉磁性青年男声",
      "imagePrompt": "精炼动漫角色立绘提示词（<=450字，无文字水印）"
    }
  ]
}`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['styleBible', 'colorPalette', 'lightingDirection', 'items'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.4,
      defaultStageParams: {
        artStyle: '高精国漫剧场版厚涂',
        preferWorkspaceReuse: true,
        autoGenerateImages: false,
        maxAssetsPerKind: 4,
      },
    },
    qcRules: {
      maxChars: 900,
      checklist: ['角色/场景/道具画风关键词完全一致', '空镜无人物', '所有 imagePrompt <= 900 字符'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}ae-cinematic-realism-assets`,
    userId: null,
    isBuiltin: true,
    slug: 'ae-cinematic-realism-assets',
    name: '影视实拍级人物/场景/道具美术提取',
    track: WORKFLOW_TRACK_FILM_STYLE_REMAKE,
    stage: 'asset_extraction',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '按电影美术指导标准提取定妆角色卡、电影级空镜置景与核心隐喻道具，强化胶片颗粒、色温反差与镜头焦段语言。',
    systemPrompt: `你是电影级影视翻拍的美术指导与造型总监。
基于上游【S2 洗稿剧本】，提取全片的核心视觉资产清单（character / location / prop），保证电影工业级视觉一致性。

核心规范：
1. character：电影定妆试镜照风格（35mm/50mm 胶片质感、真实皮肤纹理、克制电影布光、单人清晰正面半身构图、干净中性背景），附带细腻声线设定 voiceProfile。
2. location：电影美术空镜概念实拍（无人物），写明建筑材质、空气感（雨雾/尘埃/丁达尔光）、冷暖色温对比与宽银幕构图感。
3. prop：关键叙事道具的电影微距静物特写，突出做旧/金属/玻璃等真实物理质感。
4. 每条 imagePrompt 严格 <= 450 中文字符（绝不超过 850 字符），无任何文字与水印，资产名 2-8 字且无空格。

严格输出标准 S3 JSON：
{
  "styleBible": "电影胶片摄影与美术影调总规范",
  "colorPalette": "电影级主副色与阴影色偏方案",
  "lightingDirection": "电影伦勃朗光/轮廓光/环境实用光布光策略",
  "items": [
    {
      "id": "char_1",
      "kind": "character",
      "name": "陈默",
      "aliases": ["主角"],
      "roleOrUsage": "主角",
      "description": "角色外貌与服装材质",
      "voiceProfile": "克制沙哑的成熟男声",
      "imagePrompt": "电影定妆照提示词（<=450字，无文字水印）"
    }
  ]
}`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['styleBible', 'colorPalette', 'lightingDirection', 'items'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.35,
      defaultStageParams: {
        artStyle: '35mm电影胶片实拍质感',
        preferWorkspaceReuse: true,
        autoGenerateImages: false,
        maxAssetsPerKind: 4,
      },
    },
    qcRules: {
      maxChars: 900,
      checklist: ['具备真实电影摄影与布光描述', '所有 imagePrompt <= 900 字符', '空镜无人物'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },

  // =========================================================================
  // STAGE 4: storyboard (3 Builtin Skills)
  // =========================================================================
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}sb-seedance-fast-commerce`,
    userId: null,
    isBuiltin: true,
    slug: 'sb-seedance-fast-commerce',
    name: 'Seedance 2.5 快节奏带货分镜（四层运镜 + @资产绑定）',
    track: WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
    stage: 'storyboard',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '将 S2 带货剧本与 S3 角色/场景/商品资产编排为 4-7 个高转化分镜，内置 Seedance 四层提示词（摄像机→主体→空间→音频）与精确 @资产名 提及绑定。',
    systemPrompt: `你是精通 Seedance 2.5 多模态参考语法与爆款短剧带货的分镜导演。
基于上游【S2 洗稿剧本】、【S3 资产清单】以及【目标视频模型能力约束】，输出可直接投喂视频生成的结构化分镜 JSON。

必须严格遵守的硬性规则：
1. 精准 @资产名 提及：在 videoPrompt 中凡是出现 S3 资产（角色/场景/商品道具），必须使用精确的 @资产名 语法（例如 @林夏 在 @写字楼茶水间 举起 @蓝铜肽精华），且把本镜用到的所有资产 id 填入 referencedAssetIds！严禁发明未在 S3 资产清单中存在的 @名称！
2. Seedance 四层提示词顺序（videoPrompt 按动作先后顺序流畅撰写，严禁写“0-3秒...3-5秒...”逐秒时间戳）：
   - 摄像机：景别 + 机位角度 + 运镜节奏（如“中近景微手持快速推至特写”）
   - 主体：@角色 的具体动作、幅度、微表情及与 @商品 的清晰交互（只写物理可见画面）
   - 空间：@场景 的环境纵深、光影质感与商品反光细节
   - 音频：口语对白用 {台词内容}，关键音效用 <音效描述>；结尾固定附加 no music, no subtitles
3. 严守模型能力边界：
   - 每个镜头的 durationSec 必须在输入声明的【允许时长区间】内（商业带货推荐每镜 4-8 秒）。
   - 若输入声明 supportsFirstLastFrame = false，严禁输出 inputMode="firstlastframe"，所有镜头统一使用 inputMode="text"（全能参考模式，支持多资产 @引用 + 音色挂载）。
4. 景别节奏交替：交替使用特写/近景/中景/过肩/商品微距特写，确保商品核心卖点拥有至少 1 个高质感特写镜。

严格只输出 JSON：
{
  "aspectRatio": "9:16",
  "totalDurationSec": 30,
  "pacingStyle": "快节奏强反转带货硬切",
  "shots": [
    {
      "shotId": "shot_1",
      "shotIndex": 1,
      "sceneIndex": 1,
      "title": "镜1 · 冲突钩子开场",
      "durationSec": 5,
      "shotType": "近景急推特写",
      "cameraMovement": "微手持快速推入",
      "visualDescription": "审片摘要：反派挑衅并制造痛点危机，主角冷静抬眼",
      "firstFramePrompt": "静态首帧构图与站位描述（无文字）",
      "videoPrompt": "【摄像机】近景微手持快速推至特写。【主体】在 @写字楼茶水间 ，@张薇 带着轻蔑假笑凑近 @林夏 ，伸手指向她的脸颊，@林夏 眼神冷静微微勾唇，从容从包里取出 @蓝铜肽精华 。【空间】明亮现代办公茶水间柔和自然光，浅景深虚化玻璃幕墙背景。【音频】@张薇 轻佻开口：{姐，昨晚又通宵啦？粉底都卡成地图了！} <轻微高跟鞋脚步声与衣料摩擦声>，no music, no subtitles",
      "dialogue": "张薇：姐，昨晚又通宵啦？粉底都卡成地图了！",
      "onscreenText": "被嘲笑熬夜垮脸？",
      "referencedAssetIds": ["char_1", "char_2", "loc_1", "prop_1"],
      "inputMode": "text",
      "negativeConstraints": "no music, no subtitles, 无多余画面文字水印, 保持人物面部与商品包装一致"
    }
  ]
}`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['aspectRatio', 'totalDurationSec', 'pacingStyle', 'shots'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.4,
      aspectRatio: '9:16',
      defaultStageParams: {
        targetShotCount: 5,
        pacingStyle: '快节奏强反转硬切',
        maxShotDurationSec: 8,
      },
    },
    qcRules: {
      minShots: 3,
      maxShots: 10,
      maxShotDurationSec: 12,
      requiredKeywords: ['no subtitles'],
      checklist: ['所有出场资产均使用 @资产名 绑定', '无未在 S3 中定义的悬空 @提及', '符合模型时长与模式限制'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}sb-drama-cinematic-cuts`,
    userId: null,
    isBuiltin: true,
    slug: 'sb-drama-cinematic-cuts',
    name: '高张力竖屏短剧/漫剧分镜（情绪微表情 + @资产绑定）',
    track: WORKFLOW_TRACK_DRAMA_REMAKE,
    stage: 'storyboard',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '专为爆款短剧与漫剧二创打造：高频正反打、瞳孔震颤特写、反转留白与情绪爆点运镜，全面兼容 Seedance @资产语法。',
    systemPrompt: `你是头部爆款竖屏短剧与剧场版漫剧的分镜导演。
基于上游【S2 二创剧本】、【S3 资产清单】和【目标视频模型能力约束】，输出戏剧张力拉满的分镜脚本 JSON。

分镜语法要求：
1. 精准 @资产名 绑定：所有出场角色、场景、道具必须使用 S3 资产清单中的精确 @资产名，并将对应 id 写入 referencedAssetIds；禁止编造不存在的 @名称。
2. 情绪压迫与反转语法：
   - 打压阶段用俯拍/过肩/压迫构图；反转瞬间切低机位仰拍、急推瞳孔特写或道具重击定格。
   - videoPrompt 严格遵循【摄像机→主体→空间→音频】顺序，口语台词用 {台词}，音效用 <音效>，结尾附带 no music, no subtitles，不写逐秒时间戳。
3. 严格遵守输入给定的视频模型时长范围与 supportsFirstLastFrame 限制（不支持时一律使用 inputMode="text"）。

严格输出标准 S4 JSON：
{
  "aspectRatio": "9:16",
  "totalDurationSec": 40,
  "pacingStyle": "高张力正反打与反转急推",
  "shots": [
    {
      "shotId": "shot_1",
      "shotIndex": 1,
      "sceneIndex": 1,
      "title": "镜1 · 情绪压迫开场",
      "durationSec": 5,
      "shotType": "过肩近景切特写",
      "cameraMovement": "急推至眼神特写",
      "visualDescription": "中文审片摘要",
      "firstFramePrompt": "首帧构图描述",
      "videoPrompt": "【摄像机】...【主体】...（含精确 @资产名）...【空间】...【音频】{台词} <音效>，no music, no subtitles",
      "dialogue": "本镜台词",
      "onscreenText": "重点压字",
      "referencedAssetIds": [],
      "inputMode": "text",
      "negativeConstraints": "no music, no subtitles, 无多余文字水印, 保持角色外观服装一致"
    }
  ]
}`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['aspectRatio', 'totalDurationSec', 'pacingStyle', 'shots'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.42,
      aspectRatio: '9:16',
      defaultStageParams: {
        targetShotCount: 6,
        pacingStyle: '强情绪正反打急切',
        maxShotDurationSec: 10,
      },
    },
    qcRules: {
      minShots: 4,
      maxShots: 12,
      maxShotDurationSec: 12,
      requiredKeywords: ['no subtitles'],
      checklist: ['反转点具备清晰景别与角度反差', '所有 @资产名 与 S3 完全一致'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}sb-film-longtake-grammar`,
    userId: null,
    isBuiltin: true,
    slug: 'sb-film-longtake-grammar',
    name: '电影级调度与光影转场分镜（长镜头美学 + @资产绑定）',
    track: WORKFLOW_TRACK_FILM_STYLE_REMAKE,
    stage: 'storyboard',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '运用电影摄影机调度语言（跟移、推轨、光影过渡、前景遮挡转场与浅景深焦段切换），兼顾 Seedance @资产精准绑定。',
    systemPrompt: `你是电影级视听分镜导演兼摄影指导（DP）。
基于上游【S2 影视风格翻拍剧本】、【S3 资产清单】与【目标视频模型能力约束】，输出克制高级、运动连贯的电影感分镜 JSON。

电影摄影语法要求：
1. 精准 @资产名 绑定：所有出场角色、场景与关键道具均使用 S3 中的精确 @资产名，并在 referencedAssetIds 填入对应 id，禁止悬空 @提及。
2. 镜头调度克制优雅：优先使用平稳推轨（dolly in）、跟拍（tracking shot）、焦点转移（rack focus）、光影明暗过渡与道具特写承接，拒绝无意义的杂乱晃动。
3. 四层提示词规范：videoPrompt 按【摄像机→主体→空间→音频】撰写，突出焦段、光比、空气颗粒感与环境声层次（<细腻环境声>、{克制对白}），结尾附带 no music, no subtitles。
4. 严守模型时长边界与 supportsFirstLastFrame 限制（不支持时一律使用 inputMode="text"）。

严格输出标准 S4 JSON：
{
  "aspectRatio": "16:9",
  "totalDurationSec": 35,
  "pacingStyle": "电影感推轨长镜头与光影留白",
  "shots": [
    {
      "shotId": "shot_1",
      "shotIndex": 1,
      "sceneIndex": 1,
      "title": "镜1 · 电影氛围建立",
      "durationSec": 7,
      "shotType": "中远景缓慢推轨",
      "cameraMovement": "平稳斯坦尼康前推",
      "visualDescription": "审片摘要",
      "firstFramePrompt": "电影首帧构图",
      "videoPrompt": "【摄像机】...【主体】...（含精确 @资产名）...【空间】...【音频】{台词} <环境声>，no music, no subtitles",
      "dialogue": "本镜台词",
      "onscreenText": "",
      "referencedAssetIds": [],
      "inputMode": "text",
      "negativeConstraints": "no music, no subtitles, 无文字水印, 胶片质感统一, 保持角色与场景高度一致"
    }
  ]
}`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['aspectRatio', 'totalDurationSec', 'pacingStyle', 'shots'],
    },
    modelPreferences: {
      llmModelKey: 'nori::nori-gpt',
      temperature: 0.38,
      aspectRatio: '16:9',
      defaultStageParams: {
        targetShotCount: 5,
        pacingStyle: '电影级平稳推轨长镜头',
        maxShotDurationSec: 12,
      },
    },
    qcRules: {
      minShots: 3,
      maxShots: 10,
      maxShotDurationSec: 15,
      requiredKeywords: ['no subtitles'],
      checklist: ['运镜克制连贯带电影焦段与光影语言', '所有 @资产名 与 S3 完全一致'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },

  // =========================================================================
  // STAGE 5: video_gen (1 Builtin Skill — shared across all 3 tracks)
  // =========================================================================
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}vg-seedance-25-default`,
    userId: null,
    isBuiltin: true,
    slug: 'vg-seedance-25-default',
    name: 'Seedance 2.5 批量视频生成与多模态参考策略',
    track: WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
    stage: 'video_gen',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: true,
    description: '将 S4 每个分镜自动打包提交为真实视频生成任务：智能编译 @资产名 提及、挂载 S3 角色/场景/商品参考图与角色绑定音色、校验模型能力并支持单镜多 Takes 抽卡对比。',
    systemPrompt: `批量视频生成执行策略（Seedance 2.5 全能参考默认配方）：
- 模型解析：优先使用当前批次全局视频模型配置（run.modelConfig.videoModelKey），经 viewer 权限与平台路由校验后提交真实任务。
- 输入模式保护：默认全能参考模式（inputMode="text"）以支持多资产 @提及 + 角色音色参考；仅当模型支持 firstlastframe 且镜头明确配置双图首尾帧时才使用首尾帧模式。
- 音色自动挂载：当 generateAudio=true 且角色资产已绑定 voiceMaterialId 时，自动附带音频参考至 referenceAudios。
- 抽卡多版本：单镜重抽（re-roll）不会覆盖旧版本，而是追加到 takes[] 供导演自由对比选片（selectShotTake）。`,
    fewShotExamples: [],
    outputSchema: {
      type: 'object',
      required: ['modelKey', 'aspectRatio', 'resolution', 'generateAudio', 'inputMode', 'shots'],
    },
    modelPreferences: {
      videoModelKey: 'nori::norivideo2.5',
      aspectRatio: '9:16',
      resolution: '720p',
      durationSeconds: 5,
      generateAudio: true,
      defaultStageParams: {
        aspectRatio: '9:16',
        resolution: '720p',
        durationSeconds: 5,
        generateAudio: true,
        inputMode: 'text',
      },
    },
    qcRules: {
      maxShotDurationSec: 30,
      checklist: ['每个分镜至少生成 1 个可用 Take', '参考图与角色音色均通过工作区权限校验'],
    },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
  {
    id: `${BUILTIN_SKILL_ID_PREFIX}vg-vertical-commerce-fast`,
    userId: null,
    isBuiltin: true,
    slug: 'vg-vertical-commerce-fast',
    name: '竖屏快节奏带货视频',
    track: WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
    stage: 'video_gen',
    version: 1,
    parentSkillId: null,
    changeNote: '系统内置初始版本',
    isDefault: false,
    description: '面向竖屏商品短视频的紧凑默认参数：9:16、720p、5 秒、保留参考资产与角色声音。',
    systemPrompt: '竖屏快节奏带货执行策略：以商品与角色参考图保持一致，默认全能参考输入，不自动切换不可用模型；每个镜头独立提交并保留历史 Take。',
    fewShotExamples: [],
    outputSchema: { type: 'object', required: ['modelKey', 'aspectRatio', 'resolution', 'generateAudio', 'inputMode', 'shots'] },
    modelPreferences: {
      videoModelKey: 'nori::norivideo2.5', aspectRatio: '9:16', resolution: '720p', durationSeconds: 5, generateAudio: true,
      defaultStageParams: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5, generateAudio: true, inputMode: 'text' },
    },
    qcRules: { maxShotDurationSec: 15, checklist: ['商品主体清晰且风格统一', '每镜只提交一个独立 Take'] },
    createdAt: BUILTIN_TIMESTAMP,
    updatedAt: BUILTIN_TIMESTAMP,
  },
]

// =========================================================================
// 3 Built-in Track Templates (all running on the unified 5-stage engine)
// =========================================================================

export const BUILTIN_SHORT_DRAMA_COMMERCE_TEMPLATE: WorkflowTemplateDTO = {
  id: `${BUILTIN_TEMPLATE_ID_PREFIX}short-drama-commerce-v2`,
  userId: null,
  isBuiltin: true,
  slug: 'short-drama-commerce-v2',
  name: '漫剧 / 短剧带货（5步全能产线）',
  track: WORKFLOW_TRACK_SHORT_DRAMA_COMMERCE,
  description: '拆解爆款带货视频（或直接粘贴剧本）→ 爽文反转/闺蜜种草洗稿 → 角色/场景/商品定妆与批量出图 → Seedance 2.5 @资产快节奏分镜 → 批量多 Take 出片并一键展开至无限画布。',
  isDefault: true,
  stages: [
    {
      stage: 'script_analysis',
      label: 'S1 剧本解析',
      skillSlug: 'sa-commerce-viral-deconstruct',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}sa-commerce-viral-deconstruct`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { samplingPreset: 'standard', detectSceneCuts: true },
    },
    {
      stage: 'script_rewrite',
      label: 'S2 剧本洗稿',
      skillSlug: 'rw-commerce-twist-hook',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}rw-commerce-twist-hook`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { rewriteIntensity: 'medium', targetDurationSec: 30, tone: '爽感快节奏' },
    },
    {
      stage: 'asset_extraction',
      label: 'S3 解析资产 & 出图',
      skillSlug: 'ae-commerce-product-cast',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}ae-commerce-product-cast`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { artStyle: '商业短剧高质感实拍', preferWorkspaceReuse: true, autoGenerateImages: false },
    },
    {
      stage: 'storyboard',
      label: 'S4 处理分镜',
      skillSlug: 'sb-seedance-fast-commerce',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}sb-seedance-fast-commerce`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { targetShotCount: 5, pacingStyle: '快节奏强反转硬切', maxShotDurationSec: 8 },
    },
    {
      stage: 'video_gen',
      label: 'S5 批量生视频',
      skillSlug: 'vg-seedance-25-default',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}vg-seedance-25-default`,
      gateMode: 'auto',
      enabled: true,
      modelKey: null,
      options: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5, generateAudio: true, inputMode: 'text' },
    },
  ],
  createdAt: BUILTIN_TIMESTAMP,
  updatedAt: BUILTIN_TIMESTAMP,
}

export const BUILTIN_DRAMA_REMAKE_TEMPLATE: WorkflowTemplateDTO = {
  id: `${BUILTIN_TEMPLATE_ID_PREFIX}drama-remake-v1`,
  userId: null,
  isBuiltin: true,
  slug: 'drama-remake-v1',
  name: '爆款短剧 / 漫剧二创',
  track: WORKFLOW_TRACK_DRAMA_REMAKE,
  description: '拉片拆解爆款剧作节拍 → 高能二创人设换皮与反转加码 → 漫剧/国漫角色场景资产出图 → 高张力正反打分镜 → 批量生视频与抽卡选片。',
  isDefault: false,
  stages: [
    {
      stage: 'script_analysis',
      label: 'S1 剧本解析',
      skillSlug: 'sa-drama-beat-extract',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}sa-drama-beat-extract`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { samplingPreset: 'standard', detectSceneCuts: true },
    },
    {
      stage: 'script_rewrite',
      label: 'S2 剧本洗稿',
      skillSlug: 'rw-drama-plot-remake',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}rw-drama-plot-remake`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { rewriteIntensity: 'medium', targetDurationSec: 40, tone: '高能强反转' },
    },
    {
      stage: 'asset_extraction',
      label: 'S3 解析资产 & 出图',
      skillSlug: 'ae-anime-manhua-assets',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}ae-anime-manhua-assets`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { artStyle: '高精国漫剧场版厚涂', preferWorkspaceReuse: true, autoGenerateImages: false },
    },
    {
      stage: 'storyboard',
      label: 'S4 处理分镜',
      skillSlug: 'sb-drama-cinematic-cuts',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}sb-drama-cinematic-cuts`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { targetShotCount: 6, pacingStyle: '强情绪正反打急切', maxShotDurationSec: 10 },
    },
    {
      stage: 'video_gen',
      label: 'S5 批量生视频',
      skillSlug: 'vg-seedance-25-default',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}vg-seedance-25-default`,
      gateMode: 'auto',
      enabled: true,
      modelKey: null,
      options: { aspectRatio: '9:16', resolution: '720p', durationSeconds: 5, generateAudio: true, inputMode: 'text' },
    },
  ],
  createdAt: BUILTIN_TIMESTAMP,
  updatedAt: BUILTIN_TIMESTAMP,
}

export const BUILTIN_FILM_STYLE_REMAKE_TEMPLATE: WorkflowTemplateDTO = {
  id: `${BUILTIN_TEMPLATE_ID_PREFIX}film-style-remake-v1`,
  userId: null,
  isBuiltin: true,
  slug: 'film-style-remake-v1',
  name: '影视风格翻拍',
  track: WORKFLOW_TRACK_FILM_STYLE_REMAKE,
  description: '精细解析原片视听调度与影调 → 电影美学迁移与对白精简重构 → 35mm 电影级定妆与置景出图 → 长镜头推轨分镜 → 高清视频生成与画布精修。',
  isDefault: false,
  stages: [
    {
      stage: 'script_analysis',
      label: 'S1 剧本解析',
      skillSlug: 'sa-film-cinematography-parse',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}sa-film-cinematography-parse`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { samplingPreset: 'detailed', detectSceneCuts: true },
    },
    {
      stage: 'script_rewrite',
      label: 'S2 剧本洗稿',
      skillSlug: 'rw-film-style-transfer',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}rw-film-style-transfer`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { rewriteIntensity: 'heavy', targetDurationSec: 35, tone: '电影感高级克制' },
    },
    {
      stage: 'asset_extraction',
      label: 'S3 解析资产 & 出图',
      skillSlug: 'ae-cinematic-realism-assets',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}ae-cinematic-realism-assets`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { artStyle: '35mm电影胶片实拍质感', preferWorkspaceReuse: true, autoGenerateImages: false },
    },
    {
      stage: 'storyboard',
      label: 'S4 处理分镜',
      skillSlug: 'sb-film-longtake-grammar',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}sb-film-longtake-grammar`,
      gateMode: 'manual_review',
      enabled: true,
      modelKey: null,
      options: { targetShotCount: 5, pacingStyle: '电影级平稳推轨长镜头', maxShotDurationSec: 12 },
    },
    {
      stage: 'video_gen',
      label: 'S5 批量生视频',
      skillSlug: 'vg-seedance-25-default',
      skillId: `${BUILTIN_SKILL_ID_PREFIX}vg-seedance-25-default`,
      gateMode: 'auto',
      enabled: true,
      modelKey: null,
      options: { aspectRatio: '16:9', resolution: '720p', durationSeconds: 6, generateAudio: true, inputMode: 'text' },
    },
  ],
  createdAt: BUILTIN_TIMESTAMP,
  updatedAt: BUILTIN_TIMESTAMP,
}

export const BUILTIN_WORKFLOW_TEMPLATES: readonly WorkflowTemplateDTO[] = [
  BUILTIN_SHORT_DRAMA_COMMERCE_TEMPLATE,
  BUILTIN_DRAMA_REMAKE_TEMPLATE,
  BUILTIN_FILM_STYLE_REMAKE_TEMPLATE,
]

export function getBuiltinWorkflowSkills(filter?: {
  track?: string
  stage?: WorkflowStage
}): WorkflowSkillDTO[] {
  return BUILTIN_WORKFLOW_SKILLS
    .filter((skill) => (!filter?.track || skill.track === filter.track) && (!filter?.stage || skill.stage === filter.stage))
    .map((skill) => structuredClone(skill))
}

export function getBuiltinWorkflowSkillById(skillId: string): WorkflowSkillDTO | null {
  const found = BUILTIN_WORKFLOW_SKILLS.find((skill) => skill.id === skillId)
  return found ? structuredClone(found) : null
}

export function getBuiltinWorkflowSkillBySlug(slug: string, stage?: WorkflowStage): WorkflowSkillDTO | null {
  const found = BUILTIN_WORKFLOW_SKILLS.find(
    (skill) => skill.slug === slug && (!stage || skill.stage === stage),
  )
  return found ? structuredClone(found) : null
}

export function getBuiltinWorkflowTemplates(track?: string): WorkflowTemplateDTO[] {
  return BUILTIN_WORKFLOW_TEMPLATES
    .filter((tpl) => !track || tpl.track === track)
    .map((tpl) => structuredClone(tpl))
}

export function getBuiltinWorkflowTemplateById(templateId: string): WorkflowTemplateDTO | null {
  const found = BUILTIN_WORKFLOW_TEMPLATES.find((tpl) => tpl.id === templateId || tpl.slug === templateId)
  return found ? structuredClone(found) : null
}
