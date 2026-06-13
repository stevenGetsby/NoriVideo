import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const promptDir = join(process.cwd(), 'lib/prompts/novel-promotion')

describe('non-human video prompt rules', () => {
  it('keeps animal and fairy-tale subjects from being rewritten as human age/gender labels', () => {
    const detailZh = readFileSync(join(promptDir, 'agent_storyboard_detail.zh.txt'), 'utf8')
    const insertZh = readFileSync(join(promptDir, 'agent_storyboard_insert.zh.txt'), 'utf8')

    expect(detailZh).toContain('动物/童话生物/物品/非人类角色：必须保留物种或主体')
    expect(detailZh).toContain('不得改写成少年、少女、男子、女子、少男少女')
    expect(detailZh).toContain('小兔子提着月亮灯')

    expect(insertZh).toContain('动物、童话生物、物品等非人类角色必须保留物种或主体')
    expect(insertZh).toContain('不得改写成少年/少女/男子/女子/少男少女')
  })
})
