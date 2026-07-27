export interface SphereNode {
  /** rotation around Y in degrees */
  ry: number
  /** rotation around X in degrees */
  rx: number
}

const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

/** hard cap — meshes never need to resolve past this many nodes */
const MAX_NODES = 128

type Vec3 = [number, number, number]

/**
 * Convert a unit vector to the (rotateY, rotateX) pair that carries a card
 * from the origin's +Z face to that point when composed as
 * `rotateY(ry) rotateX(rx) translateZ(r)`.
 */
function vecToNode([x, y, z]: Vec3): SphereNode {
  return {
    ry: (Math.atan2(x, z) * 180) / Math.PI,
    rx: (-Math.asin(Math.max(-1, Math.min(1, y))) * 180) / Math.PI,
  }
}

/** normalize a vector to the unit sphere */
function normalize([x, y, z]: Vec3): Vec3 {
  const len = Math.hypot(x, y, z) || 1
  return [x / len, y / len, z / len]
}

/**
 * Rotate the whole vertex set so that `ref` lands exactly on +Z (0,0,1).
 * Used to snap the front-most vertex to front-centre: some meshes (goldberg's
 * cell centres in particular) have no natural vertex exactly at the pole, so we
 * reorient the set rather than accept an off-centre first card. Rodrigues
 * rotation about the axis ref×(+Z).
 */
function rotateToFront(verts: Vec3[], ref: Vec3): Vec3[] {
  const dot = Math.max(-1, Math.min(1, ref[2])) // ref · (0,0,1)
  if (dot > 1 - 1e-9) return verts // already at front
  if (dot < -1 + 1e-9) {
    // antipodal (degenerate); flip about the x-axis
    return verts.map(([x, y, z]) => [x, -y, -z] as Vec3)
  }
  // axis = ref × (0,0,1) = (ref.y, -ref.x, 0), normalized
  const ax = ref[1]
  const ay = -ref[0]
  const alen = Math.hypot(ax, ay) || 1
  const kx = ax / alen
  const ky = ay / alen
  const kz = 0
  const cos = dot
  const sin = Math.sqrt(Math.max(0, 1 - dot * dot))
  return verts.map(([x, y, z]) => {
    // cross = k × v
    const cx = ky * z - kz * y
    const cy = kz * x - kx * z
    const cz = kx * y - ky * x
    const kd = kx * x + ky * y + kz * z // k · v
    return [
      x * cos + cx * sin + kx * kd * (1 - cos),
      y * cos + cy * sin + ky * kd * (1 - cos),
      z * cos + cz * sin + kz * kd * (1 - cos),
    ] as Vec3
  })
}

/**
 * Deduplicate shared vertices (rounding to ~1e-6 to fold coincident points),
 * sort by z descending so the vertex nearest the viewer is first, then convert
 * to nodes and take the first n. This guarantees node 0 faces front-centre.
 */
function finalize(verts: Vec3[], n: number): SphereNode[] {
  if (n <= 0) return []
  const seen = new Map<string, Vec3>()
  for (const v of verts) {
    const u = normalize(v)
    const key = `${Math.round(u[0] * 1e6)},${Math.round(u[1] * 1e6)},${Math.round(u[2] * 1e6)}`
    if (!seen.has(key)) seen.set(key, u)
  }
  const unique = [...seen.values()]
  unique.sort((a, b) => b[2] - a[2])
  // snap the front-most vertex exactly to front-centre so node 0 always faces
  // the viewer (the branded opening card), then re-sort in case the rotation
  // nudged the z-ordering of the remaining vertices.
  const snapped = rotateToFront(unique, unique[0])
  snapped.sort((a, b) => b[2] - a[2])
  return snapped.slice(0, n).map(vecToNode)
}

/**
 * Fibonacci-lattice distribution of n points on a unit sphere.
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

/**
 * UV sphere: a latitude/longitude grid. Rings are spaced evenly in latitude
 * from the +Y pole to the -Y pole; each ring carries a number of points
 * proportional to cos(latitude) so density stays roughly even, and the poles
 * collapse to single points. Ring count grows with n so there are always
 * enough vertices; the finalize step dedupes the poles and takes the front n.
 */
export function uvSphere(n: number): SphereNode[] {
  if (n <= 0) return []
  if (n === 1) return [{ ry: 0, rx: 0 }]
  // ring count scaled to the point budget; err on the generous side and let
  // finalize() trim to n after the front-first sort.
  let rings = Math.max(3, Math.ceil(Math.sqrt((n * Math.PI) / 2)))
  for (;;) {
    const verts: Vec3[] = []
    // latitudes include both poles: i/rings from 0 (north) to 1 (south)
    for (let i = 0; i <= rings; i++) {
      const lat = (i / rings) * Math.PI - Math.PI / 2 // -π/2 … +π/2
      const y = Math.sin(lat)
      const r = Math.cos(lat)
      // poles are a single point
      const count = i === 0 || i === rings ? 1 : Math.max(1, Math.round(2 * rings * r))
      for (let j = 0; j < count; j++) {
        const lon = (j / count) * 2 * Math.PI
        verts.push([r * Math.sin(lon), y, r * Math.cos(lon)])
      }
    }
    if (verts.length >= n || rings > 256) return finalize(verts, n)
    rings++
  }
}

/** The 12 vertices of a regular icosahedron (unnormalized). */
function icosahedronVertices(): Vec3[] {
  const t = (1 + Math.sqrt(5)) / 2
  return [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ]
}

/** The 20 triangular faces of the icosahedron, as vertex-index triples. */
const ICO_FACES: [number, number, number][] = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
]

/**
 * Subdivide the icosahedron k times (Loop-style: each triangle splits into 4
 * by adding edge midpoints, every new point projected back to the unit
 * sphere). Returns { verts, faces } where faces index into verts. A
 * k-subdivided icosahedron has 10·4^k+2 vertices and 20·4^k faces.
 */
function subdividedIcosahedron(k: number): { verts: Vec3[]; faces: [number, number, number][] } {
  let verts: Vec3[] = icosahedronVertices().map(normalize)
  let faces = ICO_FACES.map((f) => [...f] as [number, number, number])

  for (let step = 0; step < k; step++) {
    const midCache = new Map<string, number>()
    const next: [number, number, number][] = []
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`
      const cached = midCache.get(key)
      if (cached !== undefined) return cached
      const va = verts[a]
      const vb = verts[b]
      const m = normalize([va[0] + vb[0], va[1] + vb[1], va[2] + vb[2]])
      const idx = verts.length
      verts.push(m)
      midCache.set(key, idx)
      return idx
    }
    for (const [a, b, c] of faces) {
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    faces = next
  }
  return { verts, faces }
}

/**
 * Geodesic icosphere: the vertices of a k-subdivided icosahedron, where k is
 * the smallest subdivision level whose vertex count (10·4^k+2) reaches n.
 */
export function icosahedronSphere(n: number): SphereNode[] {
  if (n <= 0) return []
  if (n === 1) return [{ ry: 0, rx: 0 }]
  let k = 0
  while (10 * 4 ** k + 2 < n && k < 5) k++
  const { verts } = subdividedIcosahedron(k)
  return finalize(verts, n)
}

/**
 * Quad sphere (spherified cube): a (k+1)×(k+1) grid on each of the six cube
 * faces, every point normalized onto the unit sphere. Shared edges and corners
 * dedupe to 6k²+2 unique vertices; k is the smallest size reaching n.
 */
export function quadSphere(n: number): SphereNode[] {
  if (n <= 0) return []
  if (n === 1) return [{ ry: 0, rx: 0 }]
  let k = 1
  while (6 * k * k + 2 < n && k < 64) k++
  // prefer an even grid size: it puts a grid point at the centre of each face,
  // and the +Z face centre normalizes to exactly (0,0,1) — front-centre.
  if (k % 2 === 1) k++

  const verts: Vec3[] = []
  // each face: an origin plus two in-plane axes spanning [-1,1]²
  const faces: { o: Vec3; u: Vec3; v: Vec3 }[] = [
    { o: [1, -1, -1], u: [0, 2, 0], v: [0, 0, 2] }, // +X
    { o: [-1, -1, 1], u: [0, 2, 0], v: [0, 0, -2] }, // -X
    { o: [-1, 1, -1], u: [2, 0, 0], v: [0, 0, 2] }, // +Y
    { o: [-1, -1, 1], u: [2, 0, 0], v: [0, 0, -2] }, // -Y
    { o: [-1, -1, 1], u: [2, 0, 0], v: [0, 2, 0] }, // +Z
    { o: [1, -1, -1], u: [-2, 0, 0], v: [0, 2, 0] }, // -Z
  ]
  for (const { o, u, v } of faces) {
    for (let i = 0; i <= k; i++) {
      const s = i / k
      for (let j = 0; j <= k; j++) {
        const t = j / k
        verts.push([o[0] + u[0] * s + v[0] * t, o[1] + u[1] * s + v[1] * t, o[2] + u[2] * s + v[2] * t])
      }
    }
  }
  return finalize(verts, n)
}

/**
 * Goldberg polyhedron: the dual of the geodesic icosahedron. Its vertices are
 * the (normalized) centroids of the subdivided icosahedron's faces, giving the
 * hexagon/pentagon cell-centre distribution. A k-subdivided icosahedron has
 * 20·4^k faces; k is the smallest level reaching n.
 */
export function goldbergSphere(n: number): SphereNode[] {
  if (n <= 0) return []
  if (n === 1) return [{ ry: 0, rx: 0 }]
  let k = 0
  while (20 * 4 ** k < n && k < 5) k++
  const { verts, faces } = subdividedIcosahedron(k)
  const centroids: Vec3[] = faces.map(([a, b, c]) => {
    const va = verts[a]
    const vb = verts[b]
    const vc = verts[c]
    return normalize([(va[0] + vb[0] + vc[0]) / 3, (va[1] + vb[1] + vc[1]) / 3, (va[2] + vb[2] + vc[2]) / 3])
  })
  return finalize(centroids, n)
}

/**
 * Dispatch to a mesh generator by name. All generators return exactly n nodes
 * (n clamped to [0, MAX_NODES]) with node 0 facing front-centre. Fibonacci is
 * the default.
 */
export function sphereNodes(mesh: string, n: number): SphereNode[] {
  const count = Math.max(0, Math.min(MAX_NODES, n))
  switch (mesh) {
    case 'uv':
      return uvSphere(count)
    case 'icosahedron':
      return icosahedronSphere(count)
    case 'quad':
      return quadSphere(count)
    case 'goldberg':
      return goldbergSphere(count)
    default:
      return fibonacciSphere(count)
  }
}
