declare module 'lucide-react/dist/esm/icons/*.js' {
  import type { LucideIcon } from 'lucide-react'

  const icon: LucideIcon
  export default icon
}

declare module 'lucide-react/dist/esm/createLucideIcon.js' {
  import type { IconNode, LucideIcon } from 'lucide-react'

  const createLucideIcon: (name: string, iconNode: IconNode) => LucideIcon
  export default createLucideIcon
}
