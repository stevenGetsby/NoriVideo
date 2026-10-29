'use client'

import type { CSSProperties } from 'react'
import { ImageIcon, Video, type IconComponent } from '@/components/ui/icons'
import { isStoryNodeType } from '@/lib/interactive/compile'
import { CanvasMenuPortal } from '../components/CanvasMenuPortal'
import type { CanvasNodeMenuType, CanvasWireMenuState } from '../editor-types'
import { STORY_NODE_HUES, STORY_NODE_ICONS } from './StoryCanvasContext'

type MenuItem = { type: CanvasNodeMenuType; label: string; hint: string }
type StoryMenuRole = 'forward' | 'backward' | 'media-pick'

/** What a released story wire can grow into, phrased by where the new card sits in the story. */
const STORY_WIRE_MENUS: Record<StoryMenuRole, { title: string; items: MenuItem[] }> = {
  forward: {
    title: '接下来',
    items: [
      { type: 'story_scene', label: '剧情片段', hint: '播放一段画面与台词' },
      { type: 'story_choice', label: '选择', hint: '让玩家做出决定' },
      { type: 'story_condition', label: '条件', hint: '按全局变量自动分支' },
      { type: 'story_exit', label: '出口', hint: '离开本章，进入下一章' },
      { type: 'story_ending', label: '结局', hint: '故事在这里结束' },
    ],
  },
  backward: {
    title: '在此之前',
    items: [
      { type: 'story_scene', label: '剧情片段', hint: '先播放一段剧情' },
      { type: 'story_choice', label: '选择', hint: '由玩家的某个选项进入' },
      { type: 'story_condition', label: '条件', hint: '满足条件时进入' },
      { type: 'story_entry', label: '入口', hint: '从章节开头直接进入' },
    ],
  },
  'media-pick': {
    title: '片段画面',
    items: [
      { type: 'video', label: '视频', hint: '生成或上传这段剧情的视频' },
      { type: 'image', label: '图片', hint: '用一张图片作为画面' },
    ],
  },
}

const MEDIA_LOOK: Record<string, { icon: IconComponent; hue: string }> = {
  video: { icon: Video, hue: 'var(--dm-hue-video)' },
  image: { icon: ImageIcon, hue: 'var(--dm-hue-image)' },
}

function lookOf(type: CanvasNodeMenuType) {
  return isStoryNodeType(type) ? { icon: STORY_NODE_ICONS[type], hue: STORY_NODE_HUES[type] } : MEDIA_LOOK[type] ?? MEDIA_LOOK.video
}

export function StoryWireMenu({ state, onPick }: { state: CanvasWireMenuState; onPick: (type: CanvasNodeMenuType) => void }) {
  const menu = state.story && state.story !== 'media' ? STORY_WIRE_MENUS[state.story] : null
  if (!menu) return null
  return (
    <CanvasMenuPortal point={state}>
      <div className="nori-story-wire-menu" role="menu" aria-label={menu.title} style={{ left: state.x, top: state.y }} onPointerDown={(event) => event.stopPropagation()}>
        <div className="nori-story-wire-menu-title">{menu.title}</div>
        {menu.items.map((item) => {
          const look = lookOf(item.type)
          const Icon = look.icon
          return (
            <button key={item.type} type="button" role="menuitem" style={{ '--story-hue': look.hue } as CSSProperties} onClick={() => onPick(item.type)}>
              <span className="nori-story-wire-menu-icon"><Icon /></span>
              <span className="nori-story-wire-menu-text"><strong>{item.label}</strong><small>{item.hint}</small></span>
            </button>
          )
        })}
      </div>
    </CanvasMenuPortal>
  )
}
