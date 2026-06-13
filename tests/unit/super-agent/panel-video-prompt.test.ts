import { describe, expect, it } from 'vitest'
import { ensureAgentPanelVideoPrompt } from '@/lib/super-agent/panel-video-prompt'

describe('ensureAgentPanelVideoPrompt', () => {
  it('converts a plain panel prompt into one clean canonical video prompt', () => {
    const result = ensureAgentPanelVideoPrompt({
      panelNumber: 2,
      description: 'Nori Cube 在工作台上亮起，流程光带汇聚成视频缩略画面。',
      location: '现代极简工作台',
      props: JSON.stringify(['Nori Cube']),
      shotType: '低机位近景',
      cameraMove: '缓缓推近',
      videoPrompt: 'Nori Cube 内部蓝白光从暗到亮。',
      duration: 8,
      clipContent: '不要真人、不要人脸、不要背景音乐。',
    })

    expect(result.changed).toBe(true)
    expect(result.duration).toBe(8)
    expect(result.videoPrompt).toMatch(/^场景：现代极简工作台。/)
    expect(result.videoPrompt).toContain('剧情片段：Nori Cube 内部蓝白光从暗到亮。')
    expect(result.videoPrompt).toContain('执行要求：严格执行本 video_prompt')
    expect(result.videoPrompt).toContain('本分镜使用资产：角色=无；场景=现代极简工作台；道具=Nori Cube。')
    expect(result.videoPrompt).toMatch(/\n0-\d+s：/)
    expect(result.videoPrompt).not.toContain('【Agent 视频分镜提示词】')
    expect(result.videoPrompt).not.toContain('本 panel 动作/台词')
    expect(result.videoPrompt).not.toContain('视频提示：')
    expect(result.videoPrompt).toContain('不要真人、不要人脸')
    expect(result.videoPrompt).toContain('不要生成背景音乐')
  })

  it('keeps an existing canonical panel prompt', () => {
    const prompt = [
      '场景：现代美国私立医院。',
      '剧情片段：Ava 请求 Dr. Grayson 安排手术。',
      '执行要求：严格执行本 video_prompt，不要改写故事含义，不要替换角色资产，不要把本分镜简化成单张静态图。',
      '本分镜使用资产：角色=Ava、Dr. Grayson；场景=现代美国私立医院；道具=手术安排文件。',
      '角色行为拆分：Ava：请求帮助；Dr. Grayson：冷静回应。',
      '人物站位：Ava、Dr. Grayson 按剧情关系形成清楚前景、中景、背景层次。',
      '镜头语言：中景到近景，固定镜头。',
      '0-4s：中景，平视，固定镜头。Ava 请求帮助，Dr. Grayson 冷静回应。',
      '【本分镜负面要求】 不要改变故事核心因果。',
    ].join('\n')
    const result = ensureAgentPanelVideoPrompt({
      videoPrompt: prompt,
      duration: 4,
    })

    expect(result.changed).toBe(false)
    expect(result.videoPrompt).toBe(prompt)
  })

  it('unwraps the legacy double Agent wrapper and keeps only the embedded canonical prompt', () => {
    const canonical = [
      '场景：现代美国私立医院。',
      '剧情片段：Ava 请求 Dr. Grayson 安排手术。',
      '执行要求：严格执行本 video_prompt，不要改写故事含义，不要替换角色资产，不要把本分镜简化成单张静态图。',
      '本分镜使用资产：角色=Ava、Dr. Grayson；场景=现代美国私立医院；道具=手术安排文件。',
      '角色行为拆分：Ava：请求帮助；Dr. Grayson：冷静回应。',
      '人物站位：Ava、Dr. Grayson 按剧情关系形成清楚前景、中景、背景层次。',
      '镜头语言：中景到近景，固定镜头。',
      '0-4s：中景，平视，固定镜头。Ava 请求帮助，Dr. Grayson 冷静回应。',
      '【本分镜负面要求】 不要改变故事核心因果。',
    ].join('\n')
    const legacy = [
      '【Agent 视频分镜提示词】',
      '【片段内分镜1｜推荐时长：4秒】',
      '场景：现代美国私立医院',
      `本 panel 动作/台词：0-4s：${canonical}`,
      `视频提示：${canonical}`,
      '【本分镜负面要求】不要生成乱码文字。',
    ].join('\n')

    const result = ensureAgentPanelVideoPrompt({
      videoPrompt: legacy,
      duration: 4,
    })

    expect(result.changed).toBe(true)
    expect(result.videoPrompt).toBe(canonical)
    expect(result.videoPrompt).not.toContain('【Agent 视频分镜提示词】')
    expect(result.videoPrompt).not.toContain('本 panel 动作/台词')
    expect(result.videoPrompt).not.toContain('视频提示：')
  })
})
