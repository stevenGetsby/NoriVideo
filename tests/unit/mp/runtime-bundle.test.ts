import { existsSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import vm from 'node:vm'
import { describe, expect, it } from 'vitest'

const bundlePath = path.resolve(process.cwd(), 'miniprogram/miniprogram/runtime/story-runtime.js')
const BUILD_HINT = '先运行 npm --prefix miniprogram run build:runtime'

// Every value export re-exported by src/lib/mp/runtime-entry.ts (F.2). Type-only exports are erased
// by the bundler and intentionally absent here.
const EXPECTED_EXPORTS = [
  // engine
  'startRun', 'advanceRun', 'resolveBeat', 'purchaseShopItem', 'isRunFinished', 'visibleOptions', 'permanentValues', 'isPermanentVariable',
  // interaction
  'STORY_BEAT_MAX_SEC', 'STORY_CHOICE_COUNTDOWNS', 'STORY_DURING_LABEL', 'STORY_INTERACTION_DEFAULT_HINT', 'STORY_INTERACTION_LABEL',
  'STORY_MOUNTED_CHOICE_MAX_OPTIONS', 'STORY_RETRY_REWIND_SEC', 'STORY_SLOW_RATE', 'STORY_SWIPE_LABEL', 'beatWindowsOverlap',
  'defaultBeatDuration', 'hasRandomResults', 'isInteractionKind', 'judgeTap', 'beatResult', 'choiceOptionParts', 'clampBeatStart',
  'defaultInteractionData', 'dueBeat', 'firstFreeBeatStart', 'holdProgress', 'interactionHandleLabel', 'interactionHandles',
  'interactionTimeoutHandle', 'judgeHold', 'judgeSwipe', 'judgeTiming', 'readChoiceOptions', 'readChoicePresentation', 'readCutWhen',
  'readInteractionData', 'readOptionUnlock', 'readResultConfig', 'resolveChoiceLayout', 'resolveRandomHandle', 'retargetHandleMap',
  'retargetInteractionData', 'swipeDirectionOf', 'timingPointer',
  // saves
  'STORY_CHECKPOINT_LIMIT', 'STORY_SAVE_SLOTS', 'emptySaves', 'savesEnabled', 'withAutoSave', 'observeCheckpoint', 'readSaves',
  'readSnapshot', 'restoreRun', 'snapshotLabel', 'snapshotRun', 'storyMap', 'withCheckpoint', 'withManualSave', 'withoutManualSave',
  // achievements
  'achievementProgress', 'emptyProfile', 'endingAchievementOf', 'endingKeys', 'reachKey', 'cosmeticsOf', 'equipCosmetic', 'equippedLook',
  'observeRun', 'readProfile', 'recordShopReward', 'toggleEndingAchievement',
  // achievement-text
  'COMPARE_PHRASES', 'valueText', 'achievementConditionText', 'achievementRewardText',
  // personality
  'STORY_PERSONALITY_DEFAULTS', 'STORY_PERSONALITY_TYPES', 'isPersonalityType', 'personalityOutcome', 'personalityResultFor',
  'personalityView', 'readPersonalityTags', 'tallyPersonality',
  // playback
  'normalizeSpeed', 'speedLabel', 'beatPlaybackRate', 'nextSpeed', 'playbackSpeeds',
  // hotspot
  'hotspotZonesOverlap', 'dragHotspotZone', 'hotspotAt', 'mediaContainBox', 'unrotateHotspotPoint',
  // places
  'STORY_UNNAMED_ENDING', 'STORY_UNNAMED_SEGMENT', 'placeLabel', 'findPlace', 'storyPlaces',
  // scene-text
  'SCENE_TEXT_MAX', 'SCENE_TEXT_MAX_ROWS', 'SCENE_TEXT_MIN_ROWS', 'SCENE_TEXT_WRAP_AT', 'clampSceneText', 'fitSceneTextRows',
  'normalizeSceneText', 'sceneTextLength', 'sceneTextMetrics',
  // beat-scheduler
  'NO_FIRED_BEATS', 'applyBeatOutcome', 'beatEndAction', 'countdownPercent', 'createResolutionGate', 'elapsedSec', 'isCountdownExpired',
  'markBeatFired', 'nextAttempt', 'remainingSec', 'unfireBeatsFrom',
  // interaction-sessions
  'SWIPE_MIN_DISTANCE', 'identityDirection', 'initialHoldSession', 'initialTapSession', 'beatHint', 'heldSecOf', 'holdFrameAt',
  'holdRelease', 'holdStart', 'holdStop', 'holdTimeout', 'judgeTimingFrame', 'registerTap', 'swipeDeltaOf', 'swipeMoveTo', 'swipeStart',
  'tapHandle', 'tapPercent', 'timingFrameAt', 'timingTapAt',
  // locked-choice
  'lockedOptionPress',
  // records
  'ACHIEVEMENT_TOAST_MS', 'hasRewardShopItems', 'recordsEnabled', 'autoSaveFor', 'checkpointFor', 'enqueueToasts', 'hasStoredRecords',
  'recordsStorageKey', 'saveTimeText',
  // viewer-store
  'PROFILE_STORAGE_PREFIX', 'SAVES_STORAGE_PREFIX', 'profileStorageKey', 'savesStorageKey', 'clearStoredProfile', 'clearStoredSaves',
  'readStoredProfile', 'readStoredSaves', 'writeStoredProfile', 'writeStoredSaves',
  // permanent-store
  'PERMANENT_STORAGE_PREFIX', 'permanentStorageKey', 'readPermanentValues', 'writePermanentValues', 'clearPermanentValues',
  // save-merge
  'mergeSaveState', 'normalizeSaveState',
]

function loadBundle(): Record<string, unknown> {
  if (!existsSync(bundlePath)) throw new Error(BUILD_HINT)
  const code = readFileSync(bundlePath, 'utf8')
  const mod = { exports: {} as Record<string, unknown> }
  const sandbox: Record<string, unknown> = { module: mod, exports: mod.exports, console }
  vm.runInNewContext(code, sandbox, { filename: 'story-runtime.js' })
  // The sandbox must stay DOM-free: only module, exports, console were provided.
  expect(vm.runInNewContext('typeof window', sandbox)).toBe('undefined')
  expect(vm.runInNewContext('typeof document', sandbox)).toBe('undefined')
  expect(vm.runInNewContext('typeof performance', sandbox)).toBe('undefined')
  return mod.exports
}

describe('runtime bundle (F.2)', () => {
  it('loads in a DOM-free sandbox and exposes every F.2 export', () => {
    const api = loadBundle()
    for (const name of EXPECTED_EXPORTS) {
      expect(api[name], `missing export ${name}`).not.toBeUndefined()
    }
  })

  it('engine entry points are callable functions', () => {
    const api = loadBundle()
    for (const name of ['startRun', 'advanceRun', 'resolveBeat', 'purchaseShopItem', 'isRunFinished', 'visibleOptions']) {
      expect(typeof api[name]).toBe('function')
    }
  })

  it('contains no DOM/browser/react references in source text', () => {
    if (!existsSync(bundlePath)) throw new Error(BUILD_HINT)
    const code = readFileSync(bundlePath, 'utf8')
    for (const token of ['document.', 'window.', 'localStorage', 'HTMLVideoElement', 'react']) {
      expect(code.includes(token), `bundle contains forbidden token ${token}`).toBe(false)
    }
  })

  it('is at most 300KB', () => {
    if (!existsSync(bundlePath)) throw new Error(BUILD_HINT)
    expect(statSync(bundlePath).size).toBeLessThanOrEqual(300 * 1024)
  })
})
