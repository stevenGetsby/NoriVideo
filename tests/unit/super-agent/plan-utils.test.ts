import { describe, expect, it } from 'vitest'
import {
  applySkillWorkflowDefaults,
  createDeterministicAnalysis,
  normalizeAgentExecutionPlan,
  normalizeCreativeParameters,
  normalizeExecutionMode,
} from '@/lib/super-agent/plan-utils'

describe('super-agent plan utils', () => {
  it('defaults to mock mode unless live is explicitly requested', () => {
    expect(normalizeExecutionMode(undefined)).toBe('mock')
    expect(normalizeExecutionMode('mock')).toBe('mock')
    expect(normalizeExecutionMode('live')).toBe('live')
  })

  it('normalizes optional creative parameters with bounded numbers', () => {
    const params = normalizeCreativeParameters({
      durationSeconds: 999,
      shotCount: 0,
      panelsPerShot: 99,
      targetAudience: ' 创作者 ',
      narration: 'on',
    })

    expect(params.durationSeconds).toBe(300)
    expect(params.shotCount).toBe(1)
    expect(params.panelsPerShot).toBe(8)
    expect(params.targetAudience).toBe('创作者')
    expect(params.narration).toBe('on')
    expect(params.mockPrompt).toContain('Mock prompt')
  })

  it('creates deterministic mock analysis without external model calls', () => {
    const analysis = createDeterministicAnalysis('制作一个16:9的智能手表商品宣传短片')

    expect(analysis.videoType).toBe('product-promo')
    expect(analysis.videoRatio).toBe('16:9')
    expect(analysis.projectName).toContain('智能手表')
    expect(analysis.confidence).toBe(1)
    expect(analysis.creativeParameters).toMatchObject({
      durationSeconds: 18,
      shotCount: 3,
      panelsPerShot: 1,
    })
  })

  it('does not add commercial fields to generic fairy-tale story prompts', () => {
    const analysis = createDeterministicAnalysis('帮我生成一个可爱的动画短片，故事是一天晚上，小兔子在森林里散步，救起掉进水坑的萤火虫。')
    const params = normalizeCreativeParameters(analysis.creativeParameters)

    expect(analysis.videoType).toBe('generic')
    expect(params.sellingPoints).toBeUndefined()
    expect(params.callToAction).toBeUndefined()
    expect(params.panelsPerShot).toBeGreaterThan(1)
  })

  it('strips commercial fields when an LLM wrongly adds them to a generic story', () => {
    const params = applySkillWorkflowDefaults(
      normalizeCreativeParameters({
        tone: '温暖',
        sellingPoints: '善良会发光',
        callToAction: '学习善良',
        shotCount: 6,
        panelsPerShot: 3,
      }),
      {
        tone: '温暖',
        sellingPoints: '善良会发光',
        callToAction: '学习善良',
        shotCount: 6,
        panelsPerShot: 3,
      },
      'generic',
    )

    expect(params.sellingPoints).toBeUndefined()
    expect(params.callToAction).toBeUndefined()
    expect(params.tone).toBe('温暖')
  })

  it('infers fallback creative parameters for UGC口播 prompts', () => {
    const analysis = createDeterministicAnalysis('制作一个口播视频介绍我们的UGC平台')

    expect(analysis.videoType).toBe('ugc-platform-promo')
    expect(analysis.creativeParameters).toMatchObject({
      durationSeconds: 30,
      targetAudience: expect.stringContaining('内容创作者'),
      narration: 'on',
      shotCount: 4,
      panelsPerShot: 1,
    })
  })

  it('keeps role-asset short drama prompts on the generic workflow', () => {
    const analysis = createDeterministicAnalysis([
      '请用 Agent 自动创作模式生成一支 9:16 欧美医疗短剧转绘视频，真实真人短剧质感，英文口型。',
      '角色资产：',
      'Ava：年轻美国女性，黑框眼镜。',
      'Dr. Grayson：美国男外科医生。',
      '剧情：Ava 在医院走廊请求医生帮外婆安排手术。',
    ].join('\n'))

    expect(analysis.videoType).toBe('generic')
    expect(analysis.videoRatio).toBe('9:16')
  })

  it('normalizes stale Agent plans to the required seven-stage workflow', () => {
    const plan = normalizeAgentExecutionPlan({
      projectConfig: {
        name: '旧计划',
        videoRatio: '9:16',
        artStyle: 'realistic',
      },
      episodeConfig: {
        name: '第1集',
        novelText: '旧故事',
      },
      selectedSkill: 'generic',
      skillDescription: '通用视频制作',
      executionMode: 'live',
      creativeParameters: normalizeCreativeParameters({}),
      stages: [
        {
          stageId: '',
          stageNumber: 0,
          title: '',
          description: '',
          estimatedDuration: 0,
          status: 'completed',
        },
      ],
      estimatedDuration: 1,
    })

    expect(plan.stages).toHaveLength(7)
    expect(plan.stages[0]).toMatchObject({
      stageId: 'stage_1',
      stageNumber: 1,
      title: '项目初始化',
      description: '创建项目和剧集',
      status: 'pending',
    })
    expect(plan.stages[6]).toMatchObject({
      stageId: 'stage_7',
      title: '视频生成',
      status: 'pending',
    })
  })
})
