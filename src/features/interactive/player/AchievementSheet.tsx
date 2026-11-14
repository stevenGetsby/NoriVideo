'use client'

import { achievementConditionText, achievementRewardText } from '@/lib/interactive/achievement-text'
import { achievementProgress, cosmeticsOf, equippedLook, type StoryCosmetic, type StoryProfile } from '@/lib/interactive/achievements'
import { storyPlaces } from '@/lib/interactive/places'
import type { StoryAchievement, StoryProgram } from '@/lib/interactive/types'
import { PlayerAvatar } from './PlayerAvatar'
import { SheetShell } from './SheetShell'
import { StoryIcon } from './StoryIcon'
import './records.css'

function LockIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="5" y="10.5" width="14" height="9.5" rx="2" />
      <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
    </svg>
  )
}

function CosmeticRow({ cosmetic, part, equipped, onEquip, onUnequip }: {
  cosmetic: StoryCosmetic
  part: 'title' | 'frame'
  equipped: boolean
  onEquip: () => void
  onUnequip: () => void
}) {
  const label = part === 'title' ? cosmetic.reward.title : '头像框'
  return (
    <li className="nori-wardrobe-item" data-testid={`cosmetic-${part}`} data-cosmetic-id={cosmetic.id} data-source={cosmetic.source}>
      <span className="nori-wardrobe-swatch" aria-hidden="true">
        {part === 'frame' && cosmetic.reward.frameUrl ? <PlayerAvatar frameUrl={cosmetic.reward.frameUrl} className="is-mini" /> : <span className="nori-wardrobe-title">{label}</span>}
      </span>
      <span className="nori-wardrobe-info">
        <strong>{cosmetic.name}</strong>
        <small>{part === 'title' ? `称号「${label}」` : '头像框'}</small>
      </span>
      <button
        type="button"
        className={`nori-wardrobe-btn${equipped ? ' is-on' : ''}`}
        data-testid="equip-cosmetic"
        data-part={part}
        data-cosmetic-id={cosmetic.id}
        aria-label={`${equipped ? '取下' : '佩戴'}${part === 'title' ? `称号${label}` : '头像框'}（${cosmetic.name}）`}
        onClick={equipped ? onUnequip : onEquip}
      >
        {equipped ? '取下' : '佩戴'}
      </button>
    </li>
  )
}

/**
 * The viewer's achievements: everything the creator set up, earned or still locked, and the
 * wardrobe of titles and frames they own. Nothing here changes the run or its clock.
 */
export function AchievementSheet({ program, profile, orientation, onEquip, onClose }: {
  program: StoryProgram
  profile: StoryProfile
  orientation: 'portrait' | 'landscape'
  onEquip: (part: 'title' | 'frame', cosmeticId: string | null) => void
  onClose: () => void
}) {
  const achievements: StoryAchievement[] = program.achievements ?? []
  const earned = new Set(profile.achievements)
  const progress = achievementProgress(program, profile)
  const look = equippedLook(program, profile)
  const cosmetics = cosmeticsOf(program, profile)
  const titles = cosmetics.filter((item) => Boolean(item.reward.title))
  const frames = cosmetics.filter((item) => Boolean(item.reward.frameUrl))
  const context = { places: storyPlaces(program.chapters), variables: program.variables }
  const equippedTitle = titles.find((item) => item.id === profile.equipped.title) ?? null
  const equippedFrame = frames.find((item) => item.id === profile.equipped.frame) ?? null

  return (
    <SheetShell
      title="成就与装扮"
      orientation={orientation}
      testId="achievements-sheet"
      ariaLabel="成就"
      onClose={onClose}
      head={(
        <span className="nori-records-progress" data-testid="achievement-progress">{progress.earned}/{progress.total}</span>
      )}
    >
      <div className={`nori-records-body is-${orientation}`}>
        <section className="nori-achievement-hero" data-testid="achievement-hero">
          <PlayerAvatar frameUrl={look.frameUrl} className="is-hero" />
          <div className="nori-achievement-hero-text">
            <strong data-testid="achievement-hero-name">我的成就</strong>
            <span>{look.title ? `称号「${look.title}」` : '还没有佩戴称号'}</span>
            <small>已达成 {progress.earned} / {progress.total}</small>
          </div>
        </section>

        <section className="nori-records-section" aria-label="成就列表">
          <h4>成就</h4>
          {achievements.length === 0 ? <p className="nori-records-empty">这部影游还没有设置成就。</p> : (
            <ul className="nori-achievement-list">
              {achievements.map((item) => {
                const isEarned = earned.has(item.id)
                return (
                  <li key={item.id} className={`nori-achievement-item${isEarned ? ' is-earned' : ' is-locked'}`}
                    data-testid="achievement-item" data-achievement-id={item.id} data-earned={isEarned ? 'true' : 'false'}>
                    <span className="nori-achievement-icon" aria-hidden="true">
                      {item.icon ? <StoryIcon icon={item.icon} /> : isEarned ? <strong>{item.name.trim().slice(0, 1) || '成'}</strong> : <LockIcon />}
                    </span>
                    <div className="nori-achievement-info">
                      <strong>{item.name || '未命名成就'}</strong>
                      <p>{item.description || achievementConditionText(item.condition, context)}</p>
                      <em>{achievementRewardText(item.reward)}</em>
                    </div>
                    <span className={`nori-achievement-state${isEarned ? ' is-earned' : ''}`}>{isEarned ? '已达成' : '未达成'}</span>
                  </li>
                )
              })}
            </ul>
          )}
        </section>

        <section className="nori-records-section" aria-label="我的装扮">
          <h4>我的装扮</h4>
          {cosmetics.length === 0 ? <p className="nori-records-empty">还没有获得称号或头像框。</p> : (
            <>
              <div className="nori-wardrobe-group">
                <h5>头像框 {equippedFrame ? <button type="button" className="nori-wardrobe-unequip" data-testid="unequip-frame" onClick={() => onEquip('frame', null)}>取下</button> : null}</h5>
                {frames.length === 0 ? <p className="nori-records-empty">还没有头像框。</p> : (
                  <ul className="nori-wardrobe-list">
                    {frames.map((item) => (
                      <CosmeticRow key={item.id} cosmetic={item} part="frame" equipped={profile.equipped.frame === item.id}
                        onEquip={() => onEquip('frame', item.id)} onUnequip={() => onEquip('frame', null)} />
                    ))}
                  </ul>
                )}
              </div>
              <div className="nori-wardrobe-group">
                <h5>称号 {equippedTitle ? <button type="button" className="nori-wardrobe-unequip" data-testid="unequip-title" onClick={() => onEquip('title', null)}>取下</button> : null}</h5>
                {titles.length === 0 ? <p className="nori-records-empty">还没有称号。</p> : (
                  <ul className="nori-wardrobe-list">
                    {titles.map((item) => (
                      <CosmeticRow key={item.id} cosmetic={item} part="title" equipped={profile.equipped.title === item.id}
                        onEquip={() => onEquip('title', item.id)} onUnequip={() => onEquip('title', null)} />
                    ))}
                  </ul>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </SheetShell>
  )
}
