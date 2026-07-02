import type { EpisodeProcessItem, ScreenwriterModeCard, ScreenwriterScriptSummary, TargetScriptEpisode, VideoRepaintTaskView } from './types'

export const screenwriterModeCards: ScreenwriterModeCard[] = [
  {
    key: 'video-repaint-2',
    title: '视频转绘',
    subtitle: '整剧视频转为目标版本剧本/分镜\n保持全剧角色、场景映射一致',
    icon: 'sparklesAlt',
    accent: '#6366f1',
    iconBg: 'rgba(99,102,241,.18)',
    badge: '2.0',
  },
  {
    key: 'script-repaint-2',
    title: '剧本转绘',
    subtitle: '整剧剧本转为目标版本',
    icon: 'sparkles',
    accent: '#22c55e',
    iconBg: 'rgba(34,197,94,.16)',
    badge: '2.0',
  },
  {
    key: 'storyboard-repaint-2',
    title: '分镜转绘',
    subtitle: '整剧分镜转为目标版本',
    icon: 'imageLandscape',
    accent: '#ec4899',
    iconBg: 'rgba(236,72,153,.16)',
    badge: '2.0',
  },
  {
    key: 'single-episode-test',
    title: '单集转绘测试',
    subtitle: '单集测试入口',
    icon: 'fileText',
    accent: '#64748b',
    iconBg: 'rgba(100,116,139,.18)',
    badge: '4项',
    compact: true,
  },
  {
    key: 'novel-to-script',
    title: '小说转剧本',
    subtitle: '小说按照剧本改写',
    icon: 'bookOpen',
    accent: '#d97706',
    iconBg: 'rgba(217,119,6,.16)',
    compact: true,
  },
]

export const emptyScreenwriterModeCards: ScreenwriterModeCard[] = [
  {
    key: 'video-repaint-2',
    title: '视频转绘2.0',
    subtitle: '整剧视频转为目标版本剧本/分镜\n保持全剧角色、场景映射一致',
    icon: 'sparklesAlt',
    accent: '#3b6ef2',
    iconBg: 'rgba(59,110,242,.16)',
    badge: 'NEW',
  },
  {
    key: 'video2script',
    title: '视频转剧本',
    subtitle: '上传参考视频，AI 分析画面节奏与对话，反向生成台词稿，适合改编或翻拍场景。',
    icon: 'videoWide',
    accent: '#3b82f6',
    iconBg: 'rgba(59,130,246,.16)',
  },
  {
    key: 'video2board',
    title: '视频转分镜',
    subtitle: '上传参考视频，AI 识别镜头切换点位与景别，输出镜头化文本，可叠加自动转绘。',
    icon: 'folderCards',
    accent: '#8b5cf6',
    iconBg: 'rgba(139,92,246,.16)',
  },
  {
    key: 'script2board',
    title: '剧本转绘',
    subtitle: '选择已有剧本或上传剧本文件，按目标市场规则生成转绘版剧本。',
    icon: 'sparkles',
    accent: '#22c55e',
    iconBg: 'rgba(34,197,94,.16)',
  },
  {
    key: 'board2board',
    title: '分镜转绘',
    subtitle: '选择已有分镜或上传分镜文件，按目标市场规则生成转绘版分镜。',
    icon: 'imageLandscape',
    accent: '#ec4899',
    iconBg: 'rgba(236,72,153,.16)',
  },
]

export const screenwriterDemoScripts: ScreenwriterScriptSummary[] = [
  {
    id: 'demo-oversea-redraw',
    title: 'TEST-海外转绘版',
    episodeCount: 30,
    taskKind: 'script_repaint_2',
    taskLabel: '剧本转绘2.0任务',
    status: 'draft',
    activeTaskId: 'demo-oversea-redraw-task',
    activeTaskLabel: '进行中',
    activeTaskStatus: 'running',
  },
]

export const videoRepaintDemoTask: VideoRepaintTaskView = {
  id: 'demo-oversea-redraw-task',
  title: 'TEST-海外转绘版',
  taskTypeLabel: '剧本转绘 2.0',
  requirement: '输出英文版本，保留现代都市设定与情感冲突，角色命名和对白表达按海外短剧语境重写。',
  currentStage: 'source_settings',
  stages: [
    { key: 'auto_split', title: '自动拆集', subtitle: '保存用户上传视频', status: 'approved' },
    { key: 'fact_extract', title: '事实卡提取', subtitle: '逐集分析文本', status: 'approved' },
    { key: 'source_settings', title: '设定提炼', subtitle: '汇总设定总纲', status: 'waiting_check', checkpoint: 'A' },
    { key: 'episode_alignment', title: '逐集对齐', subtitle: '称呼统一整理', status: 'not_started' },
    { key: 'target_settings', title: '目标设定', subtitle: '生成目标总纲', status: 'not_started', checkpoint: 'B' },
    { key: 'episode_repaint', title: '逐集转绘', subtitle: '剧本转绘2.0', status: 'not_started' },
  ],
  sourceSettings: {
    title: '审查设定总纲',
    checkpoint: 'A',
    outlineTitle: '设定总纲',
    bodySections: [
      {
        heading: '故事核与主冲突',
        body: '本剧主角是出身底层、饱受苦难的乡野孤女苏晚卿。故事的核心驱动力是她为保护相依为命的陈阿婆、保全自己的子嗣，在险恶的内宅和军阀权力倾轧中步步为营，绝地反击。',
      },
      {
        heading: '类型、主题与叙事引擎',
        body: '这是一部民国军阀背景的宅斗与权谋短剧。主要机制是身份暴露、搜集铁证、借势反杀。主题聚焦于被轻视的弱势女性如何拒绝依附男人，成长为与军阀丈夫比肩的权力共治者。',
      },
      {
        heading: '世界观与权力规则',
        body: '全剧建立在民国军阀割据与新旧思想碰撞的世界观之上。家族内宅遵循森严的婆妾等级制，外部权力场则是军阀法则、兵权代表绝对话语权。',
      },
    ],
    collapsedPanelTitle: '统一名索引',
    collapsedPanelCount: 16,
    nameIndexGroups: [
      {
        title: '人物',
        rows: [
          { sourceName: '苏晚卿', targetName: '我 / 晚卿 / 苏姨太 / 督军夫人' },
          { sourceName: '陆承煜', targetName: '副官 / 陆副官 / 承煜哥 / 陆督军' },
          { sourceName: '沈曼柔', targetName: '沈姨太 / 曼柔' },
          { sourceName: '柳氏', targetName: '柳夫人' },
        ],
      },
      {
        title: '地点',
        rows: [
          { sourceName: '土地庙', targetName: '城郊土地庙' },
        ],
      },
      {
        title: '关键道具',
        rows: [
          { sourceName: '玄铁令牌', targetName: '令牌 / 陆字令牌 / 刻陆字的玄铁令牌' },
          { sourceName: '银簪', targetName: '断裂银簪 / 阿婆留的银簪' },
        ],
      },
    ],
    issuePanelTitle: '建议复核点',
    issueCount: 2,
    issues: [
      {
        id: 'E25',
        label: 'E25',
        category: '称呼归并',
        currentHandling: '暂将陆承宇按照承煜的兄弟处理，不视为其子。',
        evidence: '剧情已明确老督军宣布三子夺嫡，且陆承煜、陆承宇、陆承泽同属“承”字辈。',
        risk: '如果强行按台词中的“逆子”保留父子设定，会导致全剧陆家的伦理关系与同辈夺嫡逻辑全面崩塌。',
        confirmationPrompt: '请人工确认：E25陆承煜台词怒斥陆承宇为“逆子”是否为“逆贼”的笔误？',
      },
      {
        id: 'E29',
        label: 'E29',
        category: '证据不足',
        currentHandling: '暂按现有素材梳理大结局，E28结束后直接跳至E30的数十年后阶段。',
        evidence: '用户提供的素材列表中直接缺少E29的数据块。',
        risk: '缺失集数会影响目标剧本的收束节奏。',
        confirmationPrompt: '请确认是否补充 E29 源视频或允许系统按现有信息补齐。',
      },
    ],
    feedbackPlaceholder: '对总纲有修改意见？填写后点击「重新提炼」',
  },
  targetSettings: {
    title: '审查目标设定总纲',
    checkpoint: 'B',
    outlineTitle: '目标设定总纲',
    bodySections: [
      {
        heading: '目标市场版本与故事核类型承诺',
        body: '本剧面向欧美短剧市场，定位为 Alpha Billionaire / Mafia Romance。核心驱动力是底层出身的代孕情人 Sophia，为保护相依为命的养母并保全孩子，在暗黑财阀家族的权力倾轧中步步为营。',
      },
      {
        heading: '本地化总策略',
        body: '全剧将民国军阀与封建内宅重绘为现代欧美掌控黑白两道的超级财阀家族。军阀兵权映射为家族的私人武装与皇佣兵指挥权。',
      },
      {
        heading: '主要人物小传',
        body: 'Sophia Vance 是底层女孩，全剧复仇与平权的智力担当。Lucas Sterling 是 Sterling 财阀的第一继承人，前期替伏佚装为家族的高级安保主管。',
      },
    ],
    collapsedPanelTitle: '角色 / 场景 / 关键道具映射',
    collapsedPanelCount: 16,
    nameIndexGroups: [
      {
        title: '人物',
        rows: [
          { sourceName: '苏晚卿', targetName: 'Sophia Vance', description: '底层出身的契约情人，后成长为掌控财阀权力的女主人。' },
          { sourceName: '陆承煜', targetName: 'Lucas Sterling', description: '伪装成安保主管的财阀第一继承人。' },
          { sourceName: '沈曼柔', targetName: 'Melissa Thorne', description: '前期反派，傲慢恶毒的财阀千金。' },
        ],
      },
      {
        title: '地点',
        rows: [
          { sourceName: '土地庙', targetName: 'The Abandoned Chapel', description: '地下交易与女主逃亡避难的边缘空间。' },
        ],
      },
      {
        title: '关键道具',
        rows: [
          { sourceName: '玄铁令牌', targetName: 'Obsidian Family Signet', description: '象征最高安保与资金调动权限的黑曜石家族印戒。' },
          { sourceName: '银簪', targetName: 'Silver Hairpin', description: '养母留下的银质发簪，防身利器与情感锚点。' },
        ],
      },
    ],
    issuePanelTitle: '待确认问题',
    issueCount: 1,
    issues: [
      {
        id: 'world-scale',
        label: '关于全剧权力世界的尺度与合规包装',
        category: '世界观合规',
        currentHandling: '保留黑帮财阀压迫感，但弱化真实犯罪组织与现实政治指向。',
        evidence: '欧美短剧市场可接受 Alpha Billionaire 与 Mafia Romance 外壳，但需避免真实组织映射。',
        risk: '如果黑帮、军火与地下交易过于写实，会影响平台审核与投放。',
        confirmationPrompt: '请确认采用“财阀安保集团 + 私人雇佣兵”的包装方式。',
      },
    ],
    feedbackPlaceholder: '对目标总纲有修改意见？填写后点击「重新生成」',
  },
  alignmentEpisodes: Array.from({ length: 30 }, (_, index): EpisodeProcessItem => ({
    id: `alignment-${index + 1}`,
    episodeNumber: index + 1,
    status: index === 12 ? 'failed' : 'running',
    errorMessage: index === 12 ? '称呼归并冲突，需重试' : undefined,
  })),
  repaintEpisodes: Array.from({ length: 30 }, (_, index): EpisodeProcessItem => ({
    id: `repaint-${index + 1}`,
    episodeNumber: index + 1,
    status: index < 2 ? 'succeeded' : index === 17 ? 'failed' : 'running',
    errorMessage: index === 17 ? '目标对白长度超出限制' : undefined,
  })),
}

export const videoRepaintTargetScriptEpisodes: TargetScriptEpisode[] = [
  {
    id: 'target-ep01',
    episodeNumber: 1,
    title: 'Rain Escape',
    status: 'succeeded',
    wordCount: 1280,
    content: 'EP01 Rain Escape\n\nINT. DERELICT SAFEHOUSE - NIGHT\n\nSophia Vance wakes up in the dark, rain hammering the broken windows. Her wrist is bruised, but her eyes stay sharp. She grips the silver hairpin Granny Clara left her and forces herself to stand.',
  },
  {
    id: 'target-ep02',
    episodeNumber: 2,
    title: 'The Abandoned Chapel',
    status: 'succeeded',
    wordCount: 1190,
    content: 'EP02 The Abandoned Chapel\n\nEXT. ABANDONED CHAPEL - NIGHT\n\nSophia stumbles into the ruined chapel, soaked and shaking. Outside, headlights sweep across the rain while Lucas Sterling watches from the shadows.',
  },
]
