import { NameIndexPanel } from './NameIndexPanel'
import type { NameIndexGroup } from './types'

export function MappingPanel({
  title,
  count,
  groups,
}: {
  title: string
  count: number
  groups: NameIndexGroup[]
}) {
  return <NameIndexPanel title={title} count={count} groups={groups} />
}
