# RNS Frontend — Full Specification

> **Status:** in design. Two brand directions are documented in parallel (Solar Genesis and Brutalist Protocol). A final decision happens after this spec has been stress-tested against the full feature surface. The mockups in `frontend/mockups/` are the visual reference; this document is the contract.

---

## Table of contents

0. [Two directions, one decision later](#0-two-directions-one-decision-later)
1. [Brand foundations](#1-brand-foundations)
2. [Voice and copy](#2-voice-and-copy)
3. [Motion language](#3-motion-language)
4. [Information architecture](#4-information-architecture)
5. [Feature inventory](#5-feature-inventory)
6. [Screen specifications](#6-screen-specifications)
7. [Differentiation playbook](#7-differentiation-playbook)
8. [Delight and easter eggs](#8-delight-and-easter-eggs)
9. [Component inventory](#9-component-inventory)
10. [States and edge cases](#10-states-and-edge-cases)
11. [Technical implementation](#11-technical-implementation)
12. [Accessibility](#12-accessibility)
13. [Open decisions](#13-open-decisions)
14. [Build order](#14-build-order)

---

## 0. Two directions, one decision later

The frontend will ship in **one** of two directions, not both, not blended. We are documenting both because:

1. Each direction makes a different brand promise. Locking that promise before designing the full feature surface risks making a promise the features can't keep.
2. Some features look obvious in one direction and absurd in the other (e.g., "live mempool feed" is a feature in Brutalist, a violation in Solar Genesis).
3. The decision criterion is not "which is prettier" but "which one carries the full app naturally over twelve months."

The spec resolves to a single direction at the end of §14.

---

## 1. Brand foundations

### 1.1 Solar Genesis

**Promise:** *Registering a name is a meaningful moment in your life. It is the first light of an on-chain identity that will persist as long as the chain does.*

**Palette**

| Token | Hex | Role |
|---|---|---|
| `--night` | `#0A0E27` | Default background |
| `--indigo` | `#3D1B6E` | Deep accent, gradient stop, secondary CTAs |
| `--dawn` | `#C44536` | Alerts, primary state changes, gradient hot stop |
| `--amber` | `#F4A261` | Primary CTAs, highlights, brand accent |
| `--apex` | `#FFEFD5` | Primary text on dark, brightest highlights |
| `--apex-dim` | `rgba(255, 239, 213, 0.65)` | Secondary text |
| `--apex-mute` | `rgba(255, 239, 213, 0.32)` | Tertiary text, dividers |
| `--hair` | `rgba(255, 239, 213, 0.12)` | Hairline borders, card edges |

Gradient signatures (use sparingly, never decoratively — only at brand moments):
- **Dawn**: `linear-gradient(180deg, var(--amber) 0%, var(--dawn) 100%)` — on the name itself, on key headlines
- **Atmosphere**: `radial-gradient(ellipse 80% 50% at 50% 110%, rgba(244, 162, 97, 0.35) 0%, transparent 60%)` — background ambience, never decoration

**Typography**

| Family | Use | License |
|---|---|---|
| **Newsreader** (variable) | Display, headlines, the name itself | Google Fonts (OFL) |
| **Inter** | Body, UI, navigation | Google Fonts (OFL) |
| **JetBrains Mono** | Technical: addresses, hashes, block numbers, kickers, microcopy labels | Google Fonts (OFL) |

Type rules:
- Headlines: Newsreader, weight 200, italic for emphasis, never above weight 400
- Body: Inter, weight 400 (300 for large display body, 500 for buttons)
- Always tracking-tight at display sizes (`letter-spacing: -0.02em` on 56px+)
- The italic variant of Newsreader is the brand's signature — it appears wherever we lean in (the name itself, the brand mark, sub-headlines)
- Numbers in code/technical contexts are always JetBrains Mono with `font-variant-numeric: tabular-nums`

**Iconography**

- Line icons only, 1.5px stroke, no fills
- Custom drawn — no Material/Heroicons. Specific RNS marks: sunrise (3-line ascending), reverse (rotating arc), commit (sealed envelope), reveal (unsealed envelope with light), record (engraved card)
- Icons are 16px or 24px. Never larger.

**Surface treatment**

- Cards: 24px radius, 1px hair border, 4% white tint background, `backdrop-filter: blur(20px)` over the ambient gradient
- Buttons: pill (999px radius), no shadows, color is the affordance
- Inputs: 999px radius pills, focused state adds a subtle dawn-colored glow (`0 0 80px rgba(244, 162, 97, 0.15)`)

### 1.2 Brutalist Protocol

**Promise:** *This is infrastructure, not a product. It does one job and it does it without asking you to like it.*

**Palette**

| Token | Hex | Role |
|---|---|---|
| `--paper` | `#FFFFFF` | Default background |
| `--ink` | `#000000` | Primary text, borders, key UI surfaces |
| `--alert` | `#FF3D00` | Single accent — used only for state changes (available, committed, revealed, expired) |
| `--under` | `#1A1A1A` | Secondary borders, hover states |
| `--sub` | `#E8E8E8` | Disabled, secondary surfaces, table-row alternation |
| `--dim` | `#707070` | Secondary text |

Hard rules:
- **Zero gradients.** A gradient anywhere violates the brand.
- **Zero shadows.** Depth is conveyed by borders only.
- **One accent color.** The alert orange is the ONLY non-grayscale color in the entire app. Multiple accents = brand violation.

**Typography**

| Family | Use | License |
|---|---|---|
| **JetBrains Mono** (variable) | Everything | Google Fonts (OFL) |

Type rules:
- Mono everywhere. No display font. No body sans.
- Weights: 400 body, 500 medium emphasis, 700 strong, 800 headlines
- All UPPERCASE for headlines, labels, navigation, buttons
- Italic reserved for system tokens (`/system/`, `<placeholder>`) — never for emphasis
- Letter-spacing: `-0.04em` for display (48px+), `0` for body, `0.08em` for uppercase labels, `0.16em` for nav/uppercase decorative labels

**Iconography**

- ASCII characters only — `■ ● ▢ ◇ → ← ↑ ↓ ✓ ✗ █ ░ ▓`
- Use the actual unicode glyphs as icons; no SVG icons at all
- Status indicators are typographic: `[OK]`, `[ERR]`, `STATUS: AVAILABLE`, `● ACTIVE`

**Surface treatment**

- Cards: 0px radius (sharp corners), 2px solid black borders, no background tint
- Buttons: rectangular, 2px borders, color affordance comes from border + fill (no shadow on click — color shift only)
- Inputs: rectangular with thick borders, focus state changes border to alert orange
- Dividers: 2px between sections, 1px between rows in tables

---

## 2. Voice and copy

### 2.1 Solar Genesis voice

**Personality:** Reverent, editorial, almost devotional. The first paragraph of a New Yorker profile, not a startup blog post. Plain words, precise verbs, occasional italics for inflection.

**Don't write:**
- "🚀 Lock in your name today!"
- "Mint your unique on-chain identity!"
- "Get started in 60 seconds"

**Do write:**
- "A name is the first thing you give yourself."
- "Held in trust for sixty seconds. Then yours, forever."
- "Inscribed at block 12,345,678."

**Copy patterns**

| Moment | Solar voice |
|---|---|
| Name available | *"alice — open. The first light of your on-chain identity. From 0.005 ETH per year."* |
| Name taken | *"alice was claimed by 0xab12…cd34 on May 27, 2026."* |
| Reserved name | *"This name is held in reserve. Reserved names belong to the protocol — they are not for sale."* |
| Allowlist required | *"This name is open only to early addresses. You'll need an invitation to claim it."* |
| Commit successful | *"Your commit is sealed. The reveal opens at sunrise."* (where sunrise = +60s) |
| Wait state | *"Held in trust. Sixty seconds. Then yours, forever."* |
| Registration successful | *"Inscribed at block 12,345,678. Welcome home."* |
| Renewal successful | *"Your name extends to May 27, 2028. Light stays on."* |
| Empty state (no owned names) | *"No names yet. Every identity begins with one."* |
| Error (tx reverted) | *"The chain refused this transaction. No funds moved. Reason: \[Reverted: NotAuthorised\]."* |
| Wallet disconnected | *"Sign in to see what's yours."* |
| Wrong network | *"You're on Ethereum. RNS lives on RiseChain. Switch?"* |

**Notes:**
- Names are lowercase always: `alice.rise`, never `Alice.Rise`
- The TLD `.rise` is sometimes italicized for tonal emphasis (`alice<em>.rise</em>`)
- Numbers in copy use commas: `12,345,678`
- Times use ISO 8601 in technical contexts, "May 27, 2026" in body copy
- The word "mint" is forbidden — names are *claimed*, *inscribed*, *registered*

### 2.2 Brutalist Protocol voice

**Personality:** Terminal manpage. Postal service receipt. A bus schedule. Says what it does, then stops talking.

**Don't write:**
- "Welcome to RNS! ✨"
- "Your unique blockchain identity awaits..."
- Anything friendly

**Do write:**
- "STATUS: AVAILABLE"
- "QUERY RETURNED. NAME IS YOURS TO TAKE."
- "DO NOT CLOSE TAB."

**Copy patterns**

| Moment | Brutalist voice |
|---|---|
| Name available | *"`> alice.rise` — STATUS: AVAILABLE / FLOOR: 0.005 ETH/YR / COMMIT? \[Y/n\]_"* |
| Name taken | *"`> alice.rise` — STATUS: TAKEN / OWNER: 0xab12…cd34 / EXPIRES: 2027-05-26"* |
| Reserved name | *"`> alice.rise` — STATUS: RESERVED / RESERVED_BY: PROTOCOL"* |
| Allowlist required | *"`> alice.rise` — STATUS: GATED / ALLOWLIST_REQUIRED: TRUE / YOUR_ADDR: NOT_IN_LIST"* |
| Commit successful | *"\[OK\] COMMITMENT HASH: 0x8f3a…d2b9 / REVEAL_WINDOW_OPENS: 60s"* |
| Wait state | *"REVEAL WINDOW: 38s / DO NOT CLOSE TAB"* (with cursor blink) |
| Registration successful | *"\[OK\] REGISTERED. TX: 0xabcd…1234 / BLOCK: 12,345,678 / NAME: alice.rise"* |
| Renewal successful | *"\[OK\] RENEWED. EXPIRES: 2028-05-27 / TX: 0x..."* |
| Empty state (no owned names) | *"NO NAMES OWNED. QUERY ABOVE TO FIND ONE."* |
| Error (tx reverted) | *"\[ERR\] TX REVERTED. REASON: NotAuthorised. NO_FUNDS_MOVED."* |
| Wallet disconnected | *"\[?] WALLET: NOT CONNECTED. CONNECT TO PROCEED."* |
| Wrong network | *"\[!] WRONG CHAIN. EXPECTED: 11155931 (RISECHAIN TESTNET). ACTUAL: 1 (ETHEREUM)."* |

**Notes:**
- ALL CAPS for headlines, labels, navigation, error messages
- Lowercase for the names themselves (`alice.rise` is still lowercase even in caps context — it's a name, not a label)
- Brackets for status: `[OK]`, `[ERR]`, `[!]`, `[?]`
- `>` prefix for commands the system is performing
- Underscores `_` and bullet characters `●` instead of spaces or icons
- Numbers always tabular, never spelled out: `60s`, not `sixty seconds`
- No emoji. Ever.

---

## 3. Motion language

### 3.1 Universal principles (both directions)

**Every motion must answer "why."** If a transition exists, it should communicate something about state — never decoration.

**Respect `prefers-reduced-motion: reduce`:**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
  }
}
```

When reduced motion is set, the app still shows state changes — just instantly. No state is hidden behind animation alone.

**Performance:**
- Only animate `transform`, `opacity`, and `filter`. Anything else is a bug.
- Use `will-change` sparingly and remove it after the animation
- Avoid simultaneous animations on >5 elements; sequence them

### 3.2 Solar Genesis grammar

**Easing curve:** `cubic-bezier(0.2, 0.7, 0.2, 1)` — slow, reverent rises, no overshoot

**Durations:**
- Hover/focus: 400ms
- Page section reveal: 800ms
- Major state change (commit → wait → registered): 1200ms
- The 60s wait progress: linear 60,000ms

**Motion vocabulary:**
- **Rise**: `translateY(40px) → translateY(0)` + opacity 0 → 1. Used on section reveals.
- **Dawn**: a glow that brightens and expands. Used on registration confirmation.
- **Sealed → Sunrise**: an envelope-like UI element transitioning from sealed to opening with light spilling out. Used at the commit → reveal transition.
- **Pulse**: very slow (1.6s) opacity breathing on live elements (block-height ticker). Not a heartbeat — a tide.

**Sequenced reveals on landing:**
1. Kicker text rises (0.0–1.2s)
2. Headline rises (0.1–1.4s, overlapping)
3. Sub-paragraph rises (0.2–1.4s)
4. Search input rises (0.3–1.4s)

Stagger is `100ms`. Total perceived "page settling" should feel like 1–1.5 seconds.

**The wait state animation:**
- Background atmospheric gradient drifts upward over 60s (slow `translateY` of the radial gradient)
- Countdown number changes are crossfaded (200ms), never snap-cut
- The progress bar fills linearly, with the gradient inside it cycling through indigo → dawn → amber as it fills
- A subtle "horizon line" appears across the page (1px hair gradient) and slowly rises with the countdown

### 3.3 Brutalist Protocol grammar

**Easing:** `steps(1)` — no easing. Every transition is a hard cut, except progress bars which are linear.

**Durations:**
- Hover: 80ms (effectively instant, just enough to register)
- State changes: instant
- Cursor blink: `1s steps(2) infinite`
- Progress bar: linear 60,000ms

**Motion vocabulary:**
- **Cut**: instant change of color, border, or text. No fade.
- **Blink**: `1s steps(2)` cursor underscore. Only on active text input or active wait state.
- **Tick**: terminal lines appear character-by-character at 16ms/char on first render. Used for terminal output blocks.
- **Scanline drift**: background `repeating-linear-gradient` of 1px horizontal lines drifting upward at 8s/loop. Used on the wait state, never elsewhere.
- **Marquee**: horizontal scrolling text for live status bars (block height, chain ID). 30s/loop, hover to pause.

**The wait state animation:**
- Terminal lines tick into place on first render (60ms each)
- Block height counter increments in tabular mono, hard-cutting between numbers (no smooth count-up)
- Progress bar is solid orange filling left-to-right, linear 60s
- "REVEAL WINDOW OPENS IN: 38s" text — the seconds number hard-cuts every second
- Cursor blinks at the end of the last line, indicating the system is "waiting for input" (the chain)

**What Brutalist does NOT have:**
- No fades. None.
- No slides. None.
- No springs. None.
- No parallax. None.
- No scroll-triggered animations beyond the section that's currently in view.
- No mouse-following effects.

---

## 4. Information architecture

### 4.1 Routes

```
/                            Landing — search bar + value prop + live registration feed
/search?q=alice              Search results (canonical search URL)
/name/alice                  Pre-registration detail page for alice.rise
/name/alice/commit           Commit step (browser-isolated, can be left and returned to)
/name/alice/wait             The 60s wait (live countdown, can be left and returned to)
/name/alice/register         Final register step
/name/alice/manage           Owner-only management (records, primary, renew)
/name/alice                  Public profile (when registered) — fallback to manage if owner

/me                          Connected wallet's owned names dashboard
/me/notifications            Expiry warnings, allowlist updates

/allowlist                   Standalone allowlist verifier — enter address, see status
/reserved                    Reserved name explainer + full list
/launch                      Launch status page (controlled-launch theatre)
/stats                       Public protocol stats (block height, names registered, etc.)
/docs                        Developer documentation (links to GitHub + Davit's docs)
```

URL contract:
- `/name/alice` is canonical and SEO-indexable. Public-readable name profiles live here.
- The registration flow (commit → wait → register) is path-stateful, not modal. Users can leave and come back; the state is recoverable from on-chain commitment data.
- `/me` requires a connected wallet. Without a wallet, redirect to `/` with a "connect to see your names" prompt.

### 4.2 Navigation

**Top nav (both directions):**

| Link | Path | Visible when |
|---|---|---|
| Logo / brand mark | `/` | Always |
| Names | `/search` | Always |
| My identity | `/me` | Wallet connected |
| Docs | `/docs` | Always |
| Connect wallet | (action) | Wallet disconnected |
| `0xFe8E…6Ad1` chip | (popover → disconnect) | Wallet connected |

**Live status (top nav, Brutalist only; subtle in Solar):**
- Block height counter (RiseChain testnet/mainnet)
- Chain ID badge
- "Live" pulse dot

### 4.3 Wallet and chain state machine

```
DISCONNECTED → CONNECTING → CONNECTED → WRONG_CHAIN → CONNECTED
                            ↓                          ↑
                            DISCONNECTED ← user action ┘
```

States the UI must handle:
1. **Disconnected** — wallet button visible, all gated routes redirect home
2. **Connecting** — button shows spinner/cursor
3. **Connected, wrong chain** — banner appears asking to switch to RiseChain (chainId 11155931)
4. **Connected, right chain** — normal operation
5. **Connected, RPC failing** — non-blocking banner: "RPC degraded. Showing cached data."

The wrong-chain banner is direction-specific:
- **Solar**: warm but firm: "*You're on Ethereum. RNS lives on RiseChain.*  \[Switch network →\]"
- **Brutalist**: blunt: "\[!\] WRONG CHAIN. EXPECTED: 11155931. SWITCH? \[Y/n\]"

### 4.4 Registration state machine (the cinematic core)

```
SEARCH → AVAILABLE → COMMIT_PENDING → COMMIT_CONFIRMED → WAITING (60s) → READY_TO_REVEAL → REVEAL_PENDING → REGISTERED
                  ↘ TAKEN
                  ↘ RESERVED
                  ↘ ALLOWLIST_GATED
```

Each transition is a visual state change, not a page navigation. The URL changes for shareability/back-button-safety, but the page itself transforms in place. This makes the flow feel like a single object changing form, not a sequence of pages.

**Critical state**: `WAITING` is **recoverable**. If the user closes the tab, comes back later, and the 60s window is still open, the page should detect the existing commitment (via `block.timestamp` and the `commitments[hash]` mapping) and resume the countdown.

---

## 5. Feature inventory

### 5.1 Core flows (must-haves)

| ID | Feature | Contract surface | Priority |
|---|---|---|---|
| F-01 | Name availability search | `available(uint256 labelhash)` + `commitments[hash]` | P0 |
| F-02 | Commit transaction | `commit(bytes32 commitment)` | P0 |
| F-03 | 60s reveal window | `commitments[hash]` block-timestamp read | P0 |
| F-04 | Register transaction | `register(Registration)` | P0 |
| F-05 | Renewal | `renew(string name, uint256 duration)` | P0 |
| F-06 | Set primary name | `ReverseRegistrar.setName(string)` | P0 |
| F-07 | Set default reverse name | `DefaultReverseRegistrar.setName(string)` | P0 |
| F-08 | Set resolver records (addr, avatar, text, contenthash) | `PublicResolver.setAddr` + multicallWithNodeCheck | P0 |
| F-09 | Withdraw (owner only — protocol treasury) | `withdraw()` | P2 |
| F-10 | Reserved name display | `reserved[labelhash]` view | P0 |
| F-11 | Allowlist check | `allowlistRoot` + merkle proof | P0 |

### 5.2 Discovery features

| ID | Feature | Notes | Priority |
|---|---|---|---|
| F-12 | Owned names dashboard | Pull via subgraph or event scan | P0 |
| F-13 | Public profile pages (`/name/alice`) | SSR'd, OG-image generated | P1 |
| F-14 | Search suggestions | Common typos, length-tier hints | P1 |
| F-15 | Live registration feed | Last 50 names registered | P1 |
| F-16 | Allowlist verifier (standalone) | Public tool, no wallet needed | P1 |
| F-17 | Stats page (`/stats`) | Block height, names registered, allowlist size | P2 |
| F-18 | Reserved name explainer | Why and which names are reserved | P1 |
| F-19 | Launch status page | Pre-launch, during-launch, post-launch states | P1 |
| F-20 | Expiry notifications | Banner + `/me/notifications` page | P2 |

### 5.3 Social features (the differentiation surface)

| ID | Feature | Notes | Priority |
|---|---|---|---|
| F-21 | Shareable profile cards | Auto-generated OG image per `/name/alice` | P1 |
| F-22 | "Inscribed at block N" badge | Permanent identity moment | P1 |
| F-23 | First-name-of-block badge | Tiny, optional, generative | P2 |
| F-24 | Generative avatar from namehash | Deterministic visual derived from `namehash(name)` | P1 |
| F-25 | Guestbook on public profile (off-chain) | Phase 7 |
| F-26 | Name constellation view | Group of related names registered by same address | P3 |

### 5.4 Admin / protocol-team features

| ID | Feature | Notes | Priority |
|---|---|---|---|
| F-27 | endLaunch trigger UI | Owner-only, behind `/admin` route | P0 |
| F-28 | Reserved name management | Owner-only | P1 |
| F-29 | Allowlist root update | Owner-only | P0 |
| F-30 | Price-tier display (read from oracle) | All users | P0 |

---

## 6. Screen specifications

> Each screen is documented with: **Purpose**, **Content**, **Layout**, **Motion**, and per-direction **Copy variants**.

### 6.1 Landing (`/`)

**Purpose:** Make a first impression that's worth screenshotting, communicate the product in one breath, and route the user to a search.

**Content:**
- Top nav (logo, Names link, Docs link, Connect wallet button)
- Hero with kicker + headline + subhead + search input
- Live registration feed (last 20 names, scrolling)
- "Why a .rise name" section (3 columns: identity / for humans and agents / instant)
- Footer with tagline

**Layout:**
- Single-column, viewport-height hero
- Live feed below the fold, full-width
- Three-column section, ~1200px max-width
- Footer with tagline + brand mark + minimal links

**Motion (Solar):**
- Hero: staggered rise of kicker → headline → sub → search (1.2s total)
- Background: atmospheric gradient drifts subtly (10s, infinite, ease-in-out)
- Live feed: names appear at the top, push others down (200ms slide-down each)

**Motion (Brutalist):**
- Hero: no entrance animation; renders instantly
- Block-height counter in top nav: hard-cuts on each new block (every ~187ms — yes, really; debounce to 1s if it feels too noisy)
- Live feed: new names hard-cut into the top of the list, no slide

**Copy:**
- **Solar headline**: *Claim the first **light** of your on-chain name.*
- **Solar sub**: *One name. One identity. One sunrise. Every .rise name you mint becomes a permanent record of who you are.*
- **Brutalist headline**: *NAMES FOR THE .RISE ERA*
- **Brutalist sub**: *A NAME SERVICE FOR RISECHAIN. COMMIT. REVEAL. REGISTER. NO DECORATION. NO LOYALTY PROGRAM. JUST OWNERSHIP.*

### 6.2 Search results (`/search?q=alice`)

**Purpose:** Show whether `alice` is available, and surface alternatives (similar names, length-tier suggestions).

**Content:**
- Top of page: the exact query result (big, hero-sized)
- "Suggestions" section: alternatives if the exact query is taken or reserved
- "Recently registered similar names" (Brutal: as a table; Solar: as a constellation of small chips)

**Layout:**
- Hero-sized result card (same as `/name/alice` minus the management surface)
- Suggestions in a 3-column grid below

**States:**
- AVAILABLE → bright, prominent CTA
- TAKEN → muted, secondary CTA ("see profile")
- RESERVED → distinct visual, link to `/reserved` explainer
- ALLOWLIST_GATED → distinct visual, link to `/allowlist` to check status

**Motion:**
- The result card animates IN on search submit (Solar: rise from below, 400ms; Brutalist: hard cut)
- Subsequent searches replace the card in-place (Solar: crossfade 200ms; Brutalist: cut)

### 6.3 Name detail / pre-registration (`/name/alice`)

The single most important screen in the entire app. Spec this richly.

**Purpose:** A page that exists for every conceivable name, indexable by search engines, shareable on social media, and that converts to registration if the visitor is the right person.

**Content (AVAILABLE state):**
- The name itself, rendered enormous (96-160px display type)
- Status badge ("Open · No allowlist" or "Open · 5-char tier" etc.)
- Price (per year, in ETH, with USD conversion as small text)
- Tier explainer (3-char premium, 4-char premium, 5+ standard)
- CTA: "Commit to claim"
- Below the fold: "What you get" — the records you can set, primary name capability, renewal rules
- Footer: similar names + length-tier examples

**Content (TAKEN state — public profile):**
- The name itself, enormous
- Avatar (from records or generative fallback)
- Bio / description (from text records)
- All public records (addr, twitter, website, etc.)
- "Inscribed at block N" badge
- "Expires on May 27, 2027" with subtle expiry warning if within 30 days
- If viewer is the owner: management CTA appears

**Content (RESERVED state):**
- The name, muted
- "Reserved" badge
- A paragraph explaining the reservation reasoning (Solar: gentle; Brutal: blunt)
- Link to `/reserved` for the full list

**Layout:**
- 2-column on desktop: left = name + meta, right = records/records-to-set
- Single-column on mobile: name → records → CTA

**Motion (Solar):**
- The name itself appears with a slow rise + dawn-gradient text fill animating in (the gradient sweeps top-to-bottom over 800ms)
- "Inscribed at block N" badge appears last, with a subtle glow pulse on first render
- Hovering over the name produces a very subtle scale (1.0 → 1.01, 600ms cubic-bezier)

**Motion (Brutalist):**
- The name appears instantly
- The records table types in row-by-row (60ms per row)
- Hovering over the name shows the namehash on the right side of the screen as a typed-out hint (`namehash: 0xa1b2…c3d4`)

**Easter egg:** Triple-click on the name to reveal a generative avatar based on its namehash, even if no avatar record is set.

### 6.4 Commit confirmation (`/name/alice/commit`)

**Purpose:** The moment between "I want this name" and "the chain has my commitment." Should feel like signing your name in a notary's book.

**Content:**
- Single centered card: the name, the price, the commitment hash being computed live
- Secret reveal: the 32-byte "secret" the commit uses (with a tooltip explaining what it is — most users don't know)
- A primary CTA "Sign commit transaction"
- A subtle "What is a commit?" explainer (collapsed by default)

**Motion (Solar):**
- The commit hash appears character-by-character as it's computed (typewriter effect, 600ms)
- After signing, the card "seals" — a horizontal line draws across it, a "sealed" stamp appears, then the card slides up off-screen and is replaced by the wait state

**Motion (Brutalist):**
- Terminal log appears:
  ```
  > Computing commitment hash...
  > namehash("alice.rise") = 0xa1b2c3d4...
  > secret = 0x9f8e7d6c... (random, kept client-side until reveal)
  > commitment = keccak256(...) = 0x8f3a...d2b9
  > AWAITING SIGNATURE...
  ```
- After signing, the line `> [OK] COMMITTED IN BLOCK 12,345,678` types out
- Page hard-cuts to the wait state

### 6.5 The wait (`/name/alice/wait`)

**This is the single screen most likely to be screenshot and shared.** Spec it lavishly.

**Purpose:** Make sixty seconds of forced inactivity feel like a feature. Most apps treat the wait as a tax to apologize for. We treat it as a moment with shape.

**Content (both directions):**
- Massive countdown (200px+ display type)
- The name, secondary
- Commit hash, block, owner address (compact technical strip)
- Progress bar (gradient in Solar, solid in Brutalist)
- A line of copy about what the wait IS (anti-frontrunning, sealed commit, etc.)

**Content (Solar specific):**
- Atmospheric background that brightens over 60s (the wait literally feels like dawn)
- A subtle horizon line that rises with the countdown
- Block height ticker showing every block (~5 per second on RiseChain) appearing as faint hairs of light along the horizon
- Last 6 seconds: the page brightens noticeably, the countdown grows slightly, the gradient saturates

**Content (Brutalist specific):**
- Terminal-style output above the countdown
- Live block height counter, hard-cutting every block
- Mempool-adjacent feed: other addresses making commitments / registrations (anonymized, not specifically related to your name)
- Scanline drift overlay
- Cursor blinks at the end of the last terminal line

**Motion:**

**Solar:**
- Background gradient drifts upward and brightens over 60s (linear)
- Countdown crossfades between numbers (200ms)
- Progress bar fills linearly, color cycling through indigo → dawn → amber
- At 0s: a flash of light, then the page transitions to the register step

**Brutalist:**
- Background scanline overlay drifts at 8s/loop
- Countdown hard-cuts every second
- Progress bar fills solid orange, linear
- Terminal lines tick in at 60ms each on first render, then static
- At 0s: terminal prints `> [OK] REVEAL WINDOW OPEN. ▶ EXECUTE REGISTER.`, cursor blinks faster (500ms)

**Cross-device sync:** If the user opens the wait on a second device with the same wallet, the countdown should match (it's derived from `block.timestamp - commitTimestamp`). This is a small detail that says "this is a protocol, not an app."

**Easter egg:** If the user leaves the tab and comes back at exactly the moment the reveal window opens, the page should automatically begin the register transaction (with their confirmation). Less waiting, more momentum.

### 6.6 Register / confirmation (`/name/alice/register`)

**Purpose:** The reveal moment. The opposite of the commit's sealing.

**Content:**
- The name, even larger than before
- "You're claiming alice.rise for 1 year"
- Total cost breakdown (base + premium + gas estimate)
- Optional records to set during registration (avatar URL, primary name toggle, default reverse toggle)
- Primary CTA: "Sign register transaction"

**Motion (Solar):**
- The "sealed" envelope from the commit step appears at the top
- On signing, the envelope "opens" — a line of light spills out
- After the tx confirms, a full-page dawn animation: the gradient saturates dramatically over 1.2s, the name appears in its final form with the dawn gradient fill, and a "Welcome home." line types out below

**Motion (Brutalist):**
- Terminal:
  ```
  > register("alice", owner=0xFe8E…6Ad1, duration=365d, ...)
  > AWAITING SIGNATURE...
  ```
- On signing:
  ```
  > [OK] REGISTERED. TX: 0xabcd…1234
  > BLOCK: 12,345,678 · GAS: 187,432 · COST: 0.0052 ETH
  > alice.rise NOW OWNED BY 0xFe8E…6Ad1
  ```
- Hard cut to the public profile page

### 6.7 My identity dashboard (`/me`)

**Purpose:** Show all names the connected wallet owns, with quick-action affordances per name.

**Content:**
- Header: "You own N names"
- Sort options: by expiry, by registration date, by length, alphabetical
- Filter: expiring soon, primary name set, no records set
- Grid (Solar) or table (Brutalist) of owned names
- Each name shows: the name itself, expiry countdown, "primary" badge if set as primary, records-set count
- Per-name actions: manage, renew, set as primary, transfer (Phase 7)

**Motion (Solar):**
- Names appear in a staggered rise (50ms stagger)
- Hovering reveals a subtle expansion: card grows ~4px in height, "Manage →" appears

**Motion (Brutalist):**
- Table renders in a single hard cut
- Hover changes row background to `--sub` (light gray)
- The "EXPIRES IN" column updates live every minute (block-tied)

### 6.8 Name management (`/name/alice/manage`)

**Purpose:** Owner-only surface for editing records, setting primary, renewing.

**Content:**
- Header: the name, "You own this"
- Records section: list of currently-set records with edit affordances
- "Set as primary name" toggle
- "Set as default reverse name" toggle (with explainer of the difference)
- Renew section: "Expires in N days. Renew for: 1 year / 3 years / 5 years / custom"
- Danger zone: transfer ownership (Phase 7), burn name (out of scope)

**Motion (both):**
- Records section uses inline editing — click a record value to edit it
- Saved records flash green for 600ms (Solar: glow; Brutalist: background flash, hard cuts on/off)

### 6.9 Public profile (`/name/alice` when TAKEN, viewed by non-owner)

Already covered in §6.3. Worth emphasizing: this page should be **gorgeous on its own**, even printed. The OG image for this URL should be a real, designed image — not a default Twitter card. See F-21.

### 6.10 Allowlist verifier (`/allowlist`)

**Purpose:** A standalone tool, no wallet required. Anyone can paste an address and learn whether it's on the allowlist.

**Content:**
- Address input
- Submit button
- Result: in or out, with merkle proof if in
- "How does the allowlist work?" explainer
- Pre-launch: a "join the allowlist" CTA pointing to wherever the protocol team is collecting allowlist addresses

**Motion (Solar):**
- Result appears with a dawn glow if in-list, a muted indigo state if not
- The merkle proof (if in-list) types out below in JetBrains Mono

**Motion (Brutalist):**
- Terminal-style result:
  ```
  > query allowlist for 0xFe8E…6Ad1
  > [OK] ADDRESS IN ALLOWLIST.
  > MERKLE PROOF (use during register):
    0xabcd…1234
    0xefgh…5678
    0xijkl…9abc
  ```

### 6.11 Reserved name explainer (`/reserved`)

**Purpose:** Educate users on which names are reserved and why. Most projects hide this; we explain it openly because doing so reduces support tickets and trust friction.

**Content:**
- Top: "RNS reserves 24 names. Here's why."
- List of all 24 reserved names with the reason for each (brand, protocol, ecosystem partner)
- "Why reserve names at all?" paragraph (Solar: thoughtful; Brutalist: blunt)
- "Can a reserved name ever become available?" Q&A

### 6.12 Launch status (`/launch`)

**Purpose:** Theatre. The launch is a moment; the launch page acknowledges and dramatizes it.

**States:**
- **Pre-launch**: countdown to launch, allowlist sign-up CTA, the "what is RNS" pitch
- **During launch (allowlist only)**: "Allowlist registrations open. Public registrations open in N days."
- **Public-launch live**: "Public registrations are open. Anyone with a wallet can register."
- **Post-launch**: a permanent monument to when the launch happened, with stats (registrations in the first hour/day/week)

The `endLaunch()` contract function transitions states 3 → 4. The frontend reads `endLaunchBlock` to determine which state to show.

**Motion (Solar):**
- Pre-launch: a sun-rising-over-horizon animation, very slow (the sun is genuinely below the horizon and rises as the launch date approaches — over real-world hours)
- Launch moment: the sun crests the horizon, full dawn animation
- Post-launch: the sun is high; the page is bright

**Motion (Brutalist):**
- Pre-launch: a single line countdown in big mono digits (`COUNTDOWN: 03d 14h 22m 11s`)
- Launch moment: hard cut to "LAUNCH: ACTIVE. ALLOWLIST PHASE."
- Post-launch: hard cut to "LAUNCH: PUBLIC. ALL ADDRESSES PERMITTED."

### 6.13 Stats (`/stats`)

**Purpose:** Public-facing protocol dashboard. Block height, total names registered, allowlist size, current price tiers.

**Hidden via Konami code on the homepage:** `↑↑↓↓←→←→BA` reveals a "developer" view of the stats page with raw event logs, gas usage, recent reverts. Just for fun.

### 6.14 404 / disconnected / error pages

**404 (Solar):** *This name doesn't exist yet. Maybe you should claim it.* (with the searched string in the input)
**404 (Brutalist):** `> PATH NOT FOUND. RETURN? [Y/n]`

**RPC down:** Both directions show a non-blocking banner explaining the chain is unreachable, with a "retry" affordance. The app degrades gracefully — cached data is shown where possible.

---

## 7. Differentiation playbook

The 20 things RNS does that other domain frontends don't (numbered for argument; not all need to ship at launch).

### D-01. The wait is cinema, not a tax

Most domain frontends treat the commit-reveal wait as a spinner. RNS treats it as the most-shareable screen in the product. See §6.5.

### D-02. Live block-height heartbeat

RiseChain's 187ms blocks are unusual. The app shows the chain ticking live — in the top nav, in the wait state, in the registration feed. This is unique because most chains have slow enough blocks that "live" is barely visible. On RiseChain, the chain feels *alive*.

### D-03. Public, beautifully-designed profile pages

Every `.rise` name has a public URL (`/name/alice`) that's SSR'd, indexable, and **gorgeous on its own**. The OG image is a real designed image, not a default Twitter card. People should *want* to put their .rise name in their bio just because the profile page exists.

### D-04. Reserved-name theatre

Most projects hide reservations. RNS publishes the full list and the reasoning. Trust through transparency.

### D-05. Allowlist as a public tool

The `/allowlist` verifier works without a wallet. Anyone can check any address. This is generosity — most projects gate allowlist info behind connecting a wallet.

### D-06. First-name-of-block badges

Names registered as the first transaction of a block get a small permanent badge: "First name of block 12,345,678." Generative trivia that gives some names a tiny narrative.

### D-07. Generative avatars from namehash

Names without avatar records auto-generate a deterministic visual from `namehash(name)` — based on hash bytes, derive a unique two-tone gradient + glyph. Means *every* profile has a beautiful default, not the usual gray circle.

### D-08. Sound design (opt-in)

A subtle chime when commit confirms, when reveal opens, when register lands. Defaults off; toggleable in settings. When on, contributes to the cinematic feel of the registration moment.

### D-09. Bundled transactions

"Claim alice.rise + set as primary + set avatar from this URL" as a single transaction via `multicallWithNodeCheck`. Most apps do this as 3-4 sequential transactions; RNS bundles them. Faster + cheaper.

### D-10. Cross-device wait state sync

If you start the commit on desktop, the wait state continues on mobile if you open the same URL there with the same wallet. Block-timestamp-derived; works without any backend.

### D-11. Recovery from interrupted commits

If a user commits and closes the tab, returning to `/name/alice/commit` later shows them their existing commitment and offers to resume the wait (if still in window) or restart (if expired). No commitment is ever "lost."

### D-12. Length-tier visualization

3-char names get a distinct visual signature. 4-char names another. 5+-char names another. The tier is signaled in palette / weight / scale — not just in price.

### D-13. Inscribed at block N

Every registered name has a permanent "Inscribed at block N" badge on its public profile. Anchors the name in time on the chain itself. Becomes a personal artifact.

### D-14. Renewal seasons

Renewal isn't a chore — it's a "you've held this name for 234 days" celebration. Slight motion + copy lift around renewal. Brutal version: terse but accurate. Solar version: reverent.

### D-15. Pre-launch countdown

The `/launch` page becomes a thing-to-bookmark before the launch. Real countdown, real allowlist gates, real protocol theatre.

### D-16. The endLaunch() moment

When the protocol team triggers `endLaunch()`, the entire app subtly shifts visual state. Pre-launch surfaces (allowlist gates, "launching soon" banners) disappear; the launch monument appears on `/launch`. Doing this in real time, visibly, makes the launch feel like a *moment*.

### D-17. Stats are public and live

`/stats` shows protocol health in real time — names registered today, block height, gas, allowlist remaining. Most projects keep this private. We publish it.

### D-18. Dev mode (Konami stats)

`↑↑↓↓←→←→BA` on the homepage reveals raw event logs, gas estimates, recent contract reverts. A subtle nod to crypto-natives who'll appreciate it.

### D-19. RNS-rendered text in the OG image

Profile OG images are server-rendered with the user's name in **Newsreader italic** (Solar) or **JetBrains Mono** (Brutalist) — at proper display size, with the right palette. When shared on Twitter/Farcaster, the link card *is* the brand.

### D-20. No bullshit modals

Other domain frontends interrupt you with newsletter signups, cookie banners, "would you like notifications" prompts, "join our Discord" interstitials. RNS has **none** of these. The only modal in the entire app is the wallet signer (which the wallet itself owns).

---

## 8. Delight and easter eggs

Specific, implementable, opinionated. Not every direction should ship every easter egg; many are direction-specific.

### E-01. Type a famous name → bespoke explanation

If a user searches for `vitalik`, `elon`, `satoshi`, etc., return a custom message: "*This name is reserved for the person, not the trader. It will never be available.*" (Solar) or `> RESERVED. SUBJECT: PERSON_OF_NOTE. NOT_FOR_SALE.` (Brutalist).

### E-02. Konami code → dev stats panel

Hidden on the homepage. Triggers a slide-down panel with raw event logs, recent registrations, gas stats. Niche, but the kind of detail that gets a small group of users to love the app.

### E-03. The 60s wait has a subtle interactive element

**Solar**: clicking-and-holding anywhere during the wait causes a brief flash of light at the click point, like striking a match. Doesn't affect anything; just a fidget toy for impatient users.

**Brutalist**: typing during the wait shows the keys as terminal output (`> KEYSTROKE: a / b / c ...`). Same vibe — fidget toy.

### E-04. First registration of the day

The first registration after midnight UTC (chain time) gets a small "First of day" badge on its profile. Permanent.

### E-05. Self-referential names

If you register `rise.rise`, `name.rise`, `service.rise`, or any other self-referential name, you get a small "meta" badge on the profile. Cute, harmless.

### E-06. Anniversary celebrations

On the year-anniversary of a name's registration, the public profile page shows a subtle "celebrating year 1" treatment for that day (Solar: extra glow; Brutalist: a single line at the top: `> ANNIVERSARY. 1 YEAR ON-CHAIN.`).

### E-07. Generative avatar from namehash (already in D-07)

### E-08. Sound on opt-in (already in D-08)

### E-09. Loading shimmer that respects the brand

Loading skeletons are direction-specific. **Solar**: hair-thin gradient lines that pulse slowly. **Brutalist**: a single `LOADING...` line with a cursor blink.

### E-10. Easter egg in the source

A polite comment on every page: `<!-- If you're reading this, hello. Names are at /search. -->` (Solar) or `<!-- HUMAN_OR_AGENT: WELCOME. ENDPOINTS: /search /name /me -->` (Brutalist).

### E-11. The "rise" verb in copy

Across the entire Solar Genesis copy, the word "rise" never appears as a noun (the brand) without somewhere nearby being a verb (to rise). Tiny linguistic consistency: the brand and the action are the same word.

### E-12. Block-height as time

Some UI elements show time in blocks instead of seconds ("Reveal opens in 19 blocks" instead of "38 seconds"). This is a tiny detail that says "this product is chain-native."

---

## 9. Component inventory

### 9.1 Atoms

- `<NameText>` — renders a `.rise` name in the brand's display font, with appropriate gradient/styling. Variants: `xs / sm / md / lg / xl / display`
- `<Address>` — renders an 0x address as `0xFe8E…6Ad1`, with copy-on-click affordance. Variants: `inline / chip / monospace-full`
- `<Hash>` — same but for hashes (block hash, tx hash, commitment hash)
- `<BlockHeight>` — live block height ticker, optionally with chain label
- `<Countdown>` — large countdown to a target time/block. Variants: `display / inline`
- `<Price>` — renders ETH amount, optional USD conversion, variants for tier-specific styling
- `<Badge>` — status badges. Variants: `available / taken / reserved / gated / primary / expiring`
- `<Glyph>` — icon/glyph wrapper. Solar uses 1.5px-stroke line icons; Brutalist uses unicode characters.

### 9.2 Molecules

- `<NameCard>` — name + status badge + price + CTA. Used in search results and dashboards.
- `<RecordRow>` — key/value pair representing a single resolver record. Editable variant for `/manage`.
- `<TransactionStatus>` — shows the current state of a signed tx (pending, confirmed, failed)
- `<NetworkBanner>` — wrong-chain warning, RPC-down warning, etc.
- `<CommitProgress>` — the 60s wait progress bar + countdown.
- `<ProfileHero>` — the name + avatar + bio combination at the top of `/name/alice`.

### 9.3 Organisms

- `<Nav>` — top navigation with logo, links, status, connect button
- `<SearchHero>` — hero section with search input and brand headline
- `<NameDetailLayout>` — the full layout for `/name/alice` in any state
- `<WaitState>` — the full 60s wait screen
- `<RegistrationFeed>` — live feed of recently-registered names
- `<MyNamesDashboard>` — the `/me` view

### 9.4 Per-direction variants

Components like `<NameText>`, `<Badge>`, `<Glyph>` have direction-specific implementations. The architecture should support this via either:
- A theme provider with direction-aware Tailwind tokens, OR
- Separate component implementations per direction (e.g., `<NameTextSolar>` and `<NameTextBrutalist>`) with a routing layer

I recommend a theme provider with **CSS custom properties** for palette + radius + spacing, and **conditional class names** for the per-direction component overrides (Brutalist's mono-only, Solar's mixed type families).

---

## 10. States and edge cases

For each screen / flow, the implementation must handle:

| State | Solar copy | Brutalist copy |
|---|---|---|
| Loading | Hair-thin pulsing gradient skeleton | `LOADING…` with cursor blink |
| Empty | "No names yet. Every identity begins with one." | "NO RESULTS. QUERY ABOVE TO FIND ONE." |
| Error (network) | "We can't reach the chain right now." | "\[ERR\] RPC UNREACHABLE." |
| Error (tx revert) | "The chain refused this transaction. No funds moved. Reason: …" | "\[ERR\] TX REVERTED. REASON: … NO_FUNDS_MOVED." |
| Wallet disconnected | "Sign in to see what's yours." | "\[?\] WALLET: NOT CONNECTED." |
| Wrong network | "You're on Ethereum. RNS lives on RiseChain. Switch?" | "\[!\] WRONG CHAIN. EXPECTED: 11155931." |
| Insufficient balance | "You'll need 0.005 ETH plus gas to claim this name." | "\[!\] BAL: 0.001 ETH. REQUIRED: 0.007 ETH." |
| Commit window expired | "Your commit expired. You can commit again." | "\[!\] COMMIT EXPIRED. RECOMMIT? \[Y/n\]" |
| Reveal too early | "The reveal window opens in N seconds." | "\[!\] REVEAL_WINDOW: NOT_YET. ETA: 38s." |
| Name registered between commit and reveal (frontrun guard) | "The name was claimed by someone with an earlier commit. You weren't charged." | "\[ERR\] FRONTRUN_GUARD_FIRED. CLAIM_BY: 0x... NO_CHARGE." |
| Reserved name | "This name is held in reserve. Reserved names belong to the protocol — they are not for sale." | "STATUS: RESERVED. RESERVED_BY: PROTOCOL." |
| Allowlist gated | "This name is open only to early addresses. You'll need an invitation to claim it." | "STATUS: GATED. ALLOWLIST_REQUIRED. CHECK: /allowlist." |
| Expiring soon (owner only) | "alice.rise expires in 12 days. Renew?" | "\[!\] alice.rise EXPIRES IN 12d. RENEW? \[Y/n\]" |
| Expired (owner only, grace period) | "alice.rise has expired. You have N days to renew before anyone can claim it." | "\[!\] alice.rise EXPIRED. GRACE: Nd. RENEW NOW." |

---

## 11. Technical implementation

### 11.1 Recommended stack

| Layer | Choice | Reasoning |
|---|---|---|
| **Framework** | Next.js 15 (App Router) | SSR for public profile pages, React Server Components for static parts of the registration flow, Edge runtime for OG image generation |
| **Styling** | Tailwind CSS v4 | Token-friendly, fast, plays well with the design-token approach |
| **UI primitives** | shadcn/ui (heavily restyled) | Good accessibility defaults; not visible at the surface |
| **Wallet** | wagmi v2 + viem | The current standard; works with RainbowKit or ConnectKit for the connect modal |
| **Chain reads** | viem + TanStack Query | Caching + revalidation patterns are mature |
| **Indexing** | A subgraph (TheGraph or alternative) for owned-name lookups | Reading all events from a fresh chain is fine; over time, an indexer is needed |
| **Hosting** | Vercel | Edge runtime, fast OG images, low ops |
| **Domain** | `rns.rise` (eventually, dogfooded), pre-launch on a `rns.xyz` or similar |

### 11.2 Animation libraries

**Solar Genesis:**
- **Motion** (`motion/react`, formerly Framer Motion) for component-level animation, layout transitions, and gestures
- **GSAP** for the dawn animations on the wait state and registration confirmation — they're complex multi-element timelines that justify GSAP
- **Lenis** for smooth scroll (only if scroll-tied animations are added; otherwise skip)
- **Generative avatars**: Canvas API or SVG, deterministic from `namehash(name)`

**Brutalist Protocol:**
- **No JS animation library.** Pure CSS animations and View Transitions API for cross-page state changes
- `steps()` keyframes for blink/tick effects
- Light usage of CSS `@property` for animatable custom properties

### 11.3 Wallet integration

- Connect modal: **RainbowKit** (familiar) or **ConnectKit** (more customizable). Recommend ConnectKit because the connect modal is high-visibility brand surface and we want full control of its styling.
- Supported wallets at launch: MetaMask, WalletConnect (covers Rabby/Frame/etc.), Coinbase Wallet
- Chain switch: programmatic via `useSwitchChain`. If switch fails, show the manual instructions for adding RiseChain to MetaMask.
- ENS-style name pre-resolution: if a user pastes a `.rise` name where an address is expected (e.g., transfer), resolve it client-side via the resolver contracts and show the matched address before signing.

### 11.4 RPC patterns

- **Reads via TanStack Query with 5-second stale time** for live data (block height, registration feed)
- **Reads via TanStack Query with 60-second stale time** for stable data (record values, name expiry)
- **Subscribe to new blocks** via `viem`'s `watchBlocks` for the live-block-height ticker
- **Listen for events** for the live registration feed: `NameRegistered`, `NameRenewed`, `NameTransferred`
- **Optimistic UI** for the commit and register transactions — show the next state immediately, reconcile when the tx confirms

### 11.5 Image / asset pipeline

- **OG images** generated at edge runtime using `@vercel/og` (satori under the hood)
- Each `/name/alice` URL gets a custom OG image with the name in display type, the avatar (if set, else generative), and brand styling
- **Generative avatar fallback** rendered as SVG, deterministic from `keccak256(namehash(name))` — two-tone gradient + a single rotating glyph derived from byte 0 of the hash
- **No client-side image processing** beyond the avatar SVG — keep the bundle tiny

### 11.6 Deployment

- Vercel (or Cloudflare Pages) — edge runtime for OG images, ISR for `/name/alice` pages that don't change often
- Two domains:
  - `rns.rise` (eventually self-hosted on the protocol's own name)
  - `app.rns.rise` for the dApp
  - `rns.xyz` or similar as a pre-launch parking domain
- HTTPS with HSTS, basic security headers

---

## 12. Accessibility

- **WCAG 2.2 AA minimum** for color contrast. Brutalist passes trivially; Solar needs care around the amber-on-night combinations (check `--apex-dim` and `--apex-mute` against `--night`).
- **All interactive elements keyboard accessible**, with visible focus indicators (Solar: dawn-colored ring; Brutalist: 2px alert border)
- **`prefers-reduced-motion` honored** — see §3.1
- **Screen reader hierarchy**: every screen has a single H1, sensible heading order, and `aria-label` on icon-only buttons
- **Live regions** for state changes — when the commit confirms, the wait countdown begins, the registration lands, those are announced via `aria-live="polite"`
- **The countdown is announced at 60s, 30s, 10s, and 0s** — not every second (which would be hostile)
- **Color is never the only signal** — every state (available, taken, reserved, gated) has a text label too

---

## 13. Open decisions

These are decisions we need to make before implementation begins. They're not blocked by the spec; they shape it.

1. **Single direction or themeable both?** Default: pick one. Themeable both is a feature creep that doubles maintenance.
2. **Dark mode for Brutalist? Light mode for Solar?** Default: no — each direction has one mode. Themeable both is feature creep.
3. **Subgraph vs direct event scanning** for owned-name lookups? Default: subgraph (TheGraph or self-hosted). Direct event scanning is fine pre-launch, too slow at scale.
4. **What's the pre-launch domain?** `rns.xyz`, `rns.app`, `getrns.com`, something else?
5. **Wallet allowlist size at launch.** Determines how the merkle proof is delivered to allowlist members.
6. **Sound design**: ship at launch or post? Default: post-launch (opt-in, polish layer).
7. **Generative avatar algorithm.** Specific design (which gradient palette per hash byte, what glyph library) is its own mini-design exercise.
8. **OG image styling.** Solar's OG image is straightforward (name in Newsreader italic, dawn gradient). Brutalist's OG image needs care — pure black-and-white with one orange accent is striking but might not pop in social feeds.
9. **Analytics.** Do we want analytics? If yes, Plausible (privacy-first) or Vercel Analytics. Default: yes, Plausible.
10. **The `/launch` countdown timing.** Set by the protocol team. Frontend honors `block.timestamp` plus a configured launch block.
11. **Renewal pricing display.** Show ETH only or ETH + USD? Default: ETH primary, USD secondary (small).
12. **Allowlist verifier presence pre-launch.** Ship it before launch as a parking-page tool? Default: yes — it's a low-effort, high-signal piece of brand presence.

---

## 14. Build order

If we shipped this end-to-end, the order would be:

**Phase A — Foundation (2-3 weeks)**
1. Project scaffold: Next.js + Tailwind + wagmi + viem
2. Design tokens for chosen direction
3. Component library: atoms + molecules
4. Wallet integration + chain switch
5. Reads against the deployed contracts (search, name details, owned names)

**Phase B — Core registration flow (2-3 weeks)**
6. Search → results
7. Name detail (AVAILABLE state)
8. Commit transaction + commit confirmation page
9. The 60s wait state (the marquee feature)
10. Register transaction + confirmation
11. Recovery from interrupted commits (D-11)

**Phase C — Public surface (1-2 weeks)**
12. Public profile pages (`/name/alice`)
13. OG image generation
14. Generative avatar fallback
15. Live registration feed

**Phase D — Ownership surface (1-2 weeks)**
16. `/me` dashboard
17. `/name/alice/manage` (records, primary, renew)
18. Notifications / expiry warnings

**Phase E — Differentiation (1-2 weeks)**
19. `/allowlist` verifier
20. `/reserved` explainer
21. `/launch` page + countdown / states
22. `/stats` page
23. Easter eggs (Konami, anniversary, first-of-block badges)

**Phase F — Polish (1 week)**
24. Sound design (opt-in)
25. Accessibility audit + fixes
26. Mobile-specific tuning
27. Performance pass (LCP < 1.5s, CLS = 0)
28. Final OG image design

**Total**: ~9-13 weeks for a single direction, single developer + designer. Halving with a team of three.

---

## Choosing a direction (the framework)

When we lock direction, the question is not "which is prettier" but:

1. **Which one carries the full feature surface naturally?** Look at §6 — Solar's wait state is beautiful; Brutalist's wait state is iconic. Which is more important for the brand promise?
2. **Which one ages better?** Solar's editorial-serif palette has 10+ years of staying power (it's the New Yorker school). Brutalist's terminal aesthetic has 5+ years of cultural ascendance but may be peaking.
3. **Which audience does the brand promise reach?** Solar tilts toward identity-conscious early adopters who think of their name as meaningful. Brutalist tilts toward crypto-natives who prefer "no bullshit." R2's agentic infrastructure brings a third audience (agents and the people who build them) who may prefer Brutalist's machine-readable aesthetic — but that audience is downstream of the product, not the launch.
4. **What does Davit / the protocol team think?** They're going to live with this for years.
5. **Which one would you (the operator) be proud of in a year when someone asks "did you build that"?**

Decision rule: pick the one that makes the *registration* moment feel most unforgettable. That's where the brand promise is kept or broken. Everything else flows from there.

---

*Last updated: 2026-05-27. Status: draft for review. After direction is chosen, this document is split into `BRAND.md` (foundations + voice + motion) and `FEATURES.md` (everything from §4 onward).*
