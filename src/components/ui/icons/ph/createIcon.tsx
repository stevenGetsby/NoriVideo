import { createElement, forwardRef, type ForwardRefExoticComponent, type RefAttributes, type SVGProps } from 'react'

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, 'ref'> {
  size?: number | string
  color?: string
  weight?: 'regular' | 'fill'
}

export type IconComponent = ForwardRefExoticComponent<IconProps & RefAttributes<SVGSVGElement>>

export function createIcon(name: string, regular: string, filled?: string): IconComponent {
  const Icon = forwardRef<SVGSVGElement, IconProps>(function Icon(
    { size = 24, color = 'currentColor', weight = 'regular', children, ...rest },
    ref,
  ) {
    const labelled = Boolean(rest['aria-label'] || rest['aria-labelledby'] || rest.role)
    return createElement(
      'svg',
      {
        ref,
        xmlns: 'http://www.w3.org/2000/svg',
        width: size,
        height: size,
        viewBox: '0 0 256 256',
        fill: color,
        'aria-hidden': labelled ? undefined : true,
        ...rest,
      },
      createElement('path', { d: weight === 'fill' && filled ? filled : regular }),
      children,
    )
  })
  Icon.displayName = name
  return Icon
}
