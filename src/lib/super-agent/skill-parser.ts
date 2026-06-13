/**
 * Skill Parser - MVP 版本
 * 简化的 Skill 定义，基于 skills/ 目录的知识
 */

import type { SkillId } from './types'
import fs from 'node:fs'
import path from 'node:path'

export interface SkillDefinition {
  id: SkillId
  name: string
  description: string
  keywords: string[]
  defaultConfig: {
    videoRatio: '9:16' | '16:9' | '1:1'
    artStyle: string
    visualStyle: string
  }
}

const BUILTIN_SKILL_DEFINITIONS: Record<string, SkillDefinition> = {
  'digital-avatar-ad': {
    id: 'digital-avatar-ad',
    name: '数字人口播',
    description: '数字人广告与产品视频，适合产品介绍、品牌宣传',
    keywords: ['数字人', 'digital avatar', '口播', '产品', 'product', '广告', 'ad'],
    defaultConfig: {
      videoRatio: '9:16',
      artStyle: 'realistic-photography',
      visualStyle: '写实摄影，干净的灯光，智能手机前置摄像头拍摄风格',
    },
  },
  'travel-master': {
    id: 'travel-master',
    name: '旅拍大师',
    description: '旅行视频制作，适合旅游vlog、风景展示',
    keywords: ['旅拍', 'travel', '旅游', 'vlog', '风景', 'landscape'],
    defaultConfig: {
      videoRatio: '16:9',
      artStyle: 'cinematic',
      visualStyle: '电影感，自然光线，广角镜头',
    },
  },
  'product-promo': {
    id: 'product-promo',
    name: '商品宣传短片',
    description: '商品宣传视频，适合电商、产品展示',
    keywords: ['商品', 'product', '宣传', 'promo', '电商', 'ecommerce'],
    defaultConfig: {
      videoRatio: '9:16',
      artStyle: 'modern-commercial',
      visualStyle: '现代商业风格，明亮干净，产品突出',
    },
  },
  'food-documentary': {
    id: 'food-documentary',
    name: '舌尖美食',
    description: '美食纪录片风格，适合美食展示、餐厅宣传',
    keywords: ['美食', 'food', '舌尖', '餐厅', 'restaurant', '料理'],
    defaultConfig: {
      videoRatio: '16:9',
      artStyle: 'documentary',
      visualStyle: '纪录片风格，暖色调，食物特写',
    },
  },
  'music-mv': {
    id: 'music-mv',
    name: '音乐MV',
    description: '音乐视频制作，适合歌曲MV、音乐宣传',
    keywords: ['音乐', 'music', 'mv', '歌曲', 'song'],
    defaultConfig: {
      videoRatio: '16:9',
      artStyle: 'artistic',
      visualStyle: '艺术化，动态镜头，节奏感强',
    },
  },
  'generic': {
    id: 'generic',
    name: '通用视频制作',
    description: '通用视频制作，适合各类视频需求',
    keywords: ['视频', 'video', '制作', 'create'],
    defaultConfig: {
      videoRatio: '9:16',
      artStyle: 'american-comic',
      visualStyle: '美式漫画风格',
    },
  },
}

function isVideoRatio(value: unknown): value is '9:16' | '16:9' | '1:1' {
  return value === '9:16' || value === '16:9' || value === '1:1'
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item))
}

function normalizeInjectedSkill(raw: unknown): SkillDefinition | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const source = raw as Record<string, unknown>
  const id = readString(source.id)
  const name = readString(source.name)
  const description = readString(source.description)
  const keywords = readStringArray(source.keywords)
  const defaultConfigRaw = source.defaultConfig && typeof source.defaultConfig === 'object' && !Array.isArray(source.defaultConfig)
    ? source.defaultConfig as Record<string, unknown>
    : {}
  const videoRatio = defaultConfigRaw.videoRatio
  const artStyle = readString(defaultConfigRaw.artStyle)
  const visualStyle = readString(defaultConfigRaw.visualStyle)

  if (!id || !/^[a-z0-9][a-z0-9._-]{1,80}$/i.test(id)) return null
  if (!name || !description || keywords.length === 0) return null
  if (!isVideoRatio(videoRatio) || !artStyle || !visualStyle) return null

  return {
    id,
    name,
    description,
    keywords,
    defaultConfig: {
      videoRatio,
      artStyle,
      visualStyle,
    },
  }
}

function getSkillDirs(): string[] {
  const dirs = [
    path.join(process.cwd(), 'agent-skills'),
  ]
  const extraDir = process.env.NORI_AGENT_SKILLS_DIR?.trim()
  if (extraDir) {
    dirs.push(path.isAbsolute(extraDir) ? extraDir : path.join(process.cwd(), extraDir))
  }
  return dirs
}

function loadInjectedSkills(): Record<string, SkillDefinition> {
  const skills: Record<string, SkillDefinition> = {}
  for (const dir of getSkillDirs()) {
    if (!fs.existsSync(dir)) continue
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) continue
      try {
        const raw = JSON.parse(fs.readFileSync(path.join(dir, entry.name), 'utf8')) as unknown
        const skill = normalizeInjectedSkill(raw)
        if (skill) {
          skills[skill.id] = skill
        }
      } catch {
        // Ignore malformed injected skill files; valid files in the same directory still load.
      }
    }
  }
  return skills
}

export class SkillLibrary {
  private getSkillMap(): Record<string, SkillDefinition> {
    return {
      ...BUILTIN_SKILL_DEFINITIONS,
      ...loadInjectedSkills(),
    }
  }

  getSkill(skillId: SkillId): SkillDefinition | undefined {
    return this.getSkillMap()[skillId]
  }

  findSkillByKeywords(keywords: string[]): SkillId {
    const lowerKeywords = keywords
      .map(k => k.toLowerCase().trim())
      .filter(Boolean)
    let bestSkill: SkillId = 'generic'
    let bestScore = 0

    for (const [skillId, skill] of Object.entries(this.getSkillMap())) {
      if (skillId === 'generic') continue
      const skillKeywords = skill.keywords.map((keyword) => keyword.toLowerCase().trim()).filter(Boolean)
      const score = skillKeywords.reduce((sum, skillKeyword) => {
        const matched = lowerKeywords.some((inputKeyword) => (
          skillKeyword.includes(inputKeyword) || inputKeyword.includes(skillKeyword)
        ))
        return matched ? sum + Math.max(1, Array.from(skillKeyword).length) : sum
      }, 0)

      if (score > bestScore) {
        bestSkill = skillId
        bestScore = score
      }
    }

    return bestSkill
  }

  getAllSkills(): SkillDefinition[] {
    return Object.values(this.getSkillMap())
  }
}

export const skillLibrary = new SkillLibrary()
