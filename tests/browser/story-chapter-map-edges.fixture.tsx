import { createRoot } from 'react-dom/client'
import { StoryChapterMap } from '../../src/features/interactive/StoryChapterMap'
import type { StoryOverviewData } from '../../src/features/interactive/story-overview-model'
import type { StoryChapterGraph } from '../../src/lib/interactive/types'
import '../../src/styles/frameos-replica.css'
import '../../src/features/interactive/interactive.css'

const graph = (projectId: string, title: string): StoryChapterGraph => ({
  projectId,
  title,
  nodes: [
    { id: 'in', kind: 'entry', title: '开场' },
    { id: 'in2', kind: 'entry', title: '另一入口' },
    { id: 'scene', kind: 'scene', title: '街道', lines: '', media: null, effects: [], beats: [] },
    { id: 'out', kind: 'exit', title: '离开' },
    { id: 'out2', kind: 'exit', title: '另一出口' },
  ],
  flows: [
    { id: 'f1', from: 'in', handle: 'output', to: 'scene' },
    { id: 'f2', from: 'scene', handle: 'output', to: 'out' },
  ],
})

const data: StoryOverviewData = {
  story: {
    workId: 'w1',
    name: '连线度量影游',
    aspectRatio: '16:9',
    resolution: '1080p',
    canManage: true,
    canCreateChapters: true,
    config: {
      version: 1,
      variables: [],
      chapters: [
        { projectId: 'p1', order: 0, position: { x: 0, y: 0 }, status: 'drafting' },
        { projectId: 'p2', order: 1, position: { x: 460, y: 140 }, status: 'drafting' },
      ],
      links: [{ id: 'l1', fromProjectId: 'p1', exitNodeId: 'out', toProjectId: 'p2', toEntryNodeId: 'in' }],
      start: { projectId: 'p1', entryNodeId: 'in' },
    },
  },
  chapters: [
    { projectId: 'p1', name: '第一章', description: null, canvasId: 'c1', nodeCount: 5, runningCount: 0, updatedAt: '2026-11-16T00:00:00.000Z', graph: graph('p1', '第一章') },
    { projectId: 'p2', name: '第二章', description: null, canvasId: 'c2', nodeCount: 5, runningCount: 0, updatedAt: '2026-11-16T00:00:00.000Z', graph: graph('p2', '第二章') },
  ],
}

const log: string[] = ((window as unknown as { __mapEvents: string[] }).__mapEvents = [])

createRoot(document.getElementById('root')!).render(
  <div className="fos-app">
    <div style={{ height: 720, display: 'grid' }}>
      <StoryChapterMap
        data={data}
        issues={[]}
        focusedId={null}
        actions={{
          readOnly: false,
          workId: 'w1',
          start: data.story.config.start,
          onStatus: () => {},
          onSetStart: () => {},
          onEdit: async () => {},
          onDelete: () => {},
        }}
        onConnect={(connection) => { log.push(`connect:${connection.source}:${connection.sourceHandle}->${connection.target}:${connection.targetHandle}`) }}
        onDeleteLinks={(ids) => { log.push(`delete:${ids.join(',')}`) }}
        onDeleteChapters={() => {}}
        onMove={() => {}}
        onFocus={() => {}}
      />
    </div>
  </div>,
)
