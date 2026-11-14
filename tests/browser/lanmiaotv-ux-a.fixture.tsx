import React from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { FosProjectHeader } from '../../src/components/frameos/FosProjectHeader'
import { FosCanvasShellContext } from '../../src/components/frameos/FosCanvasShellContext'
import { CanvasChrome } from '../../src/features/canvas/components/CanvasChrome'
import type { Canvas } from '../../src/features/canvas/types'
import '../../src/styles/frameos-replica.css'
import '../../src/features/canvas/canvas.css'
import '../../src/features/canvas/story/story-canvas.css'

const params = new URLSearchParams(location.search)
const noop = () => undefined
const canvas: Canvas = {
  id: 'canvas-a', projectId: 'work-a', title: '第一幕', themeColor: null,
  viewport: null, revision: 1, visibility: 'private', forkedFromId: null,
  createdAt: '', updatedAt: '',
}
const projectOptions = [{ id: 'work-a', name: '影游作品', workId: 'parent-a', workName: '项目甲' }]

function HeaderFixture() {
  const collapsed = params.get('sidebar') === 'collapsed'
  const name = params.get('name') || '测试作品'
  return (
    <div className="fos-app" style={{ '--fos-sidebar-width': '220px' } as React.CSSProperties}>
      <div className="fos-content">
        <aside className={`fos-sidebar${collapsed ? ' is-collapsed' : ''}`} aria-hidden />
        <main className="fos-main">
          <FosProjectHeader
            projectId="work-a"
            projectName={name}
            parentProjectId="parent-a"
            parentProjectName="项目甲"
            canDelete
            backLabel="返回我的项目"
            projectMetaTags={['2D 动漫', '16:9', '1080p']}
          />
          <div className="fos-scroll" />
        </main>
      </div>
    </div>
  )
}

function StoryTipsFixture() {
  return (
    <FosCanvasShellContext.Provider value={{ enabled: true, sidebarCollapsed: true, toggleSidebar: noop }}>
      <div className="fos-app is-canvas-shell">
        <div className="fos-main">
          <div className="nori-canvas-workspace" data-testid="workspace">
            <CanvasChrome
              projectId="work-a"
              projectName="影游作品"
              canvases={[canvas]}
              activeCanvas={canvas}
              saveState="saved"
              canUndo={false}
              canRedo={false}
              onSelectCanvas={noop}
              onCreateCanvas={noop}
              onRenameCanvas={noop}
              onDeleteCanvas={noop}
              projectOptions={projectOptions}
              parentProjectId="parent-a"
              parentProjectName="项目甲"
              onSelectProject={noop}
              canvasHomeHref="/canvas"
              createProjectHref="/projects?create_work=1&parent_project_id=parent-a"
              onUndo={noop}
              onRedo={noop}
              onRetrySave={noop}
              onOpenRevisions={noop}
              syncingProduction={false}
              canSyncProduction={false}
              readOnly={false}
              onOpenProjectAssets={noop}
              onSyncProduction={noop}
            />
            <aside className="nori-story-tips" aria-label="影游画布上手提示">
              <header><strong>三步搭起一段互动剧情</strong><button type="button" aria-label="关闭提示">×</button></header>
              <ol>
                <li><b>1</b><span><strong>先写剧情文字</strong>剧情片段卡片里直接写动作、台词和旁白，文字就是主稿</span></li>
                <li><b>2</b><span><strong>接下来发生什么</strong>点卡片右侧的 +，或从圆点拖出连线，选择下一步</span></li>
                <li><b>3</b><span><strong>画面与分支</strong>需要画面时在制作层连接视频或图片；选项和条件各有自己的出口</span></li>
              </ol>
              <footer><span>「整理剧情」会按剧情走向自动排版</span><button type="button">知道了</button></footer>
            </aside>
          </div>
        </div>
      </div>
    </FosCanvasShellContext.Provider>
  )
}

createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
    {params.get('view') === 'story-tips' ? <StoryTipsFixture /> : <HeaderFixture />}
  </NextIntlClientProvider>,
)
