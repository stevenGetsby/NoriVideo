import React from 'react'
import { createRoot } from 'react-dom/client'
import { CreateProjectDialog } from '../../src/components/frameos/CreateProjectDialog'
import '../../src/styles/frameos-replica.css'

function Fixture() {
  return (
    <CreateProjectDialog
      workName="界面验证项目"
      onClose={() => undefined}
      onCreate={() => true}
    />
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
