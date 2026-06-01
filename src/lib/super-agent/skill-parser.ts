/**
 * Skill Parser - MVP 版本
 * 简化的 Skill 定义，基于 skills/ 目录的知识
 */

import type { SkillId } from './types'

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

const SKILL_DEFINITIONS: Record<SkillId, SkillDefinition> = {
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

export class SkillLibrary {
  getSkill(skillId: SkillId): SkillDefinition | undefined {
    return SKILL_DEFINITIONS[skillId]
  }

  findSkillByKeywords(keywords: string[]): SkillId {
    const lowerKeywords = keywords.map(k => k.toLowerCase())

    for (const [skillId, skill] of Object.entries(SKILL_DEFINITIONS)) {
      const matchCount = lowerKeywords.filter(kw =>
        skill.keywords.some(sk => sk.includes(kw) || kw.includes(sk))
      ).length

      if (matchCount > 0) {
        return skillId as SkillId
      }
    }

    return 'generic'
  }

  getAllSkills(): SkillDefinition[] {
    return Object.values(SKILL_DEFINITIONS)
  }
}

export const skillLibrary = new SkillLibrary()
