import type { StoryboardPanel } from '@/lib/storyboard-phases'
import type {
  EpisodeStoryboardWorkflowResult,
  EpisodeStoryboardWorkflowSegment,
} from '@/lib/novel-promotion/episode-storyboard-workflow'
import {
  extractSeedanceVideoPromptBody,
  formatSeedancePromptForEditor,
  type SeedancePromptAsset,
} from '@/lib/novel-promotion/seedance-prompt-assets'

export const EPISODE_STORYBOARD_CLIP_SOURCE = 'episode-storyboard-cinematic-v1'

export type EpisodeStoryboardClipPlan = {
  id: string
  start: number
  end: number
  duration: number
  summary: string
  location: string
  content: string
  characters: string
  props: string | null
  startText: string
  endText: string
  shotCount: number
  screenplay: string
  finalPanels: StoryboardPanel[]
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)))
}

function styleDescription(prompt: string): string {
  const match = prompt.match(/\n◈\s*画风描述\s*\n([\s\S]+)$/u)
  return match?.[1]?.trim() || '真实短剧电影质感；角色外观、场景结构、光线方向和关键道具状态保持连续。'
}

function segmentPromptAssets(segment: EpisodeStoryboardWorkflowSegment): SeedancePromptAsset[] {
  return [
    ...segment.characters.map((item) => ({ kind: 'character' as const, name: item.name })),
    { kind: 'location' as const, name: segment.location },
    ...segment.props.map((item) => ({ kind: 'prop' as const, name: item.name })),
  ]
}

function buildPanel(
  segment: EpisodeStoryboardWorkflowSegment,
  panelNumber: number,
): StoryboardPanel {
  const characterNames = segment.characters.map((item) => item.name)
  const propNames = segment.props.map((item) => item.name)
  const editorPrompt = formatSeedancePromptForEditor(
    extractSeedanceVideoPromptBody(segment.videoPrompt),
    segmentPromptAssets(segment),
  )

  return {
    panel_id: segment.segmentId,
    panel_number: panelNumber,
    description: `${segment.functionLabel}：${segment.sourceText}`,
    location: segment.location,
    source_text: segment.sourceText,
    source_anchor: {
      start: segment.sourceText,
      end: segment.sourceText,
    },
    referenced_assets: {
      characters: characterNames,
      location: segment.location,
      props: propNames,
    },
    characters: segment.characters.map((item) => ({
      name: item.name,
      ...(item.appearance ? { appearance: item.appearance } : {}),
      ...(item.appearanceId ? { appearanceId: item.appearanceId } : {}),
    })),
    props: propNames,
    scene_type: segment.functionLabel,
    visual_style: '真人短剧',
    visual_style_description: styleDescription(segment.videoPrompt),
    shot_type: '内部多镜头',
    camera_move: '按 Shot 镜头设计执行',
    image_prompt: '',
    visual_prompt: '',
    video_prompt: editorPrompt,
    continuity_notes: segment.transitionOut,
    voice_refs: [],
    duration: segment.durationSeconds,
    photographyPlan: {
      source: EPISODE_STORYBOARD_CLIP_SOURCE,
      emotionalIntent: segment.emotionalIntent,
      storyQuestion: segment.storyQuestion,
      transitionOut: segment.transitionOut,
      openingState: segment.openingState,
      endingState: segment.endingState,
      previousEndState: segment.previousEndState,
      narrativeEntry: segment.narrativeEntry,
      narrativeExit: segment.narrativeExit,
      shotBeats: segment.shotBeats,
      cameraAxis: segment.cameraAxis,
    },
    actingNotes: {
      source: EPISODE_STORYBOARD_CLIP_SOURCE,
      characters: characterNames,
    },
  }
}

/**
 * Converts the Episode -> Scene -> Segment plan into the database clip/panel
 * shape used by the normal FrameOS project workflow. One clip represents one
 * scene; each segment becomes one video-generation panel with internal Shots.
 */
export function buildEpisodeStoryboardClipPlans(input: {
  workflow: EpisodeStoryboardWorkflowResult
  createClipId: () => string
}): EpisodeStoryboardClipPlan[] {
  const segmentById = new Map(
    input.workflow.segments.map((segment) => [segment.segmentId, segment]),
  )

  return input.workflow.scenes.map((scene, sceneIndex) => {
    const segments = scene.segmentIds
      .map((segmentId) => segmentById.get(segmentId))
      .filter((segment): segment is EpisodeStoryboardWorkflowSegment => Boolean(segment))
    if (segments.length === 0) {
      throw new Error(`EPISODE_STORYBOARD_SCENE_EMPTY: ${scene.sceneId}`)
    }

    const characterNames = unique(segments.flatMap((segment) => (
      segment.characters.map((item) => item.name)
    )))
    const propNames = unique(segments.flatMap((segment) => (
      segment.props.map((item) => item.name)
    )))
    const sourceText = segments.map((segment) => segment.sourceText).join('\n')
    const clipId = input.createClipId()

    return {
      id: clipId,
      start: sceneIndex,
      end: sceneIndex + 1,
      duration: Math.max(1, Math.ceil(scene.totalDurationSeconds)),
      summary: `${scene.location} · ${segments.map((segment) => segment.functionLabel).join(' / ')}`,
      location: scene.location,
      content: segments.map((segment) => segment.videoPrompt).join('\n\n'),
      characters: JSON.stringify(characterNames),
      props: propNames.length > 0 ? JSON.stringify(propNames) : null,
      startText: segments[0].sourceText,
      endText: segments[segments.length - 1].sourceText,
      shotCount: segments.length,
      screenplay: JSON.stringify({
        version: 1,
        source: EPISODE_STORYBOARD_CLIP_SOURCE,
        sceneId: scene.sceneId,
        location: scene.location,
        sourceText,
        segments: segments.map((segment) => ({
          segmentId: segment.segmentId,
          functionLabel: segment.functionLabel,
          sourceText: segment.sourceText,
          durationSeconds: segment.durationSeconds,
          emotionalIntent: segment.emotionalIntent,
          storyQuestion: segment.storyQuestion,
          transitionOut: segment.transitionOut,
          openingState: segment.openingState,
          endingState: segment.endingState,
          previousEndState: segment.previousEndState,
          narrativeEntry: segment.narrativeEntry,
          narrativeExit: segment.narrativeExit,
          shotBeats: segment.shotBeats,
          cameraAxis: segment.cameraAxis,
          characters: segment.characters,
          props: segment.props,
        })),
      }),
      finalPanels: segments.map((segment, index) => buildPanel(segment, index + 1)),
    }
  })
}
