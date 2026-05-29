import { nameBytes, idSuffix } from './hash'
import { APEX, AVATAR_L1, AVATAR_L2, COMP_NAMES, GLYPH_NAMES } from './tokens'

export interface AvatarParams {
  hue1: number
  hue2: number
  comp: number // 0 radial | 1 linear | 2 banded | 3 split
  glyph: number // 0 sun | 1 aperture | 2 orbit | 3 arc | 4 diamond | 5 chain
  rot: number // degrees
  sat: number // percent
  l1: number
  l2: number
}

// The D-07 algorithm, verbatim from the brand deck — with the lightness stops
// filled in (the deck specified hue/comp/glyph/rot/sat but not L).
// NOTE: multiply-before-divide (`* 360 / 255`) so this stays correct if it is
// ever re-implemented in Solidity integer math for an on-chain renderer.
export function avatarParams(name: string): AvatarParams {
  const b = nameBytes(name)
  const hue1 = Math.round((b[0] * 360) / 255)
  const hue2 = (hue1 + 30 + (b[1] % 90)) % 360
  const comp = b[2] % 4
  const glyph = b[3] % 6
  const rot = Math.round((b[4] * 360) / 255)
  const sat = 55 + (b[5] % 25)
  return { hue1, hue2, comp, glyph, rot, sat, l1: AVATAR_L1, l2: AVATAR_L2 }
}

// Human-readable description — handy for the gallery captions and debugging.
export function describe(name: string): string {
  const p = avatarParams(name)
  return `${COMP_NAMES[p.comp]} · ${GLYPH_NAMES[p.glyph]} · h${p.hue1}/${
    p.hue2
  } · ${p.sat}% · rot ${p.rot}°`
}

const S = 256 // canonical avatar coordinate space
const CX = S * 0.5
const CY = S * 0.46 // glyph centre sits just above the horizon
const HORIZON_Y = S * 0.62 // the brand-invariant hairline
const SW = S * 0.018 // base stroke width

function hsl(h: number, s: number, l: number) {
  return `hsl(${h} ${s}% ${l}%)`
}

// ── Backgrounds (one per comp) ───────────────────────────────────────────────
function background(
  p: AvatarParams,
  sfx: string,
): { defs: string; rect: string } {
  const c1 = hsl(p.hue1, p.sat, p.l1)
  const c2 = hsl(p.hue2, p.sat, p.l2)
  const gid = `bg-${sfx}`

  if (p.comp === 0) {
    // radial — light core fading to deep edge
    const defs = `<radialGradient id="${gid}" cx="42%" cy="40%" r="78%">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </radialGradient>`
    return {
      defs,
      rect: `<rect width="${S}" height="${S}" fill="url(#${gid})"/>`,
    }
  }
  if (p.comp === 1) {
    // linear — angle driven by rot for variety
    const a = p.rot
    const defs = `<linearGradient id="${gid}" gradientTransform="rotate(${a} 0.5 0.5)">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>`
    return {
      defs,
      rect: `<rect width="${S}" height="${S}" fill="url(#${gid})"/>`,
    }
  }
  if (p.comp === 2) {
    // banded — two horizontal bands meeting near the horizon
    const defs = `<linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="${c1}"/>
      <stop offset="58%" stop-color="${c1}"/>
      <stop offset="64%" stop-color="${c2}"/>
      <stop offset="100%" stop-color="${c2}"/>
    </linearGradient>`
    return {
      defs,
      rect: `<rect width="${S}" height="${S}" fill="url(#${gid})"/>`,
    }
  }
  // comp === 3 — diagonal split into two triangles
  const defs = `<linearGradient id="${gid}" gradientTransform="rotate(45 0.5 0.5)">
    <stop offset="0%" stop-color="${c1}"/>
    <stop offset="50%" stop-color="${c1}"/>
    <stop offset="50%" stop-color="${c2}"/>
    <stop offset="100%" stop-color="${c2}"/>
  </linearGradient>`
  return {
    defs,
    rect: `<rect width="${S}" height="${S}" fill="url(#${gid})"/>`,
  }
}

// ── Glyphs (one per glyph index) ─────────────────────────────────────────────
function glyphMarkup(p: AvatarParams): string {
  const ink = APEX
  const r = (k: number) => (S * k).toFixed(1)

  let body: string
  switch (p.glyph) {
    case 0: // sun — disc crossed by a diagonal ray
      body = `<circle cx="${CX}" cy="${CY}" r="${r(
        0.13,
      )}" fill="${ink}" opacity="0.92"/>
        <line x1="${CX + S * 0.12}" y1="${CY - S * 0.2}" x2="${
        CX - S * 0.06
      }" y2="${CY + S * 0.22}"
              stroke="${ink}" stroke-width="${SW}" stroke-linecap="round" opacity="0.88"/>`
      break
    case 1: // aperture — concentric rings + core
      body = `<circle cx="${CX}" cy="${CY}" r="${r(
        0.2,
      )}" fill="none" stroke="${ink}" stroke-width="${SW}" opacity="0.35"/>
        <circle cx="${CX}" cy="${CY}" r="${r(
        0.13,
      )}" fill="none" stroke="${ink}" stroke-width="${SW}" opacity="0.5"/>
        <circle cx="${CX}" cy="${CY}" r="${r(
        0.06,
      )}" fill="${ink}" opacity="0.92"/>`
      break
    case 2: // orbit — ellipse + core (rot can stand it upright)
      body = `<ellipse cx="${CX}" cy="${CY}" rx="${r(0.22)}" ry="${r(
        0.11,
      )}" fill="none" stroke="${ink}" stroke-width="${SW}" opacity="0.85"/>
        <circle cx="${CX}" cy="${CY}" r="${r(
        0.07,
      )}" fill="${ink}" opacity="0.92"/>`
      break
    case 3: // arc — hill curve with a dot at the apex
      body = `<path d="M ${CX - S * 0.2} ${CY + S * 0.07} Q ${CX} ${
        CY - S * 0.21
      } ${CX + S * 0.2} ${CY + S * 0.07}"
              fill="none" stroke="${ink}" stroke-width="${SW}" stroke-linecap="round" opacity="0.88"/>
        <circle cx="${CX}" cy="${CY - S * 0.085}" r="${r(
        0.045,
      )}" fill="${ink}" opacity="0.92"/>`
      break
    case 4: // diamond — rotated square
      body = `<rect x="${CX - S * 0.15}" y="${CY - S * 0.15}" width="${r(
        0.3,
      )}" height="${r(0.3)}"
              fill="${ink}" opacity="0.92" transform="rotate(45 ${CX} ${CY})"/>`
      break
    default: // 5 chain — three discs, large→small
      body = `<circle cx="${CX - S * 0.16}" cy="${CY}" r="${r(
        0.085,
      )}" fill="${ink}" opacity="0.92"/>
        <circle cx="${CX + S * 0.0}" cy="${CY}" r="${r(
        0.06,
      )}" fill="${ink}" opacity="0.92"/>
        <circle cx="${CX + S * 0.14}" cy="${CY}" r="${r(
        0.04,
      )}" fill="${ink}" opacity="0.92"/>`
  }
  return `<g transform="rotate(${p.rot} ${CX} ${CY})">${body}</g>`
}

// Inner avatar content on a 0 0 256 256 grid — embeddable in a larger document.
export function avatarInner(name: string, sfx = idSuffix(name)): string {
  const p = avatarParams(name)
  const bg = background(p, sfx)
  const clip = `clip-${sfx}`
  return `<defs>
    ${bg.defs}
    <clipPath id="${clip}"><rect width="${S}" height="${S}" rx="${
    S * 0.22
  }"/></clipPath>
  </defs>
  <g clip-path="url(#${clip})">
    ${bg.rect}
    ${glyphMarkup(p)}
    <line x1="0" y1="${HORIZON_Y}" x2="${S}" y2="${HORIZON_Y}" stroke="${APEX}" stroke-width="1" opacity="0.22"/>
  </g>`
}

// Standalone avatar SVG (its own file).
export function renderAvatar(name: string, size = 256): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${S} ${S}" role="img" aria-label="${name} avatar">
${avatarInner(name)}
</svg>`
}
