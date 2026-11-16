import { readProfile } from '@/lib/interactive/achievements'

export interface MpMe {
  id: string
  nickname: string
  avatarIndex: number
  stats: { played: number; endings: number; achievements: number }
}

export interface MpMeSaveRow {
  endingsGot: number
  profile: unknown
}

export function toMpMe(user: { id: string; nickname: string; avatarIndex: number }, saves: MpMeSaveRow[]): MpMe {
  return {
    id: user.id,
    nickname: user.nickname,
    avatarIndex: user.avatarIndex,
    stats: {
      played: saves.length,
      endings: saves.reduce((sum, save) => sum + save.endingsGot, 0),
      achievements: saves.reduce((sum, save) => sum + readProfile(save.profile).achievements.length, 0),
    },
  }
}
