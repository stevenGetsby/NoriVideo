'use client'

import { FosShell, type FosProjectNavigation } from './FosShell'
import { FosProjectHeader } from './FosProjectHeader'
import { useFosProject } from './useFosProject'
import { FosWorkbenchOverview } from './views/FosWorkbenchOverview'
import { FosScriptReview } from './views/FosScriptReview'
import { FosAssetSetting } from './views/FosAssetSetting'
import { FosTimbre } from './views/FosTimbre'
import { FosStoryboard } from './views/FosStoryboard'
import { FosProductionEpisodes } from './views/FosProduction'
import { FosProductionShot } from './views/FosProductionShot'
import { FosAssemblyEditor } from './views/FosAssemblyEditor'
import { CanvasWorkspace } from '@/features/canvas/CanvasWorkspace'
import { workflowNavigationSurfaceKey } from '@/lib/frameos/navigation-surface-key'

export type FosView = 'overview' | 'script-review' | 'assets' | 'storyboard' | 'production' | 'canvas'

interface Props {
  projectId: string
  view: FosView
  focus?: string | null
  initialEpisodeId?: string
  initialCanvasNodeId?: string
  assignmentReturnTo?: string
}

const HEADER_TITLES: Record<string, string> = {
  'script-review': '剧本解析结果',
  characters: '角色资产设定',
  items: '物品资产设定',
  environments: '环境资产设定',
  timbre: '设置音色',
  storyboard: '分镜设计',
  episodes: '制作剪辑',
  timeline: '制作剪辑工作台',
  shot: '制作剪辑工作台',
}

export function FosWorkflowClient({ projectId, view, focus, initialEpisodeId, initialCanvasNodeId, assignmentReturnTo }: Props) {
  const data = useFosProject(projectId)
  const navigationSurfaceKey = workflowNavigationSurfaceKey(projectId, view, focus)
  const projectNavigation: FosProjectNavigation = {
    projectId,
    projectName: data.projectName,
    activeItem: view === 'canvas' ? 'canvas' : 'workbench',
  }

  if (view === 'canvas') {
    return (
      <FosShell activeKey="canvas" canvasShell titlebarTitle={data.projectName} projectNavigation={projectNavigation}>
        <div key={navigationSurfaceKey} className="contents">{data.loading ? <div className="fos-loading">加载中…</div> : <CanvasWorkspace projectId={projectId} projectName={data.projectName} initialCanvasId={focus && focus !== 'canvas' ? focus : undefined} initialNodeId={initialCanvasNodeId} />}</div>
      </FosShell>
    )
  }

  if (view === 'overview') {
    return (
      <FosShell activeKey="projects" projectNavigation={projectNavigation}
        header={<FosProjectHeader projectId={projectId} projectName={data.projectName} backTo={assignmentReturnTo ?? '/works'} backLabel={assignmentReturnTo ? '返回我的任务' : '返回我的作品'} />}>
        <div key={navigationSurfaceKey} className="contents">{data.loading ? <div className="fos-loading">加载中…</div> : <FosWorkbenchOverview data={data} />}</div>
      </FosShell>
    )
  }

  const title = HEADER_TITLES[focus ?? view] ?? data.projectName
  const base = `/workflow/${projectId}/workbench-premium2`
  const parentBackTo = focus === 'timeline' || focus === 'shot' || focus === 'shot-detail'
    ? `${base}/production/episodes`
    : base
  const parentBackLabel = focus === 'timeline' || focus === 'shot' || focus === 'shot-detail'
    ? '返回制作剪辑'
    : '返回项目工作台'

  const renderView = () => {
    if (data.loading) return <div className="fos-loading">加载中…</div>
    switch (view) {
      case 'script-review': return <FosScriptReview data={data} />
      case 'assets':
        if (focus === 'timbre') return <FosTimbre data={data} />
        return <FosAssetSetting data={data} tab={(focus === 'items' || focus === 'environments') ? focus : 'characters'} />
      case 'storyboard': return <FosStoryboard data={data} initialEpisodeId={initialEpisodeId} />
      case 'production':
        if (focus === 'timeline') return <FosAssemblyEditor data={data} initialEpisodeId={initialEpisodeId} />
        if (focus === 'shot' || focus === 'shot-detail') return <FosProductionShot data={data} initialEpisodeId={initialEpisodeId} />
        return <FosProductionEpisodes data={data} />
      default: return <FosWorkbenchOverview data={data} />
    }
  }

  return (
    <FosShell activeKey="projects" projectNavigation={projectNavigation}
      header={<FosProjectHeader projectId={projectId} projectName={data.projectName} title={title} backTo={assignmentReturnTo ?? parentBackTo} backLabel={assignmentReturnTo ? '返回我的任务' : parentBackLabel} />}>
      <div key={navigationSurfaceKey} className="contents">{renderView()}</div>
    </FosShell>
  )
}
