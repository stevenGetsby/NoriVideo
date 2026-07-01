import { describe, expect, it } from 'vitest'
import { splitNovelIntoEpisodes } from '@/lib/novel-promotion/episode-split'

describe('splitNovelIntoEpisodes', () => {
  it('splits only by explicit episode headings', async () => {
    const content = `
浅钓的督军易上钩
故事简介：
这段只用于项目简介，不能并入第一集正文。这里补足长度，确保输入超过最低文本长度要求。
正文
第一集
1-1
场景：破旧柴房 - 夜 - 雨
苏晚卿从混沌中惊醒，被张秃子逼近。她摸出银簪反抗，跌跌撞撞冲进瓢泼大雨。

第二集
2-1
场景：城郊土地庙 - 夜 - 雨
陆承煜在土地庙门口冷声喝止追兵，救下浑身湿透的苏晚卿，并留下令牌。
`

    const episodes = await splitNovelIntoEpisodes({
      userId: 'user-1',
      projectId: 'project-1',
      content,
      locale: 'zh',
    })

    expect(episodes).toHaveLength(2)
    expect(episodes.map((episode) => episode.title)).toEqual(['第1集', '第2集'])
    expect(episodes[0].content).toContain('苏晚卿从混沌中惊醒')
    expect(episodes[0].content).not.toContain('故事简介')
    expect(episodes[1].content).toContain('陆承煜在土地庙门口冷声喝止追兵')
  })

  it('rejects scripts without explicit episode headings', async () => {
    await expect(splitNovelIntoEpisodes({
      userId: 'user-1',
      projectId: 'project-1',
      content: '这里是没有明确分集标题的长文本。'.repeat(20),
      locale: 'zh',
    })).rejects.toThrow('未检测到明确分集标题')
  })
})
