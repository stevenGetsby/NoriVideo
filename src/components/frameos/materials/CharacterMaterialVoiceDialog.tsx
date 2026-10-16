'use client'

import { useEffect, useRef, useState } from 'react'
import { apiFetch } from '@/lib/api-fetch'
import { readApiErrorMessage } from '@/lib/api/read-error-message'
import { toPlayableAudioUrl } from '@/lib/media/image-url'
import { validateCharacterAudioFile } from '@/lib/frameos/character-voice-reference'
import { ViewportDialogLayer } from '../ViewportDialogLayer'
import { MaterialPickerDialog } from './MaterialPickerDialog'
import type { FrameosMaterialItem } from './contracts'

export function CharacterMaterialVoiceDialog({ material, onSaved, onClose }: {
  material: { id: string; name: string; projectId: string; voiceUrl?: string | null; globalCharacter?: boolean }
  onSaved: () => void
  onClose: () => void
}) {
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [voiceUrl, setVoiceUrl] = useState(material.voiceUrl || null)
  const busyRef = useRef(false)
  const uploadedRef = useRef<{ file: File; voice: FrameosMaterialItem } | null>(null)
  useEffect(() => {
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape' && !busyRef.current && !picker) onClose() }
    window.addEventListener('keydown', escape)
    return () => window.removeEventListener('keydown', escape)
  }, [onClose, picker])
  const bind = async (voice: FrameosMaterialItem | null) => {
    const response = await apiFetch(material.globalCharacter ? `/api/frameos/character-voices/${material.id}` : `/api/frameos/materials/${material.id}`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ voiceMaterialId: voice?.id || null }),
    })
    if (!response.ok) throw new Error(await readApiErrorMessage(response, '绑定音色失败'))
    setVoiceUrl(voice?.url || null)
    onSaved()
  }
  const run = async (operation: () => Promise<void>) => {
    if (busyRef.current) return
    busyRef.current = true
    setBusy(true); setError(null)
    try { await operation() }
    catch (cause) { setError(cause instanceof Error ? cause.message : '音色设置失败') }
    finally { busyRef.current = false; setBusy(false) }
  }
  const upload = (file: File) => run(async () => {
    const invalid = validateCharacterAudioFile(file)
    if (invalid) throw new Error(invalid)
    let voice = uploadedRef.current?.file === file ? uploadedRef.current.voice : null
    if (!voice) {
      const form = new FormData()
      form.set('file', file); form.set('title', `${material.name}音色`)
      form.set('projectId', material.projectId); form.set('assetCategory', 'character')
      const response = await apiFetch('/api/frameos/materials', { method: 'POST', body: form })
      if (!response.ok) throw new Error(await readApiErrorMessage(response, '上传音色失败'))
      const payload = await response.json() as { material?: FrameosMaterialItem }
      if (!payload.material) throw new Error('音色上传成功但没有返回素材')
      voice = payload.material
      uploadedRef.current = { file, voice }
    }
    await bind(voice)
    onClose()
  })
  return <>
    <ViewportDialogLayer>
      <div className="fos-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget && !busyRef.current) onClose() }}>
        <section className="fos-dialog" role="dialog" aria-modal="true" aria-label={`设置角色音色 ${material.name}`} style={{ maxWidth: 520 }}>
          <div className="fos-dialog-head"><h3 className="fos-dialog-title min-w-0 flex-1" style={{ overflowWrap: 'anywhere' }}>{material.name} · 角色音色</h3><button type="button" className="fos-dialog-x shrink-0" disabled={busy} aria-label="关闭角色音色" onClick={onClose}>×</button></div>
          <div className="fos-dialog-body space-y-4">
            <p className="text-[12px] leading-5 text-[var(--fos-text-3)]">音色绑定在角色卡上。视频全能参考且开启声音时，引用这张角色图会自动带上音色；纯文生、图片生成和首尾帧不会传音频。</p>
            {voiceUrl ? <audio controls src={toPlayableAudioUrl(voiceUrl) || voiceUrl} className="w-full" /> : <p className="text-[12px] text-[var(--fos-text-4)]">尚未绑定音色</p>}
            <label className="block text-[12px] text-white">上传 MP3 / WAV / M4A / OGG（最多 50MB）<input className="fos-input mt-2 w-full" type="file" accept="audio/*,.mp3,.wav,.m4a,.ogg" disabled={busy} onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); event.target.value = '' }} /></label>
            {uploadedRef.current && error ? <button type="button" className="fos-btn fos-btn-soft" disabled={busy} onClick={() => void run(async () => { await bind(uploadedRef.current!.voice); onClose() })}>重试绑定已上传音色（不重复上传）</button> : null}
            <button type="button" className="fos-btn fos-btn-soft" disabled={busy} onClick={() => setPicker(true)}>从音色素材库选择</button>
            {error ? <p role="alert" className="break-words text-[12px] text-red-200">{error}</p> : null}
          </div>
          <div className="fos-dialog-foot">{voiceUrl ? <button type="button" className="fos-btn fos-btn-ghost" disabled={busy} onClick={() => void run(async () => { await bind(null); onClose() })}>解除音色</button> : null}<button type="button" className="fos-btn fos-btn-primary" disabled={busy} onClick={onClose}>{busy ? '保存中…' : '确定并关闭'}</button></div>
        </section>
      </div>
    </ViewportDialogLayer>
    {picker ? <MaterialPickerDialog projectId={material.projectId} type="audio" maxSelected={1} title="选择角色音色" onConfirm={(voices) => { setPicker(false); if (voices[0]) void run(async () => { await bind(voices[0]); onClose() }) }} onClose={() => setPicker(false)} /> : null}
  </>
}
