'use client'

import { useMemo, useState } from 'react'
import { storyPlaces } from '@/lib/interactive/places'
import type {
  InteractiveStoryConfig,
  StoryAchievement,
  StoryChapterGraph,
  StoryMapConfig,
  StoryPersonality,
  StoryPlaybackConfig,
  StoryShop,
  StoryVariable,
} from '@/lib/interactive/types'
import { extraPlaybackSpeedCount, savePointCount } from './gameplay-edit'
import { StoryAchievementsEditor } from './StoryAchievementsEditor'
import { StoryMapEditor } from './StoryMapEditor'
import { StoryPersonalityEditor } from './StoryPersonalityEditor'
import { StoryPlaybackEditor } from './StoryPlaybackEditor'
import { StoryShopEditor } from './StoryShopEditor'
import { StoryVariablesEditor } from './StoryVariablesEditor'
import './story-gameplay.css'

export type GameplaySegmentKey = 'variables' | 'shop' | 'achievements' | 'personality' | 'map' | 'playback'

/** The canvas ending card may ask for a specific tab before opening the panel. */
let pendingSegment: GameplaySegmentKey | null = null
export function requestStoryGameplaySegment(segment: GameplaySegmentKey) {
  pendingSegment = segment
}

const SEGMENTS: ReadonlyArray<{ key: GameplaySegmentKey; label: string }> = [
  { key: 'variables', label: '数值' },
  { key: 'shop', label: '商城' },
  { key: 'achievements', label: '成就' },
  { key: 'personality', label: '人格测试' },
  { key: 'map', label: '地图' },
  { key: 'playback', label: '倍速' },
]

/** The 玩法设置 panel body: a segmented switch over the story's gameplay config. */
export function StoryGameplaySettings({
  variables,
  shop,
  chapters = [],
  achievements,
  personality,
  map,
  playback,
  workId = null,
  readOnly,
  onSaveConfig,
}: {
  variables: StoryVariable[]
  shop: StoryShop | undefined
  /** Every chapter available to this surface; the canvas only has the live one. */
  chapters?: readonly StoryChapterGraph[]
  achievements?: StoryAchievement[] | undefined
  personality?: StoryPersonality | undefined
  map?: StoryMapConfig | undefined
  playback?: StoryPlaybackConfig | undefined
  workId?: string | null
  readOnly: boolean
  onSaveConfig: (patch: Partial<InteractiveStoryConfig>) => Promise<void>
}) {
  const [segment, setSegment] = useState<GameplaySegmentKey>(() => {
    const initial = pendingSegment ?? 'variables'
    pendingSegment = null
    return initial
  })
  const places = useMemo(() => storyPlaces(chapters), [chapters])
  const points = useMemo(() => savePointCount(chapters), [chapters])
  const counts: Partial<Record<GameplaySegmentKey, number | string>> = {
    variables: variables.length || undefined,
    shop: shop?.items.length || undefined,
    achievements: achievements?.length || undefined,
    personality: personality?.enabled ? '开' : undefined,
    map: map?.enabled ? '开' : undefined,
    playback: extraPlaybackSpeedCount(playback) || undefined,
  }

  return (
    <div className="nori-ix-gameplay">
      <div className="nori-ix-gameplay-segments" role="tablist" aria-label="玩法设置分类">
        {SEGMENTS.map((item) => (
          <button key={item.key} type="button" role="tab" aria-selected={segment === item.key} className={segment === item.key ? 'is-on' : ''}
            onClick={() => setSegment(item.key)}>
            {item.label}
            {counts[item.key] !== undefined ? <b className="nori-ix-gameplay-count">{counts[item.key]}</b> : null}
          </button>
        ))}
      </div>
      {segment === 'variables' ? (
        <StoryVariablesEditor
          key={JSON.stringify(variables)}
          variables={variables}
          workId={workId}
          readOnly={readOnly}
          onSave={(next) => onSaveConfig({ variables: next })}
        />
      ) : null}
      {segment === 'shop' ? (
        <StoryShopEditor
          key={JSON.stringify(shop ?? null)}
          shop={shop}
          variables={variables}
          workId={workId}
          readOnly={readOnly}
          onSave={(next) => onSaveConfig({ shop: next })}
          onManageVariables={() => setSegment('variables')}
        />
      ) : null}
      {segment === 'achievements' ? (
        <StoryAchievementsEditor
          key={JSON.stringify(achievements ?? null)}
          achievements={achievements}
          places={places}
          variables={variables}
          workId={workId}
          readOnly={readOnly}
          onSave={(next) => onSaveConfig({ achievements: next })}
        />
      ) : null}
      {segment === 'personality' ? (
        <StoryPersonalityEditor
          key={JSON.stringify(personality ?? null)}
          personality={personality}
          workId={workId}
          readOnly={readOnly}
          onSave={(next) => onSaveConfig({ personality: next })}
        />
      ) : null}
      {segment === 'map' ? (
        <StoryMapEditor
          key={JSON.stringify(map ?? null)}
          map={map}
          savePointCount={points}
          readOnly={readOnly}
          onSave={(next) => onSaveConfig({ map: next })}
        />
      ) : null}
      {segment === 'playback' ? (
        <StoryPlaybackEditor
          key={JSON.stringify(playback ?? null)}
          playback={playback}
          readOnly={readOnly}
          onSave={(next) => onSaveConfig({ playback: next })}
        />
      ) : null}
    </div>
  )
}
