'use client'

import { Check, GitBranch, OrganizeLayoutIcon, RotateCcw } from '@/components/ui/icons'
import type { CanvasOrganizeMode } from '../actions/layout'

type OrganizeOption = { mode: CanvasOrganizeMode; label: string; hint: string; toast: string }
type OrganizeSection = { key: string; label: string; options: ReadonlyArray<OrganizeOption> }

export const CANVAS_ORGANIZE_SECTIONS: ReadonlyArray<OrganizeSection> = [
  {
    key: 'flow',
    label: '按连线',
    options: [
      { mode: 'horizontal', label: '从左到右', hint: '沿连线分层，上游在左', toast: '已按连线从左到右整理画布' },
      { mode: 'vertical', label: '从上到下', hint: '沿连线分层，上游在上', toast: '已按连线从上到下整理画布' },
    ],
  },
  {
    key: 'content',
    label: '按内容',
    options: [
      { mode: 'grid', label: '宫格排列', hint: '按阅读顺序排成整齐宫格', toast: '已完成宫格排列' },
      { mode: 'type', label: '按类型分栏', hint: '文本、图片、视频各自成栏', toast: '已按类型分栏整理画布' },
      { mode: 'tidy', label: '对齐行列', hint: '保留现有行列，对齐并拉开间距', toast: '已对齐行列并拉开间距' },
    ],
  },
]

const ORGANIZE_OPTIONS = CANVAS_ORGANIZE_SECTIONS.flatMap((section) => section.options)

export function canvasOrganizeOption(mode: CanvasOrganizeMode): OrganizeOption {
  return ORGANIZE_OPTIONS.find((option) => option.mode === mode) || ORGANIZE_OPTIONS[0]
}

export function CanvasOrganizeMenu({
  mode,
  storyOrganize,
  onOrganize,
  onResetViewport,
}: {
  mode: CanvasOrganizeMode
  /** Story mode leads with the story-flow arrangement; plain canvases omit it. */
  storyOrganize?: () => void
  onOrganize: (mode: CanvasOrganizeMode) => void
  onResetViewport: () => void
}) {
  return (
    <div className="nori-canvas-organize-menu" role="menu" aria-label="整理方式">
      {storyOrganize ? (
        <div role="group" aria-label="按剧情">
          <p className="nori-canvas-organize-caption">按剧情</p>
          <button type="button" role="menuitem" className="nori-canvas-organize-option" onClick={storyOrganize}>
            <span className="nori-canvas-organize-glyph"><GitBranch /></span>
            <span className="nori-canvas-organize-copy"><b>按剧情走向</b><small>入口在左，选项与条件分支自上而下</small></span>
          </button>
        </div>
      ) : null}
      {CANVAS_ORGANIZE_SECTIONS.map((section) => (
        <div key={section.key} role="group" aria-label={section.label}>
          <p className="nori-canvas-organize-caption">{section.label}</p>
          {section.options.map((option) => {
            const active = option.mode === mode
            return (
              <button
                key={option.mode}
                type="button"
                role="menuitemradio"
                aria-checked={active}
                className={`nori-canvas-organize-option${active ? ' is-active' : ''}`}
                onClick={() => onOrganize(option.mode)}
              >
                <span className="nori-canvas-organize-glyph"><OrganizeLayoutIcon kind={option.mode} /></span>
                <span className="nori-canvas-organize-copy"><b>{option.label}</b><small>{option.hint}</small></span>
                {active ? <Check className="nori-canvas-organize-check" /> : null}
              </button>
            )
          })}
        </div>
      ))}
      <i />
      <button type="button" role="menuitem" className="nori-canvas-organize-option" onClick={onResetViewport}>
        <span className="nori-canvas-organize-glyph"><RotateCcw /></span>
        <span className="nori-canvas-organize-copy"><b>重置视图</b><small>回到画布原点与 100% 缩放</small></span>
      </button>
    </div>
  )
}
