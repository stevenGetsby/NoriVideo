import { forwardRef, type SVGProps } from 'react'

export const IconGradientDefs = forwardRef<SVGSVGElement, SVGProps<SVGSVGElement>>(function IconGradientDefs(props, ref) {
  return (
    <svg ref={ref} {...props}>
      {/* Icon paint is solid currentColor; the former gradient defs are gone. */}
    </svg>
  )
})
