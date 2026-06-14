#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()

const CANARY_FILES = {
  clips: 'standards/prompt-canary/story_to_script_clips.canary.json',
  episodeSplit: 'standards/prompt-canary/episode_split.canary.json',
  screenplay: 'standards/prompt-canary/screenplay_conversion.canary.json',
  frameosScreenwriter: 'standards/prompt-canary/frameos_screenwriter.canary.json',
  frameosAssets: 'standards/prompt-canary/frameos_assets.canary.json',
  voiceMapping: 'standards/prompt-canary/voice_mapping.canary.json',
  storyboardPanels: 'standards/prompt-canary/storyboard_panels.canary.json',
  voiceAnalysis: 'standards/prompt-canary/voice_analysis.canary.json',
  exportPreflight: 'standards/prompt-canary/export_preflight.canary.json',
}

const TEMPLATE_TOKEN_REQUIREMENTS = {
  'novel-promotion/agent_clip': [
    'start',
    'end',
    'summary',
    'source_anchor',
    'info_points',
    'reasoning',
    'adaptation_decision',
    'production_function',
    'self_review',
    'location',
    'characters',
    'props',
  ],
  'novel-promotion/episode_split': [
    'status',
    'steps',
    'default_visual_style',
    'script_kilo',
    'adapted_kilo',
    'items',
    'analysis',
    'validation',
    'episode_id',
    'episode_number',
    'content',
    'startMarker',
    'endMarker',
    'content_kilo',
    'source_anchor',
    'info_points',
    'reasoning',
    'diagnosis',
    'key_decisions',
    'scenes',
    'scene_id',
    'visual_style_description',
    'visual_style_confirmed',
  ],
  'novel-promotion/screenplay_conversion': [
    'clip_id',
    'original_text',
    'status',
    'steps',
    'script_kilo',
    'strategy_thinking',
    'style_reasoning',
    'default_visual_style',
    'worlds',
    'world_label',
    'world_background',
    'representative_frame',
    'selected_style_anchor',
    'preview_materials',
    'project_production_context',
    'scenes',
    'heading',
    'content',
    'type',
    'action',
    'dialogue',
    'voiceover',
  ],
  'novel-promotion/agent_character_profile': [
    'status',
    'extraction_status',
    'has_deprecated_characters',
    'role_type',
    'description',
    'identity_lock',
    'coverage_scenes',
    'coverage_episodes',
    'prompt',
    'variants',
    'speech_rate',
    'audition_status',
    'design_image',
  ],
  'novel-promotion/agent_character_visual': [
    'identity_lock',
    'expected_appearances',
    'coverage_scenes',
    'coverage_episodes',
    'variants',
    'variant_id',
    'variant_type',
    'prompt',
    'design_image',
    'voice_trait',
    'representative_line',
    'voice_audition_prompt',
    'appearances',
    'change_reason',
    'descriptions',
  ],
  'novel-promotion/agent_storyboard_plan': [
    'panel_id',
    'panel_number',
    'description',
    'characters',
    'location',
    'props',
    'scene_type',
    'visual_style',
    'visual_style_description',
    'project_production_context',
    'source_text',
    'source_anchor',
    'referenced_assets',
    'image_prompt',
    'visual_prompt',
    'visual subject',
    'start/end state',
    'lip-sync',
    'continuity_notes',
    'voice_refs',
  ],
  'novel-promotion/agent_storyboard_detail': [
    'panel_id',
    'panel_number',
    'description',
    'characters',
    'location',
    'props',
    'scene_type',
    'visual_style',
    'visual_style_description',
    'source_text',
    'source_anchor',
    'referenced_assets',
    'shot_type',
    'camera_move',
    'image_prompt',
    'visual_prompt',
    'video_prompt',
    'visual subject',
    'start/end state',
    'lip-sync',
    'continuity_notes',
    'voice_refs',
    'duration',
  ],
  'novel-promotion/agent_storyboard_insert': [
    'panel_id',
    'panel_number',
    'description',
    'characters',
    'location',
    'props',
    'scene_type',
    'visual_style',
    'visual_style_description',
    'source_text',
    'source_anchor',
    'referenced_assets',
    'shot_type',
    'camera_move',
    'image_prompt',
    'visual_prompt',
    'video_prompt',
    'visual subject',
    'start/end state',
    'voice_refs',
    'continuity_notes',
    'duration',
  ],
  'novel-promotion/agent_acting_direction': [
    'panel_number',
    'characters',
    'name',
    'acting',
    'source_text',
    'source_anchor',
    'referenced_assets',
    'video_prompt',
    'continuity_notes',
    'voice_refs',
    'dialogue_state',
    'lip_sync',
  ],
  'novel-promotion/agent_cinematographer': [
    'panel_number',
    'scene_summary',
    'composition',
    'lighting',
    'color_palette',
    'atmosphere',
    'technical_notes',
    'characters',
    'screen_position',
    'posture',
    'facing',
    'depth_of_field',
    'color_tone',
    'referenced_assets',
    'image_prompt',
    'visual_prompt',
    'video_prompt',
    'source_text',
    'source_anchor',
    'continuity_notes',
    'voice_refs',
    'visual_style',
    'visual_style_description',
  ],
  'novel-promotion/voice_analysis': [
    'lineIndex',
    'speaker',
    'content',
    'emotionStrength',
    'matchedPanel',
    'storyboardId',
    'panelIndex',
    'source_text',
    'source_anchor',
    'referenced_assets',
    'voice_refs',
    'video_prompt',
    'continuity_notes',
    'dialogue_state',
    'lip_sync',
  ],
  'novel-promotion/voice_mapping': [
    'status',
    'voice_mapping',
    'character',
    'character_id',
    'role_type',
    'voice_profile',
    'gender',
    'age_range',
    'traits',
    'voice_source',
    'custom_upload',
    'voice_raw_file',
    'candidates',
    'rank',
    'voice_id',
    'voice_name',
    'reason',
    'is_selected',
    'reference_audio_id',
    'auditions',
    'audition_id',
    'prompt',
  ],
  'novel-promotion/image_prompt_modify': [
    'panel_context_json',
    'referenced_assets_json',
    'image_prompt',
    'visual_prompt',
    'video_prompt',
    'referenced_assets',
    'characters',
    'location',
    'props',
    'continuity_notes',
    'change_summary',
    'no_visible_text',
  ],
  'novel-promotion/export_preflight_review': [
    'status',
    'readiness',
    'issues',
    'deliverables',
    'next_actions',
    'priority',
    'evidence',
    'blocking_reason',
    'source_anchor',
    'referenced_assets',
    'visual_prompt',
    'imagePrompt',
    'continuity_notes',
    'voice_refs',
    'coverage_scenes',
    'coverage_episodes',
    'missing_image',
    'missing_video',
    'missing_reference',
    'missing_prompt',
    'duration_risk',
    'voice_gap',
    'continuity_gap',
    'manifest_gap',
  ],
  'novel-promotion/single_panel_image': [
    'referenced_assets',
    'image_prompt',
    'visual_prompt',
    'video_prompt',
    'source_text',
    'source_anchor',
    'continuity_notes',
    'voice_refs',
    'visual_style',
    'visual_style_description',
  ],
  'novel-promotion/agent_shot_variant_generate': [
    'referenced_assets',
    'image_prompt',
    'visual_prompt',
    'video_prompt',
    'source_text',
    'source_anchor',
    'continuity_notes',
    'voice_refs',
    'visual_style',
    'visual_style_description',
  ],
  'novel-promotion/agent_shot_variant_analysis': [
    'panel_context_json',
    'source_text',
    'source_anchor',
    'referenced_assets',
    'image_prompt',
    'visual_prompt',
    'video_prompt',
    'image_prompt',
    'visual_prompt',
    'continuity_notes',
    'referenced_assets',
    'voice_refs',
    'visual_style',
    'visual_style_description',
    'shot_type',
    'camera_move',
    'creative_score',
  ],
  'novel-promotion/ai_story_expand': [
    'source_text',
    'episode_split',
    'screenplay_conversion',
    'asset extraction',
    'storyboard generation',
    'voice_refs',
    'export preflight review',
    'characters',
    'location',
    'props',
  ],
  'novel-promotion/storyboard_edit': [
    'panel_context_json',
    'referenced_assets_json',
    'source_image_context',
    'panel_id',
    'referenced_assets',
    'source_text',
    'source_anchor',
    'image_prompt',
    'visual_prompt',
    'video_prompt',
    'continuity_notes',
    'voice_refs',
    'visual_style',
    'visual_style_description',
    'shot_type',
    'camera_move',
    'duration',
  ],
  'novel-promotion/select_location': [
    'status',
    'extraction_status',
    'has_deprecated_environments',
    'environments',
    'environment_id',
    'int_ext',
    'summary',
    'description',
    'background',
    'entrance',
    'mood',
    'base_ambience',
    'coverage_scenes',
    'coverage_episodes',
    'prompt',
    'variants',
    'design_image',
    'available_slots',
    'descriptions',
  ],
  'novel-promotion/select_prop': [
    'status',
    'extraction_status',
    'has_deprecated_items',
    'items',
    'item_id',
    'item_type',
    'summary',
    'description',
    'background',
    'significance',
    'coverage_scenes',
    'coverage_episodes',
    'prompt',
    'variants',
    'design_image',
  ],
  'novel-promotion/character_create': [
    'prompt',
    'identity_lock',
    'coverage_scenes',
    'coverage_episodes',
    'variants',
    'design_image',
  ],
  'novel-promotion/character_modify': [
    'prompt',
    'identity_lock',
    'coverage_scenes',
    'coverage_episodes',
    'variants',
    'design_image',
  ],
  'novel-promotion/character_description_update': [
    'prompt',
    'identity_lock',
    'coverage_scenes',
    'coverage_episodes',
    'variants',
    'design_image',
  ],
  'novel-promotion/character_regenerate': [
    'descriptions',
    'identity_lock',
    'coverage_scenes',
    'coverage_episodes',
    'variants',
    'design_image',
  ],
  'novel-promotion/location_create': [
    'prompt',
    'available_slots',
    'summary',
    'description',
    'background',
    'entrance',
    'mood',
    'base_ambience',
    'coverage_scenes',
    'coverage_episodes',
    'variants',
    'environment_id',
    'design_image',
  ],
  'novel-promotion/location_modify': [
    'prompt',
    'available_slots',
    'summary',
    'description',
    'background',
    'entrance',
    'mood',
    'base_ambience',
    'coverage_scenes',
    'coverage_episodes',
    'variants',
    'environment_id',
    'design_image',
  ],
  'novel-promotion/location_description_update': [
    'prompt',
    'available_slots',
    'summary',
    'description',
    'background',
    'entrance',
    'mood',
    'base_ambience',
    'coverage_scenes',
    'coverage_episodes',
    'variants',
    'environment_id',
    'design_image',
  ],
  'novel-promotion/location_regenerate': [
    'descriptions',
    'available_slots',
    'summary',
    'description',
    'background',
    'entrance',
    'mood',
    'base_ambience',
    'coverage_scenes',
    'coverage_episodes',
    'variants',
    'environment_id',
    'design_image',
  ],
  'novel-promotion/prop_description_update': [
    'prompt',
    'item_type',
    'coverage_scenes',
    'coverage_episodes',
    'variants',
    'item_id',
    'design_image',
    'significance',
  ],
}

function fail(title, details = []) {
  console.error(`\n[prompt-json-canary-guard] ${title}`)
  for (const line of details) {
    console.error(`  - ${line}`)
  }
  process.exit(1)
}

function isRecord(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

function isString(value) {
  return typeof value === 'string'
}

function isNumber(value) {
  return typeof value === 'number' && Number.isFinite(value)
}

function isBoolean(value) {
  return typeof value === 'boolean'
}

function isStringArray(value) {
  return Array.isArray(value) && value.every((item) => isString(item))
}

function requireRecordFields(record, fields, prefix) {
  for (const field of fields) {
    if (!(field in record)) return `${prefix}.${field} is missing`
  }
  return null
}

function readJson(relativePath) {
  const fullPath = path.join(root, relativePath)
  if (!fs.existsSync(fullPath)) {
    fail('Missing canary fixture', [relativePath])
  }
  try {
    return JSON.parse(fs.readFileSync(fullPath, 'utf8'))
  } catch (error) {
    fail('Invalid canary fixture JSON', [`${relativePath}: ${error instanceof Error ? error.message : String(error)}`])
  }
}

function validateClipCanary(value) {
  if (!Array.isArray(value) || value.length === 0) return 'clips fixture must be a non-empty array'
  for (let i = 0; i < value.length; i += 1) {
    const row = value[i]
    if (!isRecord(row)) return `clips[${i}] must be an object`
    if (!isString(row.start) || row.start.length < 5) return `clips[${i}].start must be string length >= 5`
    if (!isString(row.end) || row.end.length < 5) return `clips[${i}].end must be string length >= 5`
    if (!isString(row.summary) || row.summary.length === 0) return `clips[${i}].summary must be non-empty string`
    if (!isString(row.source_anchor) || row.source_anchor.length === 0) return `clips[${i}].source_anchor must be non-empty string`
    if (!isStringArray(row.info_points)) return `clips[${i}].info_points must be string array`
    if (!isRecord(row.reasoning)) return `clips[${i}].reasoning must be object`
    if (!isString(row.reasoning.adaptation_decision)) return `clips[${i}].reasoning.adaptation_decision must be string`
    if (!isString(row.reasoning.production_function)) return `clips[${i}].reasoning.production_function must be string`
    if (!isString(row.reasoning.self_review)) return `clips[${i}].reasoning.self_review must be string`
    if (!(row.location === null || isString(row.location))) return `clips[${i}].location must be string or null`
    if (!Array.isArray(row.characters) || !row.characters.every((item) => isString(item))) {
      return `clips[${i}].characters must be string array`
    }
    if (!isStringArray(row.props)) return `clips[${i}].props must be string array`
  }
  return null
}

function validateEpisodeSplitCanary(value) {
  if (!isRecord(value)) return 'episodeSplit fixture must be an object'
  const topErr = requireRecordFields(value, [
    'status',
    'steps',
    'default_visual_style',
    'script_kilo',
    'adapted_kilo',
    'analysis',
    'items',
    'validation',
  ], 'episodeSplit')
  if (topErr) return topErr
  if (!isString(value.status)) return 'episodeSplit.status must be string'
  if (!Array.isArray(value.steps) || value.steps.length === 0) return 'episodeSplit.steps must be non-empty array'
  if (!(value.default_visual_style === null || isRecord(value.default_visual_style))) {
    return 'episodeSplit.default_visual_style must be object or null'
  }
  if (!isNumber(value.script_kilo)) return 'episodeSplit.script_kilo must be number'
  if (!isNumber(value.adapted_kilo)) return 'episodeSplit.adapted_kilo must be number'
  if (!isRecord(value.analysis)) return 'episodeSplit.analysis must be object'
  for (const field of ['totalWords', 'episodeCount', 'targetWordsPerEpisode']) {
    if (!isNumber(value.analysis[field])) return `episodeSplit.analysis.${field} must be number`
  }
  if (!isString(value.analysis.allowedRange)) return 'episodeSplit.analysis.allowedRange must be string'

  if (!Array.isArray(value.items) || value.items.length === 0) return 'episodeSplit.items must be non-empty array'
  for (let i = 0; i < value.items.length; i += 1) {
    const item = value.items[i]
    if (!isRecord(item)) return `episodeSplit.items[${i}] must be object`
    const itemErr = requireRecordFields(item, [
      'number',
      'episode_id',
      'episode_number',
      'title',
      'summary',
      'content',
      'estimatedWords',
      'content_kilo',
      'startMarker',
      'endMarker',
      'source_anchor',
      'info_points',
      'reasoning',
      'status',
      'scenes',
    ], `episodeSplit.items[${i}]`)
    if (itemErr) return itemErr
    if (!isNumber(item.number)) return `episodeSplit.items[${i}].number must be number`
    if (!isString(item.episode_id)) return `episodeSplit.items[${i}].episode_id must be string`
    if (!isNumber(item.episode_number)) return `episodeSplit.items[${i}].episode_number must be number`
    for (const field of ['title', 'summary', 'content', 'startMarker', 'endMarker', 'info_points', 'status']) {
      if (!isString(item[field])) return `episodeSplit.items[${i}].${field} must be string`
    }
    if (!isNumber(item.estimatedWords)) return `episodeSplit.items[${i}].estimatedWords must be number`
    if (!isNumber(item.content_kilo)) return `episodeSplit.items[${i}].content_kilo must be number`
    if (!isRecord(item.source_anchor)) return `episodeSplit.items[${i}].source_anchor must be object`
    if (!isString(item.source_anchor.start) || !isString(item.source_anchor.end)) {
      return `episodeSplit.items[${i}].source_anchor.start/end must be string`
    }
    if (!isRecord(item.reasoning)) return `episodeSplit.items[${i}].reasoning must be object`
    if (!isString(item.reasoning.diagnosis)) return `episodeSplit.items[${i}].reasoning.diagnosis must be string`
    if (!isStringArray(item.reasoning.key_decisions)) {
      return `episodeSplit.items[${i}].reasoning.key_decisions must be string array`
    }
    if (!Array.isArray(item.scenes) || item.scenes.length === 0) return `episodeSplit.items[${i}].scenes must be non-empty array`
    for (let j = 0; j < item.scenes.length; j += 1) {
      const scene = item.scenes[j]
      if (!isRecord(scene)) return `episodeSplit.items[${i}].scenes[${j}] must be object`
      const sceneErr = requireRecordFields(scene, [
        'scene_id',
        'scene_number',
        'heading',
        'int_ext',
        'location',
        'time',
        'summary',
        'content',
        'content_kilo',
        'characters',
        'visual_style',
        'visual_style_description',
        'visual_style_confirmed',
      ], `episodeSplit.items[${i}].scenes[${j}]`)
      if (sceneErr) return sceneErr
      if (!isString(scene.scene_id)) return `episodeSplit.items[${i}].scenes[${j}].scene_id must be string`
      if (!isNumber(scene.scene_number)) return `episodeSplit.items[${i}].scenes[${j}].scene_number must be number`
      for (const field of ['heading', 'int_ext', 'location', 'time', 'summary', 'content', 'characters', 'visual_style', 'visual_style_description']) {
        if (!isString(scene[field])) return `episodeSplit.items[${i}].scenes[${j}].${field} must be string`
      }
      if (!isNumber(scene.content_kilo)) return `episodeSplit.items[${i}].scenes[${j}].content_kilo must be number`
      if (!isBoolean(scene.visual_style_confirmed)) {
        return `episodeSplit.items[${i}].scenes[${j}].visual_style_confirmed must be boolean`
      }
    }
  }

  if (!isRecord(value.validation)) return 'episodeSplit.validation must be object'
  for (const field of ['maxWords', 'minWords', 'variance']) {
    if (!isNumber(value.validation[field])) return `episodeSplit.validation.${field} must be number`
  }
  if (!isBoolean(value.validation.isBalanced)) return 'episodeSplit.validation.isBalanced must be boolean'

  return null
}

function validateScreenplayCanary(value) {
  if (!isRecord(value)) return 'screenplay fixture must be an object'
  if (!isString(value.clip_id) || !value.clip_id) return 'screenplay.clip_id must be non-empty string'
  if (!isString(value.original_text)) return 'screenplay.original_text must be string'
  if (!Array.isArray(value.scenes) || value.scenes.length === 0) return 'screenplay.scenes must be non-empty array'

  for (let i = 0; i < value.scenes.length; i += 1) {
    const scene = value.scenes[i]
    if (!isRecord(scene)) return `screenplay.scenes[${i}] must be object`
    if (!isNumber(scene.scene_number)) return `screenplay.scenes[${i}].scene_number must be number`
    if (!isRecord(scene.heading)) return `screenplay.scenes[${i}].heading must be object`
    if (!isString(scene.heading.int_ext)) return `screenplay.scenes[${i}].heading.int_ext must be string`
    if (!isString(scene.heading.location)) return `screenplay.scenes[${i}].heading.location must be string`
    if (!isString(scene.heading.time)) return `screenplay.scenes[${i}].heading.time must be string`
    if (!isString(scene.description)) return `screenplay.scenes[${i}].description must be string`
    if (!Array.isArray(scene.characters) || !scene.characters.every((item) => isString(item))) {
      return `screenplay.scenes[${i}].characters must be string array`
    }
    if (!Array.isArray(scene.content) || scene.content.length === 0) return `screenplay.scenes[${i}].content must be non-empty array`

    for (let j = 0; j < scene.content.length; j += 1) {
      const segment = scene.content[j]
      if (!isRecord(segment)) return `screenplay.scenes[${i}].content[${j}] must be object`
      if (!isString(segment.type)) return `screenplay.scenes[${i}].content[${j}].type must be string`
      if (segment.type === 'action') {
        if (!isString(segment.text)) return `screenplay action[${i}:${j}].text must be string`
      } else if (segment.type === 'dialogue') {
        if (!isString(segment.character)) return `screenplay dialogue[${i}:${j}].character must be string`
        if (!isString(segment.lines)) return `screenplay dialogue[${i}:${j}].lines must be string`
        if (segment.parenthetical !== undefined && !isString(segment.parenthetical)) {
          return `screenplay dialogue[${i}:${j}].parenthetical must be string when present`
        }
      } else if (segment.type === 'voiceover') {
        if (!isString(segment.text)) return `screenplay voiceover[${i}:${j}].text must be string`
        if (segment.character !== undefined && !isString(segment.character)) {
          return `screenplay voiceover[${i}:${j}].character must be string when present`
        }
      } else {
        return `screenplay.scenes[${i}].content[${j}].type must be action/dialogue/voiceover`
      }
    }
  }

  return null
}

function validateFrameosScreenwriterCanary(value) {
  if (!isRecord(value)) return 'frameos screenwriter fixture must be an object'
  const topErr = requireRecordFields(value, [
    'status',
    'steps',
    'default_visual_style',
    'script_kilo',
    'adapted_kilo',
    'items',
    'art_direction',
  ], 'frameosScreenwriter')
  if (topErr) return topErr
  if (!isString(value.status)) return 'frameosScreenwriter.status must be string'
  if (!isNumber(value.script_kilo)) return 'frameosScreenwriter.script_kilo must be number'
  if (!isNumber(value.adapted_kilo)) return 'frameosScreenwriter.adapted_kilo must be number'
  if (!(value.default_visual_style === null || isRecord(value.default_visual_style))) {
    return 'frameosScreenwriter.default_visual_style must be object or null'
  }
  if (!Array.isArray(value.steps) || value.steps.length === 0) return 'frameosScreenwriter.steps must be non-empty array'
  for (let i = 0; i < value.steps.length; i += 1) {
    const step = value.steps[i]
    if (!isRecord(step)) return `frameosScreenwriter.steps[${i}] must be object`
    if (!isNumber(step.step)) return `frameosScreenwriter.steps[${i}].step must be number`
    if (!isString(step.name)) return `frameosScreenwriter.steps[${i}].name must be string`
    if (!isString(step.status)) return `frameosScreenwriter.steps[${i}].status must be string`
    if (!isString(step.time)) return `frameosScreenwriter.steps[${i}].time must be string`
  }

  if (!Array.isArray(value.items) || value.items.length === 0) return 'frameosScreenwriter.items must be non-empty array'
  for (let i = 0; i < value.items.length; i += 1) {
    const item = value.items[i]
    if (!isRecord(item)) return `frameosScreenwriter.items[${i}] must be object`
    const itemErr = requireRecordFields(item, [
      'episode_id',
      'episode_number',
      'title',
      'content',
      'content_kilo',
      'info_points',
      'source_anchor',
      'reasoning',
      'status',
      'scenes',
    ], `frameosScreenwriter.items[${i}]`)
    if (itemErr) return itemErr
    if (!isString(item.episode_id)) return `frameosScreenwriter.items[${i}].episode_id must be string`
    if (!isNumber(item.episode_number)) return `frameosScreenwriter.items[${i}].episode_number must be number`
    if (!isString(item.title)) return `frameosScreenwriter.items[${i}].title must be string`
    if (!isString(item.content)) return `frameosScreenwriter.items[${i}].content must be string`
    if (!isNumber(item.content_kilo)) return `frameosScreenwriter.items[${i}].content_kilo must be number`
    if (!isString(item.info_points)) return `frameosScreenwriter.items[${i}].info_points must be string`
    if (!isRecord(item.source_anchor)) return `frameosScreenwriter.items[${i}].source_anchor must be object`
    if (!isString(item.source_anchor.start) || !isString(item.source_anchor.end)) {
      return `frameosScreenwriter.items[${i}].source_anchor.start/end must be string`
    }
    if (!isRecord(item.reasoning)) return `frameosScreenwriter.items[${i}].reasoning must be object`
    if (!isString(item.reasoning.diagnosis)) return `frameosScreenwriter.items[${i}].reasoning.diagnosis must be string`
    if (!isStringArray(item.reasoning.key_decisions)) {
      return `frameosScreenwriter.items[${i}].reasoning.key_decisions must be string array`
    }
    if (!isString(item.status)) return `frameosScreenwriter.items[${i}].status must be string`
    if (!Array.isArray(item.scenes) || item.scenes.length === 0) {
      return `frameosScreenwriter.items[${i}].scenes must be non-empty array`
    }
    for (let j = 0; j < item.scenes.length; j += 1) {
      const scene = item.scenes[j]
      if (!isRecord(scene)) return `frameosScreenwriter.items[${i}].scenes[${j}] must be object`
      const sceneErr = requireRecordFields(scene, [
        'scene_id',
        'scene_number',
        'heading',
        'int_ext',
        'location',
        'time',
        'summary',
        'content',
        'content_kilo',
        'characters',
        'visual_style',
        'visual_style_description',
        'visual_style_confirmed',
      ], `frameosScreenwriter.items[${i}].scenes[${j}]`)
      if (sceneErr) return sceneErr
      if (!isString(scene.scene_id)) return `frameosScreenwriter.items[${i}].scenes[${j}].scene_id must be string`
      if (!isNumber(scene.scene_number)) return `frameosScreenwriter.items[${i}].scenes[${j}].scene_number must be number`
      if (!isString(scene.heading)) return `frameosScreenwriter.items[${i}].scenes[${j}].heading must be string`
      if (!isString(scene.int_ext)) return `frameosScreenwriter.items[${i}].scenes[${j}].int_ext must be string`
      if (!isString(scene.location)) return `frameosScreenwriter.items[${i}].scenes[${j}].location must be string`
      if (!isString(scene.time)) return `frameosScreenwriter.items[${i}].scenes[${j}].time must be string`
      if (!isString(scene.summary)) return `frameosScreenwriter.items[${i}].scenes[${j}].summary must be string`
      if (!isString(scene.content)) return `frameosScreenwriter.items[${i}].scenes[${j}].content must be string`
      if (!isNumber(scene.content_kilo)) return `frameosScreenwriter.items[${i}].scenes[${j}].content_kilo must be number`
      if (!isString(scene.characters)) return `frameosScreenwriter.items[${i}].scenes[${j}].characters must be string`
      if (!isString(scene.visual_style)) return `frameosScreenwriter.items[${i}].scenes[${j}].visual_style must be string`
      if (!isString(scene.visual_style_description)) return `frameosScreenwriter.items[${i}].scenes[${j}].visual_style_description must be string`
      if (!isBoolean(scene.visual_style_confirmed)) return `frameosScreenwriter.items[${i}].scenes[${j}].visual_style_confirmed must be boolean`
    }
  }

  const art = value.art_direction
  if (!isRecord(art)) return 'frameosScreenwriter.art_direction must be object'
  const artErr = requireRecordFields(art, [
    'flow_status',
    'flow_id',
    'current_label',
    'derived_phase',
    'default_world_label',
    'worlds',
  ], 'frameosScreenwriter.art_direction')
  if (artErr) return artErr
  if (!Array.isArray(art.worlds) || art.worlds.length === 0) return 'frameosScreenwriter.art_direction.worlds must be non-empty array'
  for (let i = 0; i < art.worlds.length; i += 1) {
    const world = art.worlds[i]
    if (!isRecord(world)) return `frameosScreenwriter.art_direction.worlds[${i}] must be object`
    const worldErr = requireRecordFields(world, [
      'world_label',
      'world_background',
      'representative_frame',
      'candidates',
      'selected_style_anchor',
      'preview_materials',
    ], `frameosScreenwriter.art_direction.worlds[${i}]`)
    if (worldErr) return worldErr
    if (!isString(world.world_label)) return `frameosScreenwriter.art_direction.worlds[${i}].world_label must be string`
    if (!isString(world.world_background)) return `frameosScreenwriter.art_direction.worlds[${i}].world_background must be string`
    if (!isString(world.representative_frame)) return `frameosScreenwriter.art_direction.worlds[${i}].representative_frame must be string`
    if (!isStringArray(world.candidates)) return `frameosScreenwriter.art_direction.worlds[${i}].candidates must be string array`
    if (!isString(world.selected_style_anchor)) return `frameosScreenwriter.art_direction.worlds[${i}].selected_style_anchor must be string`
    if (!Array.isArray(world.preview_materials)) return `frameosScreenwriter.art_direction.worlds[${i}].preview_materials must be array`
  }

  return null
}

function validateStoryboardPanelsCanary(value) {
  if (!Array.isArray(value) || value.length === 0) return 'storyboard panels fixture must be non-empty array'
  for (let i = 0; i < value.length; i += 1) {
    const panel = value[i]
    if (!isRecord(panel)) return `storyboardPanels[${i}] must be object`
    if (!isString(panel.panel_id)) return `storyboardPanels[${i}].panel_id must be string`
    if (!isNumber(panel.panel_number)) return `storyboardPanels[${i}].panel_number must be number`
    if (!isString(panel.description)) return `storyboardPanels[${i}].description must be string`
    if (!isString(panel.location)) return `storyboardPanels[${i}].location must be string`
    if (!Array.isArray(panel.props)) return `storyboardPanels[${i}].props must be array`
    if (!panel.props.every((item) => isString(item))) return `storyboardPanels[${i}].props must be string array`
    if (!isString(panel.scene_type)) return `storyboardPanels[${i}].scene_type must be string`
    if (!isString(panel.visual_style)) return `storyboardPanels[${i}].visual_style must be string`
    if (!isString(panel.visual_style_description)) {
      return `storyboardPanels[${i}].visual_style_description must be string`
    }
    if (!isString(panel.source_text)) return `storyboardPanels[${i}].source_text must be string`
    if (!isRecord(panel.source_anchor)) return `storyboardPanels[${i}].source_anchor must be object`
    if (!isString(panel.source_anchor.start)) return `storyboardPanels[${i}].source_anchor.start must be string`
    if (!isString(panel.source_anchor.end)) return `storyboardPanels[${i}].source_anchor.end must be string`
    if (!isRecord(panel.referenced_assets)) return `storyboardPanels[${i}].referenced_assets must be object`
    if (!isStringArray(panel.referenced_assets.characters)) {
      return `storyboardPanels[${i}].referenced_assets.characters must be string array`
    }
    if (!isString(panel.referenced_assets.location)) {
      return `storyboardPanels[${i}].referenced_assets.location must be string`
    }
    if (!isStringArray(panel.referenced_assets.props)) {
      return `storyboardPanels[${i}].referenced_assets.props must be string array`
    }
    if (!isString(panel.shot_type)) return `storyboardPanels[${i}].shot_type must be string`
    if (!isString(panel.camera_move)) return `storyboardPanels[${i}].camera_move must be string`
    if (!isString(panel.image_prompt)) return `storyboardPanels[${i}].image_prompt must be string`
    if (!isString(panel.visual_prompt)) return `storyboardPanels[${i}].visual_prompt must be string`
    if (!isString(panel.video_prompt)) return `storyboardPanels[${i}].video_prompt must be string`
    if (!isString(panel.continuity_notes)) return `storyboardPanels[${i}].continuity_notes must be string`
    if (!Array.isArray(panel.voice_refs)) return `storyboardPanels[${i}].voice_refs must be array`
    for (let j = 0; j < panel.voice_refs.length; j += 1) {
      const voiceRef = panel.voice_refs[j]
      if (!isRecord(voiceRef)) return `storyboardPanels[${i}].voice_refs[${j}] must be object`
      if (!isString(voiceRef.speaker)) return `storyboardPanels[${i}].voice_refs[${j}].speaker must be string`
      if (!isString(voiceRef.source_text)) return `storyboardPanels[${i}].voice_refs[${j}].source_text must be string`
    }
    if (panel.duration !== undefined && !isNumber(panel.duration)) return `storyboardPanels[${i}].duration must be number when present`
    if (!Array.isArray(panel.characters)) return `storyboardPanels[${i}].characters must be array`
    for (let j = 0; j < panel.characters.length; j += 1) {
      const character = panel.characters[j]
      if (!isRecord(character)) return `storyboardPanels[${i}].characters[${j}] must be object`
      if (!isString(character.name)) return `storyboardPanels[${i}].characters[${j}].name must be string`
      if (character.appearance !== undefined && !isString(character.appearance)) {
        return `storyboardPanels[${i}].characters[${j}].appearance must be string when present`
      }
    }
  }
  return null
}

function validateVoiceAnalysisCanary(value) {
  if (!Array.isArray(value) || value.length === 0) return 'voice analysis fixture must be non-empty array'
  for (let i = 0; i < value.length; i += 1) {
    const row = value[i]
    if (!isRecord(row)) return `voiceAnalysis[${i}] must be object`
    if (!isNumber(row.lineIndex)) return `voiceAnalysis[${i}].lineIndex must be number`
    if (!isString(row.speaker)) return `voiceAnalysis[${i}].speaker must be string`
    if (!isString(row.content)) return `voiceAnalysis[${i}].content must be string`
    if (!isNumber(row.emotionStrength)) return `voiceAnalysis[${i}].emotionStrength must be number`
    if (row.matchedPanel !== null) {
      if (!isRecord(row.matchedPanel)) return `voiceAnalysis[${i}].matchedPanel must be object or null`
      if (!isString(row.matchedPanel.storyboardId)) return `voiceAnalysis[${i}].matchedPanel.storyboardId must be string`
      if (!isNumber(row.matchedPanel.panelIndex)) return `voiceAnalysis[${i}].matchedPanel.panelIndex must be number`
    }
  }
  return null
}

const preflightStatusValues = ['ready', 'needs_work', 'blocked']
const preflightDeliverableValues = ['ready', 'partial', 'missing']
const preflightIssueCodes = [
  'missing_image',
  'missing_video',
  'missing_reference',
  'missing_prompt',
  'duration_risk',
  'asset_gap',
  'voice_gap',
  'continuity_gap',
  'manifest_gap',
]
const preflightIssueSeverities = ['blocker', 'warning', 'info']
const preflightStages = ['script', 'assets', 'storyboard', 'shots', 'voice', 'export']
const preflightTargetTypes = ['episode', 'scene', 'panel', 'asset', 'voice_line', 'project']

function isOneOf(value, allowed) {
  return typeof value === 'string' && allowed.includes(value)
}

function validateExportPreflightCanary(value) {
  if (!isRecord(value)) return 'exportPreflight fixture must be an object'
  const topErr = requireRecordFields(value, [
    'status',
    'summary',
    'readiness',
    'issues',
    'deliverables',
    'next_actions',
  ], 'exportPreflight')
  if (topErr) return topErr
  if (!isOneOf(value.status, preflightStatusValues)) return 'exportPreflight.status must be ready/needs_work/blocked'
  if (!isString(value.summary)) return 'exportPreflight.summary must be string'

  if (!isRecord(value.readiness)) return 'exportPreflight.readiness must be object'
  for (const field of ['script', 'assets', 'storyboard', 'shots', 'voice', 'export']) {
    if (!isOneOf(value.readiness[field], preflightStatusValues)) {
      return `exportPreflight.readiness.${field} must be ready/needs_work/blocked`
    }
  }

  if (!Array.isArray(value.issues)) return 'exportPreflight.issues must be array'
  const seenIssueCodes = new Set()
  for (let i = 0; i < value.issues.length; i += 1) {
    const issue = value.issues[i]
    if (!isRecord(issue)) return `exportPreflight.issues[${i}] must be object`
    const issueErr = requireRecordFields(issue, [
      'code',
      'severity',
      'stage',
      'target_type',
      'target_id',
      'priority',
      'evidence',
      'message',
      'blocking_reason',
      'suggested_fix',
    ], `exportPreflight.issues[${i}]`)
    if (issueErr) return issueErr
    if (!isOneOf(issue.code, preflightIssueCodes)) return `exportPreflight.issues[${i}].code has unsupported value`
    seenIssueCodes.add(issue.code)
    if (!isOneOf(issue.severity, preflightIssueSeverities)) return `exportPreflight.issues[${i}].severity has unsupported value`
    if (!isOneOf(issue.stage, preflightStages)) return `exportPreflight.issues[${i}].stage has unsupported value`
    if (!isOneOf(issue.target_type, preflightTargetTypes)) return `exportPreflight.issues[${i}].target_type has unsupported value`
    if (!isNumber(issue.priority)) return `exportPreflight.issues[${i}].priority must be number`
    if (!Number.isInteger(issue.priority) || issue.priority < 1) {
      return `exportPreflight.issues[${i}].priority must be a positive integer`
    }
    if (!isStringArray(issue.evidence) || issue.evidence.length === 0) {
      return `exportPreflight.issues[${i}].evidence must be non-empty string array`
    }
    for (const field of ['target_id', 'message', 'blocking_reason', 'suggested_fix']) {
      if (!isString(issue[field])) return `exportPreflight.issues[${i}].${field} must be string`
    }
    if (issue.severity === 'blocker' && issue.blocking_reason.length === 0) {
      return `exportPreflight.issues[${i}].blocking_reason must be non-empty for blocker`
    }
    if (issue.severity !== 'blocker' && issue.blocking_reason.length !== 0) {
      return `exportPreflight.issues[${i}].blocking_reason must be empty for non-blocker`
    }
  }
  for (const code of preflightIssueCodes) {
    if (!seenIssueCodes.has(code)) return `exportPreflight.issues must include ${code} canary coverage`
  }

  if (!isRecord(value.deliverables)) return 'exportPreflight.deliverables must be object'
  for (const field of ['video_ready', 'image_ready', 'audio_ready', 'manifest_ready']) {
    if (!isOneOf(value.deliverables[field], preflightDeliverableValues)) {
      return `exportPreflight.deliverables.${field} must be ready/partial/missing`
    }
  }

  if (!Array.isArray(value.next_actions)) return 'exportPreflight.next_actions must be array'
  for (let i = 0; i < value.next_actions.length; i += 1) {
    const action = value.next_actions[i]
    if (!isRecord(action)) return `exportPreflight.next_actions[${i}] must be object`
    const actionErr = requireRecordFields(action, ['stage', 'priority', 'target_id', 'action'], `exportPreflight.next_actions[${i}]`)
    if (actionErr) return actionErr
    if (!isOneOf(action.stage, preflightStages)) return `exportPreflight.next_actions[${i}].stage has unsupported value`
    if (!isNumber(action.priority)) return `exportPreflight.next_actions[${i}].priority must be number`
    if (!Number.isInteger(action.priority) || action.priority < 1) {
      return `exportPreflight.next_actions[${i}].priority must be a positive integer`
    }
    if (!isString(action.target_id)) return `exportPreflight.next_actions[${i}].target_id must be string`
    if (!isString(action.action)) return `exportPreflight.next_actions[${i}].action must be string`
  }

  return null
}

function validateDesignImage(value, prefix) {
  if (value === null || isRecord(value)) return null
  return `${prefix} must be object or null`
}

function validateFrameosVariantList(value, prefix) {
  if (!Array.isArray(value) || value.length === 0) return `${prefix} must be non-empty array`
  for (let i = 0; i < value.length; i += 1) {
    const variant = value[i]
    if (!isRecord(variant)) return `${prefix}[${i}] must be object`
    const fieldsErr = requireRecordFields(variant, [
      'variant_id',
      'label',
      'variant_type',
      'prompt',
      'coverage_scenes',
      'coverage_episodes',
      'design_image',
    ], `${prefix}[${i}]`)
    if (fieldsErr) return fieldsErr
    if (!isString(variant.variant_id)) return `${prefix}[${i}].variant_id must be string`
    if (!isString(variant.label)) return `${prefix}[${i}].label must be string`
    if (!isString(variant.variant_type)) return `${prefix}[${i}].variant_type must be string`
    if (!isString(variant.prompt)) return `${prefix}[${i}].prompt must be string`
    if (!isStringArray(variant.coverage_scenes)) return `${prefix}[${i}].coverage_scenes must be string array`
    if (!isStringArray(variant.coverage_episodes)) return `${prefix}[${i}].coverage_episodes must be string array`
    const imageErr = validateDesignImage(variant.design_image, `${prefix}[${i}].design_image`)
    if (imageErr) return imageErr
  }
  return null
}

function validateVoiceMappingEntries(value, prefix) {
  const allowedVoiceSources = new Set(['library_match', 'unmatched', 'custom_upload'])
  if (!Array.isArray(value) || value.length === 0) return `${prefix} must be non-empty array`
  for (let i = 0; i < value.length; i += 1) {
    const mapping = value[i]
    if (!isRecord(mapping)) return `${prefix}[${i}] must be object`
    const fieldsErr = requireRecordFields(mapping, [
      'character',
      'character_id',
      'role_type',
      'voice_profile',
      'voice_source',
      'voice_raw_file',
      'candidates',
    ], `${prefix}[${i}]`)
    if (fieldsErr) return fieldsErr
    for (const field of ['character', 'character_id', 'role_type', 'voice_source', 'voice_raw_file']) {
      if (!isString(mapping[field])) return `${prefix}[${i}].${field} must be string`
    }
    if (!allowedVoiceSources.has(mapping.voice_source)) {
      return `${prefix}[${i}].voice_source must be library_match, unmatched, or custom_upload`
    }
    if (mapping.voice_source === 'custom_upload' && mapping.voice_raw_file.length === 0) {
      return `${prefix}[${i}].voice_raw_file must be non-empty for custom_upload`
    }
    if (!isRecord(mapping.voice_profile)) return `${prefix}[${i}].voice_profile must be object`
    if (!isString(mapping.voice_profile.gender)) return `${prefix}[${i}].voice_profile.gender must be string`
    if (!isString(mapping.voice_profile.age_range)) return `${prefix}[${i}].voice_profile.age_range must be string`
    if (!isStringArray(mapping.voice_profile.traits)) return `${prefix}[${i}].voice_profile.traits must be string array`
    if (!Array.isArray(mapping.candidates)) {
      return `${prefix}[${i}].candidates must be array`
    }
    if (mapping.voice_source === 'library_match' && mapping.candidates.length === 0) {
      return `${prefix}[${i}].candidates must be non-empty array for library_match`
    }
    const candidateRanks = new Set()
    let selectedCandidateCount = 0
    for (let j = 0; j < mapping.candidates.length; j += 1) {
      const candidate = mapping.candidates[j]
      if (!isRecord(candidate)) return `${prefix}[${i}].candidates[${j}] must be object`
      const candidateErr = requireRecordFields(candidate, [
        'rank',
        'voice_id',
        'voice_name',
        'reason',
        'is_selected',
        'reference_audio_id',
      ], `${prefix}[${i}].candidates[${j}]`)
      if (candidateErr) return candidateErr
      if (!isNumber(candidate.rank)) return `${prefix}[${i}].candidates[${j}].rank must be number`
      if (!Number.isInteger(candidate.rank) || candidate.rank < 1) {
        return `${prefix}[${i}].candidates[${j}].rank must be a positive integer`
      }
      if (candidateRanks.has(candidate.rank)) {
        return `${prefix}[${i}].candidates ranks must be unique`
      }
      if (j > 0 && candidate.rank <= mapping.candidates[j - 1].rank) {
        return `${prefix}[${i}].candidates ranks must be ascending`
      }
      candidateRanks.add(candidate.rank)
      if (!isString(candidate.voice_id)) return `${prefix}[${i}].candidates[${j}].voice_id must be string`
      if (!isString(candidate.voice_name)) return `${prefix}[${i}].candidates[${j}].voice_name must be string`
      if (!isString(candidate.reason)) return `${prefix}[${i}].candidates[${j}].reason must be string`
      if (!isBoolean(candidate.is_selected)) return `${prefix}[${i}].candidates[${j}].is_selected must be boolean`
      if (candidate.is_selected) selectedCandidateCount += 1
      if (!(candidate.reference_audio_id === null || isString(candidate.reference_audio_id))) {
        return `${prefix}[${i}].candidates[${j}].reference_audio_id must be string or null`
      }
    }
    if (selectedCandidateCount > 1) {
      return `${prefix}[${i}].candidates must have at most one selected candidate`
    }
  }
  return null
}

function validateVoiceAuditions(value, prefix) {
  if (!Array.isArray(value)) return `${prefix} must be array`
  for (let i = 0; i < value.length; i += 1) {
    const audition = value[i]
    if (!isRecord(audition)) return `${prefix}[${i}] must be object`
    const fieldsErr = requireRecordFields(audition, [
      'audition_id',
      'character_id',
      'voice_id',
      'reference_audio_id',
      'prompt',
      'status',
    ], `${prefix}[${i}]`)
    if (fieldsErr) return fieldsErr
    for (const field of ['audition_id', 'character_id', 'voice_id', 'prompt', 'status']) {
      if (!isString(audition[field])) return `${prefix}[${i}].${field} must be string`
    }
    if (!(audition.reference_audio_id === null || isString(audition.reference_audio_id))) {
      return `${prefix}[${i}].reference_audio_id must be string or null`
    }
  }
  return null
}

function validateVoiceMappingCanary(value) {
  if (!isRecord(value)) return 'voiceMapping fixture must be an object'
  const topErr = requireRecordFields(value, [
    'status',
    'voice_mapping',
    'auditions',
  ], 'voiceMapping')
  if (topErr) return topErr
  if (!isString(value.status)) return 'voiceMapping.status must be string'

  const mappingErr = validateVoiceMappingEntries(value.voice_mapping, 'voiceMapping.voice_mapping')
  if (mappingErr) return mappingErr

  const auditionsErr = validateVoiceAuditions(value.auditions, 'voiceMapping.auditions')
  if (auditionsErr) return auditionsErr

  return null
}

function validateFrameosAssetsCanary(value) {
  if (!isRecord(value)) return 'frameos assets fixture must be an object'
  const topErr = requireRecordFields(value, [
    'characters',
    'items',
    'environments',
    'voice_mapping',
    'auditions',
  ], 'frameosAssets')
  if (topErr) return topErr

  if (!Array.isArray(value.characters) || value.characters.length === 0) return 'frameosAssets.characters must be non-empty array'
  for (let i = 0; i < value.characters.length; i += 1) {
    const character = value.characters[i]
    if (!isRecord(character)) return `frameosAssets.characters[${i}] must be object`
    const fieldsErr = requireRecordFields(character, [
      'character_id',
      'name',
      'role_type',
      'description',
      'background',
      'representative_line',
      'identity_lock',
      'voice_trait',
      'voice_id',
      'voice_raw_file',
      'relationships',
      'coverage_scenes',
      'coverage_episodes',
      'speech_rate',
      'is_confirmed',
      'prompt',
      'voice_audition_prompt',
      'audition_status',
      'variants',
      'design_image',
    ], `frameosAssets.characters[${i}]`)
    if (fieldsErr) return fieldsErr
    for (const field of ['character_id', 'name', 'role_type', 'description', 'background', 'representative_line', 'voice_trait', 'voice_id', 'voice_raw_file', 'prompt', 'voice_audition_prompt', 'audition_status']) {
      if (!isString(character[field])) return `frameosAssets.characters[${i}].${field} must be string`
    }
    for (const field of ['identity_lock', 'relationships', 'coverage_scenes', 'coverage_episodes']) {
      if (!isStringArray(character[field])) return `frameosAssets.characters[${i}].${field} must be string array`
    }
    if (!isNumber(character.speech_rate)) return `frameosAssets.characters[${i}].speech_rate must be number`
    if (!isBoolean(character.is_confirmed)) return `frameosAssets.characters[${i}].is_confirmed must be boolean`
    const variantErr = validateFrameosVariantList(character.variants, `frameosAssets.characters[${i}].variants`)
    if (variantErr) return variantErr
    const imageErr = validateDesignImage(character.design_image, `frameosAssets.characters[${i}].design_image`)
    if (imageErr) return imageErr
  }

  if (!Array.isArray(value.items) || value.items.length === 0) return 'frameosAssets.items must be non-empty array'
  for (let i = 0; i < value.items.length; i += 1) {
    const item = value.items[i]
    if (!isRecord(item)) return `frameosAssets.items[${i}] must be object`
    const fieldsErr = requireRecordFields(item, [
      'item_id',
      'name',
      'item_type',
      'description',
      'background',
      'significance',
      'coverage_scenes',
      'coverage_episodes',
      'is_confirmed',
      'prompt',
      'variants',
      'design_image',
    ], `frameosAssets.items[${i}]`)
    if (fieldsErr) return fieldsErr
    for (const field of ['item_id', 'name', 'item_type', 'description', 'background', 'significance', 'prompt']) {
      if (!isString(item[field])) return `frameosAssets.items[${i}].${field} must be string`
    }
    if (!isStringArray(item.coverage_scenes)) return `frameosAssets.items[${i}].coverage_scenes must be string array`
    if (!isStringArray(item.coverage_episodes)) return `frameosAssets.items[${i}].coverage_episodes must be string array`
    if (!isBoolean(item.is_confirmed)) return `frameosAssets.items[${i}].is_confirmed must be boolean`
    const variantErr = validateFrameosVariantList(item.variants, `frameosAssets.items[${i}].variants`)
    if (variantErr) return variantErr
    const imageErr = validateDesignImage(item.design_image, `frameosAssets.items[${i}].design_image`)
    if (imageErr) return imageErr
  }

  if (!Array.isArray(value.environments) || value.environments.length === 0) return 'frameosAssets.environments must be non-empty array'
  for (let i = 0; i < value.environments.length; i += 1) {
    const environment = value.environments[i]
    if (!isRecord(environment)) return `frameosAssets.environments[${i}] must be object`
    const fieldsErr = requireRecordFields(environment, [
      'environment_id',
      'name',
      'int_ext',
      'description',
      'background',
      'entrance',
      'mood',
      'base_ambience',
      'coverage_scenes',
      'coverage_episodes',
      'is_confirmed',
      'prompt',
      'variants',
      'design_image',
    ], `frameosAssets.environments[${i}]`)
    if (fieldsErr) return fieldsErr
    for (const field of ['environment_id', 'name', 'int_ext', 'description', 'background', 'entrance', 'mood', 'base_ambience', 'prompt']) {
      if (!isString(environment[field])) return `frameosAssets.environments[${i}].${field} must be string`
    }
    if (!isStringArray(environment.coverage_scenes)) return `frameosAssets.environments[${i}].coverage_scenes must be string array`
    if (!isStringArray(environment.coverage_episodes)) return `frameosAssets.environments[${i}].coverage_episodes must be string array`
    if (!isBoolean(environment.is_confirmed)) return `frameosAssets.environments[${i}].is_confirmed must be boolean`
    const variantErr = validateFrameosVariantList(environment.variants, `frameosAssets.environments[${i}].variants`)
    if (variantErr) return variantErr
    const imageErr = validateDesignImage(environment.design_image, `frameosAssets.environments[${i}].design_image`)
    if (imageErr) return imageErr
  }

  const mappingErr = validateVoiceMappingEntries(value.voice_mapping, 'frameosAssets.voice_mapping')
  if (mappingErr) return mappingErr

  const auditionsErr = validateVoiceAuditions(value.auditions, 'frameosAssets.auditions')
  if (auditionsErr) return auditionsErr

  return null
}

function checkTemplateTokens(pathStem, requiredTokens) {
  const violations = []
  for (const locale of ['zh', 'en']) {
    const relPath = `lib/prompts/${pathStem}.${locale}.txt`
    const fullPath = path.join(root, relPath)
    if (!fs.existsSync(fullPath)) {
      violations.push(`missing template: ${relPath}`)
      continue
    }
    const content = fs.readFileSync(fullPath, 'utf8')
    for (const token of requiredTokens) {
      if (!content.includes(token)) {
        violations.push(`missing token ${token} in ${relPath}`)
      }
    }
  }
  return violations
}

const violations = []

const clipsErr = validateClipCanary(readJson(CANARY_FILES.clips))
if (clipsErr) violations.push(clipsErr)

const episodeSplitErr = validateEpisodeSplitCanary(readJson(CANARY_FILES.episodeSplit))
if (episodeSplitErr) violations.push(episodeSplitErr)

const screenplayErr = validateScreenplayCanary(readJson(CANARY_FILES.screenplay))
if (screenplayErr) violations.push(screenplayErr)

const frameosScreenwriterErr = validateFrameosScreenwriterCanary(readJson(CANARY_FILES.frameosScreenwriter))
if (frameosScreenwriterErr) violations.push(frameosScreenwriterErr)

const frameosAssetsErr = validateFrameosAssetsCanary(readJson(CANARY_FILES.frameosAssets))
if (frameosAssetsErr) violations.push(frameosAssetsErr)

const voiceMappingErr = validateVoiceMappingCanary(readJson(CANARY_FILES.voiceMapping))
if (voiceMappingErr) violations.push(voiceMappingErr)

const panelsErr = validateStoryboardPanelsCanary(readJson(CANARY_FILES.storyboardPanels))
if (panelsErr) violations.push(panelsErr)

const voiceErr = validateVoiceAnalysisCanary(readJson(CANARY_FILES.voiceAnalysis))
if (voiceErr) violations.push(voiceErr)

const exportPreflightErr = validateExportPreflightCanary(readJson(CANARY_FILES.exportPreflight))
if (exportPreflightErr) violations.push(exportPreflightErr)

for (const [pathStem, requiredTokens] of Object.entries(TEMPLATE_TOKEN_REQUIREMENTS)) {
  violations.push(...checkTemplateTokens(pathStem, requiredTokens))
}

if (violations.length > 0) {
  fail('JSON schema canary check failed', violations)
}

console.log('[prompt-json-canary-guard] OK')
