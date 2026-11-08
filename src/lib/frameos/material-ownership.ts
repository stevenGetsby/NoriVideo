import type { AuthSession } from '@/lib/api-auth'
import { getWorkspaceActor } from '@/lib/collaboration/access'

export const PERSONAL_MATERIAL_PROJECT_ID = 'personal'

export function isPersonalMaterial(material: { personalOwnerId?: string | null; projectId: string }, actorId?: string): boolean {
  if (material.projectId === PERSONAL_MATERIAL_PROJECT_ID) {
    return actorId === undefined || material.personalOwnerId === actorId
  }
  return Boolean(material.personalOwnerId && (actorId === undefined || material.personalOwnerId === actorId))
}

export function canActorAccessMaterial(session: AuthSession, material: { personalOwnerId?: string | null; projectId: string }): boolean {
  return !isPersonalMaterial(material) || isPersonalMaterial(material, getWorkspaceActor(session).actorId)
}

