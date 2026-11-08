import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { CreateProjectDialog } from '../../src/components/frameos/CreateProjectDialog'
import '../../src/styles/frameos-replica.css'

function Fixture() {
  const [created, setCreated] = useState('')
  return (
    <>
      <output aria-label="创建结果">{created}</output>
      <CreateProjectDialog
        workName="界面验证项目"
        onClose={() => undefined}
        onCreate={(draft) => { setCreated(JSON.stringify(draft)); return true }}
      />
    </>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
