'use client'

import React, { useMemo, useRef, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { Player, PlayerRef } from '@remotion/player'
import { prefetch } from 'remotion'
import { AppIcon } from '@/components/ui/icons'
import { VideoComposition } from '../../remotion/VideoComposition'
import { VideoEditorProject } from '../../types/editor.types'
import { calculateTimelineDuration } from '../../utils/time-utils'
import { computeClipPositions } from '../../utils/time-utils'
import { decidePendingSeekFrame, shouldPublishPlayerFrame, shouldSynchronizePlayerFrame } from '../../utils/playback-sync'
import { toDisplayImageUrl } from '@/lib/media/image-url'

interface RemotionPreviewProps {
    project: VideoEditorProject
    currentFrame: number
    playing: boolean
    onFrameChange?: (frame: number) => void
    onPlayingChange?: (playing: boolean) => void
}

export interface RemotionPreviewHandle {
    pauseAndSeek: (frame: number) => void
}

/**
 * Remotion Player 预览封装
 * 支持双向同步：timelineState ↔ Player
 */
export const RemotionPreview = React.forwardRef<RemotionPreviewHandle, RemotionPreviewProps>(function RemotionPreview({
    project,
    currentFrame,
    playing,
    onFrameChange,
    onPlayingChange
}, forwardedRef) {
    const t = useTranslations('video')
    const playerRef = useRef<PlayerRef>(null)
    const shellRef = useRef<HTMLDivElement>(null)
    const prefetchHandlesRef = useRef<Map<string, ReturnType<typeof prefetch>>>(new Map())
    const onFrameChangeRef = useRef(onFrameChange)
    const onPlayingChangeRef = useRef(onPlayingChange)
    const lastPublishedFrameRef = useRef<number | null>(Math.round(currentFrame))
    const pendingExternalSeekFrameRef = useRef<number | null>(null)
    const lastPublishedPlayingRef = useRef(playing)
    const [shellSize, setShellSize] = useState({ width: 0, height: 0 })

    onFrameChangeRef.current = onFrameChange
    onPlayingChangeRef.current = onPlayingChange

    const totalDuration = useMemo(
        () => calculateTimelineDuration(project.timeline),
        [project.timeline]
    )
    const hasClips = project.timeline.length > 0
    const currentClipIndex = useMemo(() => {
        const positions = computeClipPositions(project.timeline)
        return Math.max(0, positions.findIndex(clip => currentFrame >= clip.startFrame && currentFrame < clip.endFrame))
    }, [currentFrame, project.timeline])
    const prefetchSources = useMemo(() => [...new Set(project.timeline
        .slice(Math.max(0, currentClipIndex - 1), currentClipIndex + 3)
        .map(clip => toDisplayImageUrl(clip.src) || clip.src)
        .filter(Boolean))], [currentClipIndex, project.timeline])
    const playerSize = useMemo(() => {
        const aspect = Math.max(0.01, project.config.width / project.config.height)
        if (!shellSize.width || !shellSize.height) return null
        if (shellSize.width / shellSize.height > aspect) {
            return { width: shellSize.height * aspect, height: shellSize.height }
        }
        return { width: shellSize.width, height: shellSize.width / aspect }
    }, [project.config.height, project.config.width, shellSize.height, shellSize.width])
    const compositionInputProps = useMemo(() => ({
        clips: project.timeline,
        bgmTrack: project.bgmTrack,
        config: project.config,
        playing,
    }), [playing, project.bgmTrack, project.config, project.timeline])

    React.useImperativeHandle(forwardedRef, () => ({
        pauseAndSeek(frame: number) {
            const player = playerRef.current
            if (!player || !Number.isFinite(frame)) return
            const nextFrame = Math.max(0, Math.min(Math.max(0, totalDuration - 1), Math.round(frame)))
            // Arm the guard before pausing: pause itself may synchronously emit
            // a final frameupdate from the old playback position.
            pendingExternalSeekFrameRef.current = nextFrame
            lastPublishedFrameRef.current = nextFrame
            player.pause()
            player.seekTo(nextFrame)
        },
    }), [totalDuration])

    useEffect(() => {
        const element = shellRef.current
        if (!element) return
        const update = () => {
            // clientWidth/clientHeight stay in the shell's logical coordinate
            // system. getBoundingClientRect() already includes the app-level
            // 120% CSS zoom and writing it back as CSS pixels scales the player
            // a second time (most visibly after undo causes a re-render).
            const width = element.clientWidth
            const height = element.clientHeight
            setShellSize((current) => current.width === width && current.height === height
                ? current
                : { width, height })
        }
        update()
        const observer = new ResizeObserver(update)
        observer.observe(element)
        return () => observer.disconnect()
    }, [hasClips])

    useEffect(() => {
        const handles = prefetchHandlesRef.current
        const desiredSources = new Set(prefetchSources)

        for (const src of desiredSources) {
            if (handles.has(src)) continue
            const handle = prefetch(src, { method: 'blob-url' })
            handles.set(src, handle)
            void handle.waitUntilDone().catch(() => {
                if (handles.get(src) !== handle) return
                handle.free()
                handles.delete(src)
            })
        }

        // Keep overlapping handles alive when the playhead crosses a cut. A
        // cleanup-per-window would revoke a Blob URL still used by the player.
        for (const [src, handle] of handles) {
            if (desiredSources.has(src)) continue
            handle.free()
            handles.delete(src)
        }
    }, [prefetchSources])

    useEffect(() => () => {
        for (const handle of prefetchHandlesRef.current.values()) handle.free()
        prefetchHandlesRef.current.clear()
    }, [])

    // 当 currentFrame 从外部改变时，同步到 Player
    useEffect(() => {
        const player = playerRef.current
        if (!player) return

        // frameupdate 会经过 React 状态再回到这里。繁忙界面下这个状态可能
        // 落后播放器数帧；播放中据此反向 seek 会让刚播过的画面再播一次。
        // 用户主动拖动/跳镜会先暂停，因此这里只在暂停态同步外部定位。
        // Pause synchronously before seekTo. Waiting for the separate playing
        // effect leaves a small window where the old playback position can
        // emit another frame and snap the timeline back after a user click.
        if (!playing) player.pause()
        const playerFrame = player.getCurrentFrame()
        if (shouldSynchronizePlayerFrame(currentFrame, playerFrame, playing)) {
            const nextFrame = Math.round(currentFrame)
            pendingExternalSeekFrameRef.current = nextFrame
            lastPublishedFrameRef.current = nextFrame
            player.seekTo(nextFrame)
        } else if (!playing) {
            pendingExternalSeekFrameRef.current = null
            lastPublishedFrameRef.current = Math.round(playerFrame)
        }
    }, [currentFrame, playing])

    // 当 playing 状态改变时，控制 Player 播放/暂停
    useEffect(() => {
        const player = playerRef.current
        if (!player) return

        lastPublishedPlayingRef.current = playing
        if (playing) {
            pendingExternalSeekFrameRef.current = null
            player.play()
        } else {
            player.pause()
        }
    }, [playing])

    // 监听 Player 的帧变化，同步到 timelineState
    useEffect(() => {
        const player = playerRef.current
        if (!player) return

        const handleFrameUpdate = () => {
            const frame = Math.round(player.getCurrentFrame())
            const pendingDecision = decidePendingSeekFrame(frame, pendingExternalSeekFrameRef.current)
            if (pendingDecision === 'ignore') return
            if (pendingDecision === 'settled') {
                pendingExternalSeekFrameRef.current = null
                lastPublishedFrameRef.current = frame
                return
            }
            if (!shouldPublishPlayerFrame(frame, lastPublishedFrameRef.current)) return
            lastPublishedFrameRef.current = frame
            onFrameChangeRef.current?.(frame)
        }

        // Remotion Player 触发 timeupdate 事件
        player.addEventListener('frameupdate', handleFrameUpdate)

        return () => {
            player.removeEventListener('frameupdate', handleFrameUpdate)
        }
    }, [hasClips])

    // 监听 Player 播放状态变化
    useEffect(() => {
        const player = playerRef.current
        if (!player) return

        const publishPlaying = (nextPlaying: boolean) => {
            if (lastPublishedPlayingRef.current === nextPlaying) return
            lastPublishedPlayingRef.current = nextPlaying
            onPlayingChangeRef.current?.(nextPlaying)
        }
        const handlePlay = () => publishPlaying(true)
        const handlePause = () => publishPlaying(false)
        const handleEnded = () => publishPlaying(false)

        player.addEventListener('play', handlePlay)
        player.addEventListener('pause', handlePause)
        player.addEventListener('ended', handleEnded)

        return () => {
            player.removeEventListener('play', handlePlay)
            player.removeEventListener('pause', handlePause)
            player.removeEventListener('ended', handleEnded)
        }
    }, [hasClips])

    // 如果没有片段，显示占位
    if (!hasClips) {
        return (
            <div ref={shellRef} style={{
                width: '100%',
                height: '100%',
                background: 'var(--glass-bg-surface)',
                border: '1px solid var(--glass-stroke-base)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '8px',
                color: 'var(--glass-text-tertiary)'
            }}>
                <div style={{ textAlign: 'center' }}>
                    <div style={{ marginBottom: '12px', display: 'flex', justifyContent: 'center' }}>
                        <AppIcon name="image" className="w-12 h-12" />
                    </div>
                    <span>{t('editor.preview.emptyStartEditing')}</span>
                </div>
            </div>
        )
    }

    return (
        <div ref={shellRef} style={{
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--glass-overlay-strong)',
            borderRadius: '8px',
            overflow: 'hidden'
        }}>
            <div style={{
                width: playerSize ? `${playerSize.width}px` : '100%',
                height: playerSize ? `${playerSize.height}px` : '100%',
                maxWidth: '100%',
                maxHeight: '100%',
                aspectRatio: `${project.config.width} / ${project.config.height}`,
                overflow: 'hidden',
                background: '#000',
            }}>
              <Player
                ref={playerRef}
                component={VideoComposition}
                inputProps={compositionInputProps}
                durationInFrames={Math.max(1, totalDuration)}
                fps={project.config.fps}
                compositionWidth={project.config.width}
                compositionHeight={project.config.height}
                style={{
                    width: '100%',
                    height: '100%'
                }}
                controls={false}  // 使用自定义控制
                loop={false}
                moveToBeginningWhenEnded={false}
                clickToPlay={false}  // 禁用点击播放，由外部控制
              />
            </div>
        </div>
    )
})

export default RemotionPreview
