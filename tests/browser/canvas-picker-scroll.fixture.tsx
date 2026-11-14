import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MaterialPickerDialog } from '../../src/components/frameos/materials/MaterialPickerDialog'
import { FosMaterialLibrary } from '../../src/components/frameos/views/FosMaterialLibrary'
import '../../src/styles/frameos-replica.css'

function Fixture() {
  const [pickerOpen, setPickerOpen] = useState(true)
  const [libraryOpen, setLibraryOpen] = useState(false)
  return (
    <main className="fos-app">
      <button type="button" onClick={() => setLibraryOpen(true)}>打开素材库</button>
      {pickerOpen ? <MaterialPickerDialog projectId="project-1" onClose={() => setPickerOpen(false)} /> : null}
      {libraryOpen ? <FosMaterialLibrary initialProjectId="project-1" /> : null}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
