import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { NextIntlClientProvider } from 'next-intl'
import { FosMaterialLibrary } from '../../src/components/frameos/views/FosMaterialLibrary'
import { FosAssetLibrary } from '../../src/components/frameos/views/FosAssetLibrary'
import { FosToolbox } from '../../src/components/frameos/views/FosToolbox'
import { FosTimbre } from '../../src/components/frameos/views/FosTimbre'
import { MaterialPickerDialog } from '../../src/components/frameos/materials/MaterialPickerDialog'
import { CanvasProjectAssets } from '../../src/features/canvas/components/CanvasProjectAssets'
import '../../src/styles/frameos-replica.css'
import '../../src/features/canvas/canvas.css'
import { setFixtureSession } from './stubs/next-auth-react'

Object.assign(window, { changeFixtureAccount: setFixtureSession })

const params = new URLSearchParams(location.search)
const view = params.get('view') || 'materials'
function Picker({ multiple = true }: { multiple?: boolean }) {
  const [open, setOpen] = useState(true)
  const [selected, setSelected] = useState('')
  return <><button onClick={() => setOpen(true)}>打开素材选择器</button><output aria-label="已确认素材">{selected}</output>{open ? <MaterialPickerDialog
    projectId="project-1" allowAllTypes multiple={multiple} title="选择项目素材"
    maxSelected={multiple ? 10 : 1} onConfirm={(materials) => { setSelected(materials.map((item) => item.title).join(',')); setOpen(false) }} onClose={() => setOpen(false)}
  /> : null}</>
}
createRoot(document.getElementById('root')!).render(
  <NextIntlClientProvider locale="zh" messages={{}} timeZone="Asia/Shanghai">
    <main className="fos-app" style={{ overflow: 'hidden' }}>
      {view === 'picker' || view === 'picker-single' ? <Picker multiple={view === 'picker'} />
        : view === 'timbre' ? <FosTimbre data={{
          projectId: 'project-1', projectName: '机甲三国', loading: false, scriptImportStatus: null, episodes: [], items: [], environments: [], world: null, scriptApproved: true, refetch: () => {},
          characters: ['关羽', '赵云'].map((name, i) => ({ id: `role-${i}`, name, type: '主角', description: '测试角色', prompt: '角色设定', imageUrl: null, confirmed: true })),
        }} />
        : view === 'assets' ? <FosAssetLibrary />
        : view === 'canvas-assets' ? <div className="nori-canvas" style={{ position: 'relative', flex: 1 }}>
          <CanvasProjectAssets projectId="project-1" onInsert={() => {}} onInsertWorkflow={() => {}} onClose={() => {}} />
        </div>
        : view === 'toolbox' ? <FosToolbox />
        : <FosMaterialLibrary initialProjectId="project-1" />}
    </main>
  </NextIntlClientProvider>,
)
