export const MP_PIPELINE_VERSION = 1

export interface ReleaseMediaFiles {
  v720?: string   // 视频 720P mp4 的 storage key
  v480?: string   // 视频 480P mp4
  poster?: string // 视频首帧 jpg
  last?: string   // 视频末帧 jpg（互动停在片尾时盖在画面上，防安卓黑屏）
  sheet?: string  // 4×4 联系表 jpg，只给审核用
  img?: string    // 图片：jpg，带透明通道时为 png
}

export interface ReleaseMediaEntry {
  id: string                // sha1(源 key 或源 URL) 前 16 位 hex
  kind: 'video' | 'image'
  source: string            // 源 storage key —— 仅服务端，绝不下发 C 端
  w: number
  h: number
  durationSec?: number
  hasAudio?: boolean
  bytes: number             // 派生文件字节数之和
  files: ReleaseMediaFiles
  refs: string[]            // program 内的 JSON Pointer，例如 /chapters/0/nodes/3/media/url
}

export interface ReleaseManifest {
  pipelineVersion: number
  media: Record<string, ReleaseMediaEntry>
}

export interface ReleaseMeta {
  title: string
  tagline: string
  synopsis: string
  tags: string[]
  creatorName: string
  accentColor: string       // #RRGGBB
  cover: string             // key：mp/releases/<rid>/cover.jpg（720×960）
  shareCover: string        // key：mp/releases/<rid>/share.jpg（1000×800）
  trailer: string | null    // key：mp/releases/<rid>/trailer.mp4
  trailerPoster: string | null
  chapters: { projectId: string; order: number; title: string; durationSec: number }[]
  endings: { projectId: string; nodeId: string; title: string; endingType: 'good' | 'normal' | 'bad' | 'hidden'; chapterOrder: number }[]
  achievements: { id: string; name: string; description: string; icon: string | null }[]
  segmentCount: number      // scene 节点总数（进度分母）
  texts: { where: string; text: string }[]  // 审核用，C 端不下发
}
