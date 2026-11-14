import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CreateProjectDialog } from '../../src/components/frameos/CreateProjectDialog'
import { buildInheritSourceOptions } from '../../src/components/frameos/works/inherit-sources'
import type { WorkSummary } from '../../src/components/frameos/works/types'
import '../../src/styles/frameos-replica.css'

interface FixtureConfig {
  currentWorkId?: string
  works?: WorkSummary[]
}

function Fixture() {
  const config = (window as unknown as { __CREATE_DIALOG_FIXTURE__?: FixtureConfig }).__CREATE_DIALOG_FIXTURE__
  const [inheritSources] = useState(() => (
    config?.works ? buildInheritSourceOptions(config.works, config.currentWorkId ?? '') : undefined
  ))
  const [created, setCreated] = useState('')
  const [calls, setCalls] = useState(0)
  return (
    <>
      <output aria-label="创建结果" data-calls={calls}>{created}</output>
      <CreateProjectDialog
        workName="界面验证项目"
        currentWorkId={config?.currentWorkId}
        inheritSources={inheritSources}
        onClose={() => undefined}
        onCreate={(draft) => { setCreated(JSON.stringify(draft)); setCalls((value) => value + 1); return true }}
      />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
