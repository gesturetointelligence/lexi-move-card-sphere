export interface CardColours {
  bg: string
  fg: string
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '')
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

export function rgbToHex([r, g, b]: [number, number, number]): string {
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')
  return `#${c(r)}${c(g)}${c(b)}`
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((v) => {
    const s = v / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a)
  const lb = relativeLuminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

function chroma(hex: string): number {
  const [r, g, b] = hexToRgb(hex)
  return (Math.max(r, g, b) - Math.min(r, g, b)) / 255
}

/** Hue-tinted near-black / near-white ink derived from a base colour. */
function ink(hex: string, dark: boolean): string {
  const [r, g, b] = hexToRgb(hex)
  const base = dark ? [21, 23, 21] : [248, 249, 249]
  const tint = 0.12
  return rgbToHex([
    base[0] * (1 - tint) + r * tint,
    base[1] * (1 - tint) + g * tint,
    base[2] * (1 - tint) + b * tint,
  ])
}

/**
 * Pick a card/text pair from a palette, Magic-style: colour-on-colour where
 * the palette allows it, hue-tinted ink fallback where it doesn't. `pick`
 * indexes into the ranked candidates so neighbouring cards on the same
 * palette can differ.
 */
export function pickPair(palette: string[], pick = 0): CardColours {
  type Cand = CardColours & { score: number }
  const cands: Cand[] = []
  const MIN_CONTRAST = 2.4
  for (const bg of palette) {
    for (const fg of palette) {
      if (bg === fg) continue
      const cr = contrastRatio(bg, fg)
      if (cr < MIN_CONTRAST) continue
      // peak reward near 4.5:1, mild penalty past it; reward saturated pairs
      const contrastScore = cr <= 4.5 ? cr / 4.5 : 4.5 / cr
      cands.push({ bg, fg, score: contrastScore * 2 + chroma(bg) + chroma(fg) * 0.6 })
    }
  }
  for (const bg of palette) {
    const dark = relativeLuminance(bg) > 0.35
    const fg = ink(bg, dark)
    const cr = contrastRatio(bg, fg)
    if (cr >= MIN_CONTRAST) cands.push({ bg, fg, score: (Math.min(cr, 4.5) / 4.5) * 1.5 + chroma(bg) })
  }
  if (cands.length === 0) return { bg: palette[0] ?? '#151715', fg: '#f8f9f9' }
  cands.sort((a, b) => b.score - a.score)
  const top = cands.slice(0, Math.max(6, Math.ceil(cands.length / 2)))
  return top[pick % top.length]
}

/** Deterministic 32-bit hash (FNV-1a) — same phrase, same look. */
export function hashString(s: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

/** Small seeded RNG (mulberry32) for reshuffles that stay stable per seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// --- Median-cut palette extraction (Color Thief style, as in colour-capture) ---

const SIGBITS = 5
const RSHIFT = 8 - SIGBITS

export function samplePixels(img: HTMLImageElement, maxSamples = 20000): Uint8ClampedArray {
  const total = img.naturalWidth * img.naturalHeight
  const scale = Math.min(1, Math.sqrt(maxSamples / Math.max(1, total)))
  const w = Math.max(1, Math.round(img.naturalWidth * scale))
  const h = Math.max(1, Math.round(img.naturalHeight * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return new Uint8ClampedArray(0)
  try {
    ctx.drawImage(img, 0, 0, w, h)
    return ctx.getImageData(0, 0, w, h).data
  } catch {
    return new Uint8ClampedArray(0)
  }
}

interface Box {
  r1: number; r2: number; g1: number; g2: number; b1: number; b2: number
  count: number
}

export function extractPalette(pixels: Uint8ClampedArray, colorCount = 10): string[] {
  const histo = new Map<number, number>()
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 125) continue
    const r = pixels[i] >> RSHIFT
    const g = pixels[i + 1] >> RSHIFT
    const b = pixels[i + 2] >> RSHIFT
    const key = (r << (2 * SIGBITS)) | (g << SIGBITS) | b
    histo.set(key, (histo.get(key) ?? 0) + 1)
  }
  if (histo.size === 0) return []

  const boxCount = (box: Box) => {
    let n = 0
    for (let r = box.r1; r <= box.r2; r++)
      for (let g = box.g1; g <= box.g2; g++)
        for (let b = box.b1; b <= box.b2; b++)
          n += histo.get((r << (2 * SIGBITS)) | (g << SIGBITS) | b) ?? 0
    return n
  }

  let r1 = 31, r2 = 0, g1 = 31, g2 = 0, b1 = 31, b2 = 0
  for (const key of histo.keys()) {
    const r = key >> (2 * SIGBITS)
    const g = (key >> SIGBITS) & 31
    const b = key & 31
    if (r < r1) r1 = r; if (r > r2) r2 = r
    if (g < g1) g1 = g; if (g > g2) g2 = g
    if (b < b1) b1 = b; if (b > b2) b2 = b
  }
  const first: Box = { r1, r2, g1, g2, b1, b2, count: 0 }
  first.count = boxCount(first)
  const boxes: Box[] = [first]

  const split = (box: Box): Box[] => {
    const rw = box.r2 - box.r1
    const gw = box.g2 - box.g1
    const bw = box.b2 - box.b1
    const axis = gw >= rw && gw >= bw ? 'g' : rw >= bw ? 'r' : 'b'
    const [lo, hi] = axis === 'r' ? [box.r1, box.r2] : axis === 'g' ? [box.g1, box.g2] : [box.b1, box.b2]
    if (lo >= hi) return [box]
    // walk the axis to the median by population
    let acc = 0
    const partials: number[] = []
    for (let v = lo; v <= hi; v++) {
      let slice = 0
      for (let a = axis === 'r' ? box.g1 : box.r1; a <= (axis === 'r' ? box.g2 : box.r2); a++)
        for (let c = axis === 'b' ? box.g1 : box.b1; c <= (axis === 'b' ? box.g2 : box.b2); c++) {
          const key = axis === 'r'
            ? (v << (2 * SIGBITS)) | (a << SIGBITS) | c
            : axis === 'g'
              ? (a << (2 * SIGBITS)) | (v << SIGBITS) | c
              : (a << (2 * SIGBITS)) | (c << SIGBITS) | v
          slice += histo.get(key) ?? 0
        }
      acc += slice
      partials.push(acc)
    }
    const half = box.count / 2
    let cut = lo
    for (let v = lo; v <= hi; v++) {
      if (partials[v - lo] >= half) { cut = v; break }
    }
    cut = Math.min(cut, hi - 1)
    const left: Box = { ...box }
    const right: Box = { ...box }
    if (axis === 'r') { left.r2 = cut; right.r1 = cut + 1 }
    else if (axis === 'g') { left.g2 = cut; right.g1 = cut + 1 }
    else { left.b2 = cut; right.b1 = cut + 1 }
    left.count = boxCount(left)
    right.count = boxCount(right)
    return [left, right].filter((b) => b.count > 0)
  }

  while (boxes.length < colorCount) {
    boxes.sort((a, b) => b.count - a.count)
    const target = boxes.find((b) => b.count > 0 && (b.r2 > b.r1 || b.g2 > b.g1 || b.b2 > b.b1))
    if (!target) break
    const parts = split(target)
    if (parts.length < 2) break
    boxes.splice(boxes.indexOf(target), 1, ...parts)
  }

  const avg = (box: Box): string => {
    let n = 0, rs = 0, gs = 0, bs = 0
    for (let r = box.r1; r <= box.r2; r++)
      for (let g = box.g1; g <= box.g2; g++)
        for (let b = box.b1; b <= box.b2; b++) {
          const c = histo.get((r << (2 * SIGBITS)) | (g << SIGBITS) | b) ?? 0
          n += c
          rs += c * (r + 0.5) * (1 << RSHIFT)
          gs += c * (g + 0.5) * (1 << RSHIFT)
          bs += c * (b + 0.5) * (1 << RSHIFT)
        }
    if (n === 0) return '#151715'
    return rgbToHex([rs / n, gs / n, bs / n])
  }

  return boxes
    .sort((a, b) => b.count - a.count)
    .slice(0, colorCount)
    .map(avg)
}
