import React from 'react'
import { createRoot } from 'react-dom/client'
import { AccountDialog } from '../../src/components/frameos/FosAccountManagementParts'

function Fixture() {
  const [open, setOpen] = React.useState(true)
  const [draft, setDraft] = React.useState<React.ComponentProps<typeof AccountDialog>['draft']>({
    accountType: 'subaccount',
    managerId: '',
    username: '',
    password: '',
    projectLeader: false,
    status: 'active' as const,
    coinCredits: '0',
    pointCredits: '0',
    dailyPointLimit: '',
  })
  return (
    <main className="fos-app">
      <button type="button" onClick={() => setOpen(true)}>新建账号</button>
      {open ? <AccountDialog
        mode="create"
        draft={draft}
        target={null}
        operatorRole="admin"
        workspaces={[]}
        saving={false}
        error=""
        onDraft={setDraft}
        onClose={() => setOpen(false)}
        onSubmit={() => undefined}
      /> : null}
    </main>
  )
}

createRoot(document.getElementById('root')!).render(<Fixture />)
