const TASK_TYPE_LABELS: Record<string, string> = {
  image_panel: '分镜图片生成',
  image_character: '角色图片生成',
  image_location: '场景图片生成',
  video_panel: '分镜视频生成',
  lip_sync: '口型同步',
  voice_line: '角色配音生成',
  voice_design: '角色音色设计',
  asset_hub_voice_design: '资产库音色设计',
  regenerate_storyboard_text: '分镜内容重写',
  insert_panel: '新增分镜',
  panel_variant: '分镜变体生成',
  modify_asset_image: '资产图片修改',
  regenerate_group: '批量重新生成',
  asset_hub_image: '资产库图片生成',
  asset_hub_modify: '资产库图片修改',
  toolbox_image: '工具箱图片生成',
  toolbox_video: '工具箱视频生成',
  toolbox_audio: '工具箱音频生成',
  toolbox_model_3d: '工具箱 3D 模型生成',
  canvas_image_operation: '画布图片处理',
  canvas_video_operation: '画布视频处理',
  canvas_text_generation: '画布文本生成',
  canvas_storyboard_plan: '画布故事板规划',
  analyze_novel: '剧本内容分析',
  asset_extraction_run: '项目资产解析',
  story_to_script_run: '剧本格式化',
  script_to_storyboard_run: '项目分镜解析',
  clips_build: '分段内容整理',
  screenplay_convert: '剧本格式转换',
  voice_analyze: '音色分析',
  analyze_global: '项目全局分析',
  ai_story_expand: 'AI 剧情扩写',
  ai_modify_appearance: '角色变体修改',
  ai_modify_location: '场景资产修改',
  ai_modify_prop: '物品资产修改',
  ai_modify_shot_prompt: '分镜提示词修改',
  analyze_shot_variants: '分镜变体分析',
  ai_create_character: '新增角色',
  ai_create_location: '新增场景',
  reference_to_character: '参考图转角色',
  episode_split_llm: '剧集拆分',
  export_delivery: '成片导出',
}

const TASK_STATUS_LABELS: Record<string, string> = {
  queued: '排队中',
  processing: '生成中',
  completed: '已完成',
  failed: '失败',
  canceled: '已取消',
  dismissed: '已忽略',
}

export function taskTypeDisplayName(value: string | null | undefined) {
  const key = value?.trim().toLowerCase() || ''
  if (TASK_TYPE_LABELS[key]) return TASK_TYPE_LABELS[key]
  if (key.includes('image')) return '图片生成'
  if (key.includes('video')) return '视频生成'
  if (key.includes('audio') || key.includes('voice') || key.includes('tts')) return '音频生成'
  if (key.includes('storyboard')) return '分镜内容生成'
  if (key.includes('script') || key.includes('text') || key.includes('analysis')) return '文本内容生成'
  return '内容生成任务'
}

export function taskStatusDisplayName(value: string | null | undefined) {
  return TASK_STATUS_LABELS[value?.trim().toLowerCase() || ''] || '处理中'
}
