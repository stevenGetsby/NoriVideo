import { mergeSaveState, permanentStorageKey, readStoredProfile, readStoredSaves, writeStoredProfile, writeStoredSaves, type SaveState } from '../runtime/story-runtime'
import { request } from './api'
import { storageKey, wxStorage } from './storage'
import type { PutSaveResponse, SavePutBody, SaveResponse } from './types'

export function pullSave(slug: string): Promise<SaveResponse> {
  return request<SaveResponse>('GET', `/api/mp/saves/${encodeURIComponent(slug)}`, undefined, { auth: 'required' })
}

export function pushSave(slug: string, body: SavePutBody): Promise<PutSaveResponse> {
  return request<PutSaveResponse>('PUT', `/api/mp/saves/${encodeURIComponent(slug)}`, body, { auth: 'required' })
}

function readLocalPermanent(key: string): unknown {
  const raw = wxStorage.getItem(permanentStorageKey(key))
  if (!raw) return {}
  try {
    return JSON.parse(raw)
  } catch {
    return {}
  }
}

// 进详情页时调用：拉云存档与本地合并后写回本地。调用方须保证当前没有在播放。
export async function syncDown(slug: string): Promise<{ rev: number; state: SaveState }> {
  const key = storageKey(slug)
  const server = await pullSave(slug)
  const merged = mergeSaveState(
    { profile: server.profile, saves: server.saves, permanent: server.permanent },
    { profile: readStoredProfile(wxStorage, key), saves: readStoredSaves(wxStorage, key), permanent: readLocalPermanent(key) },
  )
  writeStoredProfile(wxStorage, key, merged.profile)
  writeStoredSaves(wxStorage, key, merged.saves)
  wxStorage.setItem(permanentStorageKey(key), JSON.stringify(merged.permanent))
  return { rev: server.rev, state: merged }
}
