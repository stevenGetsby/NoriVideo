import React from 'react'
import { createRoot } from 'react-dom/client'
import { WorkCover } from '../../src/components/frameos/works/WorkCover'
import { AppIcon } from '../../src/components/ui/icons'
import '../../src/styles/frameos-replica.css'
import '../../src/features/canvas/canvas.css'

const coverPng = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jLfcAAAAASUVORK5CYII='

const projects = [
  { id: 'hub-1', name: '星轨少年', coverImageUrl: coverPng, workName: '长篇连载' },
  { id: 'hub-2', name: '无封面生成式作品', coverImageUrl: null, workName: '短篇' },
  { id: 'hub-3', name: '超长标题验证封面与文字间距是否足够不被遮挡的三十个汉字作品名称测试', coverImageUrl: coverPng, workName: '超长标题' },
  { id: 'hub-4', name: 'SupercalifragilisticexpialidociousUnbreakableTitleWithoutSpaces', coverImageUrl: null, workName: 'English' },
]

function Fixture() {
  return (
    <div className="fos-app">
      <div className="nori-canvas-hub-content" style={{ padding: 24 }}>
        <section className="nori-canvas-hub-direct-projects" aria-label="可进入无限画布的作品">
          <header>
            <div><strong>可用作品</strong><span>{projects.length} 个</span></div>
          </header>
          <div>
            {projects.map((project) => (
              <button type="button" key={project.id} data-testid="global-canvas-direct-project-entry" aria-label={`进入 ${project.name} 的无限画布`}>
                <WorkCover project={project} compact />
                <span><strong>{project.name}</strong><small>{project.workName || '未归属项目'} · 打开或创建画布</small></span>
                <AppIcon name="arrowRight" />
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
