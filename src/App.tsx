import { useEffect, useMemo, useRef, useState } from 'react'
import { DialRoot, DialStore } from 'dialkit'
import 'dialkit/styles.css'
import { Card } from './components/Card.tsx'
import { PHRASES } from './lib/phrases.ts'
import { TREATMENT_PALETTES } from './lib/palettes.ts'
import { fibonacciSphere } from './lib/sphere.ts'
import { extractPalette, mulberry32, pickPair, samplePixels } from './lib/colour.ts'
import type { CardColours } from './lib/colour.ts'

const PANEL_ID = 'card-sphere'
const MAX_CARDS = Math.min(PHRASES.length, TREATMENT_PALETTES.length)

// dev-only: lets local tooling drive the dials programmatically
if (import.meta.env.DEV) {
  ;(window as unknown as Record<string, unknown>).DialStore = DialStore
}

interface Dials {
  cards: number
  radius: number
  cardScale: number
  play: boolean
  speed: number
  wobble: number
  source: string
  depthFade: number
  depthBlur: number
  depthDim: number
  depthDesaturate: number
}

const DEFAULT_DIALS: Dials = {
  cards: 100,
  radius: 480,
  cardScale: 0.52,
  play: true,
  speed: 12,
  wobble: 8,
  source: 'treatment',
  depthFade: 0.9,
  depthBlur: 0,
  depthDim: 0,
  depthDesaturate: 0,
}

export default function App() {
  const [dials, setDials] = useState<Dials>(DEFAULT_DIALS)
  const [seed, setSeed] = useState(1)
  const [captured, setCaptured] = useState<string[] | null>(null)

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
        cards: [DEFAULT_DIALS.cards, 1, MAX_CARDS, 1],
        radius: [DEFAULT_DIALS.radius, 160, 800, 10],
        cardScale: [DEFAULT_DIALS.cardScale, 0.25, 1.4, 0.01],
      },
      motion: {
        play: DEFAULT_DIALS.play,
        speed: [DEFAULT_DIALS.speed, -200, 200, 1],
        wobble: [DEFAULT_DIALS.wobble, 0, 45, 1],
        grow: { type: 'action', label: 'Grow' },
      },
      depth: {
        fade: [DEFAULT_DIALS.depthFade, 0, 1, 0.05],
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

    const readValues = () => {
      const v = DialStore.getValues(PANEL_ID)
      setDials({
        cards: v['sphere.cards'] as number,
        radius: v['sphere.radius'] as number,
        cardScale: v['sphere.cardScale'] as number,
        play: v['motion.play'] as boolean,
        speed: v['motion.speed'] as number,
        wobble: v['motion.wobble'] as number,
        source: v['colour.source'] as string,
        depthFade: v['depth.fade'] as number,
        depthBlur: v['depth.blur'] as number,
        depthDim: v['depth.dim'] as number,
        depthDesaturate: v['depth.desaturate'] as number,
      })
    }
    readValues()

    // 'grow' — one card seeds the sphere, multiplies while spinning with
    // momentum, then the spin decays into a slow idle rotation. Pure dial
    // choreography: it animates the real DialKit values.
    let growRaf = 0
    const runGrow = () => {
      cancelAnimationFrame(growRaf)
      const GROW_MS = 5500
      const DECAY_MS = 7500
      const START_SPEED = 170
      const REST_SPEED = DEFAULT_DIALS.speed
      DialStore.updateValue(PANEL_ID, 'sphere.cards', 1)
      DialStore.updateValue(PANEL_ID, 'motion.play', true)
      DialStore.updateValue(PANEL_ID, 'motion.speed', START_SPEED)
      const t0 = performance.now()
      let lastCards = 1
      let lastSpeedAt = 0
      const step = (now: number) => {
        const t = now - t0
        const pGrow = Math.min(1, t / GROW_MS)
        const eased = 1 - Math.pow(1 - pGrow, 3)
        const cards = Math.max(1, Math.round(1 + (MAX_CARDS - 1) * eased))
        if (cards !== lastCards) {
          lastCards = cards
          DialStore.updateValue(PANEL_ID, 'sphere.cards', cards)
        }
        if (now - lastSpeedAt > 66) {
          lastSpeedAt = now
          const pDecay = Math.min(1, t / DECAY_MS)
          const speed = REST_SPEED + (START_SPEED - REST_SPEED) * Math.pow(1 - pDecay, 2.2)
          DialStore.updateValue(PANEL_ID, 'motion.speed', Math.round(speed))
        }
        if (t < DECAY_MS) {
          growRaf = requestAnimationFrame(step)
        } else {
          DialStore.updateValue(PANEL_ID, 'motion.speed', REST_SPEED)
        }
      }
      growRaf = requestAnimationFrame(step)
    }
    const introTimer = window.setTimeout(runGrow, 500)

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
      pitch = Math.max(-80, Math.min(80, pitch - dy * 0.25))
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
        // inertia
        yaw += velYaw
        pitch = Math.max(-80, Math.min(80, pitch + velPitch))
        velYaw *= 0.95
        velPitch *= 0.95
        if (d.play) {
          yaw += d.speed * dt
          const target = Math.sin(now / 2400) * d.wobble
          pitch += (target - pitch) * Math.min(1, dt * 1.2)
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

  // --- image upload → median-cut palette → capture mode ---
  const onFile = (file: File | undefined) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      const img = new Image()
      img.onload = () => {
        const palette = extractPalette(samplePixels(img), 10)
        if (palette.length >= 2) {
          setCaptured(palette)
          setSeed((s) => s + 1)
          DialStore.updateValue(PANEL_ID, 'colour.source', 'capture')
        }
      }
      img.src = reader.result as string
    }
    reader.readAsDataURL(file)
  }

  // --- card data ---
  const nodes = useMemo(() => fibonacciSphere(dials.cards), [dials.cards])

  const colours = useMemo<CardColours[]>(() => {
    const rng = mulberry32(seed * 2654435761)
    const n = dials.cards
    if (dials.source === 'capture' && captured) {
      // stride 7 so neighbouring nodes land on distant candidates
      const offset = Math.floor(rng() * 97)
      return Array.from({ length: n }, (_, i) => pickPair(captured, i * 7 + offset))
    }
    // one treatment palette per card — shuffled so no two cards share one
    const perm = TREATMENT_PALETTES.map((_, i) => i)
    for (let i = perm.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1))
      ;[perm[i], perm[j]] = [perm[j], perm[i]]
    }
    return Array.from({ length: n }, (_, i) =>
      pickPair(TREATMENT_PALETTES[perm[i % perm.length]], Math.floor(rng() * 5)),
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
              '--depth-fade': dials.depthFade,
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
      <header className="chrome chrome-top">
        <span className="wordmark">Card Sphere</span>
        <span className="dim">lexi-play</span>
      </header>
      <footer className="chrome chrome-bottom dim">drag to spin · dials top right</footer>
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
