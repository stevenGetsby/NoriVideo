import type { ScreenwriterModeCard, ScreenwriterScriptSummary, VideoRepaintTaskView } from './types'

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
}
