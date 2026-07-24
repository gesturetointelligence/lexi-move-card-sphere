# lexi-move-card-sphere

One hundred Magic cards orbiting on a 3D sphere — drag to spin, or let the dials play it.

---

## What It Is

A hundred short spoken phrases — the everyday things people say through Magic — each rendered as a faithful Magic card (4:5 portrait, 24px continuous corners, inset keyline, colour-tinted glow, per-phrase typeface personality) and pinned to the nodes of a Fibonacci sphere in CSS 3D.

Every card wears its own palette, extracted by median-cut quantization from the treatment moodboard (224 source images → 224 five-colour palettes). Card/text pairs are chosen colour-on-colour where the palette allows it, hue-tinted ink where it doesn't — the same scoring idea as `lexi-move-colour-capture`.

Grab the sphere to spin it (with inertia), or open the DialKit panel:

- **sphere** — card count, sphere radius, card scale
- **motion** — `play` auto-rotation, speed, wobble
- **colour** — palette source, *Randomise colours*, *Upload image* (median-cut extracts a palette from your photo and recolours the whole sphere from it)

## How to Run

```bash
npm install
npm run dev
```

## What It Connects To

- **Magic** — the card is a direct mirror of the `preview-card` in `lexi-magic-studio` / `lexi-magic-website` (which itself mirrors `apps/magic-mobile`): geometry, keyline, glow, typography rules, deterministic per-phrase scheme, ~30% lowercase.
- **`lexi-move-colour-capture`** — the palette extraction (median-cut) and card/text pairing logic carry over from its colour engine.
- The treatment moodboard (`treatment-colours.zip`) — the colour source for all 224 palettes.

## Authors

- Ravi

## Date

2026-07-24
