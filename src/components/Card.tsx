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
  const vars = {
    '--card-bg': colours.bg,
    '--card-fg': colours.fg,
  } as CSSProperties
  const place = `rotateY(${node.ry}deg) rotateX(${node.rx}deg) translateZ(${radius}px) scale(${scale})`
  return (
    <>
      <div className="card" style={{ ...vars, transform: place }}>
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
      <div className="card card-back" style={{ ...vars, transform: `${place} rotateY(180deg)` }} />
    </>
  )
})
