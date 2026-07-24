import { memo } from 'react'
import type { CSSProperties } from 'react'
import { schemeForPhrase } from '../lib/card.ts'
import type { CardColours } from '../lib/colour.ts'
import type { SphereNode } from '../lib/sphere.ts'

interface CardProps {
  phrase: string
  colours: CardColours
  node: SphereNode
  radius: number
  scale: number
}

export const Card = memo(function Card({ phrase, colours, node, radius, scale }: CardProps) {
  const scheme = schemeForPhrase(phrase)
  const style = {
    '--card-bg': colours.bg,
    '--card-fg': colours.fg,
    '--ry': `${node.ry}deg`,
    '--rx': `${node.rx}deg`,
    '--r': `${radius}px`,
    '--s': String(scale),
  } as CSSProperties
  return (
    <div className="card" style={style}>
      <p
        className="card-text"
        style={{
          fontFamily: scheme.fontFamily,
          fontWeight: scheme.fontWeight,
          fontSize: scheme.fontSize,
        }}
      >
        {scheme.text}
      </p>
    </div>
  )
})
