import { apiFetch } from '@/lib/api-fetch'
import type {
  ScreenwriterScriptSummary,
  ScriptRepaintCreateInput,
  ScriptRepaintCreateResult,
  TargetScriptEpisode,
  VideoRepaintCreateInput,
  VideoRepaintCreateResult,
  VideoRepaintRouteStage,
  VideoRepaintTaskDetail,
} from './types'

async function readJson<T>(response: Response, fallbackMessage: string): Promise<T> {
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object'
        ? ((payload as { error?: { message?: unknown }; message?: unknown }).error?.message
          || (payload as { message?: unknown }).message)
        : null
    throw new Error(typeof message === 'string' ? message : fallbackMessage)
  }
  return payload as T
}

export async function fetchScreenwriterTasks(): Promise<{
  tasks: ScreenwriterScriptSummary[]
  total?: number
  page?: number
  pageSize?: number
}> {
  const response = await apiFetch('/api/screenwriter/tasks', { cache: 'no-store' })
  return await readJson(response, '获取编剧任务失败')
}

export async function createVideoRepaintTask(input: VideoRepaintCreateInput): Promise<VideoRepaintCreateResult> {
  const response = await apiFetch('/api/screenwriter/video-repaint', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return await readJson(response, '创建视频转绘任务失败')
}

export async function createScriptRepaintTask(input: ScriptRepaintCreateInput): Promise<ScriptRepaintCreateResult> {
  const response = await apiFetch('/api/screenwriter/script-repaint', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input),
  })
  return await readJson(response, '创建剧本转绘任务失败')
}

export async function fetchVideoRepaintTask(taskId: string): Promise<VideoRepaintTaskDetail> {
  return await fetchRepaintTask('video-repaint', taskId)
}

export async function fetchScriptRepaintTask(taskId: string): Promise<VideoRepaintTaskDetail> {
  return await fetchRepaintTask('script-repaint', taskId)
}

async function fetchRepaintTask(kind: 'video-repaint' | 'script-repaint', taskId: string): Promise<VideoRepaintTaskDetail> {
  const response = await apiFetch(`/api/screenwriter/${kind}/${encodeURIComponent(taskId)}`, {
    cache: 'no-store',
  })
  const payload = await readJson<{ task: VideoRepaintTaskDetail }>(response, kind === 'script-repaint' ? '获取剧本转绘任务失败' : '获取视频转绘任务失败')
  return payload.task
}

export async function runVideoRepaintStage(taskId: string, stage: VideoRepaintRouteStage): Promise<VideoRepaintTaskDetail> {
  return await runRepaintStage('video-repaint', taskId, stage)
}

export async function runScriptRepaintStage(taskId: string, stage: VideoRepaintRouteStage): Promise<VideoRepaintTaskDetail> {
  return await runRepaintStage('script-repaint', taskId, stage)
}

async function runRepaintStage(kind: 'video-repaint' | 'script-repaint', taskId: string, stage: VideoRepaintRouteStage): Promise<VideoRepaintTaskDetail> {
  const response = await apiFetch(
    `/api/screenwriter/${kind}/${encodeURIComponent(taskId)}/stages/${encodeURIComponent(stage)}/run`,
    { method: 'POST' },
  )
  const payload = await readJson<{ task: VideoRepaintTaskDetail }>(response, '运行阶段失败')
  return payload.task
}

export async function retryVideoRepaintStage(taskId: string, stage: VideoRepaintRouteStage, episodeNumber?: number): Promise<VideoRepaintTaskDetail> {
  return await retryRepaintStage('video-repaint', taskId, stage, episodeNumber)
}

export async function retryScriptRepaintStage(taskId: string, stage: VideoRepaintRouteStage, episodeNumber?: number): Promise<VideoRepaintTaskDetail> {
  return await retryRepaintStage('script-repaint', taskId, stage, episodeNumber)
}

async function retryRepaintStage(kind: 'video-repaint' | 'script-repaint', taskId: string, stage: VideoRepaintRouteStage, episodeNumber?: number): Promise<VideoRepaintTaskDetail> {
  const response = await apiFetch(
    `/api/screenwriter/${kind}/${encodeURIComponent(taskId)}/stages/${encodeURIComponent(stage)}/retry`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ episodeNumber }),
    },
  )
  const payload = await readJson<{ task: VideoRepaintTaskDetail }>(response, '重试阶段失败')
  return payload.task
}

export async function approveVideoRepaintStage(taskId: string, stage: VideoRepaintRouteStage, feedback?: string): Promise<VideoRepaintTaskDetail> {
  return await approveRepaintStage('video-repaint', taskId, stage, feedback)
}

export async function approveScriptRepaintStage(taskId: string, stage: VideoRepaintRouteStage, feedback?: string): Promise<VideoRepaintTaskDetail> {
  return await approveRepaintStage('script-repaint', taskId, stage, feedback)
}

async function approveRepaintStage(kind: 'video-repaint' | 'script-repaint', taskId: string, stage: VideoRepaintRouteStage, feedback?: string): Promise<VideoRepaintTaskDetail> {
  const response = await apiFetch(
    `/api/screenwriter/${kind}/${encodeURIComponent(taskId)}/stages/${encodeURIComponent(stage)}/approve`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feedback }),
    },
  )
  const payload = await readJson<{ task: VideoRepaintTaskDetail }>(response, '确认阶段失败')
  return payload.task
}

export async function regenerateVideoRepaintSettings(taskId: string, stage: 'source_settings' | 'target_settings', feedback?: string): Promise<VideoRepaintTaskDetail> {
  return await regenerateRepaintSettings('video-repaint', taskId, stage, feedback)
}

export async function regenerateScriptRepaintSettings(taskId: string, stage: 'source_settings' | 'target_settings', feedback?: string): Promise<VideoRepaintTaskDetail> {
  return await regenerateRepaintSettings('script-repaint', taskId, stage, feedback)
}

async function regenerateRepaintSettings(kind: 'video-repaint' | 'script-repaint', taskId: string, stage: 'source_settings' | 'target_settings', feedback?: string): Promise<VideoRepaintTaskDetail> {
  const endpointStage = stage === 'source_settings' ? 'source-settings' : 'target-settings'
  const response = await apiFetch(
    `/api/screenwriter/${kind}/${encodeURIComponent(taskId)}/${endpointStage}/regenerate`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ feedback }),
    },
  )
  const payload = await readJson<{ task: VideoRepaintTaskDetail }>(response, '重新生成设定失败')
  return payload.task
}

export async function fetchTargetScriptEpisodes(taskId: string): Promise<TargetScriptEpisode[]> {
  return await fetchRepaintTargetScriptEpisodes('video-repaint', taskId)
}

export async function fetchScriptRepaintTargetScriptEpisodes(taskId: string): Promise<TargetScriptEpisode[]> {
  return await fetchRepaintTargetScriptEpisodes('script-repaint', taskId)
}

async function fetchRepaintTargetScriptEpisodes(kind: 'video-repaint' | 'script-repaint', taskId: string): Promise<TargetScriptEpisode[]> {
  const response = await apiFetch(`/api/screenwriter/${kind}/${encodeURIComponent(taskId)}/target-script`, {
    cache: 'no-store',
  })
  const payload = await readJson<{ episodes: TargetScriptEpisode[] }>(response, '获取目标剧本失败')
  return payload.episodes
}

export async function updateTargetScriptEpisode(taskId: string, episodeId: string, input: {
  title?: string
  content: string
}): Promise<TargetScriptEpisode> {
  return await updateRepaintTargetScriptEpisode('video-repaint', taskId, episodeId, input)
}

export async function updateScriptRepaintTargetScriptEpisode(taskId: string, episodeId: string, input: {
  title?: string
  content: string
}): Promise<TargetScriptEpisode> {
  return await updateRepaintTargetScriptEpisode('script-repaint', taskId, episodeId, input)
}

async function updateRepaintTargetScriptEpisode(kind: 'video-repaint' | 'script-repaint', taskId: string, episodeId: string, input: {
  title?: string
  content: string
}): Promise<TargetScriptEpisode> {
  const response = await apiFetch(
    `/api/screenwriter/${kind}/${encodeURIComponent(taskId)}/target-script/${encodeURIComponent(episodeId)}`,
    {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  const payload = await readJson<{ episode: TargetScriptEpisode }>(response, '保存目标剧本失败')
  return payload.episode
}
