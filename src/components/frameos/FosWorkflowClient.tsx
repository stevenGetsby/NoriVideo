'use client'

import { FosShell } from './FosShell'
import { FosProjectHeader } from './FosProjectHeader'
import { useFosProject } from './useFosProject'
import { FosWorkbenchOverview } from './views/FosWorkbenchOverview'
import { FosScriptReview } from './views/FosScriptReview'
import { FosAssetSetting } from './views/FosAssetSetting'
import { FosTimbre } from './views/FosTimbre'
import { FosStoryboard } from './views/FosStoryboard'
import { FosProductionEpisodes, FosProductionTimeline } from './views/FosProduction'
import { FosProductionShot } from './views/FosProductionShot'

export type FosView = 'overview' | 'script-review' | 'assets' | 'storyboard' | 'production'

interface Props {
  projectId: string
  view: FosView
  focus?: string | null
}

const HEADER_TITLES: Record<string, string> = {
  'script-review': '剧本解析结果',
  characters: '角色资产设定',
  items: '物品资产设定',
  environments: '环境资产设定',
  timbre: '设置音色',
  storyboard: '分镜设计',
  episodes: '制作剪辑',
  timeline: '时间线组装',
  shot: '镜头制作工作台',
}

export function FosWorkflowClient({ projectId, view, focus }: Props) {
  const data = useFosProject(projectId)

  if (view === 'overview') {
    return (
      <FosShell activeKey="projects" hideSidebar
        header={<FosProjectHeader projectId={projectId} projectName={data.projectName} backTo="/projects" />}>
        {data.loading ? <div className="fos-loading">加载中…</div> : <FosWorkbenchOverview data={data} />}
      </FosShell>
    )
  }

  const title = HEADER_TITLES[focus ?? view] ?? data.projectName

  const renderView = () => {
    if (data.loading) return <div className="fos-loading">加载中…</div>
    switch (view) {
      case 'script-review': return <FosScriptReview data={data} />
      case 'assets':
        if (focus === 'timbre') return <FosTimbre data={data} />
        return <FosAssetSetting data={data} tab={(focus === 'items' || focus === 'environments') ? focus : 'characters'} />
      case 'storyboard': return <FosStoryboard data={data} />
      case 'production':
        if (focus === 'timeline') return <FosProductionTimeline data={data} />
        if (focus === 'shot' || focus === 'shot-detail') return <FosProductionShot data={data} />
        return <FosProductionEpisodes data={data} />
      default: return <FosWorkbenchOverview data={data} />
    }
  }

  return (
    <FosShell activeKey="projects" hideSidebar
      header={<FosProjectHeader projectId={projectId} projectName={data.projectName} title={title} />}>
      {renderView()}
    </FosShell>
  )
}
