import type { SVGProps } from 'react'

export type OrganizeLayoutKind = 'horizontal' | 'vertical' | 'grid' | 'type' | 'tidy'

const NODE = { fill: 'currentColor', fillOpacity: 0.2, stroke: 'currentColor', strokeWidth: 1.3 } as const
const WIRE = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeOpacity: 0.55, strokeLinecap: 'round' } as const

/** A miniature of the arrangement each canvas organize rule produces, drawn on a 24px grid. */
export function OrganizeLayoutIcon({ kind, ...props }: { kind: OrganizeLayoutKind } & SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" {...props}>
      {kind === 'horizontal' ? <>
        <path d="M8 12C11 12 11 6.5 14.5 6.5M8 12C11 12 11 17.5 14.5 17.5" {...WIRE} />
        <rect x="1.7" y="8.5" width="6.3" height="7" rx="1.5" {...NODE} />
        <rect x="14.5" y="3" width="7.8" height="7" rx="1.5" {...NODE} />
        <rect x="14.5" y="14" width="7.8" height="7" rx="1.5" {...NODE} />
      </> : null}
      {kind === 'vertical' ? <>
        <path d="M12 8C12 11 6.4 11 6.4 14.5M12 8C12 11 17.6 11 17.6 14.5" {...WIRE} />
        <rect x="8.5" y="1.7" width="7" height="6.3" rx="1.5" {...NODE} />
        <rect x="1.7" y="14.5" width="9.4" height="7.8" rx="1.5" {...NODE} />
        <rect x="12.9" y="14.5" width="9.4" height="7.8" rx="1.5" {...NODE} />
      </> : null}
      {kind === 'grid' ? <>
        {[4, 13.5].flatMap((y) => [1.7, 9.2, 16.7].map((x) => (
          <rect key={`${x}-${y}`} x={x} y={y} width="5.6" height="6.5" rx="1.4" {...NODE} />
        )))}
      </> : null}
      {kind === 'type' ? <>
        <path d="M1.7 20.6h20.6" {...WIRE} strokeDasharray="1.5 2.4" />
        {[3, 8.2, 13.4].map((y) => <rect key={y} x="1.7" y={y} width="5.6" height="3.4" rx="1.2" {...NODE} />)}
        {[3, 11.6].map((y) => <rect key={y} x="9.2" y={y} width="5.6" height="6.6" rx="1.4" {...NODE} />)}
        <rect x="16.7" y="3" width="5.6" height="10.2" rx="1.4" {...NODE} />
      </> : null}
      {kind === 'tidy' ? <>
        <path d="M2.4 2.5v19" {...WIRE} strokeDasharray="1.5 2.4" />
        <rect x="5" y="4" width="7.2" height="6" rx="1.4" {...NODE} />
        <rect x="14.8" y="4" width="5.6" height="6" rx="1.4" {...NODE} />
        <rect x="5" y="14" width="5.2" height="6" rx="1.4" {...NODE} />
        <rect x="12.8" y="14" width="7.6" height="6" rx="1.4" {...NODE} />
      </> : null}
    </svg>
  )
}
