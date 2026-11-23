import { z } from 'zod'

const alias = z.string().regex(/^n[0-9a-z]{6}$/)
const count = z.number().int().nonnegative().max(20_000)
const shortText = (length: number) => z.string().transform((text) => text.replace(/[\r\n]+/g, ' ').slice(0, length))
const digestRow = z.object({
  ref: alias,
  type: shortText(40),
  title: shortText(40),
  status: z.enum(['running', 'failed']).optional(),
  media: z.enum(['image', 'video', 'audio', 'model3d']).optional(),
  snippet: shortText(80).optional(),
  group: alias.optional(),
  flags: z.array(z.enum(['selected', 'visible', 'touched', 'global_style', 'video_prefix'])).max(5).optional(),
  model: shortText(30).optional(),
}).strict()

const digestShape = z.object({
  v: z.literal(1),
  canvas: z.object({ title: shortText(80), nodeCount: count, edgeCount: count, groupCount: count }).strict(),
  selection: z.array(alias).max(50),
  rows: z.array(digestRow).max(160),
  edges: z.array(z.union([z.tuple([alias, alias]), z.tuple([alias, alias, shortText(40)])])).max(400),
  omitted: z.object({ nodes: count, byType: z.record(z.string().max(40), count), edges: count }).strict(),
  globalStyle: shortText(200).optional(),
  videoPrefix: shortText(200).optional(),
}).strict()

export const canvasAgentDigestSchema = z.unknown().refine((raw) => {
  try {
    return new TextEncoder().encode(JSON.stringify(raw)).byteLength <= 64 * 1024
  } catch {
    return false
  }
}, 'Canvas context exceeds 64 KiB').pipe(digestShape)

export const chatBodySchema = z.object({
  threadId: z.string().uuid(),
  messages: z.array(z.unknown()).min(1).max(400),
  context: z.object({
    mode: z.enum(['canvas', 'story']),
    locale: z.enum(['zh', 'en']).catch('zh'),
    modelKey: z.string().regex(/^[a-z][a-z0-9-]*::[A-Za-z0-9._:-]{1,120}$/).optional(),
    digest: canvasAgentDigestSchema,
    autonomy: z.enum(['confirm_costly', 'auto_budget']),
    budgetPoints: z.number().int().min(10).max(2_000).optional(),
    turnIndex: z.number().int().min(0).max(8),
  }).strict(),
}).strict()

export type CanvasAgentDigest = z.infer<typeof canvasAgentDigestSchema>

export function formatCanvasAgentDigest(digest: CanvasAgentDigest) {
  // Keep user text inside one data block even if a node title or snippet
  // contains an apparent closing tag.
  const json = JSON.stringify(digest).replace(/</g, '\\u003c').replace(/>/g, '\\u003e')
  return `<canvas_data>\n${json}\n</canvas_data>`
}
