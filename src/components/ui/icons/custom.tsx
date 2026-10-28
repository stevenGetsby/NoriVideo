import { forwardRef, type SVGProps } from 'react'

export const IconGradientDefs = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(function IconGradientDefs(props, ref) {
  return (
    <svg ref={ref} {...props}>
      <defs>
        <linearGradient id="icon-gradient" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor="#ffffff" />
        </linearGradient>
      </defs>
    </svg>
  )
})
