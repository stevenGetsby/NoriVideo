import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

describe('injected super-agent skills', () => {
  let tempDir: string
  const previousDir = process.env.NORI_AGENT_SKILLS_DIR

  beforeEach(() => {
    vi.resetModules()
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nori-agent-skills-'))
    process.env.NORI_AGENT_SKILLS_DIR = tempDir
  })

  afterEach(() => {
    process.env.NORI_AGENT_SKILLS_DIR = previousDir
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('loads valid skill json files and matches them by keyword', async () => {
    fs.writeFileSync(path.join(tempDir, 'course-promo.json'), JSON.stringify({
      id: 'course-promo',
      name: '课程宣传短片',
      description: '适合在线课程、训练营和教育产品宣传。',
      keywords: ['课程', '训练营', '在线教育'],
      defaultConfig: {
        videoRatio: '9:16',
        artStyle: 'realistic',
        visualStyle: '明亮教室与线上学习界面结合的商业宣传风格',
      },
    }))
    fs.writeFileSync(path.join(tempDir, 'invalid.json'), '{bad json')

    const { skillLibrary } = await import('@/lib/super-agent/skill-parser')

    expect(skillLibrary.getSkill('course-promo')).toMatchObject({
      id: 'course-promo',
      name: '课程宣传短片',
      defaultConfig: {
        videoRatio: '9:16',
      },
    })
    expect(skillLibrary.findSkillByKeywords(['帮我做一个在线教育训练营宣传视频'])).toBe('course-promo')
    expect(skillLibrary.findSkillByKeywords(['制作一个口播视频介绍我们的UGC平台'])).toBe('ugc-platform-promo')
  })
})
