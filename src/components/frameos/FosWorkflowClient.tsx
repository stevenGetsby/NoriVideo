'use client'

import { FosShell, type FosProjectNavigation } from './FosShell'
import { FosProjectHeader } from './FosProjectHeader'
import { useFosProject } from './useFosProject'
import dynamic from 'next/dynamic'
import { workflowNavigationSurfaceKey } from '@/lib/frameos/navigation-surface-key'

const loadingView = () => <div className="fos-loading">正在加载工作台…</div>
const FosWorkbenchOverview = dynamic(() => import('./views/FosWorkbenchOverview').then((module) => module.FosWorkbenchOverview), { loading: loadingView })
const FosScriptReview = dynamic(() => import('./views/FosScriptReview').then((module) => module.FosScriptReview), { loading: loadingView })
const FosAssetSetting = dynamic(() => import('./views/FosAssetSetting').then((module) => module.FosAssetSetting), { loading: loadingView })
const FosTimbre = dynamic(() => import('./views/FosTimbre').then((module) => module.FosTimbre), { loading: loadingView })
const FosStoryboard = dynamic(() => import('./views/FosStoryboard').then((module) => module.FosStoryboard), { loading: loadingView })
const FosProductionEpisodes = dynamic(() => import('./views/FosProduction').then((module) => module.FosProductionEpisodes), { loading: loadingView })
const FosProductionShot = dynamic(() => import('./views/FosProductionShot').then((module) => module.FosProductionShot), { loading: loadingView })
const FosAssemblyEditor = dynamic(() => import('./views/FosAssemblyEditor').then((module) => module.FosAssemblyEditor), { loading: loadingView })
const CanvasWorkspace = dynamic(() => import('@/features/canvas/CanvasWorkspace').then((module) => module.CanvasWorkspace), { ssr: false, loading: loadingView })

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

const PROJECT_STYLE_HEADER_LABELS: Record<string, string> = {
  'live-action': '仿真人',
  'anime-3d': '3D 动漫',
  'anime-2.5d': '2.5D 动漫',
  'anime-2d': '2D 动漫',
  anime: '动漫',
}

function projectMetaTags(data: ReturnType<typeof useFosProject>): string[] {
  return [
    data.world?.artStylePrompt?.includes('【用户自定义画风（最高优先级）】')
      ? '自定义画风'
      : data.world
        ? PROJECT_STYLE_HEADER_LABELS[data.world.projectStyle] ?? data.world.label
        : null,
    data.world?.videoRatio,
    data.world?.videoResolution,
  ].filter((tag): tag is string => Boolean(tag))
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
        header={<FosProjectHeader projectId={projectId} projectName={data.projectName} parentProjectName={data.parentProjectName} backTo={assignmentReturnTo ?? '/projects'} backLabel={assignmentReturnTo ? '返回我的任务' : '返回我的项目'} projectMetaTags={projectMetaTags(data)} />}>
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
    : '返回作品工作台'

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
        header={<FosProjectHeader projectId={projectId} projectName={data.projectName} parentProjectName={data.parentProjectName} title={title} backTo={assignmentReturnTo ?? parentBackTo} backLabel={assignmentReturnTo ? '返回我的任务' : parentBackLabel} projectMetaTags={projectMetaTags(data)} />}>
      <div key={navigationSurfaceKey} className="contents">{renderView()}</div>
    </FosShell>
  )
}
