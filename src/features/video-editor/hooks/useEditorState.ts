'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import {
    type VideoEditorProject,
    type VideoClip,
    type BgmClip,
    type TimelineState,
    createDefaultProject,
    generateClipId
} from '../index'

interface UseEditorStateProps {
    episodeId: string
    initialProject?: VideoEditorProject
}

const MAX_EDITOR_HISTORY = 50

export function useEditorState({ episodeId, initialProject }: UseEditorStateProps) {
    const [project, setProjectState] = useState<VideoEditorProject>(
        initialProject || createDefaultProject(episodeId)
    )
    const projectRef = useRef(project)
    const undoStack = useRef<VideoEditorProject[]>([])
    const redoStack = useRef<VideoEditorProject[]>([])
    const [, setHistoryVersion] = useState(0)

    useEffect(() => {
        projectRef.current = project
    }, [project])

    const [timelineState, setTimelineState] = useState<TimelineState>({
        currentFrame: 0,
        playing: false,
        selectedClipId: null,
        zoom: 1
    })
    const [isDirty, setIsDirty] = useState(false)

    const commitProject = useCallback((transform: (current: VideoEditorProject) => VideoEditorProject) => {
        const previous = projectRef.current
        const next = transform(previous)
        if (next === previous) return false
        undoStack.current = [...undoStack.current.slice(-(MAX_EDITOR_HISTORY - 1)), previous]
        redoStack.current = []
        projectRef.current = next
        setProjectState(next)
        setIsDirty(true)
        setHistoryVersion(version => version + 1)
        return true
    }, [])

    const addClip = useCallback((clip: Omit<VideoClip, 'id'>) => {
        const newClip: VideoClip = { ...clip, id: generateClipId() }
        commitProject(current => ({ ...current, timeline: [...current.timeline, newClip] }))
        return newClip.id
    }, [commitProject])

    const removeClip = useCallback((clipId: string) => {
        commitProject(current => {
            if (!current.timeline.some(clip => clip.id === clipId)) return current
            return { ...current, timeline: current.timeline.filter(clip => clip.id !== clipId) }
        })
    }, [commitProject])

    const updateClip = useCallback((clipId: string, updates: Partial<VideoClip>) => {
        commitProject(current => {
            if (!current.timeline.some(clip => clip.id === clipId)) return current
            return {
                ...current,
                timeline: current.timeline.map(clip => clip.id === clipId ? { ...clip, ...updates } : clip)
            }
        })
    }, [commitProject])

    const reorderClips = useCallback((fromIndex: number, toIndex: number) => {
        commitProject(current => {
            if (fromIndex === toIndex || !current.timeline[fromIndex] || toIndex < 0 || toIndex >= current.timeline.length) return current
            const timeline = [...current.timeline]
            const [removed] = timeline.splice(fromIndex, 1)
            timeline.splice(toIndex, 0, removed)
            return { ...current, timeline }
        })
    }, [commitProject])

    const splitClip = useCallback((clipId: string, offsetFrames: number) => {
        const newClipId = generateClipId()
        commitProject(current => {
            const index = current.timeline.findIndex(clip => clip.id === clipId)
            if (index < 0) return current
            const clip = current.timeline[index]
            if (clip.durationInFrames < 2) return current
            const splitAt = Math.max(1, Math.min(clip.durationInFrames - 1, Math.round(offsetFrames)))
            const sourceFrom = clip.trim?.from ?? 0
            const sourceTo = clip.trim?.to ?? sourceFrom + clip.durationInFrames
            const sourceAudio = clip.sourceAudio
            const firstAudio = sourceAudio?.segments ? {
                ...sourceAudio,
                segments: sourceAudio.segments.flatMap(segment => {
                    const from = Math.max(0, segment.from)
                    const to = Math.min(splitAt, segment.to)
                    const movedStart = Number.isFinite(segment.timelineStartFrame)
                        ? Math.max(0, Math.round(segment.timelineStartFrame!) + (from - segment.from))
                        : undefined
                    return to > from ? [{
                        ...segment,
                        from,
                        to,
                        ...(movedStart === undefined ? {} : { timelineStartFrame: movedStart }),
                    }] : []
                }),
            } : sourceAudio
            const secondAudio = sourceAudio?.segments ? {
                ...sourceAudio,
                segments: sourceAudio.segments.flatMap(segment => {
                    const from = Math.max(splitAt, segment.from)
                    const to = Math.min(clip.durationInFrames, segment.to)
                    const movedStart = Number.isFinite(segment.timelineStartFrame)
                        ? Math.max(0, Math.round(segment.timelineStartFrame!) + (from - segment.from))
                        : undefined
                    return to > from ? [{
                        ...segment,
                        id: `${segment.id}:right:${newClipId}`,
                        from: from - splitAt,
                        to: to - splitAt,
                        ...(movedStart === undefined ? {} : { timelineStartFrame: movedStart }),
                    }] : []
                }),
            } : sourceAudio
            const first: VideoClip = {
                ...clip,
                durationInFrames: splitAt,
                trim: { from: sourceFrom, to: sourceFrom + splitAt },
                transition: undefined,
                sourceAudio: firstAudio,
            }
            const second: VideoClip = {
                ...clip,
                id: newClipId,
                durationInFrames: clip.durationInFrames - splitAt,
                trim: { from: sourceFrom + splitAt, to: sourceTo },
                sourceAudio: secondAudio,
            }
            const timeline = [...current.timeline]
            timeline.splice(index, 1, first, second)
            return { ...current, timeline }
        })
        return newClipId
    }, [commitProject])

    const duplicateClip = useCallback((clipId: string) => {
        const newClipId = generateClipId()
        commitProject(current => {
            const index = current.timeline.findIndex(clip => clip.id === clipId)
            if (index < 0) return current
            const timeline = [...current.timeline]
            timeline.splice(index + 1, 0, { ...current.timeline[index], id: newClipId })
            return { ...current, timeline }
        })
        return newClipId
    }, [commitProject])

    const addBgm = useCallback((bgm: Omit<BgmClip, 'id'>) => {
        const newBgm: BgmClip = { ...bgm, id: `bgm_${Date.now()}` }
        commitProject(current => ({ ...current, bgmTrack: [...current.bgmTrack, newBgm] }))
    }, [commitProject])

    const removeBgm = useCallback((bgmId: string) => {
        commitProject(current => {
            if (!current.bgmTrack.some(clip => clip.id === bgmId)) return current
            return { ...current, bgmTrack: current.bgmTrack.filter(clip => clip.id !== bgmId) }
        })
    }, [commitProject])

    const undo = useCallback(() => {
        const previous = undoStack.current.pop()
        if (!previous) return null
        redoStack.current.push(projectRef.current)
        projectRef.current = previous
        setProjectState(previous)
        setIsDirty(true)
        setHistoryVersion(version => version + 1)
        return previous
    }, [])

    const redo = useCallback(() => {
        const next = redoStack.current.pop()
        if (!next) return null
        undoStack.current.push(projectRef.current)
        projectRef.current = next
        setProjectState(next)
        setIsDirty(true)
        setHistoryVersion(version => version + 1)
        return next
    }, [])

    // These setters sit on the bidirectional Player <-> timeline boundary.
    // Returning the existing object for an unchanged value is essential:
    // Remotion may report the same frame or playback state more than once.
    const play = useCallback(() => setTimelineState(current => current.playing
        ? current
        : { ...current, playing: true }), [])
    const pause = useCallback(() => setTimelineState(current => current.playing
        ? { ...current, playing: false }
        : current), [])
    const seek = useCallback((frame: number) => setTimelineState(current => {
        if (!Number.isFinite(frame)) return current
        const nextFrame = Math.max(0, Math.round(frame))
        return current.currentFrame === nextFrame ? current : { ...current, currentFrame: nextFrame }
    }), [])
    const selectClip = useCallback((clipId: string | null) => setTimelineState(current => current.selectedClipId === clipId
        ? current
        : { ...current, selectedClipId: clipId }), [])
    const setZoom = useCallback((zoom: number) => setTimelineState(current => {
        if (!Number.isFinite(zoom)) return current
        const nextZoom = Math.max(0.1, Math.min(5, zoom))
        return current.zoom === nextZoom ? current : { ...current, zoom: nextZoom }
    }), [])

    const loadProject = useCallback((data: VideoEditorProject) => {
        projectRef.current = data
        undoStack.current = []
        redoStack.current = []
        setProjectState(data)
        setIsDirty(false)
        setHistoryVersion(version => version + 1)
    }, [])

    const resetProject = useCallback(() => loadProject(createDefaultProject(episodeId)), [episodeId, loadProject])
    const replaceProject = useCallback((data: VideoEditorProject) => { commitProject(() => data) }, [commitProject])
    const markSaved = useCallback(() => setIsDirty(false), [])

    return {
        project,
        timelineState,
        isDirty,
        canUndo: undoStack.current.length > 0,
        canRedo: redoStack.current.length > 0,
        addClip,
        removeClip,
        updateClip,
        reorderClips,
        splitClip,
        duplicateClip,
        addBgm,
        removeBgm,
        undo,
        redo,
        play,
        pause,
        seek,
        selectClip,
        setZoom,
        resetProject,
        loadProject,
        replaceProject,
        markSaved,
    }
}
