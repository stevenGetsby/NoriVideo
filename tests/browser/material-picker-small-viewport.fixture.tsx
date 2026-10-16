import React from 'react'
import { createRoot } from 'react-dom/client'
import { MaterialPickerDialog } from '../../src/components/frameos/materials/MaterialPickerDialog'
import '../../src/styles/frameos-replica.css'

function Fixture() {
  const [open, setOpen] = React.useState(true)
  return (
    <main className="fos-app">
      <div
        style={{
          height: '100vh',
          transform: 'translate(1200px, 900px) scale(2)',
          filter: 'blur(1px)',
          perspective: '800px',
        }}
      >
        {open ? <MaterialPickerDialog
          projectId="project-1"
          multiple
          confirmLabel="添加引用"
          onConfirm={() => undefined}
          onClose={() => setOpen(false)}
        /> : null}
      </div>
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
