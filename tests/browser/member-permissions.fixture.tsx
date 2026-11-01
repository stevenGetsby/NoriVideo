import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemberManagerDialog } from '../../src/components/frameos/works/FosWorksDialogs'
import '../../src/styles/frameos-replica.css'

createRoot(document.getElementById('root')!).render(
  <MemberManagerDialog
    title="项目成员与权限"
    endpoint="/api/works/work-1/members"
    candidatesPath="/api/works/work-1/member-candidates"
    onClose={() => undefined}
    onChanged={() => undefined}
  />,
)
