import type { StoryNode, StoryProgram } from '@/lib/interactive/types'
import { describePointer } from './media-refs'

export interface ReviewText { where: string; text: string }

/** Every viewer-visible string, with its location, for the review console. */
export function collectTexts(program: StoryProgram): ReviewText[] {
  const texts: ReviewText[] = []
  const add = (pointer: string, value: unknown) => {
    if (typeof value !== 'string') return
    const text = value.trim()
    if (text) texts.push({ where: describePointer(program, pointer), text })
  }

  const nodeTexts = (node: StoryNode, pointer: string) => {
    add(pointer, node.title)
    switch (node.kind) {
      case 'scene':
        add(`${pointer}/lines`, node.lines)
        if (node.savePoint) add(`${pointer}/savePoint/name`, node.savePoint.name)
        for (const [index, beat] of node.beats.entries()) nodeTexts(beat, `${pointer}/beats/${index}`)
        break
      case 'choice':
        add(`${pointer}/prompt`, node.prompt)
        node.options.forEach((option, index) => add(`${pointer}/options/${index}/label`, option.label))
        break
      case 'interaction': {
        add(`${pointer}/hint`, node.hint)
        const spec = node.spec
        if (spec.type === 'tap' || spec.type === 'swipe' || spec.type === 'hold') add(`${pointer}/spec/buttonText`, spec.buttonText)
        if (spec.type === 'choice') {
          add(`${pointer}/spec/prompt`, spec.prompt)
          spec.options.forEach((option, index) => add(`${pointer}/spec/options/${index}/label`, option.label))
        }
        if (spec.type === 'hotspot') spec.zones.forEach((zone, index) => add(`${pointer}/spec/zones/${index}/label`, zone.label))
        break
      }
      case 'condition':
        node.branches.forEach((branch, index) => add(`${pointer}/branches/${index}/label`, branch.label))
        break
      case 'ending':
        add(`${pointer}/description`, node.description)
        break
      default:
        break
    }
  }

  program.chapters.forEach((chapter, chapterIndex) => {
    add(`/chapters/${chapterIndex}`, chapter.title)
    chapter.nodes.forEach((node, nodeIndex) => nodeTexts(node, `/chapters/${chapterIndex}/nodes/${nodeIndex}`))
  })
  program.variables.forEach((variable, index) => add(`/variables/${index}/name`, variable.name))
  program.shop?.items.forEach((item, index) => {
    add(`/shop/items/${index}/name`, item.name)
    add(`/shop/items/${index}/description`, item.description)
    if (item.reward) add(`/shop/items/${index}/reward/title`, item.reward.title)
  })
  program.achievements?.forEach((achievement, index) => {
    add(`/achievements/${index}/name`, achievement.name)
    add(`/achievements/${index}/description`, achievement.description)
    add(`/achievements/${index}/reward/title`, achievement.reward.title)
  })
  if (program.personality) {
    for (const [type, result] of Object.entries(program.personality.results)) {
      add(`/personality/results/${type}/name`, result.name)
      add(`/personality/results/${type}/description`, result.description)
    }
  }
  return texts
}
