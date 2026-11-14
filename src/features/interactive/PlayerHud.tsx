'use client'

import { useEffect, useRef, useState } from 'react'
import { achievementProgress, emptyProfile, equippedLook, type StoryProfile } from '@/lib/interactive/achievements'
import { savesEnabled } from '@/lib/interactive/saves'
import { variableMax, type StoryRun } from '@/lib/interactive/engine'
import { speedLabel } from '@/lib/interactive/playback'
import type { StoryProgram, StoryValue, StoryVariable } from '@/lib/interactive/types'
import { PlayerAvatar } from './player/PlayerAvatar'
import { hasRewardShopItems } from './player/records'
import { StoryIcon } from './player/StoryIcon'
import './player/economy.css'
import './player/records.css'

const NO_PROFILE = emptyProfile()

function valueText(variable: StoryVariable, value: StoryValue): string {
  return variable.type === 'boolean' ? (value ? '是' : '否') : String(value)
}

/** A brief +N / −N bubble when a value moves; it never touches the timer or the run itself. */
function useValueFlash(value: StoryValue) {
  const previous = useRef(value)
  const seq = useRef(0)
  const [flash, setFlash] = useState<{ delta: number; seq: number } | null>(null)
  useEffect(() => {
    const before = previous.current
    previous.current = value
    if (typeof before !== 'number' || typeof value !== 'number' || before === value) return
    seq.current += 1
    setFlash({ delta: value - before, seq: seq.current })
    const timer = setTimeout(() => setFlash(null), 900)
    return () => clearTimeout(timer)
  }, [value])
  return flash
}

function HudChip({ variable, value }: { variable: StoryVariable; value: StoryValue }) {
  const flash = useValueFlash(value)
  const max = variableMax(variable)
  const off = variable.type === 'boolean' && value === false
  const accessible = `${variable.name} ${valueText(variable, value)}${max !== null ? ` / ${max}` : ''}`
  return (
    <span
      className={`nori-hud-chip${off ? ' is-off' : ''}`}
      data-testid={`hud-variable-${variable.id}`}
      data-hud-variable={variable.id}
      data-off={off ? 'true' : undefined}
      role="status"
      title={variable.name}
      aria-label={accessible}
    >
      <StoryIcon icon={variable.icon} />
      {variable.icon ? null : <span className="nori-hud-name">{variable.name}</span>}
      <b className="nori-hud-value">{valueText(variable, value)}</b>
      {max !== null ? <i className="nori-hud-max">/{max}</i> : null}
      {flash ? (
        <i key={flash.seq} className={`nori-hud-flash ${flash.delta > 0 ? 'is-up' : 'is-down'}`}>
          {flash.delta > 0 ? `+${flash.delta}` : String(flash.delta)}
        </i>
      ) : null}
    </span>
  )
}

function MapIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M9 4 3.5 6v14L9 18l6 2 5.5-2V4L15 6 9 4Z" />
      <path d="M9 4v14M15 6v14" />
    </svg>
  )
}

/**
 * The viewer's top-right bar: one chip per value the creator flagged 显示在右上角, the speed
 * button the creator enabled, plus the shop and — when the work keeps records — the achievement
 * avatar and the map. Only the buttons take pointer input, so the bar never blocks choice cards or hits.
 */
export function PlayerHud({
  program,
  run,
  orientation,
  profile = NO_PROFILE,
  speeds = [],
  rate = 1,
  onCycleSpeed,
  onOpenShop,
  onOpenAchievements,
  onOpenMap,
}: {
  program: StoryProgram
  run: StoryRun
  orientation: 'portrait' | 'landscape'
  profile?: StoryProfile
  /** Speeds the creator offered; the button only appears when there is a choice. */
  speeds?: readonly number[]
  /** The speed in force right now, shown on the button. */
  rate?: number
  onCycleSpeed?: () => void
  onOpenShop: () => void
  onOpenAchievements?: () => void
  onOpenMap?: () => void
}) {
  const shown = program.variables.filter((variable) => variable.showInHud)
  const shop = program.shop?.enabled ? program.shop : null
  const achievements = program.achievements ?? []
  const avatarVisible = achievements.length > 0 || hasRewardShopItems(program)
  const mapVisible = savesEnabled(program)
  const speedVisible = speeds.length > 1 && Boolean(onCycleSpeed)
  if (!shown.length && !shop && !avatarVisible && !mapVisible && !speedVisible) return null
  const look = equippedLook(program, profile)
  const progress = achievementProgress(program, profile)
  return (
    <div className={`nori-hud is-${orientation}`} data-testid="player-hud">
      <div className="nori-hud-values" data-testid="hud-values">
        {shown.map((variable) => (
          <HudChip key={variable.id} variable={variable} value={run.vars[variable.id] ?? variable.initial} />
        ))}
      </div>
      <div className="nori-hud-actions" data-testid="hud-actions">
        {speedVisible ? (
          <button
            type="button"
            className="nori-hud-action is-speed"
            data-testid="hud-speed"
            aria-label={`播放倍速 ${speedLabel(rate)}，点击切换`}
            title="播放倍速"
            onClick={onCycleSpeed}
          >
            {speedLabel(rate)}
          </button>
        ) : null}
        {avatarVisible ? (
          <span className="nori-hud-avatar">
            {look.title ? <span className="nori-hud-title" data-testid="hud-title">{look.title}</span> : null}
            <button
              type="button"
              className="nori-hud-action is-avatar"
              data-testid="hud-achievements"
              aria-label={progress.total ? `打开成就，已达成 ${progress.earned} / ${progress.total}` : '打开成就'}
              title="成就"
              onClick={onOpenAchievements}
            >
              <PlayerAvatar frameUrl={look.frameUrl} />
              {progress.total ? <span className="nori-hud-badge" data-testid="hud-achievement-badge">{progress.earned}/{progress.total}</span> : null}
            </button>
          </span>
        ) : null}
        {mapVisible ? (
          <button type="button" className="nori-hud-action is-map" data-testid="hud-map" aria-label="打开地图与存档" title="地图与存档" onClick={onOpenMap}>
            <MapIcon />
          </button>
        ) : null}
        {shop ? (
          <button type="button" className="nori-hud-action is-shop" data-testid="hud-shop" aria-label="打开商城" title="商城" onClick={onOpenShop}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M5 8h14l-1 12H6L5 8Z" />
              <path d="M9 8a3 3 0 0 1 6 0" />
            </svg>
          </button>
        ) : null}
      </div>
    </div>
  )
}
