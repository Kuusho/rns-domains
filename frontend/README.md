# RNS Frontend Track

This directory holds the frontend design + implementation for the **RiseChain Name Service** registration app.

The contract layer (Phase 1-6) is the product; the frontend is the surface where users actually meet the product. Decisions here are independent of the contract decisions and should not back-pressure them.

## Status

Two brand directions remain in contention: **Solar Genesis** and **Brutalist Protocol**. (Agentic Field was dropped after the first review.) The full specification covering both directions — palette, typography, voice, motion, every screen, the differentiation playbook, easter eggs, tech stack, and a build order — lives in [`SPEC.md`](SPEC.md). A single direction will be chosen against the criteria in §14 of that document.

## Layout

```
frontend/
├── README.md                      ← this file
├── SPEC.md                        ← full spec (brand + features + motion + tech)
└── mockups/
    ├── index.html                 ← gallery / chooser
    ├── 01-solar-genesis.html      ← warm, editorial, reverent
    ├── 02-brutalist-protocol.html ← mono terminal, single accent
    └── 03-agentic-field.html      ← (archived from first review)
```

## Viewing the mockups

```bash
# Recommended — serve over HTTP (some browsers gate fonts on file://)
python3 -m http.server --directory frontend/mockups 8080
# then open http://localhost:8080

# Alternate
bunx serve frontend/mockups          # may need: bunx -p serve serve
xdg-open frontend/mockups/index.html # direct open, no server
```

Each mockup uses Google Fonts CDN — no build step.

## How to read the spec

`SPEC.md` is organized so you can dip in at any section without losing context:

- **§1-3**: brand foundations (palette, type, voice, motion) per direction
- **§4**: information architecture (routes, navigation, state machines)
- **§5**: feature inventory (30 features, prioritized)
- **§6**: screen specifications (14 screens, per-direction motion + copy variants)
- **§7**: the differentiation playbook — 20 things RNS does that other domain frontends don't
- **§8**: delight + easter eggs
- **§9-12**: components, edge cases, tech stack, accessibility
- **§13**: open decisions (12 items needing input)
- **§14**: build order and the decision framework

## Comparing the two remaining directions

Each mockup contains the same four moments:
1. **Hero / search** — first impression, the name input
2. **"Name available" state** — what a successful search looks like
3. **Commit-reveal wait** — the 60-second window between commit and register (the most-shareable screen)
4. **Profile preview** — what a registered `.rise` name looks like on a public page

The spec adds many more screens (`/me`, `/allowlist`, `/launch`, `/reserved`, `/stats`, the management surface) and walks each one through both directions.

## Next steps

1. Read `SPEC.md` end-to-end (or skim §6 + §7 if pressed for time)
2. Decide direction using the framework in §14
3. After lock-in: split `SPEC.md` into `BRAND.md` (foundations only) + `FEATURES.md` (everything else)
4. Begin Phase A of the build order (foundation: Next.js + Tailwind + wagmi + design tokens)
