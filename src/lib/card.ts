import { hashString } from './colour.ts'

// Mirrors apps/magic-mobile card typography via lexi-magic-studio card-tokens:
// 30px display text down to 24px between 100 and 160 characters, line-height 1.2.
export const CARD_BASE_WIDTH = 216 // 13.5rem — the canonical preview-card width
const MAX_FONT = 30
const MIN_FONT = 24
const SHRINK_START = 100
const SHRINK_END = 160

export function computeCardFontSize(text: string): number {
  const len = text.length
  if (len <= SHRINK_START) return MAX_FONT
  if (len >= SHRINK_END) return MIN_FONT
  const t = (len - SHRINK_START) / (SHRINK_END - SHRINK_START)
  return MAX_FONT - t * (MAX_FONT - MIN_FONT)
}

// Four card personalities → Apple system faces, as in card-tokens.ts
const CARD_FONTS = [
  { family: '-apple-system, BlinkMacSystemFont, system-ui, sans-serif', weight: 600 }, // SF Pro
  { family: 'ui-rounded, "SF Pro Rounded", -apple-system, system-ui, sans-serif', weight: 600 }, // SF Pro Rounded
  { family: 'ui-monospace, "SF Mono", Menlo, monospace', weight: 500 }, // SF Mono
  { family: 'ui-serif, "New York", Georgia, serif', weight: 600 }, // New York
]

export interface CardScheme {
  text: string
  fontFamily: string
  fontWeight: number
  fontSize: number
}

/** Deterministic per-phrase styling: font personality + ~30% lowercase. */
export function schemeForPhrase(phrase: string): CardScheme {
  const h = hashString(phrase)
  const font = CARD_FONTS[h % CARD_FONTS.length]
  const text = (h >> 3) % 10 < 3 ? phrase.toLowerCase() : phrase
  return {
    text,
    fontFamily: font.family,
    fontWeight: font.weight,
    fontSize: computeCardFontSize(text),
  }
}
