import { useEffect, useRef, useState } from 'react'
import { extractPalette } from '../lib/colour.ts'

interface CaptureLensProps {
  src: string
  palette: string[]
  onPalette: (palette: string[]) => void
  onClose: () => void
}

const VIEW_W = 240
const MAX_ZOOM = 12

/**
 * The uploaded image as a pannable, zoomable lens: whatever region is
 * visible in the frame is the region the card colours are drawn from,
 * re-extracted live as you move.
 */
export function CaptureLens({ src, palette, onPalette, onClose }: CaptureLensProps) {
  const imgRef = useRef<HTMLImageElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const [viewH, setViewH] = useState(180)
  const view = useRef({ zoom: 1, ox: 0, oy: 0 })
  const drag = useRef<{ x: number; y: number } | null>(null)
  const extractTimer = useRef(0)

  const geometry = () => {
    const img = imgRef.current
    if (!img || !img.naturalWidth) return null
    const h = frameRef.current?.clientHeight ?? viewH
    const s0 = VIEW_W / img.naturalWidth
    const scale = s0 * view.current.zoom
    return { img, h, s0, scale, visW: VIEW_W / scale, visH: h / scale }
  }

  const clampAndApply = () => {
    const g = geometry()
    if (!g) return
    const v = view.current
    v.zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom))
    const { img, h, s0 } = g
    const scale = s0 * v.zoom
    v.ox = Math.max(0, Math.min(img.naturalWidth - VIEW_W / scale, v.ox))
    v.oy = Math.max(0, Math.min(img.naturalHeight - h / scale, v.oy))
    img.style.transform = `translate(${-v.ox * scale}px, ${-v.oy * scale}px) scale(${scale})`
  }

  const extractNow = () => {
    const g = geometry()
    if (!g) return
    const { img, visW, visH } = g
    const { ox, oy } = view.current
    const canvas = document.createElement('canvas')
    const sample = Math.min(1, Math.sqrt(15000 / (visW * visH)))
    canvas.width = Math.max(1, Math.round(visW * sample))
    canvas.height = Math.max(1, Math.round(visH * sample))
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (!ctx) return
    try {
      ctx.drawImage(img, ox, oy, visW, visH, 0, 0, canvas.width, canvas.height)
      const pal = extractPalette(ctx.getImageData(0, 0, canvas.width, canvas.height).data, 10)
      if (pal.length >= 2) onPalette(pal)
    } catch {
      // tainted canvas — data URLs never are, but stay safe
    }
  }

  const scheduleExtract = () => {
    if (extractTimer.current) return
    extractTimer.current = window.setTimeout(() => {
      extractTimer.current = 0
      extractNow()
    }, 120)
  }

  useEffect(() => () => window.clearTimeout(extractTimer.current), [])

  // wheel zoom must preventDefault, so it needs a non-passive listener
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const g = geometry()
      if (!g) return
      const rect = frame.getBoundingClientRect()
      const px = e.clientX - rect.left
      const py = e.clientY - rect.top
      const v = view.current
      const before = g.s0 * v.zoom
      v.zoom = Math.min(MAX_ZOOM, Math.max(1, v.zoom * Math.exp(-e.deltaY * 0.0022)))
      const after = g.s0 * v.zoom
      // keep the image point under the cursor fixed while zooming
      v.ox += px / before - px / after
      v.oy += py / before - py / after
      clampAndApply()
      scheduleExtract()
    }
    frame.addEventListener('wheel', onWheel, { passive: false })
    return () => frame.removeEventListener('wheel', onWheel)
  })

  return (
    <aside className="lens">
      <header className="lens-bar">
        <span>capture — drag to pan, scroll to zoom</span>
        <button className="lens-close" onClick={onClose} aria-label="Close">
          ×
        </button>
      </header>
      <div
        className="lens-frame"
        ref={frameRef}
        style={{ width: VIEW_W, height: viewH }}
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, y: e.clientY }
          e.currentTarget.setPointerCapture(e.pointerId)
        }}
        onPointerMove={(e) => {
          if (!drag.current) return
          const g = geometry()
          if (!g) return
          const v = view.current
          v.ox -= (e.clientX - drag.current.x) / g.scale
          v.oy -= (e.clientY - drag.current.y) / g.scale
          drag.current = { x: e.clientX, y: e.clientY }
          clampAndApply()
          scheduleExtract()
        }}
        onPointerUp={() => {
          drag.current = null
          extractNow()
        }}
        onPointerCancel={() => {
          drag.current = null
        }}
      >
        <img
          ref={imgRef}
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => {
            const img = e.currentTarget
            setViewH(Math.max(140, Math.min(300, Math.round((VIEW_W * img.naturalHeight) / img.naturalWidth))))
            view.current = { zoom: 1, ox: 0, oy: 0 }
            requestAnimationFrame(() => {
              clampAndApply()
              extractNow()
            })
          }}
        />
      </div>
      <div className="lens-swatches">
        {palette.map((c) => (
          <span key={c} style={{ background: c }} />
        ))}
      </div>
    </aside>
  )
}
