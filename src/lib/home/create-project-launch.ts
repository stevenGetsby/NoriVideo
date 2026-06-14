import { readApiErrorMessage } from '@/lib/api/read-error-message'

interface ProjectCreationPayload {
  project?: {
    id?: string | null
  } | null
}

interface ApiFetchLike {
  (input: string, init?: RequestInit): Promise<Response>
}

export interface HomeWorkspaceLaunchTarget {
  pathname: string
  query: {
    fromHome?: '1'
  }
}

export interface CreateHomeProjectLaunchParams {
  apiFetch: ApiFetchLike
  projectName: string
  storyText: string
  videoRatio: string
  artStyle: string
  artStylePrompt?: string
  episodeName: string
}

export interface CreateHomeProjectLaunchResult {
  projectId: string
  target: HomeWorkspaceLaunchTarget
}

function readObject(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null
  return value as Record<string, unknown>
}

function readNestedString(
  source: Record<string, unknown> | null,
  outerKey: string,
  innerKey: string,
): string | null {
  const outer = readObject(source?.[outerKey])
  const value = outer?.[innerKey]
  return typeof value === 'string' && value.trim() ? value : null
}

async function readProjectId(response: Response): Promise<string> {
  const payload = await response.json() as ProjectCreationPayload
  const projectId = readNestedString(readObject(payload), 'project', 'id')
  if (!projectId) {
    throw new Error('Project creation response missing project id')
  }
  return projectId
}

export function buildHomeWorkspaceLaunchTarget(projectId: string): HomeWorkspaceLaunchTarget {
  return {
    pathname: `/workspace/${projectId}`,
    query: {
      fromHome: '1',
    },
  }
}

export async function createHomeProjectLaunch({
  apiFetch,
  projectName,
  storyText,
  videoRatio,
  artStyle,
  artStylePrompt,
  episodeName,
}: CreateHomeProjectLaunchParams): Promise<CreateHomeProjectLaunchResult> {
  const projectResponse = await apiFetch('/api/projects', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: projectName,
      initialNovelText: storyText,
      initialEpisodeName: episodeName,
    }),
  })

  if (!projectResponse.ok) {
    throw new Error(await readApiErrorMessage(projectResponse, 'Failed to create project'))
  }

  const projectId = await readProjectId(projectResponse)

  const configResponse = await apiFetch(`/api/novel-promotion/${projectId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoRatio, artStyle, ...(artStylePrompt ? { artStylePrompt } : {}) }),
  })

  if (!configResponse.ok) {
    throw new Error(await readApiErrorMessage(configResponse, 'Failed to save project config'))
  }

  return {
    projectId,
    target: buildHomeWorkspaceLaunchTarget(projectId),
  }
}
