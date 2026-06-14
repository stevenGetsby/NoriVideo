#!/usr/bin/env node

import fs from 'fs'
import path from 'path'
import process from 'process'

const root = process.cwd()
const catalogPath = path.join(root, 'src', 'lib', 'prompt-i18n', 'catalog.ts')
const chineseCharPattern = /[\p{Script=Han}]/u
const singlePlaceholderPattern = /\{([A-Za-z0-9_]+)\}/g
const doublePlaceholderPattern = /\{\{([A-Za-z0-9_]+)\}\}/g

const criticalTemplateTokens = new Map([
  ['novel-promotion/agent_clip', ['"start"', '"end"', '"summary"', '"source_anchor"', '"info_points"', '"reasoning"', '"adaptation_decision"', '"production_function"', '"self_review"', '"location"', '"characters"', '"props"']],
  ['novel-promotion/voice_analysis', ['"lineIndex"', '"speaker"', '"content"', '"emotionStrength"', '"matchedPanel"', '"storyboardId"', '"panelIndex"', 'source_text', 'source_anchor', 'referenced_assets', 'voice_refs', 'video_prompt', 'continuity_notes', 'dialogue_state', 'lip_sync']],
  ['novel-promotion/voice_mapping', ['"status"', '"voice_mapping"', '"character"', '"character_id"', '"role_type"', '"voice_profile"', '"gender"', '"age_range"', '"traits"', '"voice_source"', '"custom_upload"', '"voice_raw_file"', '"candidates"', '"rank"', '"voice_id"', '"voice_name"', '"reason"', '"is_selected"', '"reference_audio_id"', '"auditions"', '"audition_id"', '"prompt"']],
  ['novel-promotion/agent_character_profile', ['"status"', '"extraction_status"', '"has_deprecated_characters"', '"role_type"', '"description"', '"identity_lock"', '"coverage_scenes"', '"coverage_episodes"', '"prompt"', '"variants"', '"speech_rate"', '"audition_status"', '"design_image"']],
  ['novel-promotion/agent_character_visual', ['identity_lock', 'expected_appearances', 'coverage_scenes', 'coverage_episodes', 'variants', 'variant_id', 'variant_type', 'prompt', 'design_image', 'voice_trait', 'representative_line', 'voice_audition_prompt', '"appearances"', '"change_reason"', '"descriptions"']],
  ['novel-promotion/agent_storyboard_plan', ['"panel_id"', '"panel_number"', '"description"', '"characters"', '"location"', '"props"', '"scene_type"', '"visual_style"', '"visual_style_description"', 'project_production_context', '"source_text"', '"source_anchor"', '"referenced_assets"', '"image_prompt"', '"visual_prompt"', '"shot_type"', '"camera_move"', '"video_prompt"', 'visual subject', 'start/end state', 'lip-sync', '"continuity_notes"', '"voice_refs"', '"duration"']],
  ['novel-promotion/agent_storyboard_detail', ['"panel_id"', '"panel_number"', '"description"', '"characters"', '"location"', '"props"', '"scene_type"', '"visual_style"', '"visual_style_description"', '"source_text"', '"source_anchor"', '"referenced_assets"', '"image_prompt"', '"visual_prompt"', '"shot_type"', '"camera_move"', '"video_prompt"', 'visual subject', 'start/end state', 'lip-sync', '"continuity_notes"', '"voice_refs"', '"duration"']],
  ['novel-promotion/agent_storyboard_insert', ['"panel_id"', '"panel_number"', '"description"', '"characters"', '"location"', '"props"', '"scene_type"', '"visual_style"', '"visual_style_description"', '"source_text"', '"source_anchor"', '"referenced_assets"', '"image_prompt"', '"visual_prompt"', '"shot_type"', '"camera_move"', '"video_prompt"', 'visual subject', 'start/end state', 'lip-sync', 'new story beat', '"continuity_notes"', '"voice_refs"', '"duration"']],
  ['novel-promotion/agent_acting_direction', ['"panel_number"', '"characters"', '"name"', '"acting"', 'source_text', 'source_anchor', 'referenced_assets', 'video_prompt', 'continuity_notes', 'voice_refs', 'dialogue_state', 'lip_sync']],
  ['novel-promotion/agent_cinematographer', ['"panel_number"', '"scene_summary"', '"composition"', '"lighting"', '"color_palette"', '"atmosphere"', '"technical_notes"', '"characters"', '"screen_position"', '"posture"', '"facing"', '"depth_of_field"', '"color_tone"', 'referenced_assets', 'image_prompt', 'visual_prompt', 'video_prompt', 'source_text', 'source_anchor', 'continuity_notes', 'voice_refs', 'visual_style', 'visual_style_description']],
  ['novel-promotion/screenplay_conversion', ['"clip_id"', '"status"', '"steps"', '"script_kilo"', '"strategy_thinking"', '"style_reasoning"', '"default_visual_style"', '"worlds"', '"world_label"', '"world_background"', '"representative_frame"', '"selected_style_anchor"', '"preview_materials"', 'project_production_context', '"scenes"', '"heading"', '"content"', '"dialogue"', '"voiceover"']],
  ['novel-promotion/select_location', ['"status"', '"extraction_status"', '"has_deprecated_environments"', '"environments"', '"environment_id"', '"name"', '"int_ext"', '"summary"', '"description"', '"background"', '"entrance"', '"mood"', '"base_ambience"', '"coverage_scenes"', '"coverage_episodes"', '"prompt"', '"variants"', '"design_image"', '"available_slots"', '"descriptions"']],
  ['novel-promotion/select_prop', ['"status"', '"extraction_status"', '"has_deprecated_items"', '"items"', '"item_id"', '"name"', '"item_type"', '"summary"', '"description"', '"background"', '"significance"', '"coverage_scenes"', '"coverage_episodes"', '"prompt"', '"variants"', '"design_image"']],
  ['novel-promotion/episode_split', ['"status"', '"steps"', '"default_visual_style"', '"script_kilo"', '"adapted_kilo"', '"items"', '"analysis"', '"episode_id"', '"episode_number"', '"content"', '"content_kilo"', '"startMarker"', '"endMarker"', '"source_anchor"', '"info_points"', '"reasoning"', '"diagnosis"', '"key_decisions"', '"scenes"', '"scene_id"', '"visual_style_description"', '"visual_style_confirmed"', '"validation"']],
  ['novel-promotion/image_prompt_modify', ['"image_prompt"', '"visual_prompt"', '"video_prompt"', '"referenced_assets"', '"characters"', '"location"', '"props"', '"continuity_notes"', '"change_summary"', 'no_visible_text']],
  ['novel-promotion/export_preflight_review', ['"status"', '"readiness"', '"issues"', '"deliverables"', '"next_actions"', '"priority"', '"evidence"', '"blocking_reason"', 'source_anchor', 'referenced_assets', 'visual_prompt', 'imagePrompt', 'continuity_notes', 'voice_refs', 'coverage_scenes', 'coverage_episodes', 'missing_image', 'missing_video', 'missing_reference', 'missing_prompt', 'duration_risk', 'voice_gap', 'continuity_gap', 'manifest_gap']],
  ['novel-promotion/single_panel_image', ['referenced_assets', 'image_prompt', 'visual_prompt', 'video_prompt', 'source_text', 'source_anchor', 'continuity_notes', 'voice_refs', 'visual_style', 'visual_style_description']],
  ['novel-promotion/agent_shot_variant_generate', ['referenced_assets', 'image_prompt', 'visual_prompt', 'video_prompt', 'source_text', 'source_anchor', 'continuity_notes', 'voice_refs', 'visual_style', 'visual_style_description']],
  ['novel-promotion/agent_shot_variant_analysis', ['panel_context_json', 'source_text', 'source_anchor', 'referenced_assets', 'image_prompt', 'visual_prompt', 'video_prompt', 'continuity_notes', 'voice_refs', 'visual_style', 'visual_style_description', '"image_prompt"', '"visual_prompt"', '"referenced_assets"', '"continuity_notes"', '"shot_type"', '"camera_move"', '"creative_score"', 'same source_anchor']],
  ['novel-promotion/ai_story_expand', ['source_text', 'episode_split', 'screenplay_conversion', 'asset extraction', 'storyboard generation', 'voice_refs', 'export preflight review', 'characters', 'location', 'props']],
  ['novel-promotion/storyboard_edit', ['panel_context_json', 'referenced_assets_json', 'source_image_context', 'panel_id', 'referenced_assets', 'source_text', 'source_anchor', 'image_prompt', 'visual_prompt', 'video_prompt', 'continuity_notes', 'voice_refs', 'visual_style', 'visual_style_description', 'shot_type', 'camera_move', 'duration']],
  ['novel-promotion/character_create', ['"prompt"', 'identity_lock', 'coverage_scenes', 'coverage_episodes', 'variants', 'design_image']],
  ['novel-promotion/character_modify', ['"prompt"', 'identity_lock', 'coverage_scenes', 'coverage_episodes', 'variants', 'design_image']],
  ['novel-promotion/character_description_update', ['"prompt"', 'identity_lock', 'coverage_scenes', 'coverage_episodes', 'variants', 'design_image']],
  ['novel-promotion/character_regenerate', ['"descriptions"', 'identity_lock', 'coverage_scenes', 'coverage_episodes', 'variants', 'design_image']],
  ['novel-promotion/location_create', ['"prompt"', 'available_slots', 'summary', 'description', 'background', 'entrance', 'mood', 'base_ambience', 'coverage_scenes', 'coverage_episodes', 'variants', 'environment_id', 'design_image']],
  ['novel-promotion/location_modify', ['"prompt"', 'available_slots', 'summary', 'description', 'background', 'entrance', 'mood', 'base_ambience', 'coverage_scenes', 'coverage_episodes', 'variants', 'environment_id', 'design_image']],
  ['novel-promotion/location_description_update', ['"prompt"', 'available_slots', 'summary', 'description', 'background', 'entrance', 'mood', 'base_ambience', 'coverage_scenes', 'coverage_episodes', 'variants', 'environment_id', 'design_image']],
  ['novel-promotion/location_regenerate', ['"descriptions"', 'available_slots', 'summary', 'description', 'background', 'entrance', 'mood', 'base_ambience', 'coverage_scenes', 'coverage_episodes', 'variants', 'environment_id', 'design_image']],
  ['novel-promotion/prop_description_update', ['"prompt"', 'item_type', 'coverage_scenes', 'coverage_episodes', 'variants', 'item_id', 'design_image', 'significance']],
])

function fail(title, details = []) {
  console.error(`\n[prompt-semantic-regression] ${title}`)
  for (const line of details) {
    console.error(`  - ${line}`)
  }
  process.exit(1)
}

function parseCatalog(text) {
  const entries = []
  const entryPattern = /pathStem:\s*'([^']+)'\s*,[\s\S]*?variableKeys:\s*\[([\s\S]*?)\]\s*,/g
  for (const match of text.matchAll(entryPattern)) {
    const pathStem = match[1]
    const rawKeys = match[2] || ''
    const keys = Array.from(rawKeys.matchAll(/'([^']+)'/g)).map((item) => item[1])
    entries.push({ pathStem, variableKeys: keys })
  }
  return entries
}

function extractPlaceholders(template) {
  const keys = new Set()
  for (const match of template.matchAll(singlePlaceholderPattern)) {
    if (match[1]) keys.add(match[1])
  }
  for (const match of template.matchAll(doublePlaceholderPattern)) {
    if (match[1]) keys.add(match[1])
  }
  return Array.from(keys)
}

if (!fs.existsSync(catalogPath)) {
  fail('catalog.ts not found', ['src/lib/prompt-i18n/catalog.ts'])
}

const catalogText = fs.readFileSync(catalogPath, 'utf8')
const entries = parseCatalog(catalogText)
if (entries.length === 0) {
  fail('failed to parse prompt catalog entries')
}

const violations = []
for (const entry of entries) {
  const templatePath = path.join(root, 'lib', 'prompts', `${entry.pathStem}.en.txt`)
  if (!fs.existsSync(templatePath)) {
    violations.push(`missing template: lib/prompts/${entry.pathStem}.en.txt`)
    continue
  }

  const template = fs.readFileSync(templatePath, 'utf8')
  if (chineseCharPattern.test(template)) {
    violations.push(`unexpected Chinese content in English template: lib/prompts/${entry.pathStem}.en.txt`)
  }

  const placeholders = extractPlaceholders(template)
  const placeholderSet = new Set(placeholders)
  const variableKeySet = new Set(entry.variableKeys)

  for (const key of entry.variableKeys) {
    if (!placeholderSet.has(key)) {
      violations.push(`missing placeholder {${key}} in lib/prompts/${entry.pathStem}.en.txt`)
    }
  }

  for (const key of placeholders) {
    if (!variableKeySet.has(key)) {
      violations.push(`unexpected placeholder {${key}} in lib/prompts/${entry.pathStem}.en.txt`)
    }
  }

  const requiredTokens = criticalTemplateTokens.get(entry.pathStem) || []
  for (const token of requiredTokens) {
    if (!template.includes(token)) {
      violations.push(`missing semantic token ${token} in lib/prompts/${entry.pathStem}.en.txt`)
    }
  }
}

if (violations.length > 0) {
  fail('semantic regression check failed', violations)
}

console.log(`[prompt-semantic-regression] OK (${entries.length} templates checked)`)
