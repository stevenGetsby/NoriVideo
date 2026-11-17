import { describe, expect, it } from 'vitest'
import { toMpMe } from '@/lib/mp/dto'

describe('toMpMe', () => {
  it('sums played works, endings and achievements across saves', () => {
    const user = { id: 'u1', nickname: '观众abc', avatarIndex: 3 }
    const saves = [
      { endingsGot: 2, profile: { achievements: ['a1', 'a2'] } },
      { endingsGot: 1, profile: { achievements: ['a3'] } },
    ]
    expect(toMpMe(user, saves)).toEqual({
      id: 'u1',
      nickname: '观众abc',
      avatarIndex: 3,
      stats: { played: 2, endings: 3, achievements: 3 },
    })
  })

  it('reads broken profiles leniently and counts every save row as played', () => {
    const stats = toMpMe({ id: 'u1', nickname: 'n', avatarIndex: 0 }, [
      { endingsGot: 0, profile: null },
      { endingsGot: 0, profile: 'broken' },
    ]).stats
    expect(stats).toEqual({ played: 2, endings: 0, achievements: 0 })
  })
})
