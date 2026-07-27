export interface SphereNode {
  /** rotation around Y in degrees */
  ry: number
  /** rotation around X in degrees */
  rx: number
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/**
 * Fibonacci-lattice distribution of n points on a unit sphere, expressed as
 * the (rotateY, rotateX) pair that carries a card from the origin's +Z face
 * to its node when composed as `rotateY(ry) rotateX(rx) translateZ(r)`.
 *
 * The lattice runs along the z-axis: node 0 faces the viewer dead-centre
 * (the opening card), and later nodes spiral away behind it.
 */
export function fibonacciSphere(n: number): SphereNode[] {
  const nodes: SphereNode[] = []
  for (let i = 0; i < n; i++) {
    const z = n === 1 ? 1 : 1 - (i / (n - 1)) * 2
    const radial = Math.sqrt(Math.max(0, 1 - z * z))
    const theta = i * GOLDEN_ANGLE
    const x = Math.cos(theta) * radial
    const y = Math.sin(theta) * radial
    nodes.push({
      ry: (Math.atan2(x, z) * 180) / Math.PI,
      rx: (-Math.asin(y) * 180) / Math.PI,
    })
  }
  return nodes
}
