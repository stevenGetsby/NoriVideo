import { z } from 'zod'
import {
  CANVAS_IMAGE_ASPECT_RATIOS, CANVAS_IMAGE_RESOLUTIONS, CANVAS_IMAGE_QUALITIES,
  CANVAS_VIDEO_ASPECT_RATIOS, CANVAS_VIDEO_RESOLUTIONS, CANVAS_VIDEO_DURATION_MIN, CANVAS_VIDEO_DURATION_MAX,
} from '@/lib/canvas/generator-options'

const ref = z.string().trim().min(1).max(80).describe('节点引用：画布摘要里的 ref（如 n3k9x2a），或节点的完整标题')
const title = z.string().trim().min(1).max(40)
const longText = z.string().max(4000)

export const generationParamsSchema = z.object({
  aspectRatio: z.enum([...new Set([...CANVAS_IMAGE_ASPECT_RATIOS, ...CANVAS_VIDEO_ASPECT_RATIOS])] as [string, ...string[]]).optional(),
  resolution: z.enum([...CANVAS_IMAGE_RESOLUTIONS, ...CANVAS_VIDEO_RESOLUTIONS] as [string, ...string[]]).optional(),
  quality: z.enum(CANVAS_IMAGE_QUALITIES).optional(),
  duration: z.number().int().min(CANVAS_VIDEO_DURATION_MIN).max(CANVAS_VIDEO_DURATION_MAX).optional(),
  generateAudio: z.boolean().optional(),
  inputMode: z.enum(['text', 'image', 'firstlastframe']).optional(),
}).strict()

const newNode = z.object({
  key: z.string().regex(/^[a-z0-9_]{1,16}$/).describe('本次蓝图内的临时键，用于 links'),
  type: z.enum(['text', 'image', 'video', 'playlist']),
  title: title.optional(),
  text: longText.optional().describe('仅 text 节点：正文'),
  prompt: longText.optional().describe('image/video 节点：生成提示词'),
  generation: generationParamsSchema.optional(),
}).strict()

const endpoint = z.union([ref, z.object({ key: z.string().regex(/^[a-z0-9_]{1,16}$/) }).strict()])
const link = z.object({ from: endpoint, to: endpoint }).strict()
const existingLink = z.object({ from: ref, to: ref }).strict()

export const canvasAgentToolSchemas = {
  find_nodes: z.object({
    query: z.string().max(80).optional().describe('在标题、正文、提示词里查找'),
    types: z.array(z.enum(['note', 'text', 'image', 'video', 'audio', 'model_3d', 'studio_3d', 'playlist', 'video_edit', 'group'])).max(10).optional(),
    status: z.enum(['empty', 'running', 'failed', 'ready']).optional(),
    hasMedia: z.boolean().optional(),
    inGroup: ref.optional(),
    selectedOnly: z.boolean().optional(),
    limit: z.number().int().min(1).max(50).default(20),
  }).strict(),
  read_node: z.object({ node: ref }).strict(),
  list_models: z.object({ type: z.enum(['text', 'image', 'video']) }).strict(),
  quote: z.object({ node: ref, modelKey: z.string().max(120).optional(), params: generationParamsSchema.optional(), count: z.number().int().min(1).max(4).optional() }).strict(),
  build_graph: z.object({
    title: title,
    nodes: z.array(newNode).min(1).max(40),
    links: z.array(link).max(80).default([]),
    near: ref.optional().describe('放在这个节点右侧；不填则放在画布内容右侧'),
    layout: z.enum(['flow', 'grid']).default('flow'),
    group: z.boolean().default(false).describe('搭好后把新节点放进一个以 title 命名的组'),
  }).strict(),
  update_nodes: z.object({
    updates: z.array(z.object({
      node: ref, title: title.optional(), text: longText.optional(), prompt: longText.optional(), generation: generationParamsSchema.optional(),
    }).strict()).min(1).max(20),
  }).strict(),
  connect_nodes: z.object({ links: z.array(existingLink).min(1).max(40) }).strict(),
  disconnect_nodes: z.object({ links: z.array(existingLink).min(1).max(40) }).strict(),
  delete_nodes: z.object({
    nodes: z.array(ref).min(1).max(50),
    reason: z.string().min(1).max(80).describe('给用户看的一句话理由'),
    includeGroupMembers: z.boolean().default(false),
  }).strict(),
  arrange: z.object({
    scope: z.enum(['canvas', 'nodes', 'group']),
    nodes: z.array(ref).max(200).optional(),
    group: ref.optional(),
    mode: z.enum(['tidy', 'grid', 'horizontal', 'vertical', 'type']).default('tidy'),
  }).strict(),
  group_nodes: z.object({
    nodes: z.array(ref).min(2).max(100),
    title: title.optional(),
    color: z.enum(['sky', 'violet', 'pink', 'green', 'amber', 'orange', 'blue', 'red']).optional(),
  }).strict(),
  set_canvas_prompt: z.object({ kind: z.enum(['global_style', 'video_prefix']), text: z.string().max(2000) }).strict(),
  add_to_playlist: z.object({ playlist: ref, videos: z.array(ref).min(1).max(30) }).strict(),
  focus: z.object({ nodes: z.array(ref).max(50).optional().describe('不填则显示全部'), select: z.boolean().default(false) }).strict(),
  generate: z.object({
    node: ref,
    prompt: longText.optional().describe('不填则用节点已有提示词或上游文本'),
    modelKey: z.string().max(120).optional(),
    params: generationParamsSchema.optional(),
    count: z.number().int().min(1).max(4).default(1),
  }).strict(),
  open_tool: z.object({
    node: ref,
    tool: z.enum(['generator', 'image_edit', 'superresolve', 'grid_split', 'lens_focus', 'subtitle_erase', 'audio_extract', 'history', 'preview', 'panorama_720', 'studio_3d']),
  }).strict(),
  cancel_generation: z.object({ node: ref }).strict(),
  ask_user: z.object({ question: z.string().min(1).max(120), options: z.array(z.string().min(1).max(20)).min(2).max(4) }).strict(),
} as const

export type CanvasAgentToolName = keyof typeof canvasAgentToolSchemas
export const CANVAS_AGENT_TOOL_NAMES = Object.keys(canvasAgentToolSchemas) as CanvasAgentToolName[]
