import React from 'react'
import { AbsoluteFill, Sequence, Video, Audio, useCurrentFrame, interpolate } from 'remotion'
import { VideoClip, BgmClip, EditorConfig } from '../types/editor.types'
import { computeClipPositions } from '../utils/time-utils'
import { toDisplayImageUrl } from '@/lib/media/image-url'
import { getPlaybackTimeShiftTolerance } from '../utils/playback-sync'

interface VideoCompositionProps {
    clips: VideoClip[]
    bgmTrack: BgmClip[]
    config: EditorConfig
    playing?: boolean
}

/**
 * Remotion 主合成组件
 * 使用 Sequence 实现磁性时间轴布局，支持转场效果
 */
export const VideoComposition: React.FC<VideoCompositionProps> = ({
    clips,
    bgmTrack,
    config,
    playing = false,
}) => {
    const computedClips = computeClipPositions(clips)

    return (
        <AbsoluteFill style={{ backgroundColor: 'black' }}>
            {/* 视频轨道 - 带转场效果 */}
            {computedClips.map((clip, index) => {
                const transitionDuration = index < computedClips.length - 1
                    ? Math.max(0, clip.endFrame - computedClips[index + 1].startFrame)
                    : 0
                const incomingTransitionDuration = index > 0
                    ? Math.max(0, computedClips[index - 1].endFrame - clip.startFrame)
                    : 0

                return (
                    <Sequence
                        key={clip.id}
                        from={clip.startFrame}
                        durationInFrames={clip.durationInFrames}
                        premountFor={Math.min(clip.startFrame, config.fps * 2)}
                        postmountFor={Math.min(config.fps, transitionDuration)}
                        name={`Clip ${index + 1}`}
                    >
                        <ClipRenderer
                            clip={clip}
                            config={config}
                            outgoingTransitionType={clip.transition?.type}
                            outgoingTransitionDuration={transitionDuration}
                            incomingTransitionType={index > 0 ? computedClips[index - 1].transition?.type : undefined}
                            incomingTransitionDuration={incomingTransitionDuration}
                            isLastClip={index === computedClips.length - 1}
                            playing={playing}
                        />
                    </Sequence>
                )
            })}

            {/* 分离后的源音频使用整集绝对坐标，可独立于视频片段移动。 */}
            {computedClips.flatMap((clip) => clip.sourceAudio?.detached
                ? (clip.sourceAudio.segments ?? [{
                    id: `source-audio:${clip.id}`,
                    from: 0,
                    to: clip.durationInFrames,
                    volume: 1,
                }]).map((segment) => {
                    const timelineStartFrame = Number.isFinite(segment.timelineStartFrame)
                        ? Math.max(0, Math.round(segment.timelineStartFrame!))
                        : clip.startFrame + segment.from
                    return (
                        <Sequence
                            key={`${clip.id}:${segment.id}`}
                            from={timelineStartFrame}
                            durationInFrames={Math.max(1, segment.to - segment.from)}
                            layout="none"
                            name={`Source audio: ${segment.id}`}
                        >
                            <Audio
                                src={toDisplayImageUrl(clip.src) || clip.src}
                                startFrom={(clip.trim?.from || 0) + segment.from}
                                volume={clip.sourceAudio!.volume * segment.volume}
                                pauseWhenBuffering
                            />
                        </Sequence>
                    )
                })
                : [])}

            {/* BGM 轨道 */}
            {bgmTrack.map((bgm) => (
                <Sequence
                    key={bgm.id}
                    from={bgm.startFrame}
                    durationInFrames={bgm.durationInFrames}
                    name={`BGM: ${bgm.id}`}
                >
                    <BgmRenderer bgm={bgm} />
                </Sequence>
            ))}
        </AbsoluteFill>
    )
}

/**
 * BGM 渲染器 - 支持淡入淡出
 */
interface BgmRendererProps {
    bgm: BgmClip
}

const BgmRenderer: React.FC<BgmRendererProps> = ({ bgm }) => {
    const frame = useCurrentFrame()
    const fadeIn = bgm.fadeIn || 0
    const fadeOut = bgm.fadeOut || 0

    let volume = bgm.volume

    // 淡入
    if (fadeIn > 0 && frame < fadeIn) {
        volume *= interpolate(frame, [0, fadeIn], [0, 1], { extrapolateRight: 'clamp' })
    }

    // 淡出
    if (fadeOut > 0 && frame > bgm.durationInFrames - fadeOut) {
        volume *= interpolate(
            frame,
            [bgm.durationInFrames - fadeOut, bgm.durationInFrames],
            [1, 0],
            { extrapolateLeft: 'clamp' }
        )
    }

    return <Audio src={bgm.src} volume={volume} />
}

/**
 * 单个片段渲染器 - 支持转场效果
 */
interface ClipRendererProps {
    clip: VideoClip & { startFrame: number; endFrame: number }
    config: EditorConfig
    outgoingTransitionType?: 'none' | 'dissolve' | 'fade' | 'slide'
    outgoingTransitionDuration: number
    incomingTransitionType?: 'none' | 'dissolve' | 'fade' | 'slide'
    incomingTransitionDuration: number
    isLastClip: boolean
    playing: boolean
}

const ClipRenderer: React.FC<ClipRendererProps> = ({
    clip,
    config,
    outgoingTransitionType = 'none',
    outgoingTransitionDuration,
    incomingTransitionType = 'none',
    incomingTransitionDuration,
    isLastClip,
    playing,
}) => {
    const frame = useCurrentFrame()
    const clipDuration = clip.durationInFrames
    const trimBefore = Math.max(0, clip.trim?.from || 0)
    const trimAfter = Math.max(trimBefore + 1, clip.trim?.to || trimBefore + clip.durationInFrames)

    // 计算转场效果
    let opacity = 1
    let transform = 'none'

    if (outgoingTransitionType !== 'none' && outgoingTransitionDuration > 0) {
        // 出场转场效果 (在片段末尾)
        if (!isLastClip && frame > clipDuration - outgoingTransitionDuration) {
            const exitProgress = interpolate(
                frame,
                [clipDuration - outgoingTransitionDuration, clipDuration],
                [0, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
            )

            switch (outgoingTransitionType) {
                case 'dissolve':
                case 'fade':
                    opacity = 1 - exitProgress
                    break
                case 'slide':
                    transform = `translateX(${-exitProgress * 100}%)`
                    break
            }
        }

    }

    if (incomingTransitionType !== 'none' && incomingTransitionDuration > 0) {
        if (frame < incomingTransitionDuration) {
            const enterProgress = interpolate(
                frame,
                [0, incomingTransitionDuration],
                [0, 1],
                { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' }
            )

            switch (incomingTransitionType) {
                case 'dissolve':
                case 'fade':
                    opacity = enterProgress
                    break
                case 'slide':
                    transform = `translateX(${(1 - enterProgress) * 100}%)`
                    break
            }
        }
    }

    return (
        <AbsoluteFill style={{ opacity, transform }}>
            {/* 视频 */}
            <Video
                key={`${clip.id}:${trimBefore}:${trimAfter}`}
                src={toDisplayImageUrl(clip.src) || clip.src}
                trimBefore={trimBefore}
                trimAfter={trimAfter}
                volume={clip.sourceAudio?.detached ? 0 : clip.sourceAudio?.volume ?? 1}
                pauseWhenBuffering
                preload="auto"
                acceptableTimeShiftInSeconds={getPlaybackTimeShiftTolerance(playing, clipDuration, config.fps)}
                style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover'
                }}
            />

            {/* 附属配音 */}
            {clip.attachment?.audio && (
                <Audio
                    src={clip.attachment.audio.src}
                    volume={clip.attachment.audio.volume}
                />
            )}

            {/* 附属字幕 */}
            {clip.attachment?.subtitle && (
                <SubtitleOverlay
                    text={clip.attachment.subtitle.text}
                    style={clip.attachment.subtitle.style}
                />
            )}
        </AbsoluteFill>
    )
}

/**
 * 字幕叠加层
 */
interface SubtitleOverlayProps {
    text: string
    style: 'default' | 'cinematic'
}

const SubtitleOverlay: React.FC<SubtitleOverlayProps> = ({ text, style }) => {
    const styles = {
        default: {
            background: 'rgba(0, 0, 0, 0.7)',
            padding: '8px 16px',
            borderRadius: '4px',
            fontSize: '24px',
            color: 'white'
        },
        cinematic: {
            background: 'transparent',
            padding: '12px 24px',
            fontSize: '28px',
            color: 'white',
            textShadow: '2px 2px 4px rgba(0, 0, 0, 0.8)',
            fontWeight: 'bold' as const
        }
    }

    return (
        <AbsoluteFill
            style={{
                justifyContent: 'flex-end',
                alignItems: 'center',
                paddingBottom: '60px'
            }}
        >
            <div style={styles[style]}>
                {text}
            </div>
        </AbsoluteFill>
    )
}

export default VideoComposition
