import { useEffect, useMemo, useRef, useState } from 'react'
import { DialRoot, DialStore } from 'dialkit'
import 'dialkit/styles.css'
import { Card } from './components/Card.tsx'
import { CaptureLens } from './components/CaptureLens.tsx'
import { PHRASES } from './lib/phrases.ts'
import { TREATMENT_PALETTES } from './lib/palettes.ts'
import { sphereNodes } from './lib/sphere.ts'
import { mulberry32, pickPair } from './lib/colour.ts'
import type { CardColours } from './lib/colour.ts'

const PANEL_ID = 'card-sphere'
const MAX_CARDS = 128

// dev-only: lets local tooling drive the dials programmatically
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).DialStore = DialStore
}

interface Dials {
  cards: number
  mesh: string
  radius: number
  cardScale: number
  play: boolean
  speed: number
  wobble: number
  preset: string
  growMethod: string
  source: string
  depthBlur: number
  depthDim: number
  depthDesaturate: number
}

const DEFAULT_DIALS: Dials = {
  cards: 64,
  mesh: 'fibonacci',
  radius: 480,
  cardScale: 0.52,
  play: true,
  speed: 12,
  wobble: 8,
  preset: 'orbit',
  growMethod: 'bloom',
  source: 'treatment',
  depthBlur: 6,
  depthDim: 1,
  depthDesaturate: 1,
}

const MESH_TYPES = ['fibonacci', 'uv', 'icosahedron', 'quad', 'goldberg']
const MOTION_PRESETS = ['orbit', 'drift', 'pendulum', 'tumble', 'pulse']
const GROW_METHOD_NAMES = ['bloom', 'spiral', 'burst', 'steps', 'stack']

const easeOutCubic = (p: number) => 1 - Math.pow(1 - p, 3)
const easeOutBack = (p: number) => {
  const c = 1.70158
  return 1 + (c + 1) * Math.pow(p - 1, 3) + c * Math.pow(p - 1, 2)
}
const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

interface GrowMethod {
  dur: number
  /** fraction of MAX_CARDS at progress p (floored to 1 card) */
  cards: (p: number) => number
  /** fraction of the target radius at progress p */
  radius: (p: number) => number
  /** spin speed in deg/s at progress p */
  speed: (p: number) => number
}

const spinDecay = (start: number, decay: number) => (p: number) =>
  DEFAULT_DIALS.speed + (start - DEFAULT_DIALS.speed) * Math.pow(1 - p, decay)

const GROW_METHODS: Record<string, GrowMethod> = {
  // swell out of the centre, spin decaying all the way
  bloom: {
    dur: 7500,
    cards: (p) => easeOutCubic(clamp01(p / 0.73)),
    radius: (p) => easeOutCubic(clamp01(p / 0.73)),
    speed: spinDecay(170, 2.2),
  },
  // steady unfurl — count and radius climb together at a constant rate
  spiral: {
    dur: 8000,
    cards: (p) => clamp01(p / 0.85),
    radius: (p) => clamp01(p / 0.85),
    speed: (p) => (p < 0.6 ? 120 : spinDecay(120, 2)((p - 0.6) / 0.4)),
  },
  // everything at once: cards slam in, radius overshoots and settles
  burst: {
    dur: 3800,
    cards: (p) => clamp01(p * 3.2),
    radius: (p) => easeOutBack(clamp01(p * 1.8)),
    speed: spinDecay(260, 2),
  },
  // one… ten… a hundred
  steps: {
    dur: 7500,
    cards: (p) =>
      p < 0.16 ? 0
      : p < 0.26 ? (0.1 * (p - 0.16)) / 0.1
      : p < 0.48 ? 0.1
      : p < 0.72 ? 0.1 + (0.9 * (p - 0.48)) / 0.24
      : 1,
    radius: (p) => easeOutCubic(clamp01(p / 0.8)),
    speed: spinDecay(150, 1.8),
  },
  // pile up at the centre, then spring outward into place
  stack: {
    dur: 7000,
    cards: (p) => easeOutCubic(clamp01(p / 0.5)),
    radius: (p) => (p < 0.52 ? 0 : easeOutBack(clamp01((p - 0.52) / 0.4))),
    speed: spinDecay(170, 2.2),
  },
}

// the opening card is always the brand card: signal green, ink text
const SIGNAL_CARD: CardColours = { bg: '#d0e62c', fg: '#151715' }

export default function App() {
  // pre-grow seed state: one card at the centre, radius zero
  const [dials, setDials] = useState<Dials>({ ...DEFAULT_DIALS, cards: 1, radius: 0 })
  const [seed, setSeed] = useState(1)
  const [captured, setCaptured] = useState<string[] | null>(null)
  const [imageSrc, setImageSrc] = useState<string | null>(null)
  const [lensOpen, setLensOpen] = useState(false)

  const sphereRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const dialsRef = useRef(dials)
  dialsRef.current = dials
  const registered = useRef(false)

  // --- DialKit panel (imperative store, as in colour-capture) ---
  useEffect(() => {
    if (registered.current) return
    registered.current = true
    DialStore.registerPanel(PANEL_ID, 'Card Sphere', {
      sphere: {
        cards: [DEFAULT_DIALS.cards, 0, MAX_CARDS, 1],
        mesh: { type: 'select', options: MESH_TYPES, default: DEFAULT_DIALS.mesh },
        radius: [DEFAULT_DIALS.radius, 0, 800, 10],
        cardScale: [DEFAULT_DIALS.cardScale, 0.25, 1.4, 0.01],
      },
      motion: {
        play: DEFAULT_DIALS.play,
        speed: [DEFAULT_DIALS.speed, -200, 200, 1],
        wobble: [DEFAULT_DIALS.wobble, 0, 45, 1],
        preset: { type: 'select', options: MOTION_PRESETS, default: DEFAULT_DIALS.preset },
        growMethod: { type: 'select', options: GROW_METHOD_NAMES, default: DEFAULT_DIALS.growMethod },
        grow: { type: 'action', label: 'Grow' },
      },
      depth: {
        blur: [DEFAULT_DIALS.depthBlur, 0, 14, 0.5],
        dim: [DEFAULT_DIALS.depthDim, 0, 1, 0.05],
        desaturate: [DEFAULT_DIALS.depthDesaturate, 0, 1, 0.05],
      },
      colour: {
        source: { type: 'select', options: ['treatment', 'capture'], default: DEFAULT_DIALS.source },
        randomise: { type: 'action', label: 'Randomise colours' },
        upload: { type: 'action', label: 'Upload image' },
      },
    })

    // seed the pre-grow state in the store too, so the first paint is a
    // single signal card at the centre rather than a flash of the full sphere
    DialStore.updateValue(PANEL_ID, 'sphere.cards', 1)
    DialStore.updateValue(PANEL_ID, 'sphere.radius', 0)

    const readValues = () => {
      const v = DialStore.getValues(PANEL_ID)
      setDials({
        cards: v['sphere.cards'] as number,
        mesh: v['sphere.mesh'] as string,
        radius: v['sphere.radius'] as number,
        cardScale: v['sphere.cardScale'] as number,
        play: v['motion.play'] as boolean,
        speed: v['motion.speed'] as number,
        wobble: v['motion.wobble'] as number,
        preset: v['motion.preset'] as string,
        growMethod: v['motion.growMethod'] as string,
        source: v['colour.source'] as string,
        depthBlur: v['depth.blur'] as number,
        depthDim: v['depth.dim'] as number,
        depthDesaturate: v['depth.desaturate'] as number,
      })
    }
    readValues()

    // 'grow' — one card seeds the sphere at the centre (radius 0), grows to
    // the full sphere, then the spin decays into a slow idle rotation. Pure
    // dial choreography via the selected grow method: it animates the real
    // DialKit values.
    let growRaf = 0
    let growing = false
    let growTargets = {
      cards: DEFAULT_DIALS.cards,
      radius: DEFAULT_DIALS.radius,
      scale: DEFAULT_DIALS.cardScale,
    }
    const runGrow = (targets?: typeof growTargets) => {
      cancelAnimationFrame(growRaf)
      const v = DialStore.getValues(PANEL_ID)
      const method = GROW_METHODS[v['motion.growMethod'] as string] ?? GROW_METHODS.bloom
      // grow always respects the current dials as its destination — card
      // amount is the maximum, radius and scale are where it settles.
      // (mid-grow retrigger reuses the captured targets, not partial values)
      if (targets) growTargets = targets
      else if (!growing)
        growTargets = {
          cards: Math.max(1, v['sphere.cards'] as number),
          radius: (v['sphere.radius'] as number) || DEFAULT_DIALS.radius,
          scale: (v['sphere.cardScale'] as number) || DEFAULT_DIALS.cardScale,
        }
      growing = true
      const startScale = Math.min(1.4, growTargets.scale * 1.9)
      DialStore.updateValue(PANEL_ID, 'sphere.cards', 1)
      DialStore.updateValue(PANEL_ID, 'sphere.radius', 0)
      DialStore.updateValue(PANEL_ID, 'sphere.cardScale', startScale)
      DialStore.updateValue(PANEL_ID, 'motion.play', true)
      DialStore.updateValue(PANEL_ID, 'motion.speed', Math.round(method.speed(0)))
      const t0 = performance.now()
      let lastCards = 1
      let lastTickAt = 0
      const step = (now: number) => {
        const p = Math.min(1, (now - t0) / method.dur)
        const cards = Math.max(1, Math.round(method.cards(p) * growTargets.cards))
        if (cards !== lastCards) {
          lastCards = cards
          DialStore.updateValue(PANEL_ID, 'sphere.cards', cards)
        }
        if (now - lastTickAt > 66) {
          lastTickAt = now
          const rp = method.radius(p)
          DialStore.updateValue(PANEL_ID, 'sphere.radius', Math.round(rp * growTargets.radius))
          DialStore.updateValue(
            PANEL_ID,
            'sphere.cardScale',
            Math.round((startScale + (growTargets.scale - startScale) * rp) * 100) / 100,
          )
          DialStore.updateValue(PANEL_ID, 'motion.speed', Math.round(method.speed(p)))
        }
        if (p < 1) {
          growRaf = requestAnimationFrame(step)
        } else {
          DialStore.updateValue(PANEL_ID, 'sphere.cards', growTargets.cards)
          DialStore.updateValue(PANEL_ID, 'sphere.radius', growTargets.radius)
          DialStore.updateValue(PANEL_ID, 'sphere.cardScale', growTargets.scale)
          DialStore.updateValue(PANEL_ID, 'motion.speed', DEFAULT_DIALS.speed)
          growing = false
        }
      }
      growRaf = requestAnimationFrame(step)
    }
    // intro targets are explicit — the store was just seeded to 1 card / radius 0
    const introTimer = window.setTimeout(
      () =>
        runGrow({
          cards: DEFAULT_DIALS.cards,
          radius: DEFAULT_DIALS.radius,
          scale: DEFAULT_DIALS.cardScale,
        }),
      500,
    )

    const unsubValues = DialStore.subscribe(PANEL_ID, readValues)
    const unsubActions = DialStore.subscribeActions(PANEL_ID, (action) => {
      if (action === 'colour.randomise') setSeed((s) => s + 1)
      if (action === 'colour.upload') fileRef.current?.click()
      if (action === 'motion.grow') runGrow()
    })
    return () => {
      unsubValues()
      unsubActions()
      window.clearTimeout(introTimer)
      cancelAnimationFrame(growRaf)
    }
  }, [])

  // --- rotation: drag + inertia + play ---
  useEffect(() => {
    const sphere = sphereRef.current
    const stage = sphere?.parentElement
    if (!sphere || !stage) return

    let yaw = -20
    let pitch = -8
    let velYaw = 0
    let velPitch = 0
    let dragging = false
    let lastX = 0
    let lastY = 0
    let lastT = performance.now()
    let raf = 0

    const onDown = (e: PointerEvent) => {
      dragging = true
      lastX = e.clientX
      lastY = e.clientY
      velYaw = 0
      velPitch = 0
      stage.setPointerCapture(e.pointerId)
      stage.classList.add('grabbing')
    }
    const onMove = (e: PointerEvent) => {
      if (!dragging) return
      const dx = e.clientX - lastX
      const dy = e.clientY - lastY
      lastX = e.clientX
      lastY = e.clientY
      yaw += dx * 0.25
      // no pitch cap — the sphere can spin up/down infinitely
      pitch -= dy * 0.25
      velYaw = dx * 0.25
      velPitch = -dy * 0.25
    }
    const onUp = () => {
      dragging = false
      stage.classList.remove('grabbing')
    }

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastT) / 1000)
      lastT = now
      const d = dialsRef.current
      if (!dragging) {
        // inertia — no pitch cap, spin carries on freely
        yaw += velYaw
        pitch += velPitch
        velYaw *= 0.95
        velPitch *= 0.95
        // 0 = nothing, 1 = a static card; life begins at 2
        if (d.play && d.cards > 1) {
          // ease toward the nearest equivalent of the target so a spun-up
          // pitch (e.g. 700°) settles into its wobble without rewinding
          // through whole turns back toward 0
          const easeTo = (target: number) => {
            const nearest = target + 360 * Math.round((pitch - target) / 360)
            pitch += (nearest - pitch) * Math.min(1, dt * 1.2)
          }
          switch (d.preset) {
            case 'drift': // slow wander, speed swelling and ebbing
              yaw += d.speed * dt * (0.55 + 0.45 * Math.sin(now / 5200))
              easeTo((Math.sin(now / 3100) + 0.5 * Math.sin(now / 1700)) * d.wobble)
              break
            case 'pendulum': // swing back and forth
              yaw += Math.cos(now / 1400) * d.speed * dt * 2
              easeTo(Math.sin(now / 2800) * d.wobble)
              break
            case 'tumble': // end over end, both axes advancing
              yaw += d.speed * dt
              pitch += d.speed * 0.35 * dt
              break
            case 'pulse': // surges of spin between near-pauses
              yaw += d.speed * dt * (0.25 + 1.5 * Math.pow(0.5 + 0.5 * Math.sin(now / 1600), 2))
              easeTo(Math.sin(now / 3200) * d.wobble)
              break
            default: // orbit — steady spin, gentle sway
              yaw += d.speed * dt
              easeTo(Math.sin(now / 2400) * d.wobble)
          }
        }
      }
      sphere.style.transform = `translateZ(${-d.radius * 0.35}px) rotateX(${pitch}deg) rotateY(${yaw}deg)`
      sphere.style.setProperty('--yaw', `${yaw}deg`)
      sphere.style.setProperty('--pitch', `${pitch}deg`)
      raf = requestAnimationFrame(tick)
    }

    stage.addEventListener('pointerdown', onDown)
    stage.addEventListener('pointermove', onMove)
    stage.addEventListener('pointerup', onUp)
    stage.addEventListener('pointercancel', onUp)
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      stage.removeEventListener('pointerdown', onDown)
      stage.removeEventListener('pointermove', onMove)
      stage.removeEventListener('pointerup', onUp)
      stage.removeEventListener('pointercancel', onUp)
    }
  }, [])

  // --- image upload → capture lens; the visible region drives the palette ---
  const onFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      setImageSrc(reader.result as string)
      setLensOpen(true)
      DialStore.updateValue(PANEL_ID, 'colour.source', 'capture')
    }
    reader.readAsDataURL(file)
  }

  const onLensPalette = (palette: string[]) => {
    setCaptured(palette)
  }

  // --- card data ---
  const nodes = useMemo(() => sphereNodes(dials.mesh, dials.cards), [dials.mesh, dials.cards])

  const colours = useMemo<CardColours[]>(() => {
    const rng = mulberry32(seed * 2654435761)
    const n = dials.cards
    if (dials.source === 'capture' && captured) {
      // stride 7 so neighbouring nodes land on distant candidates
      const offset = Math.floor(rng() * 97)
      return Array.from({ length: n }, (_, i) =>
        i === 0 ? SIGNAL_CARD : pickPair(captured, i * 7 + offset),
      )
    }
    // one treatment palette per card — shuffled so no two cards share one
    const perm = TREATMENT_PALETTES.map((_, i) => i)
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[perm[i], perm[j]] = [perm[j], perm[i]]
    }
    return Array.from({ length: n }, (_, i) =>
      i === 0 ? SIGNAL_CARD : pickPair(TREATMENT_PALETTES[perm[i % perm.length]], Math.floor(rng() * 5)),
    )
  }, [dials.cards, dials.source, captured, seed])

  return (
    <>
      <div className="stage">
        <div
          className="sphere"
          ref={sphereRef}
          style={
            {
              '--depth-blur': dials.depthBlur,
              '--depth-dim': dials.depthDim,
              '--depth-desat': dials.depthDesaturate,
            } as React.CSSProperties
          }
        >
          {nodes.map((node, i) => (
            <Card
              key={i}
              phrase={PHRASES[i % PHRASES.length]}
              colours={colours[i]}
              node={node}
              radius={dials.radius}
              scale={dials.cardScale}
            />
          ))}
        </div>
      </div>
      {imageSrc && lensOpen && dials.source === 'capture' && (
        <CaptureLens
          src={imageSrc}
          palette={captured ?? []}
          onPalette={onLensPalette}
          onClose={() => setLensOpen(false)}
        />
      )}
      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          onFile(e.target.files?.[0])
          e.target.value = ''
        }}
      />
      <DialRoot position="top-right" defaultOpen={false} theme="dark" productionEnabled />
    </>
  )
}
