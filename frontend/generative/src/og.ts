import { avatarInner } from './avatar';
import { idSuffix } from './hash';
import { AMBER, APEX, APEX_DIM, APEX_MUTE, INDIGO, NIGHT } from './tokens';

export type OgState = 'profile' | 'available' | 'reserved';

export interface OgOptions {
  bio?: string; // profile
  block?: string; // profile — "12,345,678"
  expires?: string; // profile — "2027-05-27"
  price?: string; // available — "0.005 ETH / year"
  tier?: string; // available — "5-character tier"
}

const W = 1200;
const H = 630;
const FONTS =
  'https://fonts.googleapis.com/css2?family=Newsreader:ital,opsz,wght@0,6..72,200..600;1,6..72,200..600&family=JetBrains+Mono:wght@400;500&display=swap';

// State accents — ACTIVE/OPEN ride the amber brand accent; RESERVED cools to indigo.
function badge(state: OgState): { label: string; color: string } {
  if (state === 'available') return { label: 'OPEN', color: AMBER };
  if (state === 'reserved') return { label: 'RESERVED', color: '#9B8BC4' };
  return { label: 'ACTIVE', color: AMBER };
}

// The horizon hairline rendered as a block-height ruler — the brand signature
// turned into an on-chain timeline. Ticks every 26px, every 5th amber + taller.
function horizonRuler(y: number): string {
  const x0 = 80;
  const x1 = W - 80;
  let ticks = '';
  let i = 0;
  for (let x = x0; x <= x1; x += 26, i++) {
    const major = i % 5 === 0;
    const h = major ? 9 : 5;
    const col = major ? AMBER : APEX;
    const op = major ? 0.55 : 0.28;
    ticks += `<line x1="${x}" y1="${y - h}" x2="${x}" y2="${y + h}" stroke="${col}" stroke-width="${major ? 1.5 : 1}" opacity="${op}"/>`;
  }
  return `<line x1="${x0}" y1="${y}" x2="${x1}" y2="${y}" stroke="${APEX}" stroke-width="1" opacity="0.3"/>${ticks}`;
}

export function renderOg(name: string, state: OgState = 'profile', opts: OgOptions = {}): string {
  const sfx = idSuffix(name);
  const [label, dot] = (() => {
    const b = badge(state);
    return [b.label, b.color] as const;
  })();

  // Split the name: "alice" cream + ".rise" muted-gradient, "." as the amber brand dot.
  const lastDot = name.lastIndexOf('.');
  const stem = lastDot >= 0 ? name.slice(0, lastDot) : name;
  const tld = lastDot >= 0 ? name.slice(lastDot + 1) : '';

  const nameY = 360;
  const nameSize = 150;
  const avatarBox = 190;
  const avatarX = 250;
  const avatarY = nameY - avatarBox + 36;

  // Secondary line under the name — varies by state.
  let subline = '';
  if (state === 'profile' && opts.bio) {
    subline = `<text x="${W / 2}" y="455" text-anchor="middle"
      font-family="Newsreader" font-style="italic" font-weight="300" font-size="34" fill="${APEX_DIM}">“${opts.bio}”</text>`;
  } else if (state === 'available') {
    const price = opts.price ?? '0.005 ETH / year';
    const tier = opts.tier ?? '';
    subline = `<text x="${W / 2}" y="452" text-anchor="middle"
      font-family="Newsreader" font-weight="300" font-size="38" fill="${APEX}">${price}</text>
      ${tier ? `<text x="${W / 2}" y="486" text-anchor="middle" font-family="JetBrains Mono" font-size="15" letter-spacing="3" fill="${APEX_MUTE}">${tier.toUpperCase()}</text>` : ''}`;
  } else if (state === 'reserved') {
    subline = `<text x="${W / 2}" y="455" text-anchor="middle"
      font-family="Newsreader" font-style="italic" font-weight="300" font-size="34" fill="${APEX_DIM}">Held in reserve by the protocol.</text>`;
  }

  // Footer — varies by state.
  let footerLeft = '';
  if (state === 'profile') {
    footerLeft = `inscribed at block ${opts.block ?? '12,345,678'} · expires ${opts.expires ?? '2027-05-27'}`;
  } else if (state === 'available') {
    footerLeft = 'available now · commit to claim';
  } else {
    footerLeft = 'reserved names are not for sale';
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <style>@import url('${FONTS}');</style>
    <radialGradient id="dawn-${sfx}" cx="50%" cy="92%" r="60%">
      <stop offset="0%" stop-color="${AMBER}" stop-opacity="0.38"/>
      <stop offset="45%" stop-color="#C44536" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="${NIGHT}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="rise-${sfx}" x1="0" y1="0" x2="1" y2="0.4">
      <stop offset="0%" stop-color="#C9BBD6"/>
      <stop offset="100%" stop-color="#7E5C95"/>
    </linearGradient>
    <radialGradient id="vignette-${sfx}" cx="50%" cy="38%" r="75%">
      <stop offset="60%" stop-color="${NIGHT}" stop-opacity="0"/>
      <stop offset="100%" stop-color="#05060F" stop-opacity="0.6"/>
    </radialGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="${NIGHT}"/>
  <rect width="${W}" height="${H}" fill="url(#dawn-${sfx})"/>
  <rect width="${W}" height="${H}" fill="url(#vignette-${sfx})"/>

  <!-- header -->
  <circle cx="138" cy="58" r="7" fill="${AMBER}"/>
  <text x="162" y="64" font-family="JetBrains Mono" font-size="16" letter-spacing="4" fill="${APEX_DIM}">RNS · RISECHAIN NAME SERVICE</text>
  <g>
    <rect x="${W - 200}" y="40" width="120" height="38" rx="19" fill="none" stroke="${dot}" stroke-opacity="0.6"/>
    <circle cx="${W - 176}" cy="59" r="5" fill="${dot}"/>
    <text x="${W - 160}" y="64" font-family="JetBrains Mono" font-size="15" letter-spacing="2" fill="${dot}">${label}</text>
  </g>

  <!-- avatar -->
  <svg x="${avatarX}" y="${avatarY}" width="${avatarBox}" height="${avatarBox}" viewBox="0 0 256 256">
    ${avatarInner(name, sfx)}
  </svg>

  <!-- name -->
  <text x="${avatarX + avatarBox + 40}" y="${nameY}" font-family="Newsreader" font-weight="300" font-size="${nameSize}" fill="${APEX}">${stem}<tspan fill="${AMBER}">.</tspan><tspan font-style="italic" fill="url(#rise-${sfx})">${tld}</tspan></text>

  ${subline}

  <!-- horizon ruler -->
  ${horizonRuler(500)}

  <!-- footer -->
  <text x="80" y="588" font-family="JetBrains Mono" font-size="16" letter-spacing="1" fill="${APEX_DIM}">${footerLeft}</text>
  <text x="${W - 80}" y="588" text-anchor="end" font-family="JetBrains Mono" font-size="16" letter-spacing="1" fill="${AMBER}">rns.rise</text>
</svg>`;
}
