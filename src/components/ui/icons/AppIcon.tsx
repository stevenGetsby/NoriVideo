import { iconRegistry, type AppIconName } from './registry'
import type { IconProps } from './ph/createIcon'

export interface AppIconProps extends IconProps {
  name: AppIconName
}

export function AppIcon({ name, ...props }: AppIconProps) {
  const IconComponent = iconRegistry[name]
  if (!IconComponent) {
    throw new Error(`Unknown AppIcon name: ${String(name)}`)
  }
  return <IconComponent {...props} />
}
