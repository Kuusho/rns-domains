# RNS generative identity — avatars (D-07) + link previews (D-19)

Deterministic, name-derived brand assets. One algorithm produces both the in-app avatar and the 1200×630 OG link-preview card. No runtime canvas; pure SVG today, satori-portable tomorrow.

## Run it

```bash
# From the repo root (resolves viem from root node_modules — no install needed)
bun run frontend/generative/generate.ts

# Then view
python3 -m http.server --directory frontend/generative/out 8081
# open http://localhost:8081
```

Output lands in `frontend/generative/out/` (gitignore-able): 12 avatar SVGs, 5 OG cards, and an `index.html` gallery.

## The algorithm (D-07)

```
b     = keccak256(namehash(name)).slice(0, 6)   // via viem
hue1  = b[0] * 360 / 255
hue2  = (hue1 + 30 + b[1] % 90) % 360            // analogous-ish, never clashes
comp  = b[2] % 4    // radial | linear | banded | split
glyph = b[3] % 6    // sun | aperture | orbit | arc | diamond | chain
rot   = b[4] * 360 / 255
sat   = 55 + b[5] % 25
```

Two values the brand deck left unspecified are pinned in `src/tokens.ts`:
`AVATAR_L1 = 58` and `AVATAR_L2 = 44` (the gradient lightness stops). Adjust there to
re-tune every avatar at once.

## Layout

```
frontend/generative/
├── README.md
├── generate.ts          ← CLI: render 12 avatars + 3 OG states + gallery
├── src/
│   ├── hash.ts          ← name → 6 bytes (viem keccak256·namehash)
│   ├── tokens.ts        ← Solar Genesis palette + lightness stops
│   ├── avatar.ts        ← avatarParams() + renderAvatar() + avatarInner()
│   └── og.ts            ← renderOg(name, state, opts) — 1200×630, 3 states
└── out/                 ← generated (run the CLI)
```

## Two things worth knowing

1. **The deck's name→glyph pairings are illustrative, not algorithmic.** The brand slide
   hand-picked which glyph sat on `alice` vs `max` to show the vocabulary. The *real*
   algorithm assigns glyphs by hash, so `alice.rise` here is `split · arc`, not the deck's
   `sun`. The visual *language* matches the deck; the specific mappings are whatever the
   hash dictates (that's the point of determinism). If a specific marquee name must have a
   specific glyph, that's a curation layer on top, not a change to the algorithm.

2. **This is pure SVG, not satori — by design, for now.** The byte→visual-params mapping
   (`avatarParams`, the comp/glyph functions) is the valuable, portable core. Moving to the
   production satori pipeline means re-expressing the same params as JSX/flexbox so
   `@vercel/og` can embed font binaries and emit PNG at the edge. The geometry math ports
   unchanged. Until there's a Next.js app to host the OG route, pure SVG is the fastest way
   to *see* the system and iterate on it.

## satori-porting checklist (when the Next.js app exists)

- satori has **no `<filter>`/blur** — the dawn glow and any soft edges must stay as
  radial-gradient overlays (already done that way here).
- satori needs **font binaries loaded explicitly** (`Newsreader`, `JetBrains Mono`) — the
  `@import` in `og.ts` is browser-only; swap for satori's `fonts` option.
- satori does linear + radial gradients (fine) but **no conic** (not used here).
- Keep `avatarParams()` as the single source of truth; render it twice (avatar route +
  OG route) rather than duplicating the math.
