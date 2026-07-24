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
 */
export function fibonacciSphere(n: number): SphereNode[] {
  const nodes: SphereNode[] = []
  for (let i = 0; i < n; i++) {
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2
    const radial = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = i * GOLDEN_ANGLE
    const x = Math.cos(theta) * radial
    const z = Math.sin(theta) * radial
    nodes.push({
      ry: (Math.atan2(x, z) * 180) / Math.PI,
      rx: (-Math.asin(y) * 180) / Math.PI,
    })
  }
  return nodes
}
