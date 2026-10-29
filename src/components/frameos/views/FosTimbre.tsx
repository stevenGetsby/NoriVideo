'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import { AppIcon } from '@/components/ui/icons'
import { MediaImage } from '@/components/media/MediaImage'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { hasAccountPermissions } from '@/lib/account/permissions'
import { toDisplayImageUrl, toPlayableAudioUrl } from '@/lib/media/image-url'
import { resolveTaskResponse } from '@/lib/task/client'
import type { FosAsset, FosProjectData } from '../useFosProject'
import { useAccountBalance } from '@/hooks/common/useAccountBalance'
import { AssetTabs } from './FosAssetShared'
import { characterPairName, validateCharacterAudioFile } from '@/lib/frameos/character-voice-reference'

type TimbreTab = 'seedance' | 'local' | 'batch'

interface VideoModelItem {
  modelKey: string
  name: string
}

interface GenerationConfig {
  videoModels?: VideoModelItem[]
  defaults?: { videoModel?: string | null }
}

function auditionPrompt(character: FosAsset) {
  return [
    `@${character.name} 自然说：“我是${character.name}。这一次，我会亲手拿回属于我的一切。”`,
    '生成清晰普通话人声并准确同步口型；仅保留角色人声，无音乐、环境音、字幕或水印，5 秒。',
  ].join('\n')
}

function formatAudioTime(value: number) {
  if (!Number.isFinite(value) || value < 0) return '0:00'
  const total = Math.floor(value)
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`
}

function CompactAudioPlayer({ src, label }: { src: string; label: string }) {
  const audioRef = useRef<HTMLAudioElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [mediaError, setMediaError] = useState('')

  useEffect(() => {
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
    setMediaError('')
  }, [src])

  const toggle = async () => {
    const audio = audioRef.current
    if (!audio) return
    if (!audio.paused) {
      audio.pause()
      return
    }
    setMediaError('')
    try {
      await audio.play()
    } catch {
      audio.load()
      setMediaError('音频暂时无法播放，请稍后重试。')
    }
  }

  return (
    <div className="fos-voice-player">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onLoadedMetadata={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onDurationChange={(event) => setDuration(Number.isFinite(event.currentTarget.duration) ? event.currentTarget.duration : 0)}
        onTimeUpdate={(event) => setCurrentTime(event.currentTarget.currentTime)}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onError={() => setMediaError('音频加载失败，请刷新后重试。')}
      />
      <button type="button" className="fos-voice-player-play" aria-label={playing ? `暂停${label}` : `播放${label}`} onClick={() => void toggle()}>
        <AppIcon name={playing ? 'pause' : 'play'} />
      </button>
      <span className="fos-voice-player-time">{formatAudioTime(currentTime)}</span>
      <input
        aria-label={`${label}播放进度`}
        type="range"
        min={0}
        max={Math.max(duration, 0.01)}
        step={0.01}
        value={Math.min(currentTime, Math.max(duration, 0.01))}
        disabled={duration <= 0}
        onChange={(event) => {
          const next = Number(event.target.value)
          if (!audioRef.current || !Number.isFinite(next)) return
          audioRef.current.currentTime = next
          setCurrentTime(next)
        }}
      />
      <span className="fos-voice-player-time">{formatAudioTime(duration)}</span>
      <AppIcon name="volume" className="fos-voice-player-volume" />
      {mediaError ? <span className="fos-voice-player-error">{mediaError}</span> : null}
    </div>
  )
}

export function FosTimbre({ data }: { data: FosProjectData }) {
  const { data: session } = useSession()
  const searchParams = useSearchParams()
  const { generationAllowed, generationDisabledReason, generationDisabledLabel } = useAccountBalance()
  const canEdit = hasAccountPermissions({ role: session?.user?.role, permissions: session?.user?.permissions }, ['assetWrite'])
  const characters = data.characters
  const [activeId, setActiveId] = useState(characters[0]?.id ?? '')
  const [tab, setTab] = useState<TimbreTab>('seedance')
  const [batchFiles, setBatchFiles] = useState<File[]>([])
  const [batchBusy, setBatchBusy] = useState(false)
  const [batchReport, setBatchReport] = useState<string | null>(null)
  const [prompt, setPrompt] = useState('')
  const [models, setModels] = useState<VideoModelItem[]>([])
  const [modelKey, setModelKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<number | null>(null)
  const [stage, setStage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [auditionVideoUrl, setAuditionVideoUrl] = useState<string | null>(null)
  const [auditionAudioUrl, setAuditionAudioUrl] = useState<string | null>(null)
  const [boundAudioUrl, setBoundAudioUrl] = useState<string | null>(null)
  const [confirming, setConfirming] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)
  const active = characters.find((character) => character.id === activeId) ?? characters[0]
  const activeIdentity = useRef('')
  activeIdentity.current = `${data.projectId}:${active?.id || ''}`
  const total = characters.length
  const hasBoundVoice = (character: FosAsset) => Boolean(
    character.id === active?.id
      ? boundAudioUrl || character.customVoiceUrl || character.voiceId
      : character.customVoiceUrl || character.voiceId,
  )
  const boundCount = characters.filter(hasBoundVoice).length

  useEffect(() => {
    const requested = searchParams?.get('characterId')?.trim()
    if (requested && characters.some((character) => character.id === requested)) setActiveId(requested)
  }, [characters, searchParams])

  useEffect(() => {
    if (!active) return
    setPrompt(auditionPrompt(active))
    setBoundAudioUrl(active.customVoiceUrl || null)
    setAuditionVideoUrl(null)
    setAuditionAudioUrl(null)
    setError(null)
    setNotice(null)
  }, [active])

  useEffect(() => {
    if (!active?.id) return
    let cancelled = false
    void apiFetch(`/api/novel-promotion/${data.projectId}/character-audition?characterId=${encodeURIComponent(active.id)}`, { cache: 'no-store' })
      .then(async (response) => response.ok ? await response.json() as {
        audition?: { videoUrl?: string | null; audioUrl?: string | null } | null
      } : null)
      .then((payload) => {
        if (cancelled || !payload?.audition) return
        setAuditionVideoUrl(payload.audition.videoUrl || null)
        setAuditionAudioUrl(payload.audition.audioUrl || null)
      })
      .catch(() => undefined)
    return () => { cancelled = true }
  }, [active?.id, data.projectId])

  useEffect(() => {
    void apiFetch(`/api/frameos/generation-config?projectId=${encodeURIComponent(data.projectId)}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiErrorMessage(response, '加载视频模型失败'))
        return await response.json() as GenerationConfig
      })
      .then((config) => {
        const seedance = (config.videoModels || []).filter((model) => /seedance[\s_-]*2[\s_.-]*0/i.test(`${model.modelKey} ${model.name}`))
        setModels(seedance)
        const preferred = seedance.find((model) => model.modelKey === config.defaults?.videoModel) || seedance[0]
        setModelKey(preferred?.modelKey || '')
      })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : '加载视频模型失败'))
  }, [data.projectId])

  const imageUrl = toDisplayImageUrl(active?.imageUrl)
  const audioUrl = toPlayableAudioUrl(boundAudioUrl)
  const videoUrl = toDisplayImageUrl(auditionVideoUrl)
  const auditionAudio = toPlayableAudioUrl(auditionAudioUrl)
  const modelUnavailable = models.length === 0

  const uploadVoice = async (file: File) => {
    if (!active || !canEdit || busy || batchBusy) return
    const identity = activeIdentity.current
    const invalid = validateCharacterAudioFile(file)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    setStage('正在上传并绑定角色音色…')
    try {
      const formData = new FormData()
      formData.append('characterId', active.id)
      formData.append('file', file)
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/character-voice`, { method: 'POST', body: formData })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '上传角色音色失败'))
      const payload = await response.json() as { audioUrl?: string }
      if (activeIdentity.current !== identity) { data.refetch(); return }
      setBoundAudioUrl(payload.audioUrl || null)
      setNotice(`已将音频绑定为 @${active.name} 的角色音色。`)
      data.refetch()
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : '上传角色音色失败')
    } finally {
      setBusy(false)
      setStage('')
    }
  }

  const generateAudition = async () => {
    if (!generationAllowed) { setError(generationDisabledReason || '当前账号不可生成'); return }
    if (!active || !canEdit || !modelKey || !prompt.trim() || busy) return
    setBusy(true)
    setProgress(0)
    setError(null)
    setNotice(null)
    setStage('正在提交 Seedance 2.0 试镜…')
    try {
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/character-audition`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: active.id, prompt, videoModel: modelKey, locale: 'zh' }),
      })
      const result = await resolveTaskResponse<{ videoUrl?: string; audioUrl?: string }>(response, {
        onTaskUpdate: (task) => {
          setProgress(task.progress ?? 0)
          setStage(task.status === 'queued' ? '试镜任务排队中…' : 'Seedance 正在生成带声音的试镜视频…')
        },
      })
      if (!result.videoUrl) throw new Error('试镜任务完成但没有返回视频。')
      setAuditionVideoUrl(result.videoUrl)
      if (!result.audioUrl) throw new Error('试镜视频已生成，但服务器没有返回提取后的角色音轨。')
      setAuditionAudioUrl(result.audioUrl)
      setNotice('试镜音色已生成，请先试听，满意后再确认绑定。')
    } catch (generateError) {
      setError(generateError instanceof Error ? generateError.message : '生成角色试镜失败')
    } finally {
      setBusy(false)
      setProgress(null)
      setStage('')
    }
  }

  const confirmAuditionVoice = async () => {
    if (!active || !auditionAudioUrl || !canEdit || confirming) return
    setConfirming(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/character-voice`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          characterId: active.id,
          voiceType: 'seedance-audition',
          voiceId: null,
          customVoiceUrl: auditionAudioUrl,
        }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '绑定角色音色失败'))
      setBoundAudioUrl(auditionAudioUrl)
      setAuditionAudioUrl(null)
      setNotice(`已确认并绑定为 @${active.name} 的角色音色。`)
      data.refetch()
    } catch (confirmError) {
      setError(confirmError instanceof Error ? confirmError.message : '绑定角色音色失败')
    } finally {
      setConfirming(false)
    }
  }

  const clearVoice = async () => {
    if (!active || !canEdit || busy) return
    setBusy(true)
    setError(null)
    try {
      const response = await apiFetch(`/api/novel-promotion/${data.projectId}/character-voice`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ characterId: active.id, voiceType: null, voiceId: null, customVoiceUrl: null }),
      })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '解除角色音色失败'))
      setBoundAudioUrl(null)
      setNotice(`已解除 @${active.name} 的角色音色。`)
      data.refetch()
    } catch (clearError) {
      setError(clearError instanceof Error ? clearError.message : '解除角色音色失败')
    } finally {
      setBusy(false)
    }
  }

  const uploadBatchVoices = async () => {
    if (!canEdit || batchBusy || batchFiles.length === 0) return
    setBatchBusy(true)
    setBatchReport(null)
    const characterByName = new Map<string, FosAsset[]>()
    for (const character of characters) {
      const name = character.name.normalize('NFKC').trim().toLocaleLowerCase()
      characterByName.set(name, [...(characterByName.get(name) || []), character])
    }
    const successes: string[] = []
    const failures: string[] = []
    const failedFiles: File[] = []
    const names = batchFiles.map((file) => characterPairName(file.name))
    try {
      for (const file of batchFiles) {
        try {
          const baseName = characterPairName(file.name)
          const matches = characterByName.get(baseName) || []
          const invalid = validateCharacterAudioFile(file)
          if (invalid) throw new Error(invalid)
          if (matches.length !== 1) throw new Error(matches.length ? '存在多个同名角色，请先修改名称再绑定' : '未找到同名角色')
          if (names.filter((name) => name === baseName).length > 1) throw new Error('多个音色文件匹配同一角色，请只保留一个')
          const formData = new FormData()
          formData.append('characterId', matches[0].id); formData.append('file', file)
          const response = await apiFetch(`/api/novel-promotion/${data.projectId}/character-voice`, { method: 'POST', body: formData })
          if (!response.ok) throw new Error(await readApiErrorMessage(response, '上传失败'))
          successes.push(matches[0].name)
        } catch (cause) {
          failures.push(`${file.name}：${cause instanceof Error ? cause.message : '上传失败'}`)
          failedFiles.push(file)
        }
      }
      if (successes.length > 0) data.refetch()
      setBatchReport(`成功绑定 ${successes.length} 个角色${failures.length ? `；失败 ${failures.length} 个（${failures.slice(0, 3).join('；')}）` : ''}。`)
      setBatchFiles(failedFiles)
    } finally {
      setBatchBusy(false)
    }
  }

  const statusText = useMemo(() => active?.customVoiceUrl || boundAudioUrl ? '已绑定角色音色' : '尚未绑定音色', [active?.customVoiceUrl, boundAudioUrl])

  return (
    <div className="fos-timbre-layout grid min-h-0 min-w-0 flex-1">
      <aside className="flex min-h-0 flex-col border-r border-[var(--fos-border-soft)]">
        <div className="flex-none p-3">
          <AssetTabs projectId={data.projectId} active="timbre" />
          <div className="flex items-center justify-between"><h2 className="text-[14px] font-bold text-white">角色音色</h2><span className="fos-pill" style={{ height: 22 }}>{boundCount}/{total}</span></div>
        </div>
        <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto px-3 pb-3">
          {characters.map((character) => {
            const isActive = character.id === active?.id
            const characterBound = hasBoundVoice(character)
            return <button key={character.id} type="button" onClick={() => setActiveId(character.id)} className="w-full rounded-[10px] px-3 py-2.5 text-left" style={{ border: isActive ? '1px solid rgba(255,255,255,.4)' : '1px solid transparent', background: isActive ? 'var(--fos-primary-soft)' : 'transparent' }}><div className="flex items-center justify-between gap-2"><span className="truncate text-[13px] font-bold text-white">{character.name}</span><span className={`h-2 w-2 rounded-full ${characterBound ? 'bg-[#57d49b]' : 'bg-white/15'}`} /></div><div className="mt-0.5 text-[11px] text-[var(--fos-text-4)]">{characterBound ? '音色已绑定' : '等待设置'} · {character.type}</div></button>
          })}
        </div>
      </aside>

      <article className="min-h-0 overflow-y-auto p-6">
        {active ? <>
          <div className="flex items-start justify-between gap-5"><div><h2 className="text-[17px] font-bold text-white">{active.name} · 角色绑定音色</h2><p className="mt-2 text-[12px] leading-6 text-[var(--fos-text-3)]">每个角色只绑定一个当前音色。该音频会作为后续 Seedance 2.0 分镜视频的角色参考音频输入。</p></div><span className={`rounded-full px-3 py-1 text-[11px] font-bold ${audioUrl ? 'bg-emerald-500/10 text-emerald-300' : 'bg-white/5 text-[var(--fos-text-4)]'}`}>{statusText}</span></div>

          <div className="fos-timbre-tabs mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-[var(--fos-border-soft)]">
            {([['seedance', 'Seedance 2.0 试镜'], ['local', '本地 MP3 上传'], ['batch', '批量按角色名绑定']] as const).map(([key, label]) => <button key={key} type="button" onClick={() => setTab(key)} className="relative h-10 text-[13px] font-bold" style={{ color: tab === key ? '#fff' : 'var(--fos-text-2)' }}>{label}{tab === key ? <span className="absolute inset-x-0 -bottom-px h-0.5 bg-white" /> : null}</button>)}
          </div>

          {tab === 'seedance' ? <section className="mt-5">
            <div className="fos-timbre-studio-grid">
              <div className="fos-timbre-card fos-timbre-reference-card">
                <div className="fos-timbre-card-heading"><span>角色设定图</span><small>自动作为人物参考</small></div>
                <div className="fos-timbre-reference-media">
                  {imageUrl ? <MediaImage src={imageUrl} alt={active.name} fill sizes="360px" style={{ objectFit: 'contain' }} /> : <div className="fos-timbre-empty">尚无角色设定图</div>}
                </div>
              </div>

              <div className="fos-timbre-card fos-timbre-control-card">
                <div className="fos-timbre-card-heading"><span>试镜台词与声音要求</span><small>生成后先试听，再确认绑定</small></div>
                <textarea className="fos-textarea fos-timbre-prompt" value={prompt} readOnly={!canEdit} onChange={(event) => setPrompt(event.target.value)} />
                <div className="fos-timbre-submit-row">
                  <select className="fos-input" value={modelKey} disabled={!canEdit || busy || modelUnavailable} onChange={(event) => setModelKey(event.target.value)}>
                    {models.map((model) => <option key={model.modelKey} value={model.modelKey}>{model.name}</option>)}
                    {modelUnavailable ? <option value="">未配置 Seedance 2.0</option> : null}
                  </select>
                  <button type="button" className="fos-btn fos-btn-primary" disabled={!generationAllowed || !canEdit || busy || modelUnavailable || !imageUrl || !prompt.trim()} title={!generationAllowed ? generationDisabledReason || undefined : undefined} onClick={() => void generateAudition()}>
                    <AppIcon name={busy ? 'loader' : 'video'} className={`h-4 w-4 ${busy ? 'animate-spin' : ''}`} />
                    {busy ? '试镜处理中…' : !generationAllowed ? generationDisabledLabel : '生成试镜音色'}
                  </button>
                </div>
                {stage ? <div className="fos-timbre-progress"><span>{stage}</span><strong>{progress ?? 0}%</strong></div> : <div className="fos-timbre-control-note">使用角色设定图生成 5 秒带人声试镜，并自动提取纯净音轨。</div>}
              </div>

              <div className="fos-timbre-card fos-timbre-video-card">
                <div className="fos-timbre-card-heading"><span>试镜视频</span><small>{videoUrl ? '已生成' : '等待生成'}</small></div>
                <div className="fos-timbre-video-media">
                  {videoUrl ? <video src={videoUrl} controls playsInline preload="metadata" /> : <div className="fos-timbre-empty"><AppIcon name="video" /><span>生成后在这里预览人物口型与表演</span></div>}
                </div>
              </div>

              <div className={`fos-timbre-card fos-timbre-audio-card${auditionAudio ? ' is-ready' : ''}`}>
                <div className="fos-timbre-audio-header">
                  <div><div className="fos-timbre-card-heading"><span>待确认的试镜音色</span><small>{auditionAudio ? '试听满意后绑定' : '等待生成'}</small></div><p>绑定前不会覆盖当前角色音色。</p></div>
                  {auditionAudio ? <button type="button" className="fos-btn fos-btn-primary fos-btn-sm" disabled={confirming} onClick={() => void confirmAuditionVoice()}>{confirming ? '绑定中…' : '确认并绑定音色'}</button> : null}
                </div>
                {auditionAudio ? <CompactAudioPlayer src={auditionAudio} label="试镜音色" /> : <div className="fos-timbre-audio-placeholder"><AppIcon name="volume" />完成视频生成后，将自动提取可绑定音轨</div>}
              </div>
            </div>
          </section> : null}

          {tab === 'local' ? <section className="mt-5"><input ref={fileRef} className="hidden" type="file" accept="audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadVoice(file); event.currentTarget.value = '' }} /><button type="button" className="fos-dropzone w-full" style={{ minHeight: 150 }} disabled={!canEdit || busy} onClick={() => fileRef.current?.click()}><AppIcon name="upload" className="h-7 w-7" /><span className="text-[13px] font-semibold text-[var(--fos-text-2)]">上传 {active.name} 的角色音色</span><span className="text-[11px]">优先支持 MP3；也可上传 WAV / M4A / OGG，最大 50MB</span></button></section> : null}
          {tab === 'batch' ? <section className="mt-5 space-y-4">
            <div className="rounded-[10px] border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] px-4 py-3 text-[12px] leading-5 text-[var(--fos-text-2)]">选择多个音频，系统按“文件名 = 角色名”自动绑定。例如：<code>关羽.mp3</code> 会绑定角色“关羽”；也支持 <code>关羽_voice.wav</code>。</div>
            <input className="hidden" id="batch-character-voices" type="file" multiple disabled={!canEdit || batchBusy || busy} accept="audio/mpeg,audio/mp3,audio/wav,audio/mp4,audio/ogg,.mp3,.wav,.m4a,.ogg" onChange={(event) => {
              const files = Array.from(event.target.files || [])
              event.currentTarget.value = ''
              if (files.length > 100) { setError('每批最多 100 个音色文件'); return }
              const invalid = files.find((file) => validateCharacterAudioFile(file))
              if (invalid) { setError(`${invalid.name}：${validateCharacterAudioFile(invalid)}`); return }
              setBatchFiles(files); setBatchReport(null); setError(null)
            }} />
            <label htmlFor="batch-character-voices" className="fos-dropzone flex w-full cursor-pointer flex-col" style={{ minHeight: 150 }}><AppIcon name="upload" className="h-7 w-7" /><span className="text-[13px] font-semibold text-[var(--fos-text-2)]">选择多个角色音频</span><span className="text-[11px]">{batchFiles.length ? `已选择 ${batchFiles.length} 个文件` : '文件名请使用角色名称，便于自动匹配'}</span></label>
            <button type="button" className="fos-btn fos-btn-primary" disabled={!canEdit || batchBusy || batchFiles.length === 0} onClick={() => void uploadBatchVoices()}>{batchBusy ? '批量绑定中…' : '开始批量绑定音色'}</button>
            {batchReport ? <div className="rounded-lg border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] px-3 py-2 text-[12px] text-[var(--fos-text-1)]">{batchReport}</div> : null}
          </section> : null}

          {audioUrl ? <section className="fos-bound-voice-card"><div className="fos-bound-voice-heading"><div><h3>当前绑定音色 · @{active.name}</h3><p>该角色所在分镜会自动使用这段参考音频。</p></div><button type="button" className="fos-btn fos-btn-ghost fos-btn-sm text-red-200" disabled={!canEdit || busy} onClick={() => void clearVoice()}>解除绑定</button></div><CompactAudioPlayer src={audioUrl} label={`${active.name} 当前音色`} /></section> : null}
          {error ? <div className="mt-4 rounded-lg border border-red-400/25 bg-red-500/10 px-3 py-2 text-[11px] leading-5 text-red-200">{error}</div> : null}
          {notice ? <div className="mt-4 rounded-lg border border-[var(--fos-primary-border)] bg-[var(--fos-primary-soft)] px-3 py-2 text-[11px] leading-5 text-[var(--fos-text-1)]">{notice}</div> : null}
        </> : <div className="fos-loading">当前作品没有角色资产。</div>}
      </article>

      <aside className="min-h-0 overflow-y-auto border-l border-[var(--fos-border-soft)] p-5">
        <h3 className="mb-3 text-[14px] font-bold text-white">角色画像</h3>
        <div className="relative aspect-[16/9] overflow-hidden rounded-lg border border-[var(--fos-border-mid)] bg-black/35">{imageUrl ? <MediaImage src={imageUrl} alt={active?.name || '角色'} fill sizes="300px" style={{ objectFit: 'contain' }} /> : <AppIcon name="user" className="absolute left-1/2 top-1/2 h-9 w-9 -translate-x-1/2 -translate-y-1/2 text-white/15" />}</div>
        <h3 className="mb-2 mt-5 text-[14px] font-bold text-white">角色信息</h3><div className="text-[11px] font-bold text-[var(--fos-text-4)]">角色类型</div><div className="mb-3 text-[13px] font-bold text-white">{active?.type || '未设定'}</div><div className="text-[11px] font-bold text-[var(--fos-text-4)]">LLM 角色设定</div><p className="mt-1 whitespace-pre-wrap text-[12px] leading-6 text-[var(--fos-text-2)]">{active?.description || active?.prompt || '暂无角色设定。'}</p>
      </aside>
    </div>
  )
}
