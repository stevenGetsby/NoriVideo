import { describe, expect, it } from 'vitest'
import {
  EpisodeSplitParseError,
  parseScriptEpisodes,
} from '@/lib/novel-promotion/script-format'

describe('script episode splitter', () => {
  it('splits by Chinese episode headings', () => {
    const result = parseScriptEpisodes(`
故事简介：
一个民国复仇故事。

正文
第一集
1-1
场景：破旧柴房 - 夜 - 雨
苏晚卿从柴房逃出。

第二集
2-1
场景：城郊土地庙 - 夜 - 雨
陆承煜救下苏晚卿。
`, { fileName: 'sample.txt' })

    expect(result.version).toBe('episode-split-v1')
    expect(result.source.fileName).toBe('sample.txt')
    expect(result.episodes).toHaveLength(2)
    expect(result.episodes[0]).toMatchObject({
      id: 'episode-001',
      episodeNumber: 1,
      title: '第1集',
    })
    expect(result.episodes[0].sourceText).toContain('苏晚卿从柴房逃出')
    expect(result.episodes[0].sourceText).not.toContain('故事简介')
    expect(result.episodes[1]).toMatchObject({
      id: 'episode-002',
      episodeNumber: 2,
      title: '第2集',
    })
    expect(result.episodes[1].sourceText).toContain('陆承煜救下苏晚卿')
    expect(result.warnings).toEqual([])
  })

  it('keeps episode titles after the heading number', () => {
    const result = parseScriptEpisodes(`
第1集：雨夜逃亡
苏晚卿被卖给恶霸后趁雨夜逃走。

第2集：入府为妾
苏晚卿答应进入陆府。
`)

    expect(result.episodes.map((episode) => `${episode.episodeNumber}:${episode.title}`)).toEqual([
      '1:雨夜逃亡',
      '2:入府为妾',
    ])
  })

  it('supports EP and Episode headings', () => {
    const result = parseScriptEpisodes(`
EP01 误入顾家
林知夏进入顾家。

Episode 02: 旧案线索
顾沉舟发现林知夏的真实目的。
`)

    expect(result.episodes.map((episode) => `${episode.episodeNumber}:${episode.title}`)).toEqual([
      '1:误入顾家',
      '2:旧案线索',
    ])
  })

  it('defaults to one episode when there are no episode headings', () => {
    const result = parseScriptEpisodes('林知夏收到一封来自旧宅的信。她回到故乡，在祠堂发现父亲留下的线索。')

    expect(result.episodes).toHaveLength(1)
    expect(result.episodes[0]).toMatchObject({
      id: 'episode-001',
      episodeNumber: 1,
      title: '第1集',
    })
    expect(result.episodes[0].sourceText).toContain('林知夏收到一封来自旧宅的信')
    expect(result.warnings).toEqual([
      {
        code: 'NO_EPISODE_HEADING_DEFAULTED',
        message: '未检测到分集标题，已将全文作为第 1 集。',
        targetId: 'episode-001',
      },
    ])
  })

  it('throws on empty text', () => {
    expect(() => parseScriptEpisodes('   \n\n')).toThrow(EpisodeSplitParseError)
  })
})
