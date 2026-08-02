// ========================================
// Video Editor Core Types
// Schema Version: 1.0
// ========================================

/**
 * 剪辑项目 - 顶层结构
 */
export interface VideoEditorProject {
    id: string
    episodeId: string
    schemaVersion: '1.0'

    config: EditorConfig

    // 主时间轴 (磁性轨道) - 顺序即时间
    timeline: VideoClip[]

    // BGM 轨道 (绝对定位)
    bgmTrack: BgmClip[]
}

/**
 * 编辑器配置
 */
export interface EditorConfig {
    fps: number
    width: number
    height: number
}

/**
 * 视频片段 - 时间轴核心单元
 */
export interface VideoClip {
    id: string
    src: string                    // COS URL
    durationInFrames: number       // 播放时长

    // 素材内裁剪 (可选)
    trim?: {
        from: number                 // 素材起始帧
        to: number                   // 素材结束帧
    }

    // 附属内容 - 跟随视频移动
    attachment?: ClipAttachment

    // 转场 (与下一个片段的过渡)
    transition?: ClipTransition

    // 从原视频中分离出的源音频。detached=true 时视频轨静音，
    // 同一媒体源会在独立音频轨按相同入点播放。
    sourceAudio?: {
        detached: boolean
        volume: number
        segments?: SourceAudioSegment[]
    }

    // AI 元数据 (用于回溯)
    metadata: ClipMetadata
}

export interface SourceAudioSegment {
    id: string
    from: number
    to: number
    volume: number
    // Absolute placement on the assembled episode timeline. Older projects
    // omit this value and continue to follow their owning video clip.
    timelineStartFrame?: number
}

/**
 * 片段附属内容 (配音 + 字幕)
 */
export interface ClipAttachment {
    audio?: {
        src: string
        volume: number
        voiceLineId?: string
    }
    subtitle?: {
        text: string
        style: 'default' | 'cinematic'
    }
}

/**
 * 转场效果
 */
export interface ClipTransition {
    type: 'none' | 'dissolve' | 'fade' | 'slide'
    durationInFrames: number
}

/**
 * 片段元数据
 */
export interface ClipMetadata {
    panelId: string
    storyboardId: string
    description?: string
    sceneLabel?: string
    segmentLabel?: string
    imageUrl?: string | null
    sourceDurationInFrames?: number
}

/**
 * BGM 片段 - 独立轨道
 */
export interface BgmClip {
    id: string
    src: string
    startFrame: number             // 绝对定位
    durationInFrames: number
    volume: number
    fadeIn?: number
    fadeOut?: number
}

// ========================================
// 时间轴 UI 状态
// ========================================

export interface TimelineState {
    currentFrame: number
    playing: boolean
    selectedClipId: string | null
    zoom: number                   // 缩放级别 (1 = 100%)
}

// ========================================
// 计算工具类型
// ========================================

export interface ComputedClip extends VideoClip {
    startFrame: number             // 计算得出的起始帧
    endFrame: number               // 计算得出的结束帧
}

// ========================================
// API 相关类型
// ========================================

export interface SaveEditorProjectRequest {
    projectData: VideoEditorProject
}

export interface RenderRequest {
    editorProjectId: string
    format: 'mp4' | 'webm'
    quality: 'draft' | 'high'
}

export interface RenderStatus {
    status: 'pending' | 'rendering' | 'completed' | 'failed'
    progress?: number
    outputUrl?: string
    error?: string
}
